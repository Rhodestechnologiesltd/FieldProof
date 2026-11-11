import { forbidden, notFound } from './errors.js';

export const OPEN_FIELD_STATUSES = ['assigned', 'in_progress', 'rework'];

export function getJobRow(ctx, companyId, jobId) {
  const job = ctx.db.prepare('SELECT * FROM jobs WHERE id = ? AND company_id = ?').get(jobId, companyId);
  if (!job) throw notFound('JOB_NOT_FOUND');
  return job;
}

export function isAssigned(ctx, jobId, userId) {
  return Boolean(ctx.db.prepare('SELECT 1 FROM assignments WHERE job_id = ? AND worker_id = ?').get(jobId, userId));
}

/** Can this user see the job? Mirrors the permissions table in the spec. */
export function canView(ctx, user, job) {
  if (job.company_id !== user.company_id) return false;
  switch (user.role) {
    case 'admin': return true;
    case 'supervisor': return job.supervisor_id === user.id || isAssigned(ctx, job.id, user.id);
    case 'worker': return isAssigned(ctx, job.id, user.id);
    case 'customer': return job.customer_id === user.customer_id;
    default: return false;
  }
}

/** Admins, or the job's own supervisor, may manage it. */
export function canManage(user, job) {
  return user.role === 'admin' || (user.role === 'supervisor' && job.supervisor_id === user.id);
}

export function loadJobFor(ctx, user, jobId) {
  const job = getJobRow(ctx, user.company_id, jobId);
  if (!canView(ctx, user, job)) throw notFound('JOB_NOT_FOUND'); // do not reveal existence
  return job;
}

export function loadManagedJob(ctx, user, jobId) {
  const job = loadJobFor(ctx, user, jobId);
  if (!canManage(user, job)) throw forbidden();
  return job;
}

export const adminIds = (ctx, companyId) =>
  ctx.db.prepare("SELECT id FROM users WHERE company_id = ? AND role = 'admin' AND status = 'active'").all(companyId).map((r) => r.id);

export const workerIds = (ctx, jobId) =>
  ctx.db.prepare('SELECT worker_id FROM assignments WHERE job_id = ?').all(jobId).map((r) => r.worker_id);

export const customerContactIds = (ctx, job) =>
  ctx.db.prepare("SELECT id FROM users WHERE company_id = ? AND role = 'customer' AND customer_id = ? AND status = 'active'")
    .all(job.company_id, job.customer_id).map((r) => r.id);

/** People who should see live updates for a job. */
export function audience(ctx, job) {
  return [...adminIds(ctx, job.company_id), job.supervisor_id, ...workerIds(ctx, job.id), ...customerContactIds(ctx, job)].filter(Boolean);
}

/** Supervisor, or all admins when no supervisor is set. */
export const managers = (ctx, job) => (job.supervisor_id ? [job.supervisor_id] : adminIds(ctx, job.company_id));

export function publish(ctx, job, change) {
  ctx.bus.send(audience(ctx, job), { type: 'job', jobId: job.id, change });
}

export function messageParams(ctx, job, extra = {}) {
  const site = ctx.db.prepare('SELECT name FROM sites WHERE id = ?').get(job.site_id);
  const company = ctx.db.prepare('SELECT timezone FROM companies WHERE id = ?').get(job.company_id);
  const when = new Intl.DateTimeFormat('en-GB', {
    timeZone: company.timezone, dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(job.scheduled_start));
  return { job: job.title, site: site?.name || '', when, ...extra };
}

export function touch(ctx, jobId, fields) {
  const sets = Object.keys(fields).map((k) => `${k} = @${k}`);
  sets.push('updated_at = @updated_at');
  ctx.db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = @id`).run({ ...fields, updated_at: ctx.now().toISOString(), id: jobId });
  return ctx.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
}

/** Full job view with checklist, people, attendance, confirmations and decisions. */
export function jobDetail(ctx, user, job) {
  const db = ctx.db;
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(job.site_id);
  const customer = db.prepare('SELECT id, name, type FROM customers WHERE id = ?').get(job.customer_id);
  const service = job.service_id ? db.prepare('SELECT id, name FROM services WHERE id = ?').get(job.service_id) : null;
  const supervisor = job.supervisor_id ? db.prepare('SELECT id, name, phone FROM users WHERE id = ?').get(job.supervisor_id) : null;
  const items = db.prepare('SELECT * FROM job_items WHERE job_id = ? ORDER BY position').all(job.id);
  const itemMedia = db.prepare(
    `SELECT im.item_id, m.id, m.taken_at, m.lat, m.lng FROM item_media im JOIN media m ON m.id = im.media_id
     WHERE m.job_id = ? ORDER BY m.id`,
  ).all(job.id);
  const assignments = db.prepare(
    `SELECT a.worker_id, a.pay_basis, a.pay_rate, a.assigned_at, u.name, u.phone FROM assignments a
     JOIN users u ON u.id = a.worker_id WHERE a.job_id = ? ORDER BY u.name`,
  ).all(job.id);
  const attendance = db.prepare(
    `SELECT a.*, u.name AS worker_name FROM attendance a JOIN users u ON u.id = a.worker_id
     WHERE a.job_id = ? ORDER BY a.at`,
  ).all(job.id);
  const arrivals = db.prepare(
    'SELECT ar.*, u.name AS by_name FROM arrivals ar LEFT JOIN users u ON u.id = ar.by_user WHERE job_id = ? ORDER BY ar.id',
  ).all(job.id);
  const decisions = db.prepare(
    'SELECT d.*, u.name AS by_name FROM decisions d LEFT JOIN users u ON u.id = d.by_user WHERE job_id = ? ORDER BY d.id',
  ).all(job.id);
  const decisionMedia = db.prepare(
    'SELECT dm.decision_id, dm.media_id FROM decision_media dm JOIN decisions d ON d.id = dm.decision_id WHERE d.job_id = ?',
  ).all(job.id);

  const isCustomer = user.role === 'customer';
  const isFieldOrManager = !isCustomer;
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(job.company_id);

  return {
    id: job.id,
    title: job.title,
    notes: isFieldOrManager ? job.notes : null,
    status: job.status,
    scheduledStart: job.scheduled_start,
    scheduledEnd: job.scheduled_end,
    slaText: job.sla_text,
    slaHours: job.sla_hours,
    arrivalStatus: job.arrival_status,
    visitStartedAt: job.visit_started_at,
    visitVerified: job.visit_verified == null ? null : Boolean(job.visit_verified),
    submittedAt: job.submitted_at,
    decidedAt: job.decided_at,
    reworkCount: job.rework_count,
    cancelledReason: job.cancelled_reason,
    payBasis: canManage(user, job) ? job.pay_basis : undefined,
    payRate: canManage(user, job) ? job.pay_rate : undefined,
    autoConfirmMinutes: company.arrival_autoconfirm_min,
    autoApproveHours: company.approval_autoapprove_hours,
    site: site && {
      id: site.id, name: site.name, address: site.address, lat: site.lat, lng: site.lng,
      radiusM: site.radius_m, accessNotes: isFieldOrManager ? site.access_notes : null,
    },
    customer,
    service,
    supervisor,
    items: items.map((i) => ({
      id: i.id, position: i.position, label: i.label, type: i.type, required: Boolean(i.required),
      doneAt: i.done_at, doneBy: i.done_by, note: i.note, value: i.value,
      media: itemMedia.filter((m) => m.item_id === i.id).map((m) => ({ id: m.id, takenAt: m.taken_at })),
    })),
    workers: assignments.map((a) => ({
      id: a.worker_id, name: a.name, phone: isCustomer ? null : a.phone, assignedAt: a.assigned_at,
      payBasis: canManage(user, job) || user.id === a.worker_id ? a.pay_basis : undefined,
      payRate: canManage(user, job) || user.id === a.worker_id ? a.pay_rate : undefined,
    })),
    attendance: attendance.map((a) => ({
      id: a.id, workerId: a.worker_id, workerName: a.worker_name, kind: a.kind, at: a.at,
      serverTime: a.server_time, deviceTime: isCustomer ? undefined : a.device_time,
      // Customers see whether it was verified, not raw coordinates.
      lat: isCustomer ? undefined : a.lat, lng: isCustomer ? undefined : a.lng,
      accuracyM: isCustomer ? undefined : a.accuracy_m, distanceM: a.distance_m,
      inside: a.inside == null ? null : Boolean(a.inside), verified: Boolean(a.verified), late: Boolean(a.late),
      reason: a.reason, offline: Boolean(a.offline), clockSkew: Boolean(a.clock_skew), auto: Boolean(a.auto), photoId: a.photo_id,
    })),
    arrivals: arrivals.map((a) => ({ id: a.id, status: a.status, by: a.by_name, reason: a.reason, at: a.at })),
    decisions: decisions.map((d) => ({
      id: d.id, decision: d.decision, reasonCode: d.reason_code, comment: d.comment, rating: d.rating, by: d.by_name, at: d.at,
      media: decisionMedia.filter((m) => m.decision_id === d.id).map((m) => m.media_id),
    })),
    progress: { done: items.filter((i) => i.done_at).length, total: items.length },
  };
}

/** Workers with a time conflict for the given window (BR-08 / FR-JOB-03). */
export function overlappingJobs(ctx, workerId, start, end, excludeJobId) {
  return ctx.db.prepare(
    `SELECT j.id, j.title, j.scheduled_start, j.scheduled_end FROM assignments a JOIN jobs j ON j.id = a.job_id
     WHERE a.worker_id = ? AND j.id <> ? AND j.status NOT IN ('cancelled','approved')
       AND j.scheduled_start < ? AND j.scheduled_end > ?`,
  ).all(workerId, excludeJobId ?? 0, end, start);
}
