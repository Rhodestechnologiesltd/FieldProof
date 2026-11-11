// Time-based business rules, run every minute: BR-03 late alerts, BR-04 arrival auto-confirm, BR-05 auto-approve.
import { notify } from './lib/services.js';
import { messageParams, managers, customerContactIds, workerIds, publish } from './lib/jobs.js';

export function runScheduledRules(ctx) {
  const now = ctx.now();
  const nowIso = now.toISOString();
  const db = ctx.db;
  const results = { autoConfirmed: 0, autoApproved: 0, lateAlerts: 0 };

  // BR-04: a Verified arrival auto-confirms when the customer has not responded. Flagged ones stay pending.
  const pendingArrivals = db.prepare(
    `SELECT j.*, c.arrival_autoconfirm_min m FROM jobs j JOIN companies c ON c.id = j.company_id
     WHERE j.arrival_status = 'pending' AND j.visit_verified = 1 AND j.visit_started_at IS NOT NULL`,
  ).all();
  for (const job of pendingArrivals) {
    if (new Date(job.visit_started_at).getTime() + job.m * 60000 > now.getTime()) continue;
    db.transaction(() => {
      db.prepare("INSERT INTO arrivals (job_id, status, by_user, reason, at) VALUES (?, 'auto_confirmed', NULL, ?, ?)")
        .run(job.id, `No response within ${job.m} minutes`, nowIso);
      db.prepare("UPDATE jobs SET arrival_status = 'auto_confirmed', updated_at = ? WHERE id = ?").run(nowIso, job.id);
      db.prepare("INSERT INTO audit_log (company_id, actor_id, action, entity, entity_id, data, at) VALUES (?, NULL, 'arrival.auto_confirmed', 'job', ?, ?, ?)")
        .run(job.company_id, job.id, JSON.stringify({ minutes: job.m }), nowIso);
    })();
    notify(ctx, { companyId: job.company_id, userIds: [...customerContactIds(ctx, job), ...managers(ctx, job)], type: 'arrival_auto_confirmed', jobId: job.id, params: messageParams(ctx, job) });
    publish(ctx, job, 'arrival');
    results.autoConfirmed++;
  }

  // BR-05: completion auto-approves after the company's waiting time.
  const submitted = db.prepare(
    `SELECT j.*, c.approval_autoapprove_hours h FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.status = 'submitted'`,
  ).all();
  for (const job of submitted) {
    if (new Date(job.submitted_at).getTime() + job.h * 36e5 > now.getTime()) continue;
    db.transaction(() => {
      db.prepare("INSERT INTO decisions (job_id, decision, comment, by_user, at) VALUES (?, 'auto_approved', ?, NULL, ?)")
        .run(job.id, `No response within ${job.h} hours`, nowIso);
      db.prepare("UPDATE jobs SET status = 'approved', decided_at = ?, updated_at = ? WHERE id = ?").run(nowIso, nowIso, job.id);
      db.prepare("INSERT INTO audit_log (company_id, actor_id, action, entity, entity_id, data, at) VALUES (?, NULL, 'job.auto_approved', 'job', ?, ?, ?)")
        .run(job.company_id, job.id, JSON.stringify({ hours: job.h }), nowIso);
    })();
    notify(ctx, {
      companyId: job.company_id, userIds: [...customerContactIds(ctx, job), ...managers(ctx, job), ...workerIds(ctx, job.id)],
      type: 'job_auto_approved', jobId: job.id, params: messageParams(ctx, job),
    });
    publish(ctx, { ...job, status: 'approved' }, 'decision');
    results.autoApproved++;
  }

  // BR-03: no check-in by start + grace time -> alert the supervisor once.
  const due = db.prepare(
    `SELECT j.*, c.late_grace_min g FROM jobs j JOIN companies c ON c.id = j.company_id
     WHERE j.status IN ('scheduled','assigned') AND j.late_alerted = 0 AND j.visit_started_at IS NULL AND j.scheduled_end > ?`,
  ).all(nowIso);
  for (const job of due) {
    if (new Date(job.scheduled_start).getTime() + job.g * 60000 > now.getTime()) continue;
    db.prepare('UPDATE jobs SET late_alerted = 1 WHERE id = ?').run(job.id);
    notify(ctx, { companyId: job.company_id, userIds: managers(ctx, job), type: 'worker_late', jobId: job.id, params: messageParams(ctx, job) });
    publish(ctx, job, 'late');
    results.lateAlerts++;
  }
  return results;
}

export function startScheduler(ctx) {
  const tick = () => {
    try { runScheduledRules(ctx); } catch (err) { console.error('Scheduler error', err); }
  };
  const timer = setInterval(tick, ctx.config.schedulerIntervalMs);
  timer.unref?.();
  tick();
  return () => clearInterval(timer);
}
