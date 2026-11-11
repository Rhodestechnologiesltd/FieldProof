// Infrastructure services shared by routes: live event bus, email, web push, audit log, notifications.
import nodemailer from 'nodemailer';
import webpush from 'web-push';
import { notificationText } from './messages.js';

/** In-memory pub/sub feeding Server-Sent Event connections, keyed by user id. */
export function createBus() {
  const clients = new Map(); // userId -> Set(res)
  return {
    add(userId, res) {
      if (!clients.has(userId)) clients.set(userId, new Set());
      clients.get(userId).add(res);
      return () => {
        const set = clients.get(userId);
        set?.delete(res);
        if (set && set.size === 0) clients.delete(userId);
      };
    },
    send(userIds, event) {
      const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
      for (const id of new Set(userIds)) {
        for (const res of clients.get(id) || []) res.write(payload);
      }
    },
    connections: () => [...clients.values()].reduce((n, s) => n + s.size, 0),
  };
}

export function createMailer(smtp, logger = console) {
  if (!smtp.host) {
    return {
      enabled: false,
      sent: [],
      async send(msg) {
        this.sent.push(msg);
        logger.info?.(`[mail disabled] to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
      },
    };
  }
  const transport = nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  return {
    enabled: true,
    async send(msg) {
      try {
        await transport.sendMail({ from: smtp.from, ...msg });
      } catch (err) {
        logger.error?.('Email failed', err.message);
      }
    },
  };
}

export function createPush(vapid, db, logger = console) {
  const enabled = Boolean(vapid.publicKey && vapid.privateKey);
  if (enabled) webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  return {
    enabled,
    publicKey: vapid.publicKey,
    async send(userId, payload) {
      if (!enabled) return;
      const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
      for (const s of subs) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload));
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
          } else {
            logger.error?.('Push failed', err.message);
          }
        }
      }
    },
  };
}

/** Append a row to the audit log (BR-13, FR-RPT-02). */
export function audit(ctx, { companyId, actorId, action, entity, entityId, data, lat, lng }) {
  ctx.db.prepare(
    `INSERT INTO audit_log (company_id, actor_id, action, entity, entity_id, data, lat, lng, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(companyId, actorId ?? null, action, entity, entityId ?? null, data ? JSON.stringify(data) : null, lat ?? null, lng ?? null, ctx.now().toISOString());
}

/**
 * Create in-app notifications for each recipient, push them live over SSE,
 * and send web push + email copies. Email is sent only for types that need action.
 */
const EMAIL_TYPES = new Set(['worker_arrived', 'job_submitted', 'job_rejected', 'arrival_disputed', 'job_admin_review', 'job_assigned_worker']);

export function notify(ctx, { companyId, userIds, type, jobId, params }) {
  const recipients = [...new Set(userIds.filter(Boolean))];
  if (!recipients.length) return;
  const now = ctx.now().toISOString();
  const insert = ctx.db.prepare(
    'INSERT INTO notifications (company_id, user_id, type, job_id, params, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const users = ctx.db
    .prepare(`SELECT id, email, lang, status FROM users WHERE id IN (${recipients.map(() => '?').join(',')})`)
    .all(...recipients)
    .filter((u) => u.status === 'active');
  for (const u of users) {
    const info = insert.run(companyId, u.id, type, jobId ?? null, JSON.stringify(params || {}), now);
    ctx.bus.send([u.id], { type: 'notification', id: Number(info.lastInsertRowid), jobId });
    const text = notificationText(type, u.lang, params || {});
    const url = jobId ? `${ctx.config.appUrl}/jobs/${jobId}` : ctx.config.appUrl;
    ctx.push.send(u.id, { title: 'FieldProof', body: text, url }).catch(() => {});
    if (u.email && EMAIL_TYPES.has(type)) {
      ctx.mailer.send({ to: u.email, subject: text.slice(0, 120), text: `${text}\n\n${url}\n` });
    }
  }
}
