// Demo data: one service company in Mauritius with 14 days of history and a busy "today".
// Usage: npm run seed            (only into an empty database)
//        npm run seed -- --force (deletes the database and uploads first)
// Every demo account uses the password printed at the end. Do not use demo data in production.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { runScheduledRules } from '../src/scheduler.js';

const PASSWORD = 'Demo1234!';
const here = path.dirname(fileURLToPath(import.meta.url));
const force = process.argv.includes('--force');

if (force) {
  for (const f of [config.dbFile, `${config.dbFile}-wal`, `${config.dbFile}-shm`]) fs.rmSync(f, { force: true });
  fs.rmSync(config.uploadDir, { recursive: true, force: true });
}
const db = openDb(config.dbFile);
if (db.prepare('SELECT COUNT(*) n FROM companies').get().n > 0) {
  console.error('The database already has data. Run `npm run seed -- --force` to wipe it and reseed.');
  process.exit(1);
}

const realNow = new Date();
let clock = new Date(realNow);
const quiet = { info() {}, error: console.error, warn() {} };
const { app, ctx } = createApp({ db, config: { ...config, smtp: { host: '' }, vapid: {} }, now: () => new Date(clock), logger: quiet });
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

const photos = Object.fromEntries(
  fs.readdirSync(path.join(here, 'seed-photos')).map((f) => [f.replace('.jpg', ''), fs.readFileSync(path.join(here, 'seed-photos', f))]),
);

function makeClient() {
  let cookie = '';
  const call = async (method, url, body, isForm) => {
    const headers = { 'X-Requested-With': 'fetch', cookie };
    if (!isForm && body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + url, { method, headers, body: isForm ? body : body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${JSON.stringify(data)}`);
    return data;
  };
  return {
    get: (u) => call('GET', u),
    post: (u, b) => call('POST', u, b ?? {}),
    patch: (u, b) => call('PATCH', u, b),
    upload: (fields, buffer) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
      fd.append('file', new Blob([buffer], { type: 'image/jpeg' }), 'photo.jpg');
      return call('POST', '/api/media', fd, true);
    },
  };
}

const at = (date) => { clock = new Date(date); };
const minutes = (n) => n * 60000;
const near = (site, metres, bearing = 45) => ({
  lat: site.lat + (metres * Math.cos((bearing * Math.PI) / 180)) / 111_320,
  lng: site.lng + (metres * Math.sin((bearing * Math.PI) / 180)) / (111_320 * Math.cos((site.lat * Math.PI) / 180)),
});

// Local (Mauritius, UTC+4) wall-clock time on a day offset from today.
function local(dayOffset, hh, mm = 0) {
  const tz = 'Indian/Mauritius';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(realNow);
  const d = new Date(`${today}T00:00:00+04:00`);
  return new Date(d.getTime() + dayOffset * 864e5 + (hh * 60 + mm) * 60000);
}

async function main() {
  at(local(-15, 8));
  const admin = makeClient();
  await admin.post('/api/auth/register-company', {
    companyName: 'Île Facility Services', name: 'Priya Ramdin', email: 'admin@example.com', password: PASSWORD, lang: 'en',
  });
  await admin.post('/api/me/consent');

  const skills = {};
  for (const name of ['Cleaning', 'HVAC', 'Gardening', 'Electrical']) skills[name] = (await admin.post('/api/skills', { name })).id;

  const services = {};
  services.cleaning = await admin.post('/api/services', {
    name: 'Office cleaning', description: 'Daily or weekly cleaning of offices and common areas.',
    slaText: 'Completed within 4 hours of start. Washrooms spotless, bins emptied, floors clean.', slaHours: 4,
    defaultPayBasis: 'hourly', defaultPayRate: 150, skills: [skills.Cleaning],
    checklist: [
      { label: 'Empty all bins and replace liners', type: 'tick', required: true },
      { label: 'Vacuum and mop floors', type: 'tick', required: true },
      { label: 'Clean washrooms (photo after)', type: 'photo', required: true },
      { label: 'Restock soap and paper (units used)', type: 'number', required: true },
      { label: 'Report any damage or issues', type: 'note', required: false },
    ],
  });
  services.ac = await admin.post('/api/services', {
    name: 'AC maintenance', description: 'Preventive maintenance of split and cassette air-conditioning units.',
    slaText: 'All listed units serviced within 6 hours; cooling tested on each unit.', slaHours: 6,
    defaultPayBasis: 'fixed', defaultPayRate: 1800, skills: [skills.HVAC],
    checklist: [
      { label: 'Inspect and clean filters (photo)', type: 'photo', required: true },
      { label: 'Clean coils and drain line', type: 'tick', required: true },
      { label: 'Gas pressure reading (psi)', type: 'number', required: true },
      { label: 'Test cooling on every unit', type: 'tick', required: true },
    ],
  });
  services.garden = await admin.post('/api/services', {
    name: 'Garden maintenance', description: 'Lawn, hedges and green waste removal.',
    slaText: 'Lawn cut, hedges trimmed, green waste removed the same day.', slaHours: 8,
    defaultPayBasis: 'daily', defaultPayRate: 900, skills: [skills.Gardening],
    checklist: [
      { label: 'Mow lawn', type: 'tick', required: true },
      { label: 'Trim hedges (photo after)', type: 'photo', required: true },
      { label: 'Remove green waste', type: 'tick', required: true },
    ],
  });

  const customers = {};
  const sites = {};
  const addCustomer = async (key, body, siteBodies) => {
    customers[key] = await admin.post('/api/customers', body);
    for (const [sk, sb] of Object.entries(siteBodies)) sites[sk] = { ...(await admin.post(`/api/customers/${customers[key].id}/sites`, sb)), customerId: customers[key].id };
  };
  await addCustomer('ebene', { name: 'Ebène Tower Ltd', type: 'business', email: 'facilities@example.com', phone: '+230 400 1000' }, {
    ebene: { name: 'Ebène Tower, 3rd floor', address: 'Cybercity, Ebène', lat: -20.2437, lng: 57.4890, radiusM: 100, accessNotes: 'Badge at reception. Service lift B.' },
  });
  await addCustomer('caudan', { name: 'Caudan Trading Co.', type: 'business', email: 'office@example.com', phone: '+230 210 2000' }, {
    caudan: { name: 'Caudan office', address: 'Caudan Waterfront, Port Louis', lat: -20.1609, lng: 57.4989, radiusM: 80, accessNotes: 'Key with security guard.' },
    qb: { name: 'Quatre Bornes warehouse', address: 'Royal Road, Quatre Bornes', lat: -20.2654, lng: 57.4791, radiusM: 150 },
  });
  await addCustomer('lim', { name: 'Lim family', type: 'household', phone: '+230 5 700 3000' }, {
    lim: { name: 'Villa Lim, Grand Baie', address: 'Coastal Road, Grand Baie', lat: -20.0109, lng: 57.5805, radiusM: 60, accessNotes: 'Dog in garden; ring twice.' },
  });

  const people = {};
  const invite = async (key, body) => {
    const res = await admin.post('/api/people', { lang: 'en', ...body });
    const token = res.inviteLink.split('/invite/')[1];
    const c = makeClient();
    const acc = await c.post('/api/auth/accept-invite', { token, password: PASSWORD });
    await c.post('/api/me/consent');
    people[key] = { client: c, user: acc.user };
  };
  await invite('jm', { role: 'supervisor', name: 'Jean-Marc Lebrasse', email: 'supervisor@example.com', phone: '+230 5 711 0001', skills: [skills.Cleaning, skills.Gardening] });
  await invite('aisha', { role: 'supervisor', name: 'Aisha Peerbux', email: 'supervisor2@example.com', phone: '+230 5 711 0002', skills: [skills.HVAC, skills.Electrical] });
  const team1 = people.jm.user.id;
  const team2 = people.aisha.user.id;
  await invite('kevin', { role: 'worker', name: 'Kevin Appadoo', email: 'worker@example.com', phone: '+230 5 722 0001', supervisorId: team1, skills: [skills.Cleaning], baseSalaryBasis: 'monthly', baseSalaryAmount: 16500, availability: [1, 2, 3, 4, 5, 6] });
  await invite('nadia', { role: 'worker', name: 'Nadia Joomun', email: 'nadia@example.com', supervisorId: team1, skills: [skills.Cleaning], baseSalaryBasis: 'none', availability: [1, 2, 3, 4, 5] });
  await invite('ravi', { role: 'worker', name: 'Ravi Gopaul', email: 'ravi@example.com', supervisorId: team1, skills: [skills.Cleaning, skills.Gardening], baseSalaryBasis: 'none', availability: [1, 2, 3, 4, 5, 6] });
  await invite('sophie', { role: 'worker', name: 'Sophie Laval', email: 'sophie@example.com', supervisorId: team2, skills: [skills.HVAC], baseSalaryBasis: 'hourly', baseSalaryAmount: 175, availability: [1, 2, 3, 4, 5] });
  await invite('yusuf', { role: 'worker', name: 'Yusuf Hossen', email: 'yusuf@example.com', supervisorId: team2, skills: [skills.HVAC, skills.Electrical, skills.Gardening], baseSalaryBasis: 'none', availability: [1, 2, 3, 4, 5, 6, 7] });
  await invite('marie', { role: 'customer', name: 'Marie Fong', email: 'customer@example.com', customerId: customers.ebene.id });
  await invite('daniel', { role: 'customer', name: 'Daniel Seegoolam', email: 'customer2@example.com', customerId: customers.caudan.id });
  await invite('lim', { role: 'customer', name: 'Kelly Lim', email: 'customer3@example.com', customerId: customers.lim.id, lang: 'fr' });

  const contactFor = { [customers.ebene.id]: 'marie', [customers.caudan.id]: 'daniel', [customers.lim.id]: 'lim' };
  const photoFor = { cleaning: ['washroom', 'floor', 'lobby'], ac: ['ac-filter'], garden: ['hedge'] };

  async function createJob({ service, site, start, hours, supervisor, workers = [], payBasis, payRate, title }) {
    const svc = services[service];
    const s = sites[site];
    at(new Date(start.getTime() - 3 * 864e5));
    const job = await admin.post('/api/jobs', {
      customerId: s.customerId, siteId: s.id, serviceId: svc.id, title,
      scheduledStart: start.toISOString(), scheduledEnd: new Date(start.getTime() + hours * 36e5).toISOString(),
      supervisorId: supervisor ? people[supervisor].user.id : null, payBasis, payRate,
    });
    for (const w of workers) {
      await admin.post(`/api/jobs/${job.id}/assignments`, { workerId: people[w].user.id, acknowledgeConflict: true });
    }
    return { ...job, service, site: s };
  }

  async function doWork(job, worker, { startAt, doneItems, metres = 12, reason, accuracy = 9 }) {
    const w = people[worker].client;
    at(startAt);
    await w.post(`/api/jobs/${job.id}/check-in`, { ...near(job.site, metres), accuracy, reason, deviceTime: clock.toISOString() });
    const items = doneItems ?? job.items.length;
    for (const [i, item] of job.items.slice(0, items).entries()) {
      at(new Date(startAt.getTime() + minutes(20 * (i + 1))));
      const body = { done: true, deviceTime: clock.toISOString() };
      if (item.type === 'photo') {
        const pick = photoFor[job.service][i % photoFor[job.service].length];
        const m = await w.upload({ jobId: job.id, kind: 'item', ...near(job.site, metres), takenAt: clock.toISOString() }, photos[pick]);
        body.mediaIds = [m.id];
      }
      if (item.type === 'number') body.value = 4 + (i % 5);
      if (item.type === 'note') { if (!item.required) continue; body.note = 'All fine'; }
      await w.post(`/api/jobs/${job.id}/items/${item.id}`, body);
    }
  }

  async function submit(job, worker, when) {
    at(when);
    await people[worker].client.post(`/api/jobs/${job.id}/submit`, { ...near(job.site, 10), accuracy: 8, deviceTime: clock.toISOString() });
  }

  async function customerDecides(job, when, decision, extra = {}) {
    at(when);
    const c = people[contactFor[job.site.customerId]].client;
    const body = { decision, ...extra };
    if (decision === 'reject') {
      const m = await c.upload({ jobId: job.id, kind: 'rejection' }, photos.damage);
      body.mediaIds = [m.id];
    }
    await c.post(`/api/jobs/${job.id}/decision`, body);
  }

  async function confirmArrival(job, when, action = 'confirm', reason) {
    at(when);
    await people[contactFor[job.site.customerId]].client.post(`/api/jobs/${job.id}/arrival`, { action, reason });
  }

  // ---- 14 days of history ----
  const plan = [
    ['cleaning', 'ebene', 'jm', ['kevin', 'nadia'], 7, 3],
    ['cleaning', 'caudan', 'jm', ['ravi'], 8, 3],
    ['ac', 'qb', 'aisha', ['sophie'], 9, 4],
    ['garden', 'lim', 'jm', ['ravi'], 13, 4],
    ['ac', 'ebene', 'aisha', ['yusuf'], 14, 3],
  ];
  let n = 0;
  for (let day = -14; day <= -1; day++) {
    const dow = local(day, 12).getUTCDay();
    if (dow === 0) continue; // no Sunday work
    const todays = plan.filter((p, i) => (day + i) % 2 === 0 || p[1] === 'ebene');
    for (const [service, site, sup, workers, hh, hours] of todays) {
      n++;
      const start = local(day, hh);
      const job = await createJob({ service, site, start, hours, supervisor: sup, workers });
      const lateBy = n % 6 === 0 ? 22 : (n % 3) * 4;
      const begin = new Date(start.getTime() + minutes(lateBy - 5));
      const flagged = n % 9 === 0;
      for (const [i, w] of workers.entries()) {
        await doWork(job, w, {
          startAt: new Date(begin.getTime() + minutes(i * 3)), doneItems: i === 0 ? undefined : 0,
          metres: flagged ? 260 : 8 + (n % 5) * 6, reason: flagged ? 'GPS drift inside the building' : undefined,
        });
      }
      if (n % 4 !== 0 && !flagged) await confirmArrival(job, new Date(begin.getTime() + minutes(6 + (n % 7))));
      const submitAt = new Date(begin.getTime() + minutes(job.items.length * 20 + 25 + (n % 4) * 15));
      await submit(job, workers[0], submitAt);
      if (n % 7 === 3) {
        // Rejected, reworked next morning, then approved.
        await customerDecides(job, new Date(submitAt.getTime() + minutes(90)), 'reject', {
          reasonCode: n % 2 ? 'incomplete' : 'poor_quality', comment: n % 2 ? 'Meeting room bins were not emptied.' : 'Streaks left on the lobby floor.',
        });
        const redo = new Date(local(day + 1, 17, 30));
        if (redo < realNow) {
          await doWork(job, workers[0], { startAt: redo, doneItems: 0 });
          await submit(job, workers[0], new Date(redo.getTime() + minutes(45)));
          await customerDecides(job, new Date(redo.getTime() + minutes(150)), 'approve', { rating: 4 });
        }
      } else if (n % 5 !== 4) {
        await customerDecides(job, new Date(submitAt.getTime() + minutes(40 + (n % 6) * 30)), 'approve', { rating: 3 + (n % 3) });
      }
      // n % 5 === 4: no response; the 48-hour rule approves it when the scheduler runs.
      at(new Date(submitAt.getTime() + 49 * 36e5));
      runScheduledRules(ctx);
    }
  }

  // ---- Today ----
  const nowMs = realNow.getTime();
  const rel = (mins) => new Date(nowMs + minutes(mins));

  // 0. Rejected yesterday afternoon; back with the team for rework today.
  const j6 = await createJob({ service: 'cleaning', site: 'caudan', start: local(-1, 14), hours: 3, supervisor: 'jm', workers: ['nadia'], title: 'Deep clean, archive room' });
  await doWork(j6, 'nadia', { startAt: local(-1, 14, 5) });
  await confirmArrival(j6, local(-1, 14, 20));
  await submit(j6, 'nadia', local(-1, 16, 10));
  await customerDecides(j6, local(-1, 17, 40), 'reject', { reasonCode: 'incomplete', comment: 'Shelves in the archive room were not dusted.' });
  // 1. In progress, arrival confirmed, part of the checklist done.
  const j1 = await createJob({ service: 'cleaning', site: 'ebene', start: rel(-70), hours: 4, supervisor: 'jm', workers: ['kevin', 'nadia'] });
  await doWork(j1, 'kevin', { startAt: rel(-72), doneItems: 2 });
  await doWork(j1, 'nadia', { startAt: rel(-68), doneItems: 0, metres: 20 });
  await confirmArrival(j1, rel(-60));
  // 2. Submitted, waiting for the customer.
  const j2 = await createJob({ service: 'cleaning', site: 'caudan', start: rel(-210), hours: 3, supervisor: 'jm', workers: ['ravi'] });
  await doWork(j2, 'ravi', { startAt: rel(-205) });
  await confirmArrival(j2, rel(-195));
  await submit(j2, 'ravi', rel(-35));
  // 3. Late: nobody has checked in.
  await createJob({ service: 'ac', site: 'qb', start: rel(-40), hours: 4, supervisor: 'aisha', workers: ['sophie'] });
  // 4. Disputed arrival: Yusuf checked in, the customer says nobody came to the meeting rooms; he then left for the next job.
  const j5 = await createJob({ service: 'ac', site: 'ebene', start: rel(-50), hours: 3, supervisor: 'aisha', workers: ['yusuf'], title: 'AC maintenance, meeting rooms' });
  await doWork(j5, 'yusuf', { startAt: rel(-45), doneItems: 0, metres: 15 });
  await confirmArrival(j5, rel(-38), 'dispute', 'Nobody came to the 5th floor meeting rooms');
  at(rel(-30));
  await people.yusuf.client.post(`/api/jobs/${j5.id}/check-out`, { ...near(j5.site, 15), accuracy: 9 });
  // 5. Flagged check-in, arrival still pending.
  const j4 = await createJob({ service: 'garden', site: 'lim', start: rel(-25), hours: 4, supervisor: 'jm', workers: ['yusuf'] });
  await doWork(j4, 'yusuf', { startAt: rel(-20), doneItems: 1, metres: 430, reason: 'Map pin is on the main road; villa is up the hill' });
  // 7. Later today.
  await createJob({ service: 'cleaning', site: 'caudan', start: rel(150), hours: 3, supervisor: 'jm', workers: ['kevin'] });
  await createJob({ service: 'ac', site: 'caudan', start: rel(200), hours: 3, supervisor: 'aisha', workers: ['sophie'] });
  // 8. Waiting for assignment: no supervisor and no workers yet.
  await createJob({ service: 'garden', site: 'qb', start: local(1, 9), hours: 5 });
  await createJob({ service: 'cleaning', site: 'ebene', start: local(1, 7), hours: 3, supervisor: 'jm' });
  // 9. Weekly cleaning for the next four weeks.
  at(realNow);
  await admin.post('/api/jobs', {
    customerId: customers.caudan.id, siteId: sites.caudan.id, serviceId: services.cleaning.id, supervisorId: team1,
    scheduledStart: local(2, 7).toISOString(), scheduledEnd: local(2, 10).toISOString(), repeat: { every: 'week', count: 4 },
  });

  at(realNow);
  runScheduledRules(ctx);
  server.close();
  db.close();

  console.log('\nDemo data created. Sign in at the web app with any of these accounts:\n');
  const rows = [
    ['Admin', 'admin@example.com'], ['Supervisor', 'supervisor@example.com'], ['Supervisor', 'supervisor2@example.com'],
    ['Worker', 'worker@example.com'], ['Worker', 'ravi@example.com'], ['Worker', 'yusuf@example.com'],
    ['Customer (business)', 'customer@example.com'], ['Customer (business)', 'customer2@example.com'], ['Customer (household, French)', 'customer3@example.com'],
  ];
  for (const [role, email] of rows) console.log(`  ${role.padEnd(30)} ${email}`);
  console.log(`\n  Password for all: ${PASSWORD}\n`);
}

main().catch((err) => {
  console.error(err);
  server.close();
  process.exit(1);
});
