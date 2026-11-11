// Company setup: settings, skills, people, customers and sites, services and checklists.
import { Router } from 'express';
import { z } from 'zod';
import { wrap, parse, notFound, conflict, badRequest } from '../lib/errors.js';
import { requireRole, publicUser } from '../auth.js';
import { audit } from '../lib/services.js';
import { LANGS, sendInvite } from './auth.js';
import { anonymiseUser, anonymiseCustomer } from './account.js';

const id = z.coerce.number().int().positive();
const money = z.coerce.number().min(0).max(1e9);
const checklistItem = z.object({
  label: z.string().trim().min(1).max(200),
  type: z.enum(['tick', 'photo', 'note', 'number']).default('tick'),
  required: z.boolean().default(true),
});
export const payBasis = z.enum(['salary', 'hourly', 'daily', 'fixed']);

function companyRow(ctx, companyId) {
  return ctx.db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
}

function setUserSkills(ctx, companyId, userId, skillIds) {
  ctx.db.prepare('DELETE FROM user_skills WHERE user_id = ?').run(userId);
  const ok = ctx.db.prepare('SELECT id FROM skills WHERE id = ? AND company_id = ?');
  const ins = ctx.db.prepare('INSERT INTO user_skills (user_id, skill_id) VALUES (?, ?)');
  for (const s of skillIds) if (ok.get(s, companyId)) ins.run(userId, s);
}

function personView(ctx, u) {
  const profile = ctx.db.prepare('SELECT * FROM worker_profiles WHERE user_id = ?').get(u.id);
  const skills = ctx.db.prepare('SELECT skill_id FROM user_skills WHERE user_id = ?').all(u.id).map((r) => r.skill_id);
  return {
    ...publicUser(u),
    skills,
    baseSalaryAmount: profile?.base_salary_amount ?? 0,
    baseSalaryBasis: profile?.base_salary_basis ?? 'none',
    availability: profile ? JSON.parse(profile.availability) : [1, 2, 3, 4, 5],
  };
}

function siteView(s) {
  return {
    id: s.id, customerId: s.customer_id, name: s.name, address: s.address, lat: s.lat, lng: s.lng,
    radiusM: s.radius_m, accessNotes: s.access_notes, active: Boolean(s.active),
  };
}

function serviceView(ctx, s) {
  return {
    id: s.id, name: s.name, description: s.description, slaText: s.sla_text, slaHours: s.sla_hours,
    defaultPayBasis: s.default_pay_basis, defaultPayRate: s.default_pay_rate,
    checklist: JSON.parse(s.checklist), active: Boolean(s.active),
    skills: ctx.db.prepare('SELECT skill_id FROM service_skills WHERE service_id = ?').all(s.id).map((r) => r.skill_id),
  };
}

export default function setupRoutes(ctx) {
  const r = Router();
  const staff = requireRole('admin', 'supervisor');
  const admin = requireRole('admin');
  const a = (req, action, entity, entityId, data) =>
    audit(ctx, { companyId: req.user.company_id, actorId: req.user.id, action, entity, entityId, data });

  // ---------- Company settings (business rule defaults, section 8) ----------
  r.get('/company', staff, (req, res) => res.json(companyRow(ctx, req.user.company_id)));

  r.patch('/company', admin, wrap((req, res) => {
    const body = parse(z.object({
      name: z.string().trim().min(2).max(120),
      timezone: z.string().min(1).max(60),
      currency: z.string().trim().length(3).transform((s) => s.toUpperCase()),
      default_lang: z.enum(LANGS),
      arrival_autoconfirm_min: z.coerce.number().int().min(5).max(1440),
      approval_autoapprove_hours: z.coerce.number().int().min(1).max(720),
      default_radius_m: z.coerce.number().int().min(20).max(5000),
      gps_accuracy_max_m: z.coerce.number().int().min(10).max(1000),
      checkin_early_min: z.coerce.number().int().min(0).max(720),
      late_grace_min: z.coerce.number().int().min(0).max(240),
      max_rework: z.coerce.number().int().min(0).max(10),
    }).partial(), req.body);
    try { if (body.timezone) new Intl.DateTimeFormat('en', { timeZone: body.timezone }); } catch { throw badRequest('BAD_TIMEZONE'); }
    const current = companyRow(ctx, req.user.company_id);
    const next = { ...current, ...body };
    ctx.db.prepare(
      `UPDATE companies SET name=@name, timezone=@timezone, currency=@currency, default_lang=@default_lang,
        arrival_autoconfirm_min=@arrival_autoconfirm_min, approval_autoapprove_hours=@approval_autoapprove_hours,
        default_radius_m=@default_radius_m, gps_accuracy_max_m=@gps_accuracy_max_m, checkin_early_min=@checkin_early_min,
        late_grace_min=@late_grace_min, max_rework=@max_rework WHERE id=@id`,
    ).run(next);
    a(req, 'company.update', 'company', current.id, body);
    res.json(companyRow(ctx, current.id));
  }));

  // ---------- Skills ----------
  r.get('/skills', staff, (req, res) =>
    res.json(ctx.db.prepare('SELECT id, name FROM skills WHERE company_id = ? ORDER BY name').all(req.user.company_id)));

  r.post('/skills', admin, wrap((req, res) => {
    const body = parse(z.object({ name: z.string().trim().min(1).max(60) }), req.body);
    try {
      const info = ctx.db.prepare('INSERT INTO skills (company_id, name) VALUES (?, ?)').run(req.user.company_id, body.name);
      a(req, 'skill.create', 'skill', Number(info.lastInsertRowid), body);
      res.status(201).json({ id: Number(info.lastInsertRowid), name: body.name });
    } catch {
      throw conflict('SKILL_EXISTS');
    }
  }));

  r.delete('/skills/:id', admin, wrap((req, res) => {
    const info = ctx.db.prepare('DELETE FROM skills WHERE id = ? AND company_id = ?').run(Number(req.params.id), req.user.company_id);
    if (!info.changes) throw notFound();
    a(req, 'skill.delete', 'skill', Number(req.params.id));
    res.json({ ok: true });
  }));

  // ---------- People: admins, supervisors, workers, customer contacts ----------
  r.get('/people', staff, wrap((req, res) => {
    const role = req.query.role;
    const params = [req.user.company_id];
    let sql = "SELECT * FROM users WHERE company_id = ? AND status <> 'deleted'";
    if (role) { sql += ' AND role = ?'; params.push(String(role)); }
    if (req.user.role === 'supervisor') {
      // Supervisors see their own team and themselves, and other supervisors' names for context only.
      sql += " AND (supervisor_id = ? OR id = ? OR role = 'customer')";
      params.push(req.user.id, req.user.id);
    }
    if (req.query.customerId) { sql += ' AND customer_id = ?'; params.push(Number(req.query.customerId)); }
    sql += ' ORDER BY role, name';
    res.json(ctx.db.prepare(sql).all(...params).map((u) => personView(ctx, u)));
  }));

  const personBody = z.object({
    role: z.enum(['admin', 'supervisor', 'worker', 'customer']),
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().email().max(200).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    lang: z.enum(LANGS).optional(),
    customerId: id.nullable().optional(),
    supervisorId: id.nullable().optional(),
    skills: z.array(id).default([]),
    baseSalaryAmount: money.default(0),
    baseSalaryBasis: z.enum(['none', 'monthly', 'hourly']).default('none'),
    availability: z.array(z.number().int().min(1).max(7)).default([1, 2, 3, 4, 5]),
  });

  // Zod 4 applies .default() values even inside .partial(), so PATCH bodies use their own schema without defaults.
  const personPatch = z.object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().email().max(200).nullable(),
    phone: z.string().trim().max(40).nullable(),
    lang: z.enum(LANGS),
    supervisorId: id.nullable(),
    skills: z.array(id),
    baseSalaryAmount: money,
    baseSalaryBasis: z.enum(['none', 'monthly', 'hourly']),
    availability: z.array(z.number().int().min(1).max(7)),
  }).partial();

  r.post('/people', admin, wrap((req, res) => {
    const body = parse(personBody, req.body);
    if (!body.email) throw badRequest('EMAIL_REQUIRED');
    if (body.role === 'customer') {
      const c = body.customerId && ctx.db.prepare('SELECT 1 FROM customers WHERE id = ? AND company_id = ?').get(body.customerId, req.user.company_id);
      if (!c) throw badRequest('CUSTOMER_REQUIRED');
    }
    if (body.supervisorId) {
      const s = ctx.db.prepare("SELECT 1 FROM users WHERE id = ? AND company_id = ? AND role = 'supervisor'").get(body.supervisorId, req.user.company_id);
      if (!s) throw badRequest('BAD_SUPERVISOR');
    }
    if (ctx.db.prepare("SELECT 1 FROM users WHERE lower(email) = ? AND status <> 'deleted'").get(body.email)) throw conflict('EMAIL_TAKEN');
    const company = companyRow(ctx, req.user.company_id);
    const now = ctx.now().toISOString();
    const user = ctx.db.transaction(() => {
      const info = ctx.db.prepare(
        `INSERT INTO users (company_id, role, name, email, phone, lang, status, customer_id, supervisor_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'invited', ?, ?, ?)`,
      ).run(company.id, body.role, body.name, body.email, body.phone ?? null, body.lang ?? company.default_lang,
        body.role === 'customer' ? body.customerId : null, body.role === 'worker' ? body.supervisorId ?? null : null, now);
      const uid = Number(info.lastInsertRowid);
      if (body.role === 'worker' || body.role === 'supervisor') {
        ctx.db.prepare('INSERT INTO worker_profiles (user_id, base_salary_amount, base_salary_basis, availability) VALUES (?, ?, ?, ?)')
          .run(uid, body.baseSalaryAmount, body.baseSalaryBasis, JSON.stringify(body.availability));
        setUserSkills(ctx, company.id, uid, body.skills);
      }
      a(req, 'user.invite', 'user', uid, { role: body.role, name: body.name });
      return ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
    })();
    const inviteLink = sendInvite(ctx, user, company.name);
    // The link is returned to the admin so it can be shared by SMS or chat when email is not set up.
    res.status(201).json({ ...personView(ctx, user), inviteLink });
  }));

  r.patch('/people/:id', admin, wrap((req, res) => {
    const target = ctx.db.prepare("SELECT * FROM users WHERE id = ? AND company_id = ? AND status <> 'deleted'").get(Number(req.params.id), req.user.company_id);
    if (!target) throw notFound();
    const body = parse(personPatch, req.body);
    if (body.email && body.email !== target.email &&
        ctx.db.prepare("SELECT 1 FROM users WHERE lower(email) = ? AND status <> 'deleted' AND id <> ?").get(body.email, target.id)) {
      throw conflict('EMAIL_TAKEN');
    }
    ctx.db.transaction(() => {
      ctx.db.prepare('UPDATE users SET name = ?, email = ?, phone = ?, lang = ?, supervisor_id = ? WHERE id = ?').run(
        body.name ?? target.name, body.email ?? target.email, body.phone === undefined ? target.phone : body.phone,
        body.lang ?? target.lang, target.role === 'worker' ? (body.supervisorId === undefined ? target.supervisor_id : body.supervisorId) : null, target.id,
      );
      if (target.role === 'worker' || target.role === 'supervisor') {
        const p = ctx.db.prepare('SELECT * FROM worker_profiles WHERE user_id = ?').get(target.id);
        ctx.db.prepare(
          `INSERT INTO worker_profiles (user_id, base_salary_amount, base_salary_basis, availability) VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET base_salary_amount = excluded.base_salary_amount,
             base_salary_basis = excluded.base_salary_basis, availability = excluded.availability`,
        ).run(target.id, body.baseSalaryAmount ?? p?.base_salary_amount ?? 0, body.baseSalaryBasis ?? p?.base_salary_basis ?? 'none',
          JSON.stringify(body.availability ?? (p ? JSON.parse(p.availability) : [1, 2, 3, 4, 5])));
        if (body.skills) setUserSkills(ctx, req.user.company_id, target.id, body.skills);
      }
      a(req, 'user.update', 'user', target.id, body);
    })();
    res.json(personView(ctx, ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(target.id)));
  }));

  r.post('/people/:id/resend-invite', admin, wrap((req, res) => {
    const target = ctx.db.prepare("SELECT * FROM users WHERE id = ? AND company_id = ? AND status = 'invited'").get(Number(req.params.id), req.user.company_id);
    if (!target) throw notFound();
    const link = sendInvite(ctx, target, companyRow(ctx, req.user.company_id).name);
    a(req, 'user.resend_invite', 'user', target.id);
    res.json({ inviteLink: link });
  }));

  r.post('/people/:id/status', admin, wrap((req, res) => {
    const body = parse(z.object({ status: z.enum(['active', 'disabled']) }), req.body);
    const target = ctx.db.prepare("SELECT * FROM users WHERE id = ? AND company_id = ? AND status IN ('active','disabled')").get(Number(req.params.id), req.user.company_id);
    if (!target) throw notFound();
    if (target.id === req.user.id) throw badRequest('CANNOT_CHANGE_SELF');
    ctx.db.prepare('UPDATE users SET status = ?, token_version = token_version + 1 WHERE id = ?').run(body.status, target.id);
    a(req, `user.${body.status === 'active' ? 'enable' : 'disable'}`, 'user', target.id);
    res.json(personView(ctx, ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(target.id)));
  }));

  r.delete('/people/:id', admin, wrap((req, res) => {
    const target = ctx.db.prepare("SELECT * FROM users WHERE id = ? AND company_id = ? AND status <> 'deleted'").get(Number(req.params.id), req.user.company_id);
    if (!target) throw notFound();
    if (target.id === req.user.id) throw badRequest('CANNOT_CHANGE_SELF');
    ctx.db.transaction(() => { a(req, 'user.delete', 'user', target.id, { role: target.role }); anonymiseUser(ctx, target.id); })();
    res.json({ ok: true });
  }));

  // ---------- Customers and sites ----------
  const customerBody = z.object({
    name: z.string().trim().min(1).max(160),
    type: z.enum(['business', 'household']).default('business'),
    email: z.string().trim().toLowerCase().email().max(200).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
  });
  const siteBody = z.object({
    name: z.string().trim().min(1).max(160),
    address: z.string().trim().max(300).nullable().optional(),
    lat: z.coerce.number().min(-90).max(90).nullable().optional(),
    lng: z.coerce.number().min(-180).max(180).nullable().optional(),
    radiusM: z.coerce.number().int().min(20).max(5000).optional(),
    accessNotes: z.string().trim().max(1000).nullable().optional(),
  });

  r.get('/customers', staff, (req, res) => {
    const customers = ctx.db.prepare('SELECT * FROM customers WHERE company_id = ? AND deleted_at IS NULL ORDER BY name').all(req.user.company_id);
    const sites = ctx.db.prepare('SELECT * FROM sites WHERE company_id = ? AND active = 1 ORDER BY name').all(req.user.company_id);
    res.json(customers.map((c) => ({
      id: c.id, name: c.name, type: c.type, email: c.email, phone: c.phone,
      sites: sites.filter((s) => s.customer_id === c.id).map(siteView),
    })));
  });

  r.post('/customers', admin, wrap((req, res) => {
    const body = parse(customerBody, req.body);
    const info = ctx.db.prepare('INSERT INTO customers (company_id, name, type, email, phone, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.user.company_id, body.name, body.type, body.email ?? null, body.phone ?? null, ctx.now().toISOString());
    a(req, 'customer.create', 'customer', Number(info.lastInsertRowid), body);
    res.status(201).json({ id: Number(info.lastInsertRowid), ...body, sites: [] });
  }));

  r.patch('/customers/:id', admin, wrap((req, res) => {
    const c = ctx.db.prepare('SELECT * FROM customers WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(req.params.id), req.user.company_id);
    if (!c) throw notFound();
    const body = parse(z.object({
      name: z.string().trim().min(1).max(160),
      type: z.enum(['business', 'household']),
      email: z.string().trim().toLowerCase().email().max(200).nullable(),
      phone: z.string().trim().max(40).nullable(),
    }).partial(), req.body);
    const next = { ...c, ...body };
    ctx.db.prepare('UPDATE customers SET name = ?, type = ?, email = ?, phone = ? WHERE id = ?').run(next.name, next.type, next.email ?? null, next.phone ?? null, c.id);
    a(req, 'customer.update', 'customer', c.id, body);
    res.json({ id: c.id, name: next.name, type: next.type, email: next.email, phone: next.phone });
  }));

  r.delete('/customers/:id', admin, wrap((req, res) => {
    const c = ctx.db.prepare('SELECT * FROM customers WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(req.params.id), req.user.company_id);
    if (!c) throw notFound();
    ctx.db.transaction(() => {
      a(req, 'customer.delete', 'customer', c.id);
      for (const u of ctx.db.prepare("SELECT id FROM users WHERE customer_id = ? AND status <> 'deleted'").all(c.id)) anonymiseUser(ctx, u.id);
      anonymiseCustomer(ctx, c.id);
      ctx.db.prepare("UPDATE jobs SET status = 'cancelled', cancelled_reason = 'Customer deleted', updated_at = ? WHERE customer_id = ? AND status IN ('scheduled','assigned')")
        .run(ctx.now().toISOString(), c.id);
    })();
    res.json({ ok: true });
  }));

  r.post('/customers/:id/sites', admin, wrap((req, res) => {
    const c = ctx.db.prepare('SELECT * FROM customers WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(req.params.id), req.user.company_id);
    if (!c) throw notFound();
    const body = parse(siteBody, req.body);
    const company = companyRow(ctx, req.user.company_id);
    const info = ctx.db.prepare(
      'INSERT INTO sites (company_id, customer_id, name, address, lat, lng, radius_m, access_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(company.id, c.id, body.name, body.address ?? null, body.lat ?? null, body.lng ?? null, body.radiusM ?? company.default_radius_m, body.accessNotes ?? null);
    a(req, 'site.create', 'site', Number(info.lastInsertRowid), body);
    res.status(201).json(siteView(ctx.db.prepare('SELECT * FROM sites WHERE id = ?').get(info.lastInsertRowid)));
  }));

  r.patch('/sites/:id', admin, wrap((req, res) => {
    const s = ctx.db.prepare('SELECT * FROM sites WHERE id = ? AND company_id = ?').get(Number(req.params.id), req.user.company_id);
    if (!s) throw notFound();
    const body = parse(siteBody.partial(), req.body);
    ctx.db.prepare('UPDATE sites SET name = ?, address = ?, lat = ?, lng = ?, radius_m = ?, access_notes = ? WHERE id = ?').run(
      body.name ?? s.name, body.address === undefined ? s.address : body.address,
      body.lat === undefined ? s.lat : body.lat, body.lng === undefined ? s.lng : body.lng,
      body.radiusM ?? s.radius_m, body.accessNotes === undefined ? s.access_notes : body.accessNotes, s.id,
    );
    a(req, 'site.update', 'site', s.id, body);
    res.json(siteView(ctx.db.prepare('SELECT * FROM sites WHERE id = ?').get(s.id)));
  }));

  r.delete('/sites/:id', admin, wrap((req, res) => {
    const info = ctx.db.prepare('UPDATE sites SET active = 0 WHERE id = ? AND company_id = ?').run(Number(req.params.id), req.user.company_id);
    if (!info.changes) throw notFound();
    a(req, 'site.archive', 'site', Number(req.params.id));
    res.json({ ok: true });
  }));

  // ---------- Services, checklist templates, SLAs ----------
  const serviceBody = z.object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).nullable().optional(),
    slaText: z.string().trim().max(2000).nullable().optional(),
    slaHours: z.coerce.number().min(0).max(8760).nullable().optional(),
    defaultPayBasis: payBasis.default('salary'),
    defaultPayRate: money.default(0),
    checklist: z.array(checklistItem).max(100).default([]),
    skills: z.array(id).default([]),
  });

  const setServiceSkills = (serviceId, companyId, skills) => {
    ctx.db.prepare('DELETE FROM service_skills WHERE service_id = ?').run(serviceId);
    const ok = ctx.db.prepare('SELECT 1 FROM skills WHERE id = ? AND company_id = ?');
    const ins = ctx.db.prepare('INSERT INTO service_skills (service_id, skill_id) VALUES (?, ?)');
    for (const s of skills) if (ok.get(s, companyId)) ins.run(serviceId, s);
  };

  r.get('/services', staff, (req, res) => {
    const rows = ctx.db.prepare('SELECT * FROM services WHERE company_id = ? AND active = 1 ORDER BY name').all(req.user.company_id);
    res.json(rows.map((s) => serviceView(ctx, s)));
  });

  r.post('/services', admin, wrap((req, res) => {
    const b = parse(serviceBody, req.body);
    const sid = ctx.db.transaction(() => {
      const info = ctx.db.prepare(
        `INSERT INTO services (company_id, name, description, sla_text, sla_hours, default_pay_basis, default_pay_rate, checklist)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(req.user.company_id, b.name, b.description ?? null, b.slaText ?? null, b.slaHours ?? null, b.defaultPayBasis, b.defaultPayRate, JSON.stringify(b.checklist));
      const newId = Number(info.lastInsertRowid);
      setServiceSkills(newId, req.user.company_id, b.skills);
      a(req, 'service.create', 'service', newId, { name: b.name });
      return newId;
    })();
    res.status(201).json(serviceView(ctx, ctx.db.prepare('SELECT * FROM services WHERE id = ?').get(sid)));
  }));

  r.patch('/services/:id', admin, wrap((req, res) => {
    const s = ctx.db.prepare('SELECT * FROM services WHERE id = ? AND company_id = ? AND active = 1').get(Number(req.params.id), req.user.company_id);
    if (!s) throw notFound();
    const b = parse(z.object({
      name: z.string().trim().min(1).max(160),
      description: z.string().trim().max(2000).nullable(),
      slaText: z.string().trim().max(2000).nullable(),
      slaHours: z.coerce.number().min(0).max(8760).nullable(),
      defaultPayBasis: payBasis,
      defaultPayRate: money,
      checklist: z.array(checklistItem).max(100),
      skills: z.array(id),
    }).partial(), req.body);
    ctx.db.transaction(() => {
      ctx.db.prepare(
        `UPDATE services SET name = ?, description = ?, sla_text = ?, sla_hours = ?, default_pay_basis = ?, default_pay_rate = ?, checklist = ? WHERE id = ?`,
      ).run(b.name ?? s.name, b.description === undefined ? s.description : b.description,
        b.slaText === undefined ? s.sla_text : b.slaText, b.slaHours === undefined ? s.sla_hours : b.slaHours,
        b.defaultPayBasis ?? s.default_pay_basis, b.defaultPayRate ?? s.default_pay_rate,
        b.checklist ? JSON.stringify(b.checklist) : s.checklist, s.id);
      if (b.skills) setServiceSkills(s.id, req.user.company_id, b.skills);
      a(req, 'service.update', 'service', s.id, { name: b.name });
    })();
    res.json(serviceView(ctx, ctx.db.prepare('SELECT * FROM services WHERE id = ?').get(s.id)));
  }));

  r.delete('/services/:id', admin, wrap((req, res) => {
    const info = ctx.db.prepare('UPDATE services SET active = 0 WHERE id = ? AND company_id = ?').run(Number(req.params.id), req.user.company_id);
    if (!info.changes) throw notFound();
    a(req, 'service.archive', 'service', Number(req.params.id));
    res.json({ ok: true });
  }));

  return r;
}
