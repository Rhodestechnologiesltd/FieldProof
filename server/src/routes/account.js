import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { wrap, parse, badRequest, forbidden } from '../lib/errors.js';
import { requireUser, publicUser, clearSession } from '../auth.js';
import { audit } from '../lib/services.js';
import { LANGS } from './auth.js';

/** Remove personal details from a user record while keeping job history (BR-14). */
export function anonymiseUser(ctx, userId) {
  ctx.db.prepare(
    `UPDATE users SET name = 'Deleted user', email = NULL, phone = NULL, password_hash = NULL,
       status = 'deleted', token_version = token_version + 1 WHERE id = ?`,
  ).run(userId);
  ctx.db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(userId);
  ctx.db.prepare("UPDATE tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL").run(ctx.now().toISOString(), userId);
}

/** Households are private people: remove their name, contact details and home location. */
export function anonymiseCustomer(ctx, customerId) {
  const c = ctx.db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  if (!c) return;
  ctx.db.prepare("UPDATE customers SET name = ?, email = NULL, phone = NULL, deleted_at = ? WHERE id = ?")
    .run(`Deleted customer #${c.id}`, ctx.now().toISOString(), c.id);
  if (c.type === 'household') {
    ctx.db.prepare("UPDATE sites SET name = 'Deleted site', address = NULL, lat = NULL, lng = NULL, access_notes = NULL, active = 0 WHERE customer_id = ?")
      .run(c.id);
  }
}

export default function accountRoutes(ctx) {
  const r = Router();
  r.use(requireUser);

  r.get('/', (req, res) => {
    const company = req.company;
    res.json({
      user: publicUser(req.user),
      company: { id: company.id, name: company.name, currency: company.currency, timezone: company.timezone },
    });
  });

  r.patch('/', wrap((req, res) => {
    const body = parse(z.object({
      name: z.string().trim().min(1).max(120).optional(),
      phone: z.string().trim().max(40).nullable().optional(),
      lang: z.enum(LANGS).optional(),
    }), req.body);
    const u = req.user;
    ctx.db.prepare('UPDATE users SET name = ?, phone = ?, lang = ? WHERE id = ?')
      .run(body.name ?? u.name, body.phone === undefined ? u.phone : body.phone, body.lang ?? u.lang, u.id);
    res.json({ user: publicUser(ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
  }));

  r.post('/password', wrap(async (req, res) => {
    const body = parse(z.object({ current: z.string().min(1), next: z.string().min(8).max(200) }), req.body);
    if (!(await bcrypt.compare(body.current, req.user.password_hash || ''))) throw badRequest('BAD_CREDENTIALS');
    ctx.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(body.next, 10), req.user.id);
    audit(ctx, { companyId: req.user.company_id, actorId: req.user.id, action: 'user.password_change', entity: 'user', entityId: req.user.id });
    res.json({ ok: true });
  }));

  // NFR-08: privacy notice + location consent recorded at first sign-in.
  r.post('/consent', (req, res) => {
    const now = ctx.now().toISOString();
    ctx.db.prepare('UPDATE users SET consent_at = ? WHERE id = ?').run(now, req.user.id);
    audit(ctx, { companyId: req.user.company_id, actorId: req.user.id, action: 'user.consent', entity: 'user', entityId: req.user.id });
    res.json({ consentAt: now });
  });

  // NFR-08: a copy of the personal data held about the signed-in user.
  r.get('/export', (req, res) => {
    const id = req.user.id;
    const db = ctx.db;
    const data = {
      exportedAt: ctx.now().toISOString(),
      profile: publicUser(req.user),
      workerProfile: db.prepare('SELECT base_salary_amount, base_salary_basis, availability FROM worker_profiles WHERE user_id = ?').get(id) || null,
      skills: db.prepare('SELECT s.name FROM user_skills us JOIN skills s ON s.id = us.skill_id WHERE us.user_id = ?').all(id).map((s) => s.name),
      assignments: db.prepare('SELECT job_id, pay_basis, pay_rate, assigned_at FROM assignments WHERE worker_id = ?').all(id),
      attendance: db.prepare('SELECT job_id, kind, lat, lng, accuracy_m, distance_m, verified, reason, at, device_time, offline FROM attendance WHERE worker_id = ?').all(id),
      arrivalConfirmations: db.prepare('SELECT job_id, status, reason, at FROM arrivals WHERE by_user = ?').all(id),
      decisions: db.prepare('SELECT job_id, decision, reason_code, comment, rating, at FROM decisions WHERE by_user = ?').all(id),
      notifications: db.prepare('SELECT type, job_id, params, created_at, read_at FROM notifications WHERE user_id = ?').all(id),
      activity: db.prepare('SELECT action, entity, entity_id, at FROM audit_log WHERE actor_id = ? ORDER BY id DESC LIMIT 1000').all(id),
    };
    res.setHeader('Content-Disposition', 'attachment; filename="my-fieldproof-data.json"');
    res.json(data);
  });

  // FR-ACC-06: customers delete their own account. Staff accounts are removed by an admin.
  r.delete('/', wrap((req, res) => {
    const u = req.user;
    if (u.role !== 'customer') throw forbidden('STAFF_DELETE_VIA_ADMIN');
    ctx.db.transaction(() => {
      audit(ctx, { companyId: u.company_id, actorId: u.id, action: 'user.delete_self', entity: 'user', entityId: u.id });
      anonymiseUser(ctx, u.id);
      const others = ctx.db.prepare("SELECT COUNT(*) n FROM users WHERE customer_id = ? AND status <> 'deleted'").get(u.customer_id).n;
      const customer = ctx.db.prepare('SELECT * FROM customers WHERE id = ?').get(u.customer_id);
      if (customer && customer.type === 'household' && others === 0) anonymiseCustomer(ctx, customer.id);
    })();
    clearSession(ctx, res);
    res.json({ ok: true });
  }));

  return r;
}
