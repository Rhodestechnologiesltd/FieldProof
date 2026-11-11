// Checks that every translation key used in the code exists, and that all four languages have the same keys.
// Run: npm run check:i18n
import fs from 'node:fs';
import path from 'node:path';
import en from '../src/i18n/en.js';
import fr from '../src/i18n/fr.js';
import mfe from '../src/i18n/mfe.js';
import ar from '../src/i18n/ar.js';

const flatten = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) =>
  (v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
const keys = (d) => new Set(flatten(d));
function lookup(node, key) {
  if (node == null || typeof node !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(node, key)) return node[key];
  const i = key.indexOf('.');
  return i < 0 ? undefined : lookup(node[key.slice(0, i)], key.slice(i + 1));
}
const base = keys(en);
let problems = 0;

for (const [name, dict] of Object.entries({ fr, mfe, ar })) {
  const k = keys(dict);
  const missing = [...base].filter((x) => !k.has(x));
  const extra = [...k].filter((x) => !base.has(x));
  if (missing.length || extra.length) {
    problems++;
    console.log(`${name}: missing ${missing.length}, extra ${extra.length}`, missing.slice(0, 20), extra.slice(0, 20));
  }
  // Placeholders must match the English text.
  for (const key of base) {
    const get = (d) => lookup(d, key);
    const a = String(get(en) ?? '').match(/\{\w+\}/g)?.sort().join() || '';
    const b = String(get(dict) ?? '').match(/\{\w+\}/g)?.sort().join() || '';
    if (a !== b && get(dict) != null) { problems++; console.log(`${name}: placeholder mismatch in ${key}: "${a}" vs "${b}"`); }
  }
}

// Keys referenced in code
const used = new Set();
const walk = (dir) => {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { if (f !== 'i18n') walk(p); continue; }
    if (!/\.(jsx?|mjs)$/.test(f)) continue;
    const s = fs.readFileSync(p, 'utf8');
    for (const m of s.matchAll(/\bt\(\s*'([^']+)'/g)) used.add(m[1]);
    for (const m of s.matchAll(/\?\s*'([a-z]+\.[A-Za-z_.]+)'\s*:\s*'([a-z]+\.[A-Za-z_.]+)'/g)) { used.add(m[1]); used.add(m[2]); }
    for (const m of s.matchAll(/key: '([a-z]+\.[A-Za-z]+)'/g)) used.add(m[1]);
  }
};
walk(path.resolve('src'));

// Dynamic families: every value the code can produce.
const families = {
  status: ['scheduled', 'assigned', 'in_progress', 'submitted', 'rework', 'admin_review', 'approved', 'cancelled'],
  arrival: ['pending', 'confirmed', 'auto_confirmed', 'disputed'],
  decision: ['approved', 'rejected', 'auto_approved', 'admin_approved', 'admin_rework', 'admin_cancelled'],
  roles: ['admin', 'supervisor', 'worker', 'customer'],
  itemType: ['tick', 'photo', 'note', 'number'],
  rejectReasons: ['incomplete', 'poor_quality', 'damage', 'not_as_agreed', 'sla_missed', 'other'],
  pay: ['salary', 'hourly', 'daily', 'fixed'],
  days: ['1', '2', '3', '4', '5', '6', '7'],
  'jobs.ranges': ['today', 'week', 'upcoming', 'past', 'all'],
  notif: ['job_assigned_supervisor', 'job_assigned_worker', 'worker_arrived', 'checkin_flagged', 'worker_late', 'arrival_disputed',
    'arrival_auto_confirmed', 'job_submitted', 'job_approved', 'job_auto_approved', 'job_rejected', 'job_admin_review', 'job_cancelled'],
  'earnings.state_': ['earned', 'pending'],
  'manage.review_': ['rework', 'approve', 'cancel'],
  'people.tab_': ['worker', 'supervisor', 'customer', 'admin'],
  'people.empty_': ['worker', 'supervisor', 'customer', 'admin'],
  'people.status_': ['active', 'invited', 'disabled'],
  'people.per_': ['monthly', 'hourly'],
  'customers.type_': ['business', 'household'],
  'audit.entity_': ['job', 'user', 'customer', 'site', 'service', 'skill', 'company'],
  'profile.push_': ['checking', 'unsupported', 'server_off', 'on', 'off'],
  'settings.': ['default_radius_m', 'gps_accuracy_max_m', 'checkin_early_min', 'late_grace_min', 'arrival_autoconfirm_min', 'approval_autoapprove_hours', 'max_rework'].flatMap((k) => [k, `${k}_hint`]),
  'attendance.': ['in', 'out'],
  'field.': ['gpsDenied', 'gpsUnavailable'],
};
for (const [prefix, values] of Object.entries(families)) {
  for (const v of values) used.add(prefix.endsWith('_') || prefix.endsWith('.') ? `${prefix}${v}` : `${prefix}.${v}`);
}
// Server error codes the client may show.
const serverSrc = ['../server/src/routes', '../server/src/lib'].flatMap((d) => fs.readdirSync(path.resolve(d)).map((f) => fs.readFileSync(path.resolve(d, f), 'utf8'))).join('\n');
for (const m of serverSrc.matchAll(/(?:badRequest|conflict|forbidden|notFound|unauthorized)\('([A-Z_]+)'/g)) used.add(`errors.${m[1]}`);

const missingUsed = [...used].filter((k) => !base.has(k));
if (missingUsed.length) { problems++; console.log('Used in code but missing in en.js:', missingUsed); }

console.log(problems ? `\n${problems} problem(s) found.` : `All ${base.size} keys present in 4 languages; ${used.size} references checked.`);
process.exit(problems ? 1 : 0);
