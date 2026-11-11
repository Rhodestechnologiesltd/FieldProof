import { monthRange, localDate } from './time.js';

const round2 = (n) => Math.round(n * 100) / 100;
const EARNED = new Set(['approved']);
const EXCLUDED = new Set(['cancelled']);

/** Pair each check-in with the next check-out; returns minutes worked and the local days touched. */
export function workedMinutes(events, timeZone, nowIso) {
  let minutes = 0;
  let openAt = null;
  const days = new Set();
  let open = false;
  for (const e of events) {
    if (e.kind === 'in') {
      if (!open) { openAt = new Date(e.at); open = true; days.add(localDate(openAt, timeZone)); }
    } else if (open) {
      minutes += Math.max(0, (new Date(e.at) - openAt) / 60000);
      open = false;
    }
  }
  // Still on site: count time so far, so the worker sees a running total.
  if (open && nowIso) minutes += Math.max(0, (new Date(nowIso) - openAt) / 60000);
  return { minutes, days: days.size, open };
}

/**
 * BR-10 / BR-11: earnings for one worker in a pay period ('YYYY-MM').
 * hourly = hours x rate; daily = days on site x rate; fixed = rate once;
 * salary = paid by the base salary (hourly base -> hours x base rate, monthly base -> one line for the month).
 * Jobs count as Earned only once approved; otherwise Pending. All figures are estimates.
 */
export function workerEarnings(ctx, company, workerId, period) {
  const db = ctx.db;
  const [from, to] = monthRange(period, company.timezone);
  const profile = db.prepare('SELECT * FROM worker_profiles WHERE user_id = ?').get(workerId)
    || { base_salary_amount: 0, base_salary_basis: 'none' };
  const nowIso = ctx.now().toISOString();

  const jobs = db.prepare(
    `SELECT j.id, j.title, j.status, a.pay_basis, a.pay_rate, s.name AS site_name,
            MIN(att.at) AS first_in
     FROM assignments a
     JOIN jobs j ON j.id = a.job_id
     JOIN sites s ON s.id = j.site_id
     JOIN attendance att ON att.job_id = j.id AND att.worker_id = a.worker_id AND att.kind = 'in'
     WHERE a.worker_id = ? AND j.company_id = ?
     GROUP BY j.id
     HAVING first_in >= ? AND first_in < ?
     ORDER BY first_in`,
  ).all(workerId, company.id, from.toISOString(), to.toISOString());

  const evStmt = db.prepare('SELECT kind, at FROM attendance WHERE job_id = ? AND worker_id = ? ORDER BY at, id');
  const lines = [];
  let totalMinutes = 0;
  for (const j of jobs) {
    if (EXCLUDED.has(j.status)) continue;
    const { minutes, days, open } = workedMinutes(evStmt.all(j.id, workerId), company.timezone, nowIso);
    totalMinutes += minutes;
    const hours = minutes / 60;
    let amount = 0;
    switch (j.pay_basis) {
      case 'hourly': amount = hours * j.pay_rate; break;
      case 'daily': amount = days * j.pay_rate; break;
      case 'fixed': amount = j.pay_rate; break;
      case 'salary': amount = profile.base_salary_basis === 'hourly' ? hours * profile.base_salary_amount : 0; break;
      default: amount = 0;
    }
    lines.push({
      jobId: j.id, title: j.title, site: j.site_name, date: j.first_in, status: j.status,
      basis: j.pay_basis, rate: j.pay_basis === 'salary' ? null : j.pay_rate,
      hours: round2(hours), onSite: open, amount: round2(amount),
      state: EARNED.has(j.status) ? 'earned' : 'pending',
    });
  }

  const base = profile.base_salary_basis === 'monthly'
    ? { basis: 'monthly', amount: round2(profile.base_salary_amount) }
    : { basis: profile.base_salary_basis, amount: 0, rate: profile.base_salary_amount };

  const earned = round2(lines.filter((l) => l.state === 'earned').reduce((s, l) => s + l.amount, 0) + base.amount);
  const pending = round2(lines.filter((l) => l.state === 'pending').reduce((s, l) => s + l.amount, 0));
  return {
    period, currency: company.currency, estimate: true,
    hours: round2(totalMinutes / 60), jobsCompleted: lines.filter((l) => l.state === 'earned').length,
    base, lines, earned, pending, total: round2(earned + pending),
  };
}
