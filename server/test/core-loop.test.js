// End-to-end tests of the release 1 core loop, mapped to the spec's test scenarios (T1–T13) and rules (BR-xx).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, setupCompany, createAssignedJob, client, metresNorth, tinyJpeg } from './helpers.js';

const notificationsOf = (t, userId, type) =>
  t.db.prepare('SELECT * FROM notifications WHERE user_id = ? AND type = ?').all(userId, type);

async function completeChecklist(t, co, job, who = 'worker') {
  const c = co[who].client;
  const photo = await c.upload('/api/media', { jobId: job.id, kind: 'item' }, tinyJpeg);
  assert.equal(photo.status, 201, JSON.stringify(photo.body));
  for (const item of job.items) {
    const body = item.type === 'photo' ? { done: true, mediaIds: [photo.body.id] } : item.type === 'number' ? { done: true, value: 3 } : { done: true };
    const r = await c.post(`/api/jobs/${job.id}/items/${item.id}`, body);
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
}

test('T1: check-in 40 m from site with good GPS is Verified and the customer is notified', async () => {
  const t = makeApp();
  const co = await setupCompany(t);
  const job = await createAssignedJob(t, co);
  const res = await co.worker.client.post(`/api/jobs/${job.id}/check-in`, { ...metresNorth(40), accuracy: 12 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.verified, true);
  assert.equal(res.body.distance, 40);
  assert.equal(res.body.job.status, 'in_progress');
  assert.equal(res.body.job.arrivalStatus, 'pending');
  assert.equal(notificationsOf(t, co.customer.user.id, 'worker_arrived').length, 1);
  // Customers see verification, not raw coordinates.
  const seen = await co.customer.client.get(`/api/jobs/${job.id}`);
  assert.equal(seen.body.attendance[0].verified, true);
  assert.equal(seen.body.attendance[0].lat, undefined);
});

test('T2: check-in 600 m away needs a reason, is Flagged and alerts the supervisor', async () => {
  const t = makeApp();
  const co = await setupCompany(t);
  const job = await createAssignedJob(t, co);
  let res = await co.worker.client.post(`/api/jobs/${job.id}/check-in`, { ...metresNorth(600), accuracy: 10 });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'REASON_REQUIRED');
  assert.ok(Math.abs(res.body.error.details.distance - 600) <= 2);
  res = await co.worker.client.post(`/api/jobs/${job.id}/check-in`, { ...metresNorth(600), accuracy: 10, reason: 'Gate is on the next street' });
  assert.equal(res.status, 200);
  assert.equal(res.body.verified, false);
  assert.equal(notificationsOf(t, co.supervisor.user.id, 'checkin_flagged').length, 1);
});

test('BR-01: poor GPS accuracy inside the area is not Verified', async () => {
  const t = makeApp();
  const co = await setupCompany(t);
  const job = await createAssignedJob(t, co);
  const res = await co.worker.client.post(`/api/jobs/${job.id}/check-in`, { ...metresNorth(10), accuracy: 250, reason: 'Indoors' });
  assert.equal(res.body.inside, true);
  assert.equal(res.body.verified, false);
});

test('BR-02: check-in more than 30 minutes early is refused', async () => {
  const t = makeApp();
  const co = await setupCompany(t);
  const job = await createAssignedJob(t, co, { start: '2026-10-19T08:00:00.000Z' });
  const res = await co.worker.client.post(`/api/jobs/${job.id}/check-in`, { ...metresNorth(5), accuracy: 5 });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'TOO_EARLY');
});

test('T3: offline check-in syncs later with device time, is marked offline, and replays are ignored', async () => {
  const t = makeApp();
  const co = await setupCompany(t);
  const job = await createAssignedJob(t, co);
  const captured = t.now().toISOString();
  t.advance(120);
  const body = { ...metresNorth(20), accuracy: 8, offline: true, deviceTime: captured, clientId: 'device-abc-0001' };
  const first = await co.worker.client.post(`/api/jobs/${job.id}/check-in`, body);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.at, captured);
  const replay = await co.worker.client.post(`/api/jobs/${job.id}/check-in`, body);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.attendanceId, first.body.attendanceId);
  const rows = t.db.prepare("SELECT * FROM attendance WHERE job_id = ? AND kind = 'in'").all(job.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].offline, 1);
  assert.equal(rows[0].clock_skew, 1);
});

test('T4: Verified arrival auto-confirms after 30 minutes; a Flagged one stays pending', async () => {
  const t = makeApp();
  const co = await setupCompany(t);
  const jobA = await createAssignedJob(t, co);
  const jobB = await createAssignedJob(t, co, { workers: ['worker2'] });
  await co.worker.client.post(`/api/jobs/${jobA.id}/check-in`, { ...metresNorth(10), accuracy: 5 });
  await co.worker2.client.post(`/api/jobs/${jobB.id}/check-in`, { ...metresNorth(900), accuracy: 5, reason: 'Wrong pin' });
  t.advance(29);
  t.tick();
  assert.equal((await co.admin.get(`/api/jobs/${jobA.id}`)).body.arrivalStatus, 'pending');
  t.advance(2);
  const out = t.tick();
  assert.equal(out.autoConfirmed, 1);
  assert.equal((await co.admin.get(`/api/jobs/${jobA.id}`)).body.arrivalStatus, 'auto_confirmed');
  assert.equal((await co.admin.get(`/api/jobs/${jobB.id}`)).body.arrivalStatus, 'pending');
});

test('Customer confirms or disputes arrival; a dispute alerts the supervisor', async () => {
  const t = makeApp();
  const co = await setupCompany(t);
  const job = await createAssignedJob(t, co);
  await co.worker.client.post(`/api/jobs/${job.id}/check-in`, { ...metresNorth(10), accuracy: 5 });
  let res = await co.customer.client.post(`/api/jobs/${job.id}/arrival`, { action: 'dispute' });
  assert.equal(res.body.error.code, 'REASON_REQUIRED');
  res = await co.customer.client.post(`/api/jobs/${job.id}/arrival`, { action: 'dispute', reason: 'Nobody is here' });
  assert.equal(res.body.arrivalStatus, 'disputed');
  assert.equal(notificationsOf(t, co.supervisor.user.id, 'arrival_disputed').length, 1);
  res = await co.customer.client.post(`/api/jobs/${job.id}/arrival`, { action: 'confirm' });
  assert.equal(res.status, 409);
});

test('T5: submit is refused until required items are done; photo items need a photo', async () => {
  const t = makeApp();
  const co = await setupCompany(t);
  const job = await createAssignedJob(t, co);
  const w = co.worker.client;
  let res = await w.post(`/api/jobs/${job.id}/items/${job.items[0].id}`, { done: true });
  assert.equal(res.body.error.code, 'NOT_CHECKED_IN');
  await w.post(`/api/jobs/${job.id}/check-in`, { ...metresNorth(10), accuracy: 5 });
  res = await w.post(`/api/jobs/${job.id}/submit`, {});
  assert.equal(res.body.error.code, 'ITEMS_MISSING');
  assert.equal(res.body.error.details.length, 2);
  const photoItem = job.items.find((i) => i.type === 'photo');
  res = await w.post(`/api/jobs/${job.id}/items/${photoItem.id}`, { done: true });
  assert.equal(res.body.error.code, 'PHOTO_REQUIRED');
  await completeChecklist(t, co, job);
  res = await w.post(`/api/jobs/${job.id}/submit`, { ...metresNorth(10), accuracy: 5 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.job.status, 'submitted');
  assert.equal(notificationsOf(t, co.customer.user.id, 'job_submitted').length, 1);
});

test('T6 + T7: rejection sends the job to rework with earnings pending; the third rejection goes to admin review', async () => {
  const t = makeApp();
  const co = await setupCompany(t);
  const job = await createAssignedJob(t, co);
  const w = co.worker.client;
  for (let round = 1; round <= 3; round++) {
    let res = await w.post(`/api/jobs/${job.id}/check-in`, { ...metresNorth(10), accuracy: 5 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    if (round === 1) await completeChecklist(t, co, job);
    t.advance(60);
    res = await w.post(`/api/jobs/${job.id}/submit`, { ...metresNorth(10), accuracy: 5 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const photo = await co.customer.client.upload('/api/media', { jobId: job.id, kind: 'rejection' }, tinyJpeg);
    res = await co.customer.client.post(`/api/jobs/${job.id}/decision`, { decision: 'reject', reasonCode: 'poor_quality', comment: 'Floor still dirty', mediaIds: [photo.body.id] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, round < 3 ? 'rework' : 'admin_review');
    assert.equal(res.body.reworkCount, round);
    if (round === 1) {
      const earnings = await w.get('/api/earnings/me?period=2026-10');
      assert.equal(earnings.body.lines[0].state, 'pending');
    }
    t.advance(60);
  }
  const adminId = t.db.prepare("SELECT id FROM users WHERE role = 'admin'").get().id;
  assert.equal(notificationsOf(t, adminId, 'job_admin_review').length, 1);
  const res = await co.admin.post(`/api/jobs/${job.id}/review`, { action: 'approve', comment: 'Checked on site with the client' });
  assert.equal(res.body.status, 'approved');
});

test('Approval closes the job and makes the earnings final', async () => {
  const t = makeApp();
  const co = await setupCompany(t);
  const job = await createAssignedJob(t, co);
  await co.worker.client.post(`/api/jobs/${job.id}/check-in`, { ...metresNorth(10), accuracy: 5 });
  await completeChecklist(t, co, job);
  t.advance(90);
  await co.worker.client.post(`/api/jobs/${job.id}/submit`, {});
  const res = await co.customer.client.post(`/api/jobs/${job.id}/decision`, { decision: 'approve', rating: 5 });
  assert.equal(res.body.status, 'approved');
  const e = (await co.worker.client.get('/api/earnings/me?period=2026-10')).body;
  assert.equal(e.lines[0].state, 'earned');
  assert.equal(e.earned, 225); // 1.5 h x 150
});

test('BR-05: completion auto-approves after 48 hours without a response', async () => {
  const t = makeApp();
  const co = await setupCompany(t);
  const job = await createAssignedJob(t, co);
  await co.worker.client.post(`/api/jobs/${job.id}/check-in`, { ...metresNorth(10), accuracy: 5 });
  await completeChecklist(t, co, job);
  await co.worker.client.post(`/api/jobs/${job.id}/submit`, {});
  t.advance(47 * 60);
  assert.equal(t.tick().autoApproved, 0);
  t.advance(61);
  assert.equal(t.tick().autoApproved, 1);
  const d = (await co.customer.client.get(`/api/jobs/${job.id}`)).body;
  assert.equal(d.status, 'approved');
  assert.equal(d.decisions.at(-1).decision, 'auto_approved');
});

test('BR-03: no check-in by start + 15 minutes alerts the supervisor once', async () => {
  const t = makeApp();
  const co = await setupCompany(t);
  await createAssignedJob(t, co, { start: '2026-10-19T07:00:00.000Z' });
  t.setTime('2026-10-19T07:14:00.000Z');
  assert.equal(t.tick().lateAlerts, 0);
  t.setTime('2026-10-19T07:16:00.000Z');
  assert.equal(t.tick().lateAlerts, 1);
  assert.equal(t.tick().lateAlerts, 0);
  assert.equal(notificationsOf(t, co.supervisor.user.id, 'worker_late').length, 1);
});

test('T8: assigning a worker already booked at the same time needs confirmation', async () => {
  const t = makeApp();
  const co = await setupCompany(t);
  await createAssignedJob(t, co);
  const second = (await co.admin.post('/api/jobs', {
    customerId: co.ids.customer, siteId: co.ids.site, serviceId: co.ids.service, supervisorId: co.supervisor.user.id,
    scheduledStart: '2026-10-19T07:00:00.000Z', scheduledEnd: '2026-10-19T09:00:00.000Z',
  })).body;
  let res = await co.supervisor.client.post(`/api/jobs/${second.id}/assignments`, { workerId: co.worker.user.id });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'OVERLAP');
  const cands = (await co.supervisor.client.get(`/api/jobs/${second.id}/candidates`)).body;
  const wendy = cands.find((c) => c.id === co.worker.user.id);
  assert.equal(wendy.conflicts.length, 1);
  assert.equal(cands.at(-1).id, co.worker2.user.id); // no matching skill: ranked last
  res = await co.supervisor.client.post(`/api/jobs/${second.id}/assignments`, { workerId: co.worker.user.id, acknowledgeConflict: true });
  assert.equal(res.status, 201);
});

test('BR-08: a worker cannot be checked in to two jobs at once', async () => {
  const t = makeApp();
  const co = await setupCompany(t);
  const a = await createAssignedJob(t, co);
  const b = await createAssignedJob(t, co);
  await co.worker.client.post(`/api/jobs/${a.id}/check-in`, { ...metresNorth(10), accuracy: 5 });
  const res = await co.worker.client.post(`/api/jobs/${b.id}/check-in`, { ...metresNorth(10), accuracy: 5 });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'CHECKED_IN_ELSEWHERE');
});

test('T9: a customer cannot open another customer\'s job', async () => {
  const t = makeApp();
  const co = await setupCompany(t);
  const job = await createAssignedJob(t, co);
  const other = (await co.admin.post('/api/customers', { name: 'Other Ltd' })).body;
  await co.admin.post('/api/people', { role: 'customer', name: 'Olga Other', email: 'olga@example.com', customerId: other.id });
  const token = t.ctx.mailer.sent.at(-1).text.match(/\/invite\/([A-Za-z0-9_-]+)/)[1];
  const olga = client(t.app);
  await olga.post('/api/auth/accept-invite', { token, password: 'Password1!' });
  assert.equal((await olga.get(`/api/jobs/${job.id}`)).status, 404);
  assert.equal((await olga.get('/api/jobs')).body.length, 0);
});

test('T10: a user of company X cannot reach company Y data', async () => {
  const t = makeApp();
  const x = await setupCompany(t, 'X Facilities', 'x');
  const y = await setupCompany(t, 'Y Facilities', 'y');
  const jobY = await createAssignedJob(t, y);
  assert.equal((await x.admin.get(`/api/jobs/${jobY.id}`)).status, 404);
  assert.equal((await x.admin.get('/api/jobs')).body.length, 0);
  const people = (await x.admin.get('/api/people')).body;
  assert.ok(people.every((p) => p.companyId !== y.admin.companyId && !p.email?.startsWith('y-')));
  const res = await x.admin.patch(`/api/sites/${y.ids.site}`, { name: 'Hacked' });
  assert.equal(res.status, 404);
  const assign = await x.admin.post(`/api/jobs/${jobY.id}/assignments`, { workerId: x.worker.user.id });
  assert.equal(assign.status, 404);
});

test('T11: hourly pay of MUR 150 for 3 h 20 min shows MUR 500, labelled estimate', async () => {
  const t = makeApp();
  const co = await setupCompany(t);
  const job = await createAssignedJob(t, co, { payBasis: 'hourly', payRate: 150 });
  await co.worker.client.post(`/api/jobs/${job.id}/check-in`, { ...metresNorth(10), accuracy: 5 });
  t.advance(200);
  await co.worker.client.post(`/api/jobs/${job.id}/check-out`, {});
  const e = (await co.worker.client.get('/api/earnings/me?period=2026-10')).body;
  assert.equal(e.lines[0].amount, 500);
  assert.equal(e.lines[0].hours, 3.33);
  assert.equal(e.estimate, true);
  assert.equal(e.currency, 'MUR');
});

test('Pay bases: daily, fixed, and monthly base salary', async () => {
  const t = makeApp();
  const co = await setupCompany(t);
  await co.admin.patch(`/api/people/${co.worker.user.id}`, { baseSalaryBasis: 'monthly', baseSalaryAmount: 18000 });
  const daily = await createAssignedJob(t, co, { payBasis: 'daily', payRate: 900 });
  await co.worker.client.post(`/api/jobs/${daily.id}/check-in`, { ...metresNorth(10), accuracy: 5 });
  t.advance(60);
  await co.worker.client.post(`/api/jobs/${daily.id}/check-out`, {});
  const fixed = await createAssignedJob(t, co, { start: '2026-10-19T07:15:00.000Z', payBasis: 'fixed', payRate: 2000 });
  await co.worker.client.post(`/api/jobs/${fixed.id}/check-in`, { ...metresNorth(10), accuracy: 5 });
  const e = (await co.worker.client.get('/api/earnings/me?period=2026-10')).body;
  assert.equal(e.base.amount, 18000);
  assert.deepEqual(e.lines.map((l) => [l.basis, l.amount]), [['daily', 900], ['fixed', 2000]]);
  assert.equal(e.pending, 2900);
  assert.equal(e.earned, 18000);
  const csv = await co.admin.get('/api/earnings/export.csv?period=2026-10');
  assert.match(csv.text, /Base salary \(monthly\)/);
  assert.match(csv.text, /"daily","900","1","900","pending"/);
});

test('T12: a customer deletes their account; personal details are removed and job records kept', async () => {
  const t = makeApp();
  const co = await setupCompany(t);
  const job = await createAssignedJob(t, co);
  const res = await co.customer.client.del('/api/me');
  assert.equal(res.status, 200);
  const u = t.db.prepare('SELECT * FROM users WHERE id = ?').get(co.customer.user.id);
  assert.equal(u.status, 'deleted');
  assert.equal(u.email, null);
  assert.equal(u.name, 'Deleted user');
  assert.ok(t.db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(job.id));
  assert.equal((await co.customer.client.get('/api/me')).status, 401);
  // Staff cannot delete themselves; an admin removes them.
  assert.equal((await co.worker.client.del('/api/me')).status, 403);
});

test('Attendance and audit records are append-only (BR-13)', async () => {
  const t = makeApp();
  const co = await setupCompany(t);
  const job = await createAssignedJob(t, co);
  await co.worker.client.post(`/api/jobs/${job.id}/check-in`, { ...metresNorth(10), accuracy: 5 });
  assert.throws(() => t.db.prepare('UPDATE attendance SET lat = 0').run(), /append-only/);
  assert.throws(() => t.db.prepare('DELETE FROM audit_log').run(), /append-only/);
  const log = (await co.admin.get(`/api/jobs/${job.id}/audit`)).body;
  assert.deepEqual(log.map((l) => l.action), ['job.create', 'job.assign_worker', 'attendance.check_in']);
  assert.ok(log[2].lat);
});

test('Roles: workers and customers cannot use admin endpoints; supervisors are limited to their team', async () => {
  const t = makeApp();
  const co = await setupCompany(t);
  assert.equal((await co.worker.client.post('/api/customers', { name: 'X' })).status, 403);
  assert.equal((await co.customer.client.get('/api/dashboard')).status, 403);
  assert.equal((await co.worker.client.get('/api/earnings')).status, 403);
  assert.equal((await co.supervisor.client.patch('/api/company', { max_rework: 5 })).status, 403);
  const job = await createAssignedJob(t, co);
  // Worker can see own job but not manage it.
  assert.equal((await co.worker.client.get(`/api/jobs/${job.id}`)).status, 200);
  assert.equal((await co.worker.client.post(`/api/jobs/${job.id}/cancel`, { reason: 'nope' })).status, 403);
  // Worker 2 is not assigned: not visible.
  assert.equal((await co.worker2.client.get(`/api/jobs/${job.id}`)).status, 404);
});

test('Security: CSRF header is required, sessions end after a password reset', async () => {
  const t = makeApp();
  const co = await setupCompany(t);
  const raw = await co.admin.agent.post('/api/customers').send({ name: 'No header' });
  assert.equal(raw.status, 403);
  assert.equal(raw.body.error.code, 'CSRF');
  const anon = client(t.app);
  await anon.post('/api/auth/forgot', { email: 'acme-worker@example.com' });
  const token = t.ctx.mailer.sent.at(-1).text.match(/\/reset\/([A-Za-z0-9_-]+)/)[1];
  const r = await anon.post('/api/auth/reset', { token, password: 'NewPassword1!' });
  assert.equal(r.status, 200);
  assert.equal((await co.worker.client.get('/api/me')).status, 401);
  const login = await anon.post('/api/auth/login', { email: 'acme-worker@example.com', password: 'NewPassword1!' });
  assert.equal(login.status, 200);
  assert.equal((await anon.post('/api/auth/reset', { token, password: 'Another1!!' })).status, 400);
});

test('Dashboard shows today, late, flagged, approvals and SLA breaches', async () => {
  const t = makeApp();
  const co = await setupCompany(t);
  const late = await createAssignedJob(t, co, { start: '2026-10-19T05:00:00.000Z', hours: 2 });
  const flagged = await createAssignedJob(t, co, { workers: ['worker2'] });
  await co.worker2.client.post(`/api/jobs/${flagged.id}/check-in`, { ...metresNorth(800), accuracy: 5, reason: 'Wrong pin' });
  const d = (await co.admin.get('/api/dashboard')).body;
  assert.equal(d.today.total, 2);
  assert.deepEqual(d.late.map((j) => j.id), [late.id]);
  assert.deepEqual(d.flagged.map((j) => j.id), [flagged.id]);
  assert.equal(d.trend.length, 14);
  const sup = (await co.supervisor.client.get('/api/dashboard')).body;
  assert.equal(sup.today.total, 2);
});

test('Recurring jobs create one job per occurrence; calendar export lists them', async () => {
  const t = makeApp();
  const co = await setupCompany(t);
  const res = await co.admin.post('/api/jobs', {
    customerId: co.ids.customer, siteId: co.ids.site, serviceId: co.ids.service,
    scheduledStart: '2026-10-20T05:00:00.000Z', scheduledEnd: '2026-10-20T07:00:00.000Z', repeat: { every: 'week', count: 4 },
  });
  assert.equal(res.body.createdIds.length, 4);
  const ics = await co.admin.get('/api/jobs/calendar.ics');
  assert.equal((ics.text.match(/BEGIN:VEVENT/g) || []).length, 4);
});
