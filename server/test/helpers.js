import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { runScheduledRules } from '../src/scheduler.js';

// Site in Port Louis used by the tests; points are offset north of it.
export const SITE = { lat: -20.1609, lng: 57.4989 };
export const metresNorth = (m) => ({ lat: SITE.lat + m / 111_320, lng: SITE.lng });

const silent = { info() {}, error() {}, warn() {} };

export function makeApp() {
  const db = openDb(':memory:');
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-test-'));
  let clock = new Date('2026-10-19T06:00:00.000Z'); // 10:00 in Mauritius
  const config = {
    env: 'test', isProd: false, jwtSecret: 'test-secret', appUrl: 'http://app.test', uploadDir, webDist: null,
    signupCode: '', maxUploadBytes: 5 * 1024 * 1024, schedulerIntervalMs: 60000,
    smtp: { host: '' }, vapid: {},
  };
  const { app, ctx } = createApp({ db, config, now: () => new Date(clock), logger: silent });
  return {
    app, ctx, db,
    setTime: (iso) => { clock = new Date(iso); },
    advance: (minutes) => { clock = new Date(clock.getTime() + minutes * 60000); },
    now: () => new Date(clock),
    tick: () => runScheduledRules(ctx),
  };
}

/** A logged-in client: every request carries the CSRF header and the session cookie. */
export function client(app) {
  const agent = request.agent(app);
  const withHeader = (req) => req.set('X-Requested-With', 'fetch');
  return {
    agent,
    get: (url) => agent.get(url),
    post: (url, body) => withHeader(agent.post(url)).send(body ?? {}),
    patch: (url, body) => withHeader(agent.patch(url)).send(body ?? {}),
    del: (url) => withHeader(agent.delete(url)),
    upload: (url, fields, buffer, mime = 'image/jpeg') => {
      let req = withHeader(agent.post(url));
      for (const [k, v] of Object.entries(fields)) req = req.field(k, String(v));
      return req.attach('file', buffer, { filename: 'photo.jpg', contentType: mime });
    },
  };
}

const inviteToken = (ctx) => {
  const last = ctx.mailer.sent.filter((m) => m.subject.includes('invited') || m.subject.includes('Invitation')).at(-1);
  return last.text.match(/\/invite\/([A-Za-z0-9_-]+)/)[1];
};

/** Create a company with admin, supervisor, worker, customer contact, a site and a service. */
export async function setupCompany(t, name = 'Acme Facilities', emailPrefix = 'acme') {
  const admin = client(t.app);
  let res = await admin.post('/api/auth/register-company', {
    companyName: name, name: 'Ada Admin', email: `${emailPrefix}-admin@example.com`, password: 'Password1!',
  });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));

  const skill = (await admin.post('/api/skills', { name: 'Cleaning' })).body;
  const service = (await admin.post('/api/services', {
    name: 'Office cleaning', slaText: 'Done within 4 hours', slaHours: 4, defaultPayBasis: 'hourly', defaultPayRate: 150,
    skills: [skill.id],
    checklist: [
      { label: 'Empty bins', type: 'tick', required: true },
      { label: 'Photo of clean floor', type: 'photo', required: true },
      { label: 'Supplies left (units)', type: 'number', required: false },
    ],
  })).body;
  const customer = (await admin.post('/api/customers', { name: `${name} Client Ltd`, type: 'business' })).body;
  const site = (await admin.post(`/api/customers/${customer.id}/sites`, { name: 'Head office', address: 'Port Louis', ...SITE, radiusM: 100 })).body;

  const invite = async (body) => {
    const r = await admin.post('/api/people', body);
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    const c = client(t.app);
    const token = inviteToken(t.ctx);
    const acc = await c.post('/api/auth/accept-invite', { token, password: 'Password1!' });
    if (acc.status !== 200) throw new Error(JSON.stringify(acc.body));
    return { client: c, user: acc.body.user };
  };
  const supervisor = await invite({ role: 'supervisor', name: 'Sam Supervisor', email: `${emailPrefix}-sup@example.com`, skills: [skill.id] });
  const worker = await invite({
    role: 'worker', name: 'Wendy Worker', email: `${emailPrefix}-worker@example.com`, supervisorId: supervisor.user.id,
    skills: [skill.id], baseSalaryBasis: 'none', availability: [1, 2, 3, 4, 5, 6, 7],
  });
  const worker2 = await invite({
    role: 'worker', name: 'Will Worker', email: `${emailPrefix}-worker2@example.com`, supervisorId: supervisor.user.id,
    skills: [], availability: [1, 2, 3, 4, 5],
  });
  const cust = await invite({ role: 'customer', name: 'Carla Customer', email: `${emailPrefix}-cust@example.com`, customerId: customer.id });
  return { admin, supervisor, worker, worker2, customer: cust, ids: { skill: skill.id, service: service.id, customer: customer.id, site: site.id } };
}

/** Create a job at the given time and assign the worker. Returns the job detail. */
export async function createAssignedJob(t, co, { start = '2026-10-19T06:00:00.000Z', hours = 4, workers = ['worker'], payBasis, payRate } = {}) {
  const end = new Date(new Date(start).getTime() + hours * 36e5).toISOString();
  const res = await co.admin.post('/api/jobs', {
    customerId: co.ids.customer, siteId: co.ids.site, serviceId: co.ids.service,
    scheduledStart: start, scheduledEnd: end, supervisorId: co.supervisor.user.id, payBasis, payRate,
  });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  for (const w of workers) {
    const a = await co.supervisor.client.post(`/api/jobs/${res.body.id}/assignments`, { workerId: co[w].user.id, acknowledgeConflict: true });
    if (a.status !== 201) throw new Error(JSON.stringify(a.body));
  }
  return res.body;
}

export const tinyJpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);
