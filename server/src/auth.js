import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { unauthorized, forbidden } from './lib/errors.js';

export const COOKIE = 'fp_session';
const SHORT_HOURS = 12;      // web sessions (NFR-07)
const LONG_DAYS = 30;        // "keep me signed in" on the phone app (NFR-07)

export function issueSession(ctx, res, user, remember) {
  const maxAgeMs = remember ? LONG_DAYS * 864e5 : SHORT_HOURS * 36e5;
  const token = jwt.sign(
    { sub: user.id, v: user.token_version, r: remember ? 1 : 0 },
    ctx.config.jwtSecret,
    { expiresIn: Math.floor(maxAgeMs / 1000) },
  );
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.isProd,
    maxAge: maxAgeMs,
    path: '/',
  });
}

export function clearSession(ctx, res) {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: ctx.config.isProd, path: '/' });
}

/** Load the signed-in user (if any) onto req.user; slide the session when it is older than an hour. */
export function sessionMiddleware(ctx) {
  return (req, res, next) => {
    const token = req.cookies?.[COOKIE];
    if (!token) return next();
    try {
      const payload = jwt.verify(token, ctx.config.jwtSecret);
      const user = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
      if (!user || user.status !== 'active' || user.token_version !== payload.v) {
        clearSession(ctx, res);
        return next();
      }
      req.user = user;
      req.company = ctx.db.prepare('SELECT * FROM companies WHERE id = ?').get(user.company_id);
      if (Date.now() / 1000 - payload.iat > 3600) issueSession(ctx, res, user, payload.r === 1);
    } catch {
      clearSession(ctx, res);
    }
    next();
  };
}

/** CSRF defence for cookie auth: state-changing requests must come from our own fetch code. */
export function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'fetch') return next(forbidden('CSRF'));
  next();
}

export const requireUser = (req, res, next) => (req.user ? next() : next(unauthorized()));

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden());
  next();
};

export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
export const newToken = () => crypto.randomBytes(32).toString('base64url');

/** Public shape of a user — never includes the password hash. */
export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, companyId: u.company_id, role: u.role, name: u.name, email: u.email, phone: u.phone,
    lang: u.lang, status: u.status, customerId: u.customer_id, supervisorId: u.supervisor_id,
    consentAt: u.consent_at, createdAt: u.created_at,
  };
}
