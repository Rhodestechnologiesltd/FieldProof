// Media uploads, earnings, dashboard, notifications, web push, live events and the audit log.
import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { wrap, parse, badRequest, forbidden, notFound } from '../lib/errors.js';
import { requireUser, requireRole } from '../auth.js';
import { loadJobFor, isAssigned, canView } from '../lib/jobs.js';
import { workerEarnings } from '../lib/earnings.js';
import { currentPeriod, localDate, localDayStartUtc } from '../lib/time.js';
import { REJECT_REASONS } from './jobs.js';

const ALLOWED_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export default function miscRoutes(ctx) {
  const r = Router();
  r.use(requireUser);
  fs.mkdirSync(ctx.config.uploadDir, { recursive: true });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: ctx.config.maxUploadBytes, files: 1 },
    fileFilter: (req, file, cb) => cb(null, Boolean(ALLOWED_MIME[file.mimetype])),
  });

  // ---------- Media ----------
  r.post('/media', upload.single('file'), wrap((req, res) => {
    if (!req.file) throw badRequest('FILE_REQUIRED');
    const b = parse(z.object({
      jobId: z.coerce.number().int().positive(),
      kind: z.enum(['item', 'checkin', 'rejection']),
      lat: z.coerce.number().min(-90).max(90).optional(),
      lng: z.coerce.number().min(-180).max(180).optional(),
      takenAt: z.string().optional(),
    }), req.body);
    const job = loadJobFor(ctx, req.user, b.jobId);
    if (b.kind === 'rejection') {
      if (req.user.role !== 'customer') throw forbidden();
    } else if (!isAssigned(ctx, job.id, req.user.id)) {
      throw forbidden('NOT_ASSIGNED');
    }
    const name = `${job.company_id}/${crypto.randomUUID()}${ALLOWED_MIME[req.file.mimetype]}`;
    const full = path.join(ctx.config.uploadDir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, req.file.buffer);
    const takenAt = b.takenAt && !Number.isNaN(Date.parse(b.takenAt)) ? new Date(b.takenAt).toISOString() : ctx.now().toISOString();
    const info = ctx.db.prepare(
      `INSERT INTO media (company_id, job_id, kind, uploaded_by, file, mime, size, lat, lng, taken_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(job.company_id, job.id, b.kind, req.user.id, name, req.file.mimetype, req.file.size, b.lat ?? null, b.lng ?? null, takenAt, ctx.now().toISOString());
    res.status(201).json({ id: Number(info.lastInsertRowid), takenAt });
  }));

  r.get('/media/:id', wrap((req, res) => {
    const m = ctx.db.prepare('SELECT * FROM media WHERE id = ? AND company_id = ?').get(Number(req.params.id), req.user.company_id);
    if (!m) throw notFound();
    const job = ctx.db.prepare('SELECT * FROM jobs WHERE id = ?').get(m.job_id);
    if (!job || !canView(ctx, req.user, job)) throw notFound();
    const full = path.join(ctx.config.uploadDir, m.file);
    if (!full.startsWith(path.resolve(ctx.config.uploadDir)) || !fs.existsSync(full)) throw notFound();
    res.setHeader('Content-Type', m.mime);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.sendFile(path.resolve(full));
  }));

  // ---------- Earnings (FR-PAY-03, FR-PAY-04) ----------
  r.get('/earnings/me', requireRole('worker', 'supervisor'), wrap((req, res) => {
    const period = req.query.period ? parse(periodSchema, req.query.period) : currentPeriod(ctx.now(), req.company.timezone);
    res.json(workerEarnings(ctx, req.company, req.user.id, period));
  }));

  const teamEarnings = (req, period) => {
    const params = [req.user.company_id];
    let sql = "SELECT id, name, role FROM users WHERE company_id = ? AND role IN ('worker','supervisor') AND status IN ('active','disabled')";
    if (req.user.role === 'supervisor') { sql += ' AND (supervisor_id = ? OR id = ?)'; params.push(req.user.id, req.user.id); }
    return ctx.db.prepare(`${sql} ORDER BY name`).all(...params).map((u) => ({ worker: u, ...workerEarnings(ctx, req.company, u.id, period) }));
  };

  r.get('/earnings', requireRole('admin', 'supervisor'), wrap((req, res) => {
    const period = req.query.period ? parse(periodSchema, req.query.period) : currentPeriod(ctx.now(), req.company.timezone);
    const rows = teamEarnings(req, period);
    res.json({
      period, currency: req.company.currency,
      workers: rows.map((r) => ({
        id: r.worker.id, name: r.worker.name, role: r.worker.role, hours: r.hours, jobsCompleted: r.jobsCompleted,
        base: r.base, earned: r.earned, pending: r.pending, total: r.total, lines: r.lines,
      })),
    });
  }));

  r.get('/earnings/export.csv', requireRole('admin', 'supervisor'), wrap((req, res) => {
    const period = req.query.period ? parse(periodSchema, req.query.period) : currentPeriod(ctx.now(), req.company.timezone);
    const csv = (v) => {
      const s = v == null ? '' : String(v);
      // Neutralise spreadsheet formulas and quote every cell.
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const lines = [['Period', 'Worker', 'Job ID', 'Job', 'Site', 'Date', 'Status', 'Pay basis', 'Rate', 'Hours', 'Amount', 'State', 'Currency'].map(csv).join(',')];
    for (const r of teamEarnings(req, period)) {
      if (r.base.basis === 'monthly') lines.push([period, r.worker.name, '', 'Base salary (monthly)', '', '', '', 'monthly', r.base.amount, '', r.base.amount, 'earned', r.currency].map(csv).join(','));
      for (const l of r.lines) {
        lines.push([period, r.worker.name, l.jobId, l.title, l.site, l.date, l.status, l.basis, l.rate ?? '', l.hours, l.amount, l.state, r.currency].map(csv).join(','));
      }
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="hours-earnings-${period}.csv"`);
    res.send(`﻿${lines.join('\r\n')}\r\n`);
  }));

  // ---------- Dashboard (FR-RPT-01) ----------
  r.get('/dashboard', requireRole('admin', 'supervisor'), wrap((req, res) => {
    const c = req.company;
    const now = ctx.now();
    const today = localDate(now, c.timezone);
    const dayStart = localDayStartUtc(today, c.timezone);
    const dayEnd = new Date(dayStart.getTime() + 864e5);
    const scope = req.user.role === 'supervisor' ? ' AND j.supervisor_id = ?' : '';
    const sp = req.user.role === 'supervisor' ? [req.user.id] : [];
    const q = (sql, ...p) => ctx.db.prepare(sql).all(c.id, ...p, ...sp);
    const one = (sql, ...p) => ctx.db.prepare(sql).get(c.id, ...p, ...sp);

    const todayRows = q(`SELECT j.status, COUNT(*) n FROM jobs j WHERE j.company_id = ? AND j.scheduled_start >= ? AND j.scheduled_start < ?${scope} GROUP BY j.status`,
      dayStart.toISOString(), dayEnd.toISOString());
    const byStatus = Object.fromEntries(todayRows.map((r) => [r.status, r.n]));
    const lateCutoff = new Date(now.getTime() - c.late_grace_min * 60000).toISOString();
    const late = q(`SELECT j.id, j.title, j.scheduled_start, s.name site FROM jobs j JOIN sites s ON s.id = j.site_id
                    WHERE j.company_id = ? AND j.status IN ('scheduled','assigned') AND j.visit_started_at IS NULL
                    AND j.scheduled_start <= ? AND j.scheduled_end > ?${scope} ORDER BY j.scheduled_start`, lateCutoff, now.toISOString());
    const flagged = q(`SELECT DISTINCT j.id, j.title, s.name site, a.reason, a.distance_m, u.name worker, a.at FROM attendance a
                       JOIN jobs j ON j.id = a.job_id JOIN sites s ON s.id = j.site_id JOIN users u ON u.id = a.worker_id
                       WHERE j.company_id = ? AND a.kind = 'in' AND a.verified = 0 AND a.at >= ?${scope} ORDER BY a.at DESC LIMIT 20`, dayStart.toISOString());
    const list = (status) => q(`SELECT j.id, j.title, j.status, j.submitted_at, j.updated_at, j.rework_count, s.name site FROM jobs j JOIN sites s ON s.id = j.site_id
                                WHERE j.company_id = ? AND j.status = '${status}'${scope} ORDER BY j.updated_at`);
    const disputes = q(`SELECT j.id, j.title, s.name site, j.updated_at FROM jobs j JOIN sites s ON s.id = j.site_id
                        WHERE j.company_id = ? AND j.arrival_status = 'disputed' AND j.status NOT IN ('approved','cancelled')${scope}`);
    const since30 = new Date(now.getTime() - 30 * 864e5).toISOString();
    const reasons = q(`SELECT d.reason_code code, COUNT(*) n FROM decisions d JOIN jobs j ON j.id = d.job_id
                       WHERE j.company_id = ? AND d.decision = 'rejected' AND d.at >= ?${scope} GROUP BY d.reason_code ORDER BY n DESC`, since30);
    // SLA breach: not submitted by start + SLA hours (or by the scheduled end when no SLA hours are set).
    const slaRows = q(`SELECT j.id, j.title, j.scheduled_start, j.scheduled_end, j.sla_hours, j.submitted_at, j.status, s.name site
                       FROM jobs j JOIN sites s ON s.id = j.site_id WHERE j.company_id = ? AND j.status <> 'cancelled'
                       AND j.scheduled_start >= ? AND j.scheduled_start <= ?${scope}`, since30, now.toISOString());
    const slaBreaches = slaRows.filter((j) => {
      const due = j.sla_hours != null ? new Date(j.scheduled_start).getTime() + j.sla_hours * 36e5 : new Date(j.scheduled_end).getTime();
      const done = j.submitted_at ? new Date(j.submitted_at).getTime() : (['approved'].includes(j.status) ? due : now.getTime());
      return done > due;
    }).map((j) => ({ id: j.id, title: j.title, site: j.site, status: j.status }));
    const verifiedShare = one(`SELECT COUNT(*) total, SUM(a.verified) verified FROM attendance a JOIN jobs j ON j.id = a.job_id
                               WHERE j.company_id = ? AND a.kind = 'in' AND a.at >= ?${scope}`, since30);
    const approvalTimes = q(`SELECT d.at, j.submitted_at FROM decisions d JOIN jobs j ON j.id = d.job_id
                             WHERE j.company_id = ? AND d.decision IN ('approved','auto_approved') AND d.at >= ?${scope}`, since30);
    // Last 14 days: outcome per local day, for the trend chart.
    const trendStart = localDayStartUtc(localDate(new Date(now.getTime() - 13 * 864e5), c.timezone), c.timezone);
    const decided = q(`SELECT d.decision, d.at FROM decisions d JOIN jobs j ON j.id = d.job_id
                       WHERE j.company_id = ? AND d.at >= ? AND d.decision IN ('approved','auto_approved','rejected','admin_approved')${scope}`, trendStart.toISOString());
    const days = [];
    for (let i = 0; i < 14; i++) {
      const d = localDate(new Date(trendStart.getTime() + (i * 864e5) + 12 * 36e5), c.timezone);
      days.push({ date: d, approved: 0, rejected: 0 });
    }
    for (const d of decided) {
      const day = days.find((x) => x.date === localDate(new Date(d.at), c.timezone));
      if (!day) continue;
      if (d.decision === 'rejected') day.rejected++; else day.approved++;
    }
    res.json({
      today: { date: today, total: todayRows.reduce((s, r) => s + r.n, 0), byStatus },
      late, flagged, disputes,
      awaitingApproval: list('submitted'),
      rework: list('rework'),
      adminReview: list('admin_review'),
      slaBreaches,
      rejectionReasons: reasons,
      metrics: {
        verifiedCheckinShare: verifiedShare.total ? verifiedShare.verified / verifiedShare.total : null,
        checkins30d: verifiedShare.total,
        avgApprovalHours: approvalTimes.length
          ? approvalTimes.reduce((s, r) => s + (new Date(r.at) - new Date(r.submitted_at || r.at)) / 36e5, 0) / approvalTimes.length : null,
        rejections30d: reasons.reduce((s, r) => s + r.n, 0),
        approvals30d: approvalTimes.length,
      },
      trend: days,
      rejectReasons: REJECT_REASONS,
    });
  }));

  // ---------- Notifications ----------
  r.get('/notifications', (req, res) => {
    const rows = ctx.db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(req.user.id);
    const unread = ctx.db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(req.user.id).n;
    res.json({ unread, items: rows.map((n) => ({ id: n.id, type: n.type, jobId: n.job_id, params: JSON.parse(n.params), createdAt: n.created_at, readAt: n.read_at })) });
  });

  r.post('/notifications/read', wrap((req, res) => {
    const b = parse(z.object({ ids: z.array(z.number().int()).optional(), all: z.boolean().optional() }), req.body);
    const now = ctx.now().toISOString();
    if (b.all) ctx.db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now, req.user.id);
    else for (const id of b.ids || []) ctx.db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL').run(now, id, req.user.id);
    res.json({ ok: true });
  }));

  r.get('/push/key', (req, res) => res.json({ enabled: ctx.push.enabled, publicKey: ctx.push.publicKey || null }));

  r.post('/push/subscribe', wrap((req, res) => {
    const b = parse(z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }), req.body);
    ctx.db.prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    ).run(req.user.id, b.endpoint, b.keys.p256dh, b.keys.auth, ctx.now().toISOString());
    res.status(201).json({ ok: true });
  }));

  r.post('/push/unsubscribe', wrap((req, res) => {
    const b = parse(z.object({ endpoint: z.string().max(1000) }), req.body);
    ctx.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(b.endpoint, req.user.id);
    res.json({ ok: true });
  }));

  // ---------- Live updates (Server-Sent Events, NFR-02) ----------
  r.get('/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`event: hello\ndata: {"ok":true}\n\n`);
    const remove = ctx.bus.add(req.user.id, res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => { clearInterval(ping); remove(); });
  });

  // ---------- Audit log (FR-RPT-02) ----------
  r.get('/audit', requireRole('admin'), wrap((req, res) => {
    const where = ['a.company_id = ?'];
    const p = [req.user.company_id];
    if (req.query.entity) { where.push('a.entity = ?'); p.push(String(req.query.entity)); }
    if (req.query.entityId) { where.push('a.entity_id = ?'); p.push(Number(req.query.entityId)); }
    if (req.query.actorId) { where.push('a.actor_id = ?'); p.push(Number(req.query.actorId)); }
    if (req.query.before) { where.push('a.id < ?'); p.push(Number(req.query.before)); }
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const rows = ctx.db.prepare(
      `SELECT a.*, u.name actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
       WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT ${limit}`,
    ).all(...p);
    res.json(rows.map((x) => ({
      id: x.id, action: x.action, entity: x.entity, entityId: x.entity_id, actorId: x.actor_id, actor: x.actor_name,
      data: x.data ? JSON.parse(x.data) : null, lat: x.lat, lng: x.lng, at: x.at,
    })));
  }));

  return r;
}
