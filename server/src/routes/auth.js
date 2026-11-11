import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { wrap, parse, badRequest, unauthorized, conflict, notFound, forbidden } from '../lib/errors.js';
import { issueSession, clearSession, hashToken, newToken, publicUser, requireUser } from '../auth.js';
import { audit } from '../lib/services.js';
import { emailText } from '../lib/messages.js';

export const LANGS = ['en', 'fr', 'mfe', 'ar'];
const password = z.string().min(8, 'At least 8 characters').max(200);
const email = z.string().trim().toLowerCase().email().max(200);

export function createInviteToken(ctx, user) {
  const token = newToken();
  ctx.db.prepare("UPDATE tokens SET used_at = ? WHERE user_id = ? AND kind = 'invite' AND used_at IS NULL")
    .run(ctx.now().toISOString(), user.id);
  ctx.db.prepare("INSERT INTO tokens (user_id, kind, token_hash, expires_at) VALUES (?, 'invite', ?, ?)")
    .run(user.id, hashToken(token), new Date(ctx.now().getTime() + 7 * 864e5).toISOString());
  return token;
}

export function sendInvite(ctx, user, companyName) {
  const token = createInviteToken(ctx, user);
  const link = `${ctx.config.appUrl}/invite/${token}`;
  if (user.email) {
    ctx.mailer.send({ to: user.email, ...emailText('invite', user.lang, { name: user.name, company: companyName, link }) });
  }
  return link;
}

function findValidToken(ctx, token, kind) {
  const row = ctx.db.prepare('SELECT * FROM tokens WHERE token_hash = ? AND kind = ?').get(hashToken(token || ''), kind);
  if (!row || row.used_at || row.expires_at < ctx.now().toISOString()) return null;
  return row;
}

export default function authRoutes(ctx) {
  const r = Router();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: ctx.config.env === 'test' ? 1000 : 20,
    standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED' } },
  });

  // Register a new service company and its first admin.
  r.post('/register-company', limiter, wrap(async (req, res) => {
    const body = parse(z.object({
      companyName: z.string().trim().min(2).max(120),
      name: z.string().trim().min(1).max(120),
      email, password,
      lang: z.enum(LANGS).default('en'),
      signupCode: z.string().optional(),
    }), req.body);
    if (ctx.config.signupCode && body.signupCode !== ctx.config.signupCode) throw forbidden('SIGNUP_CODE');
    const exists = ctx.db.prepare("SELECT 1 FROM users WHERE lower(email) = ? AND status <> 'deleted'").get(body.email);
    if (exists) throw conflict('EMAIL_TAKEN');
    const hash = await bcrypt.hash(body.password, 10);
    const now = ctx.now().toISOString();
    const user = ctx.db.transaction(() => {
      const c = ctx.db.prepare('INSERT INTO companies (name, default_lang, created_at) VALUES (?, ?, ?)').run(body.companyName, body.lang, now);
      const u = ctx.db.prepare(
        `INSERT INTO users (company_id, role, name, email, password_hash, lang, status, created_at)
         VALUES (?, 'admin', ?, ?, ?, ?, 'active', ?)`,
      ).run(c.lastInsertRowid, body.name, body.email, hash, body.lang, now);
      audit(ctx, { companyId: Number(c.lastInsertRowid), actorId: Number(u.lastInsertRowid), action: 'company.register', entity: 'company', entityId: Number(c.lastInsertRowid) });
      return ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(u.lastInsertRowid);
    })();
    issueSession(ctx, res, user, false);
    res.status(201).json({ user: publicUser(user) });
  }));

  r.post('/login', limiter, wrap(async (req, res) => {
    const body = parse(z.object({ email, password: z.string().min(1), remember: z.boolean().optional() }), req.body);
    const user = ctx.db.prepare("SELECT * FROM users WHERE lower(email) = ? AND status <> 'deleted'").get(body.email);
    const ok = user?.password_hash && (await bcrypt.compare(body.password, user.password_hash));
    if (!ok) throw unauthorized('BAD_CREDENTIALS');
    if (user.status !== 'active') throw forbidden('ACCOUNT_DISABLED');
    issueSession(ctx, res, user, Boolean(body.remember));
    audit(ctx, { companyId: user.company_id, actorId: user.id, action: 'user.login', entity: 'user', entityId: user.id });
    res.json({ user: publicUser(user) });
  }));

  r.post('/logout', (req, res) => {
    clearSession(ctx, res);
    res.json({ ok: true });
  });

  // Always answers OK so the endpoint does not reveal which emails exist.
  r.post('/forgot', limiter, wrap(async (req, res) => {
    const body = parse(z.object({ email }), req.body);
    const user = ctx.db.prepare("SELECT * FROM users WHERE lower(email) = ? AND status = 'active'").get(body.email);
    if (user) {
      const token = newToken();
      ctx.db.prepare("INSERT INTO tokens (user_id, kind, token_hash, expires_at) VALUES (?, 'reset', ?, ?)")
        .run(user.id, hashToken(token), new Date(ctx.now().getTime() + 36e5).toISOString());
      const link = `${ctx.config.appUrl}/reset/${token}`;
      await ctx.mailer.send({ to: user.email, ...emailText('reset', user.lang, { name: user.name, link }) });
    }
    res.json({ ok: true });
  }));

  r.post('/reset', limiter, wrap(async (req, res) => {
    const body = parse(z.object({ token: z.string().min(10), password }), req.body);
    const row = findValidToken(ctx, body.token, 'reset');
    if (!row) throw badRequest('TOKEN_INVALID');
    const hash = await bcrypt.hash(body.password, 10);
    ctx.db.transaction(() => {
      ctx.db.prepare('UPDATE tokens SET used_at = ? WHERE id = ?').run(ctx.now().toISOString(), row.id);
      // Bumping token_version signs the user out everywhere.
      ctx.db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(hash, row.user_id);
    })();
    const user = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
    audit(ctx, { companyId: user.company_id, actorId: user.id, action: 'user.password_reset', entity: 'user', entityId: user.id });
    res.json({ ok: true });
  }));

  r.get('/invite/:token', wrap((req, res) => {
    const row = findValidToken(ctx, req.params.token, 'invite');
    if (!row) throw notFound('TOKEN_INVALID');
    const user = ctx.db.prepare('SELECT u.*, c.name AS company_name FROM users u JOIN companies c ON c.id = u.company_id WHERE u.id = ?').get(row.user_id);
    res.json({ name: user.name, email: user.email, role: user.role, company: user.company_name, lang: user.lang });
  }));

  r.post('/accept-invite', limiter, wrap(async (req, res) => {
    const body = parse(z.object({ token: z.string().min(10), password, lang: z.enum(LANGS).optional(), remember: z.boolean().optional() }), req.body);
    const row = findValidToken(ctx, body.token, 'invite');
    if (!row) throw badRequest('TOKEN_INVALID');
    const hash = await bcrypt.hash(body.password, 10);
    const now = ctx.now().toISOString();
    ctx.db.transaction(() => {
      ctx.db.prepare('UPDATE tokens SET used_at = ? WHERE id = ?').run(now, row.id);
      ctx.db.prepare("UPDATE users SET password_hash = ?, status = 'active', lang = COALESCE(?, lang) WHERE id = ?")
        .run(hash, body.lang ?? null, row.user_id);
    })();
    const user = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
    audit(ctx, { companyId: user.company_id, actorId: user.id, action: 'user.accept_invite', entity: 'user', entityId: user.id });
    issueSession(ctx, res, user, Boolean(body.remember));
    res.json({ user: publicUser(user) });
  }));

  r.get('/session', requireUser, (req, res) => res.json({ user: publicUser(req.user) }));

  return r;
}
