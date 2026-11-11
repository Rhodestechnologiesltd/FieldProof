// Jobs: creation, assignment, field work (check-in, checklist, submit), customer confirmation and approval.
import { Router } from 'express';
import { z } from 'zod';
import { wrap, parse, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { requireRole, requireUser } from '../auth.js';
import { audit, notify } from '../lib/services.js';
import { evaluatePosition } from '../lib/geo.js';
import { localDate } from '../lib/time.js';
import {
  loadJobFor, loadManagedJob, canManage, isAssigned, jobDetail, overlappingJobs, publish, touch,
  messageParams, managers, adminIds, workerIds, customerContactIds,
} from '../lib/jobs.js';
import { payBasis } from './setup.js';

const idSchema = z.coerce.number().int().positive();
const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date').transform((s) => new Date(s).toISOString());
const FIELD_OPEN = ['assigned', 'in_progress', 'rework'];
export const REJECT_REASONS = ['incomplete', 'poor_quality', 'damage', 'not_as_agreed', 'sla_missed', 'other'];
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const position = {
  lat: z.coerce.number().min(-90).max(90).nullable().optional(),
  lng: z.coerce.number().min(-180).max(180).nullable().optional(),
  accuracy: z.coerce.number().min(0).max(100000).nullable().optional(),
  deviceTime: isoDate.optional(),
  offline: z.boolean().optional(),
  clientId: z.string().min(8).max(80).optional(),
};

function companyOf(ctx, job) {
  return ctx.db.prepare('SELECT * FROM companies WHERE id = ?').get(job.company_id);
}

/** Replay protection for offline sync: the same client action is applied once. */
function idempotent(ctx, req, res, fn) {
  const clientId = req.body?.clientId;
  if (clientId) {
    const prior = ctx.db.prepare('SELECT * FROM client_actions WHERE client_id = ? AND user_id = ?').get(clientId, req.user.id);
    if (prior) return res.json(JSON.parse(prior.response));
  }
  const result = fn();
  if (clientId) {
    ctx.db.prepare('INSERT OR IGNORE INTO client_actions (client_id, user_id, response, at) VALUES (?, ?, ?, ?)')
      .run(clientId, req.user.id, JSON.stringify(result), ctx.now().toISOString());
  }
  return res.json(result);
}

/** BR-09: server time when online; device time (flagged) when captured offline. */
function effectiveTime(ctx, body) {
  const server = ctx.now();
  const device = body.deviceTime ? new Date(body.deviceTime) : null;
  const skew = device ? Math.abs(server - device) > CLOCK_SKEW_MS : false;
  let at = server;
  if (body.offline && device && device <= new Date(server.getTime() + CLOCK_SKEW_MS)) at = device;
  return { server: server.toISOString(), at: at.toISOString(), device: device?.toISOString() ?? null, skew };
}

function openCheckIn(ctx, jobId, workerId) {
  const last = ctx.db.prepare('SELECT kind FROM attendance WHERE job_id = ? AND worker_id = ? ORDER BY at DESC, id DESC LIMIT 1').get(jobId, workerId);
  return last?.kind === 'in';
}

function jobSummaries(ctx, rows, user) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => '?').join(',');
  const workers = ctx.db.prepare(
    `SELECT a.job_id, u.id, u.name FROM assignments a JOIN users u ON u.id = a.worker_id WHERE a.job_id IN (${marks})`,
  ).all(...ids);
  const progress = ctx.db.prepare(
    `SELECT job_id, COUNT(*) total, SUM(done_at IS NOT NULL) done FROM job_items WHERE job_id IN (${marks}) GROUP BY job_id`,
  ).all(...ids);
  const flagged = new Set(ctx.db.prepare(
    `SELECT DISTINCT job_id FROM attendance WHERE job_id IN (${marks}) AND kind = 'in' AND verified = 0`,
  ).all(...ids).map((r) => r.job_id));
  return rows.map((j) => {
    const p = progress.find((x) => x.job_id === j.id);
    return {
      id: j.id, title: j.title, status: j.status, scheduledStart: j.scheduled_start, scheduledEnd: j.scheduled_end,
      arrivalStatus: j.arrival_status, reworkCount: j.rework_count, submittedAt: j.submitted_at,
      site: { id: j.site_id, name: j.site_name, address: j.site_address, lat: j.site_lat, lng: j.site_lng },
      customer: { id: j.customer_id, name: j.customer_name },
      supervisor: j.supervisor_id ? { id: j.supervisor_id, name: j.supervisor_name } : null,
      service: j.service_name,
      workers: workers.filter((w) => w.job_id === j.id).map((w) => ({ id: w.id, name: w.name })),
      progress: { done: p?.done || 0, total: p?.total || 0 },
      flagged: flagged.has(j.id),
      late: Boolean(j.late_alerted) && !j.visit_started_at,
      mine: user.role === 'worker' || user.role === 'supervisor' ? workers.some((w) => w.job_id === j.id && w.id === user.id) : undefined,
    };
  });
}

export default function jobRoutes(ctx) {
  const r = Router();
  r.use(requireUser);
  const staff = requireRole('admin', 'supervisor');
  const auditJob = (req, job, action, data, pos) =>
    audit(ctx, { companyId: job.company_id, actorId: req.user.id, action, entity: 'job', entityId: job.id, data, lat: pos?.lat, lng: pos?.lng });

  // ---------- List ----------
  r.get('/', wrap((req, res) => {
    const u = req.user;
    const where = ['j.company_id = ?'];
    const params = [u.company_id];
    if (u.role === 'supervisor') {
      where.push('(j.supervisor_id = ? OR EXISTS (SELECT 1 FROM assignments a WHERE a.job_id = j.id AND a.worker_id = ?))');
      params.push(u.id, u.id);
    } else if (u.role === 'worker') {
      where.push('EXISTS (SELECT 1 FROM assignments a WHERE a.job_id = j.id AND a.worker_id = ?)');
      params.push(u.id);
    } else if (u.role === 'customer') {
      where.push('j.customer_id = ?');
      params.push(u.customer_id);
    }
    const q = req.query;
    if (q.status) {
      const list = String(q.status).split(',').filter(Boolean);
      where.push(`j.status IN (${list.map(() => '?').join(',')})`);
      params.push(...list);
    }
    if (q.from) { where.push('j.scheduled_end >= ?'); params.push(new Date(String(q.from)).toISOString()); }
    if (q.to) { where.push('j.scheduled_start < ?'); params.push(new Date(String(q.to)).toISOString()); }
    if (q.customerId) { where.push('j.customer_id = ?'); params.push(Number(q.customerId)); }
    if (q.siteId) { where.push('j.site_id = ?'); params.push(Number(q.siteId)); }
    if (q.supervisorId) { where.push('j.supervisor_id = ?'); params.push(Number(q.supervisorId)); }
    if (q.workerId) { where.push('EXISTS (SELECT 1 FROM assignments a2 WHERE a2.job_id = j.id AND a2.worker_id = ?)'); params.push(Number(q.workerId)); }
    if (q.q) { where.push('(j.title LIKE ? OR s.name LIKE ? OR c.name LIKE ?)'); const like = `%${String(q.q)}%`; params.push(like, like, like); }
    const order = q.order === 'desc' ? 'DESC' : 'ASC';
    const limit = Math.min(Number(q.limit) || 200, 500);
    const rows = ctx.db.prepare(
      `SELECT j.*, s.name site_name, s.address site_address, s.lat site_lat, s.lng site_lng, c.name customer_name,
              sv.name supervisor_name, svc.name service_name
       FROM jobs j JOIN sites s ON s.id = j.site_id JOIN customers c ON c.id = j.customer_id
       LEFT JOIN users sv ON sv.id = j.supervisor_id LEFT JOIN services svc ON svc.id = j.service_id
       WHERE ${where.join(' AND ')} ORDER BY j.scheduled_start ${order} LIMIT ${limit}`,
    ).all(...params);
    res.json(jobSummaries(ctx, rows, u));
  }));

  // FR-JOB / D9: calendar export of the user's upcoming jobs (.ics).
  r.get('/calendar.ics', wrap((req, res) => {
    const u = req.user;
    const now = ctx.now();
    const from = new Date(now.getTime() - 7 * 864e5).toISOString();
    const to = new Date(now.getTime() + 90 * 864e5).toISOString();
    let rows;
    const base = `SELECT j.*, s.name site_name, s.address site_address FROM jobs j JOIN sites s ON s.id = j.site_id
                  WHERE j.company_id = ? AND j.status <> 'cancelled' AND j.scheduled_start BETWEEN ? AND ?`;
    if (u.role === 'admin') rows = ctx.db.prepare(base).all(u.company_id, from, to);
    else if (u.role === 'customer') rows = ctx.db.prepare(`${base} AND j.customer_id = ?`).all(u.company_id, from, to, u.customer_id);
    else rows = ctx.db.prepare(`${base} AND (j.supervisor_id = ? OR EXISTS (SELECT 1 FROM assignments a WHERE a.job_id = j.id AND a.worker_id = ?))`).all(u.company_id, from, to, u.id, u.id);
    const fmt = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const esc = (s) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FieldProof//Jobs//EN', 'CALSCALE:GREGORIAN'];
    for (const j of rows) {
      lines.push('BEGIN:VEVENT', `UID:job-${j.id}@fieldproof`, `DTSTAMP:${fmt(now.toISOString())}`,
        `DTSTART:${fmt(j.scheduled_start)}`, `DTEND:${fmt(j.scheduled_end)}`, `SUMMARY:${esc(j.title)} - ${esc(j.site_name)}`,
        `LOCATION:${esc(j.site_address || j.site_name)}`, `URL:${ctx.config.appUrl}/jobs/${j.id}`, 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="fieldproof-jobs.ics"');
    res.send(lines.join('\r\n'));
  }));

  // ---------- Create / edit / cancel ----------
  const jobBody = z.object({
    customerId: idSchema,
    siteId: idSchema,
    serviceId: idSchema.nullable().optional(),
    title: z.string().trim().max(160).optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    scheduledStart: isoDate,
    scheduledEnd: isoDate,
    supervisorId: idSchema.nullable().optional(),
    slaText: z.string().trim().max(2000).nullable().optional(),
    slaHours: z.coerce.number().min(0).max(8760).nullable().optional(),
    payBasis: payBasis.optional(),
    payRate: z.coerce.number().min(0).max(1e9).optional(),
    checklist: z.array(z.object({
      label: z.string().trim().min(1).max(200),
      type: z.enum(['tick', 'photo', 'note', 'number']).default('tick'),
      required: z.boolean().default(true),
    })).max(100).optional(),
    repeat: z.object({ every: z.enum(['day', 'week', 'month']), count: z.coerce.number().int().min(1).max(52) }).optional(),
  });

  r.post('/', staff, wrap((req, res) => {
    const b = parse(jobBody, req.body);
    const u = req.user;
    if (new Date(b.scheduledEnd) <= new Date(b.scheduledStart)) throw badRequest('END_BEFORE_START');
    const site = ctx.db.prepare('SELECT * FROM sites WHERE id = ? AND company_id = ? AND customer_id = ? AND active = 1').get(b.siteId, u.company_id, b.customerId);
    if (!site) throw badRequest('BAD_SITE');
    const service = b.serviceId ? ctx.db.prepare('SELECT * FROM services WHERE id = ? AND company_id = ? AND active = 1').get(b.serviceId, u.company_id) : null;
    if (b.serviceId && !service) throw badRequest('BAD_SERVICE');
    let supervisorId = u.role === 'supervisor' ? u.id : b.supervisorId ?? null;
    if (supervisorId && u.role === 'admin') {
      const ok = ctx.db.prepare("SELECT 1 FROM users WHERE id = ? AND company_id = ? AND role = 'supervisor' AND status = 'active'").get(supervisorId, u.company_id);
      if (!ok) throw badRequest('BAD_SUPERVISOR');
    }
    const checklist = b.checklist ?? (service ? JSON.parse(service.checklist) : []);
    const title = b.title || service?.name || site.name;
    const now = ctx.now().toISOString();
    const occurrences = b.repeat ? b.repeat.count : 1;
    const step = (date, n) => {
      const d = new Date(date);
      if (!b.repeat) return d;
      if (b.repeat.every === 'day') d.setUTCDate(d.getUTCDate() + n);
      if (b.repeat.every === 'week') d.setUTCDate(d.getUTCDate() + 7 * n);
      if (b.repeat.every === 'month') d.setUTCMonth(d.getUTCMonth() + n);
      return d;
    };
    const created = ctx.db.transaction(() => {
      const out = [];
      for (let n = 0; n < occurrences; n++) {
        const info = ctx.db.prepare(
          `INSERT INTO jobs (company_id, customer_id, site_id, service_id, title, notes, scheduled_start, scheduled_end, status,
             supervisor_id, sla_text, sla_hours, pay_basis, pay_rate, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(u.company_id, b.customerId, b.siteId, service?.id ?? null, title, b.notes ?? null,
          step(b.scheduledStart, n).toISOString(), step(b.scheduledEnd, n).toISOString(), supervisorId,
          b.slaText ?? service?.sla_text ?? null, b.slaHours ?? service?.sla_hours ?? null,
          b.payBasis ?? service?.default_pay_basis ?? 'salary', b.payRate ?? service?.default_pay_rate ?? 0, u.id, now, now);
        const jobId = Number(info.lastInsertRowid);
        const ins = ctx.db.prepare('INSERT INTO job_items (job_id, position, label, type, required) VALUES (?, ?, ?, ?, ?)');
        checklist.forEach((it, i) => ins.run(jobId, i + 1, it.label, it.type, it.required ? 1 : 0));
        const job = ctx.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
        auditJob(req, job, 'job.create', { title, start: job.scheduled_start, repeatIndex: n });
        out.push(job);
      }
      return out;
    })();
    const first = created[0];
    if (first.supervisor_id && u.role === 'admin') {
      notify(ctx, { companyId: u.company_id, userIds: [first.supervisor_id], type: 'job_assigned_supervisor', jobId: first.id, params: messageParams(ctx, first) });
    }
    for (const job of created) publish(ctx, job, 'created');
    res.status(201).json({ ...jobDetail(ctx, u, first), createdIds: created.map((j) => j.id) });
  }));

  r.get('/:id', wrap((req, res) => {
    const job = loadJobFor(ctx, req.user, Number(req.params.id));
    res.json(jobDetail(ctx, req.user, job));
  }));

  r.patch('/:id', staff, wrap((req, res) => {
    const job = loadManagedJob(ctx, req.user, Number(req.params.id));
    if (!['scheduled', 'assigned'].includes(job.status)) throw conflict('JOB_LOCKED');
    const b = parse(jobBody.omit({ customerId: true, siteId: true, serviceId: true, repeat: true, supervisorId: true }).partial(), req.body);
    const start = b.scheduledStart ?? job.scheduled_start;
    const end = b.scheduledEnd ?? job.scheduled_end;
    if (new Date(end) <= new Date(start)) throw badRequest('END_BEFORE_START');
    const updated = ctx.db.transaction(() => {
      const next = touch(ctx, job.id, {
        title: b.title || job.title, notes: b.notes === undefined ? job.notes : b.notes,
        scheduled_start: start, scheduled_end: end,
        sla_text: b.slaText === undefined ? job.sla_text : b.slaText, sla_hours: b.slaHours === undefined ? job.sla_hours : b.slaHours,
        pay_basis: b.payBasis ?? job.pay_basis, pay_rate: b.payRate ?? job.pay_rate, late_alerted: 0,
      });
      if (b.checklist) {
        ctx.db.prepare('DELETE FROM job_items WHERE job_id = ? AND done_at IS NULL AND id NOT IN (SELECT item_id FROM item_media)').run(job.id);
        const remaining = ctx.db.prepare('SELECT COUNT(*) n FROM job_items WHERE job_id = ?').get(job.id).n;
        const ins = ctx.db.prepare('INSERT INTO job_items (job_id, position, label, type, required) VALUES (?, ?, ?, ?, ?)');
        b.checklist.forEach((it, i) => ins.run(job.id, remaining + i + 1, it.label, it.type, it.required ? 1 : 0));
      }
      auditJob(req, job, 'job.update', b);
      return next;
    })();
    publish(ctx, updated, 'updated');
    res.json(jobDetail(ctx, req.user, updated));
  }));

  r.post('/:id/cancel', staff, wrap((req, res) => {
    const job = loadManagedJob(ctx, req.user, Number(req.params.id));
    if (['approved', 'cancelled'].includes(job.status)) throw conflict('JOB_CLOSED');
    const b = parse(z.object({ reason: z.string().trim().min(3).max(500) }), req.body);
    const updated = touch(ctx, job.id, { status: 'cancelled', cancelled_reason: b.reason });
    auditJob(req, job, 'job.cancel', b);
    notify(ctx, { companyId: job.company_id, userIds: [...workerIds(ctx, job.id), ...customerContactIds(ctx, job)], type: 'job_cancelled', jobId: job.id, params: messageParams(ctx, job) });
    publish(ctx, updated, 'cancelled');
    res.json(jobDetail(ctx, req.user, updated));
  }));

  // ---------- Assignment ----------
  r.post('/:id/supervisor', requireRole('admin'), wrap((req, res) => {
    const job = loadManagedJob(ctx, req.user, Number(req.params.id));
    if (['approved', 'cancelled'].includes(job.status)) throw conflict('JOB_CLOSED');
    const b = parse(z.object({ supervisorId: idSchema.nullable() }), req.body);
    if (b.supervisorId) {
      const ok = ctx.db.prepare("SELECT 1 FROM users WHERE id = ? AND company_id = ? AND role = 'supervisor' AND status = 'active'").get(b.supervisorId, job.company_id);
      if (!ok) throw badRequest('BAD_SUPERVISOR');
    }
    const updated = touch(ctx, job.id, { supervisor_id: b.supervisorId });
    auditJob(req, job, 'job.assign_supervisor', b);
    if (b.supervisorId) notify(ctx, { companyId: job.company_id, userIds: [b.supervisorId], type: 'job_assigned_supervisor', jobId: job.id, params: messageParams(ctx, job) });
    publish(ctx, updated, 'supervisor');
    res.json(jobDetail(ctx, req.user, updated));
  }));

  // FR-JOB-02: supervisors ranked by service expertise and load that day.
  r.get('/:id/supervisor-candidates', requireRole('admin'), wrap((req, res) => {
    const job = loadManagedJob(ctx, req.user, Number(req.params.id));
    const company = companyOf(ctx, job);
    const needed = job.service_id ? ctx.db.prepare('SELECT skill_id FROM service_skills WHERE service_id = ?').all(job.service_id).map((r) => r.skill_id) : [];
    const day = localDate(new Date(job.scheduled_start), company.timezone);
    const sups = ctx.db.prepare("SELECT id, name FROM users WHERE company_id = ? AND role = 'supervisor' AND status = 'active' ORDER BY name").all(job.company_id);
    const out = sups.map((s) => {
      const skills = ctx.db.prepare('SELECT skill_id FROM user_skills WHERE user_id = ?').all(s.id).map((r) => r.skill_id);
      const matched = needed.filter((n) => skills.includes(n)).length;
      const load = ctx.db.prepare("SELECT scheduled_start FROM jobs WHERE supervisor_id = ? AND status NOT IN ('cancelled')").all(s.id)
        .filter((j) => localDate(new Date(j.scheduled_start), company.timezone) === day).length;
      return { id: s.id, name: s.name, skillMatch: needed.length ? matched / needed.length : 1, jobsThatDay: load };
    }).sort((a, b) => b.skillMatch - a.skillMatch || a.jobsThatDay - b.jobsThatDay || a.name.localeCompare(b.name));
    res.json(out);
  }));

  // FR-JOB-03: workers ranked by skill, availability and conflicts.
  r.get('/:id/candidates', staff, wrap((req, res) => {
    const job = loadManagedJob(ctx, req.user, Number(req.params.id));
    const company = companyOf(ctx, job);
    const needed = job.service_id ? ctx.db.prepare('SELECT skill_id FROM service_skills WHERE service_id = ?').all(job.service_id).map((r) => r.skill_id) : [];
    // ISO weekday (1 = Monday) of the job's local date.
    const localDay = new Date(`${localDate(new Date(job.scheduled_start), company.timezone)}T12:00:00Z`).getUTCDay() || 7;
    let pool;
    if (req.user.role === 'admin') {
      pool = ctx.db.prepare("SELECT * FROM users WHERE company_id = ? AND role IN ('worker','supervisor') AND status = 'active'").all(job.company_id);
    } else {
      pool = ctx.db.prepare("SELECT * FROM users WHERE company_id = ? AND status = 'active' AND ((role = 'worker' AND supervisor_id = ?) OR id = ?)").all(job.company_id, req.user.id, req.user.id);
    }
    const assigned = new Set(workerIds(ctx, job.id));
    const out = pool.map((u) => {
      const skills = ctx.db.prepare('SELECT skill_id FROM user_skills WHERE user_id = ?').all(u.id).map((r) => r.skill_id);
      const profile = ctx.db.prepare('SELECT availability FROM worker_profiles WHERE user_id = ?').get(u.id);
      const days = profile ? JSON.parse(profile.availability) : [1, 2, 3, 4, 5];
      const conflicts = overlappingJobs(ctx, u.id, job.scheduled_start, job.scheduled_end, job.id)
        .map((j) => ({ id: j.id, title: j.title, start: j.scheduled_start, end: j.scheduled_end }));
      const matched = needed.filter((n) => skills.includes(n)).length;
      return {
        id: u.id, name: u.name, role: u.role,
        skillMatch: needed.length ? matched / needed.length : 1,
        available: days.includes(localDay), conflicts, assigned: assigned.has(u.id),
      };
    }).sort((a, b) => b.skillMatch - a.skillMatch || Number(b.available) - Number(a.available)
      || a.conflicts.length - b.conflicts.length || a.name.localeCompare(b.name));
    res.json(out);
  }));

  r.post('/:id/assignments', staff, wrap((req, res) => {
    const job = loadManagedJob(ctx, req.user, Number(req.params.id));
    if (!['scheduled', 'assigned', 'in_progress', 'rework'].includes(job.status)) throw conflict('JOB_LOCKED');
    const b = parse(z.object({
      workerId: idSchema, payBasis: payBasis.optional(), payRate: z.coerce.number().min(0).max(1e9).optional(),
      acknowledgeConflict: z.boolean().optional(),
    }), req.body);
    const worker = ctx.db.prepare("SELECT * FROM users WHERE id = ? AND company_id = ? AND role IN ('worker','supervisor') AND status = 'active'").get(b.workerId, job.company_id);
    if (!worker) throw badRequest('BAD_WORKER');
    if (req.user.role === 'supervisor' && !(worker.supervisor_id === req.user.id || worker.id === req.user.id)) throw forbidden('NOT_YOUR_TEAM');
    if (isAssigned(ctx, job.id, worker.id)) throw conflict('ALREADY_ASSIGNED');
    const conflicts = overlappingJobs(ctx, worker.id, job.scheduled_start, job.scheduled_end, job.id);
    if (conflicts.length && !b.acknowledgeConflict) {
      throw conflict('OVERLAP', 'Worker is booked at an overlapping time', conflicts.map((j) => ({ id: j.id, title: j.title, start: j.scheduled_start, end: j.scheduled_end })));
    }
    const updated = ctx.db.transaction(() => {
      ctx.db.prepare('INSERT INTO assignments (job_id, worker_id, pay_basis, pay_rate, assigned_by, assigned_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(job.id, worker.id, b.payBasis ?? job.pay_basis, b.payRate ?? job.pay_rate, req.user.id, ctx.now().toISOString());
      auditJob(req, job, 'job.assign_worker', { workerId: worker.id, payBasis: b.payBasis ?? job.pay_basis, payRate: b.payRate ?? job.pay_rate, overlapAcknowledged: conflicts.length > 0 });
      return job.status === 'scheduled' ? touch(ctx, job.id, { status: 'assigned' }) : job;
    })();
    notify(ctx, { companyId: job.company_id, userIds: [worker.id], type: 'job_assigned_worker', jobId: job.id, params: messageParams(ctx, job) });
    publish(ctx, updated, 'assignment');
    res.status(201).json(jobDetail(ctx, req.user, updated));
  }));

  r.delete('/:id/assignments/:workerId', staff, wrap((req, res) => {
    const job = loadManagedJob(ctx, req.user, Number(req.params.id));
    const workerId = Number(req.params.workerId);
    const worked = ctx.db.prepare('SELECT 1 FROM attendance WHERE job_id = ? AND worker_id = ?').get(job.id, workerId);
    if (worked) throw conflict('WORKER_HAS_ATTENDANCE');
    const info = ctx.db.prepare('DELETE FROM assignments WHERE job_id = ? AND worker_id = ?').run(job.id, workerId);
    if (!info.changes) throw notFound();
    const remaining = workerIds(ctx, job.id).length;
    const updated = remaining === 0 && job.status === 'assigned' ? touch(ctx, job.id, { status: 'scheduled' }) : job;
    auditJob(req, job, 'job.unassign_worker', { workerId });
    publish(ctx, updated, 'assignment');
    res.json(jobDetail(ctx, req.user, updated));
  }));

  // ---------- Field work (assigned workers, or a supervisor assigned to the job) ----------
  const fieldJob = (req) => {
    const job = loadJobFor(ctx, req.user, Number(req.params.id));
    if (!['worker', 'supervisor'].includes(req.user.role) || !isAssigned(ctx, job.id, req.user.id)) throw forbidden('NOT_ASSIGNED');
    if (job.status === 'cancelled') throw conflict('JOB_CANCELLED');
    return job;
  };

  r.post('/:id/check-in', wrap((req, res) => {
    const b = parse(z.object({ ...position, reason: z.string().trim().max(500).optional(), photoId: idSchema.optional() }), req.body);
    idempotent(ctx, req, res, () => {
      const job = fieldJob(req);
      if (!FIELD_OPEN.includes(job.status)) throw conflict('JOB_NOT_OPEN');
      const u = req.user;
      if (openCheckIn(ctx, job.id, u.id)) throw conflict('ALREADY_CHECKED_IN');
      const elsewhere = ctx.db.prepare(
        `SELECT a.job_id FROM attendance a WHERE a.worker_id = ? AND a.job_id <> ?
         AND a.id = (SELECT id FROM attendance WHERE worker_id = a.worker_id AND job_id = a.job_id ORDER BY at DESC, id DESC LIMIT 1)
         AND a.kind = 'in'`,
      ).get(u.id, job.id);
      if (elsewhere) throw conflict('CHECKED_IN_ELSEWHERE', null, { jobId: elsewhere.job_id }); // BR-08
      const company = companyOf(ctx, job);
      const time = effectiveTime(ctx, b);
      const earliest = new Date(new Date(job.scheduled_start).getTime() - company.checkin_early_min * 60000);
      if (job.status !== 'rework' && new Date(time.at) < earliest) throw badRequest('TOO_EARLY', null, { earliest: earliest.toISOString() }); // BR-02
      const site = ctx.db.prepare('SELECT * FROM sites WHERE id = ?').get(job.site_id);
      const pos = evaluatePosition({ lat: b.lat, lng: b.lng, accuracy: b.accuracy }, site, company);
      if (!pos.verified && !b.reason) {
        throw badRequest('REASON_REQUIRED', null, { distance: pos.distance, accuracy: b.accuracy ?? null, radius: site.radius_m, inside: pos.inside });
      }
      if (b.photoId && !ctx.db.prepare('SELECT 1 FROM media WHERE id = ? AND job_id = ? AND uploaded_by = ?').get(b.photoId, job.id, u.id)) throw badRequest('BAD_PHOTO');
      const late = new Date(time.at) > new Date(new Date(job.scheduled_start).getTime() + company.late_grace_min * 60000);
      const result = ctx.db.transaction(() => {
        const info = ctx.db.prepare(
          `INSERT INTO attendance (company_id, job_id, worker_id, kind, lat, lng, accuracy_m, distance_m, inside, verified, late, reason,
             device_time, server_time, at, offline, clock_skew, photo_id, client_id)
           VALUES (?, ?, ?, 'in', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(job.company_id, job.id, u.id, b.lat ?? null, b.lng ?? null, b.accuracy ?? null, pos.distance, pos.inside ? 1 : 0,
          pos.verified ? 1 : 0, late && job.status !== 'rework' ? 1 : 0, b.reason ?? null, time.device, time.server, time.at,
          b.offline ? 1 : 0, time.skew ? 1 : 0, b.photoId ?? null, b.clientId ?? null);
        const fields = {};
        if (job.status !== 'in_progress') fields.status = 'in_progress';
        const firstOfVisit = !job.visit_started_at;
        if (firstOfVisit) Object.assign(fields, { visit_started_at: time.at, visit_verified: pos.verified ? 1 : 0, arrival_status: 'pending' });
        const updated = Object.keys(fields).length ? touch(ctx, job.id, fields) : job;
        auditJob(req, job, 'attendance.check_in', { verified: pos.verified, distance: pos.distance, accuracy: b.accuracy, reason: b.reason, offline: Boolean(b.offline), late }, b);
        return { attendanceId: Number(info.lastInsertRowid), updated, firstOfVisit };
      })();
      const params = messageParams(ctx, job, { worker: u.name, distance: pos.distance ?? '?', reason: b.reason || '' });
      if (result.firstOfVisit) {
        notify(ctx, { companyId: job.company_id, userIds: customerContactIds(ctx, job), type: 'worker_arrived', jobId: job.id, params });
      }
      if (!pos.verified) {
        notify(ctx, { companyId: job.company_id, userIds: [...managers(ctx, job), ...adminIds(ctx, job.company_id)], type: 'checkin_flagged', jobId: job.id, params });
      }
      publish(ctx, result.updated, 'check_in');
      return {
        ok: true, attendanceId: result.attendanceId, verified: pos.verified, inside: pos.inside, distance: pos.distance,
        late, offline: Boolean(b.offline), at: time.at, job: jobDetail(ctx, u, result.updated),
      };
    });
  }));

  r.post('/:id/check-out', wrap((req, res) => {
    const b = parse(z.object({ ...position, reason: z.string().trim().max(500).optional() }), req.body);
    idempotent(ctx, req, res, () => {
      const job = fieldJob(req);
      const u = req.user;
      if (!openCheckIn(ctx, job.id, u.id)) throw conflict('NOT_CHECKED_IN');
      const company = companyOf(ctx, job);
      const site = ctx.db.prepare('SELECT * FROM sites WHERE id = ?').get(job.site_id);
      const pos = evaluatePosition({ lat: b.lat, lng: b.lng, accuracy: b.accuracy }, site, company);
      const time = effectiveTime(ctx, b);
      ctx.db.prepare(
        `INSERT INTO attendance (company_id, job_id, worker_id, kind, lat, lng, accuracy_m, distance_m, inside, verified, reason,
           device_time, server_time, at, offline, clock_skew, client_id)
         VALUES (?, ?, ?, 'out', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(job.company_id, job.id, u.id, b.lat ?? null, b.lng ?? null, b.accuracy ?? null, pos.distance, pos.inside ? 1 : 0, pos.verified ? 1 : 0,
        b.reason ?? null, time.device, time.server, time.at, b.offline ? 1 : 0, time.skew ? 1 : 0, b.clientId ?? null);
      auditJob(req, job, 'attendance.check_out', { distance: pos.distance, offline: Boolean(b.offline) }, b);
      publish(ctx, job, 'check_out');
      return { ok: true, at: time.at, job: jobDetail(ctx, u, job) };
    });
  }));

  r.post('/:id/items/:itemId', wrap((req, res) => {
    const b = parse(z.object({
      done: z.boolean(),
      note: z.string().trim().max(2000).nullable().optional(),
      value: z.coerce.number().nullable().optional(),
      mediaIds: z.array(idSchema).max(10).optional(),
      deviceTime: isoDate.optional(),
      offline: z.boolean().optional(),
      clientId: z.string().min(8).max(80).optional(),
    }), req.body);
    idempotent(ctx, req, res, () => {
      const job = fieldJob(req);
      if (!FIELD_OPEN.includes(job.status)) throw conflict('JOB_NOT_OPEN');
      if (!openCheckIn(ctx, job.id, req.user.id)) throw conflict('NOT_CHECKED_IN');
      const item = ctx.db.prepare('SELECT * FROM job_items WHERE id = ? AND job_id = ?').get(Number(req.params.itemId), job.id);
      if (!item) throw notFound('ITEM_NOT_FOUND');
      const mediaIds = b.mediaIds || [];
      for (const m of mediaIds) {
        const ok = ctx.db.prepare("SELECT 1 FROM media WHERE id = ? AND job_id = ? AND kind = 'item'").get(m, job.id);
        if (!ok) throw badRequest('BAD_PHOTO');
      }
      const existingPhotos = ctx.db.prepare('SELECT COUNT(*) n FROM item_media WHERE item_id = ?').get(item.id).n;
      const note = b.note === undefined ? item.note : b.note;
      const value = b.value === undefined ? item.value : b.value;
      if (b.done) {
        if (item.type === 'photo' && existingPhotos + mediaIds.length === 0) throw badRequest('PHOTO_REQUIRED');
        if (item.type === 'note' && !note) throw badRequest('NOTE_REQUIRED');
        if (item.type === 'number' && (value == null || Number.isNaN(value))) throw badRequest('VALUE_REQUIRED');
      }
      const time = effectiveTime(ctx, b);
      ctx.db.transaction(() => {
        ctx.db.prepare('UPDATE job_items SET done_at = ?, done_by = ?, note = ?, value = ? WHERE id = ?')
          .run(b.done ? time.at : null, b.done ? req.user.id : null, note ?? null, value ?? null, item.id);
        const link = ctx.db.prepare('INSERT OR IGNORE INTO item_media (item_id, media_id) VALUES (?, ?)');
        const setItem = ctx.db.prepare('UPDATE media SET item_id = ? WHERE id = ?');
        for (const m of mediaIds) { link.run(item.id, m); setItem.run(item.id, m); }
        auditJob(req, job, b.done ? 'item.complete' : 'item.reopen', { itemId: item.id, label: item.label, photos: mediaIds.length, offline: Boolean(b.offline) });
      })();
      publish(ctx, job, 'item');
      return { ok: true, job: jobDetail(ctx, req.user, job) };
    });
  }));

  r.post('/:id/submit', wrap((req, res) => {
    const b = parse(z.object(position), req.body);
    idempotent(ctx, req, res, () => {
      const job = fieldJob(req);
      if (job.status !== 'in_progress') throw conflict('JOB_NOT_OPEN');
      const missing = ctx.db.prepare('SELECT id, label FROM job_items WHERE job_id = ? AND required = 1 AND done_at IS NULL').all(job.id);
      if (missing.length) throw badRequest('ITEMS_MISSING', null, missing); // BR-06
      const time = effectiveTime(ctx, b);
      const company = companyOf(ctx, job);
      const site = ctx.db.prepare('SELECT * FROM sites WHERE id = ?').get(job.site_id);
      const updated = ctx.db.transaction(() => {
        const insOut = ctx.db.prepare(
          `INSERT INTO attendance (company_id, job_id, worker_id, kind, lat, lng, accuracy_m, distance_m, inside, verified, reason,
             device_time, server_time, at, offline, clock_skew, auto) VALUES (?, ?, ?, 'out', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const wid of workerIds(ctx, job.id)) {
          if (!openCheckIn(ctx, job.id, wid)) continue;
          const self = wid === req.user.id;
          const pos = self ? evaluatePosition({ lat: b.lat, lng: b.lng, accuracy: b.accuracy }, site, company) : { distance: null, inside: false, verified: false };
          insOut.run(job.company_id, job.id, wid, self ? b.lat ?? null : null, self ? b.lng ?? null : null, self ? b.accuracy ?? null : null,
            pos.distance, pos.inside ? 1 : 0, pos.verified ? 1 : 0, self ? null : 'Checked out automatically when the job was submitted',
            time.device, time.server, time.at, b.offline ? 1 : 0, time.skew ? 1 : 0, self ? 0 : 1);
        }
        auditJob(req, job, 'job.submit', { offline: Boolean(b.offline) }, b);
        return touch(ctx, job.id, { status: 'submitted', submitted_at: time.at });
      })();
      const params = messageParams(ctx, job);
      notify(ctx, { companyId: job.company_id, userIds: [...customerContactIds(ctx, job), ...managers(ctx, job)], type: 'job_submitted', jobId: job.id, params });
      publish(ctx, updated, 'submitted');
      return { ok: true, job: jobDetail(ctx, req.user, updated) };
    });
  }));

  // ---------- Customer: arrival confirmation and approval ----------
  const customerJob = (req) => {
    if (req.user.role !== 'customer') throw forbidden();
    return loadJobFor(ctx, req.user, Number(req.params.id));
  };

  r.post('/:id/arrival', wrap((req, res) => {
    const job = customerJob(req);
    const b = parse(z.object({ action: z.enum(['confirm', 'dispute']), reason: z.string().trim().max(500).optional() }), req.body);
    if (job.arrival_status !== 'pending') throw conflict('ARRIVAL_NOT_PENDING');
    if (b.action === 'dispute' && (!b.reason || b.reason.length < 3)) throw badRequest('REASON_REQUIRED');
    const status = b.action === 'confirm' ? 'confirmed' : 'disputed';
    const updated = ctx.db.transaction(() => {
      ctx.db.prepare('INSERT INTO arrivals (job_id, status, by_user, reason, at) VALUES (?, ?, ?, ?, ?)')
        .run(job.id, status, req.user.id, b.reason ?? null, ctx.now().toISOString());
      auditJob(req, job, `arrival.${status}`, { reason: b.reason });
      return touch(ctx, job.id, { arrival_status: status });
    })();
    if (status === 'disputed') {
      notify(ctx, { companyId: job.company_id, userIds: [...managers(ctx, job), ...adminIds(ctx, job.company_id)], type: 'arrival_disputed', jobId: job.id, params: messageParams(ctx, job, { reason: b.reason }) });
    }
    publish(ctx, updated, 'arrival');
    res.json(jobDetail(ctx, req.user, updated));
  }));

  r.post('/:id/decision', wrap((req, res) => {
    const job = customerJob(req);
    const b = parse(z.object({
      decision: z.enum(['approve', 'reject']),
      reasonCode: z.enum(REJECT_REASONS).optional(),
      comment: z.string().trim().max(2000).optional(),
      rating: z.coerce.number().int().min(1).max(5).optional(),
      mediaIds: z.array(idSchema).max(10).optional(),
    }), req.body);
    if (job.status !== 'submitted') throw conflict('JOB_NOT_SUBMITTED');
    if (b.decision === 'reject' && (!b.reasonCode || !b.comment || b.comment.length < 3)) throw badRequest('REJECT_REASON_REQUIRED');
    for (const m of b.mediaIds || []) {
      if (!ctx.db.prepare("SELECT 1 FROM media WHERE id = ? AND job_id = ? AND kind = 'rejection' AND uploaded_by = ?").get(m, job.id, req.user.id)) throw badRequest('BAD_PHOTO');
    }
    const company = companyOf(ctx, job);
    const now = ctx.now().toISOString();
    const updated = ctx.db.transaction(() => {
      const info = ctx.db.prepare('INSERT INTO decisions (job_id, decision, reason_code, comment, rating, by_user, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(job.id, b.decision === 'approve' ? 'approved' : 'rejected', b.reasonCode ?? null, b.comment ?? null, b.rating ?? null, req.user.id, now);
      for (const m of b.mediaIds || []) ctx.db.prepare('INSERT INTO decision_media (decision_id, media_id) VALUES (?, ?)').run(info.lastInsertRowid, m);
      auditJob(req, job, b.decision === 'approve' ? 'job.approve' : 'job.reject', { reasonCode: b.reasonCode, comment: b.comment, rating: b.rating });
      if (b.decision === 'approve') return touch(ctx, job.id, { status: 'approved', decided_at: now });
      const count = job.rework_count + 1;
      // BR-12: after max_rework rejections the job goes to an admin instead of back to the field.
      const status = count > company.max_rework ? 'admin_review' : 'rework';
      return touch(ctx, job.id, { status, rework_count: count, decided_at: now, visit_started_at: null, visit_verified: null, arrival_status: null, submitted_at: null });
    })();
    const params = messageParams(ctx, job, { reason: b.comment || b.reasonCode || '', count: updated.rework_count });
    if (b.decision === 'approve') {
      notify(ctx, { companyId: job.company_id, userIds: [...managers(ctx, job), ...workerIds(ctx, job.id)], type: 'job_approved', jobId: job.id, params });
    } else {
      notify(ctx, { companyId: job.company_id, userIds: [...managers(ctx, job), ...workerIds(ctx, job.id)], type: 'job_rejected', jobId: job.id, params });
      if (updated.status === 'admin_review') notify(ctx, { companyId: job.company_id, userIds: adminIds(ctx, job.company_id), type: 'job_admin_review', jobId: job.id, params });
    }
    publish(ctx, updated, 'decision');
    res.json(jobDetail(ctx, req.user, updated));
  }));

  // FR-CMP-03 / BR-12: admin resolves a job that was rejected too many times.
  r.post('/:id/review', requireRole('admin'), wrap((req, res) => {
    const job = loadManagedJob(ctx, req.user, Number(req.params.id));
    if (job.status !== 'admin_review') throw conflict('NOT_IN_REVIEW');
    const b = parse(z.object({ action: z.enum(['rework', 'approve', 'cancel']), comment: z.string().trim().min(3).max(2000) }), req.body);
    const now = ctx.now().toISOString();
    const decision = { rework: 'admin_rework', approve: 'admin_approved', cancel: 'admin_cancelled' }[b.action];
    const status = { rework: 'rework', approve: 'approved', cancel: 'cancelled' }[b.action];
    const updated = ctx.db.transaction(() => {
      ctx.db.prepare('INSERT INTO decisions (job_id, decision, comment, by_user, at) VALUES (?, ?, ?, ?, ?)').run(job.id, decision, b.comment, req.user.id, now);
      auditJob(req, job, `job.review_${b.action}`, b);
      return touch(ctx, job.id, { status, decided_at: now, cancelled_reason: b.action === 'cancel' ? b.comment : job.cancelled_reason });
    })();
    publish(ctx, updated, 'review');
    res.json(jobDetail(ctx, req.user, updated));
  }));

  r.get('/:id/audit', staff, wrap((req, res) => {
    const job = loadJobFor(ctx, req.user, Number(req.params.id));
    if (!canManage(req.user, job)) throw forbidden();
    const rows = ctx.db.prepare(
      `SELECT a.*, u.name actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.company_id = ? AND a.entity = 'job' AND a.entity_id = ? ORDER BY a.id`,
    ).all(job.company_id, job.id);
    res.json(rows.map((x) => ({ id: x.id, action: x.action, actor: x.actor_name, data: x.data ? JSON.parse(x.data) : null, lat: x.lat, lng: x.lng, at: x.at })));
  }));

  return r;
}
