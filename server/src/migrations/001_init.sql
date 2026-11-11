-- FieldProof initial schema. All timestamps are ISO-8601 strings in UTC.
-- Every business record carries company_id so each company's data stays separate.

CREATE TABLE companies (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Indian/Mauritius',
  currency TEXT NOT NULL DEFAULT 'MUR',
  default_lang TEXT NOT NULL DEFAULT 'en',
  arrival_autoconfirm_min INTEGER NOT NULL DEFAULT 30,
  approval_autoapprove_hours INTEGER NOT NULL DEFAULT 48,
  default_radius_m INTEGER NOT NULL DEFAULT 100,
  gps_accuracy_max_m INTEGER NOT NULL DEFAULT 100,
  checkin_early_min INTEGER NOT NULL DEFAULT 30,
  late_grace_min INTEGER NOT NULL DEFAULT 15,
  max_rework INTEGER NOT NULL DEFAULT 2,
  created_at TEXT NOT NULL
);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'business' CHECK (type IN ('business','household')),
  email TEXT,
  phone TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_customers_company ON customers(company_id);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  role TEXT NOT NULL CHECK (role IN ('admin','supervisor','worker','customer')),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  password_hash TEXT,
  lang TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','disabled','deleted')),
  customer_id INTEGER REFERENCES customers(id),
  supervisor_id INTEGER REFERENCES users(id),
  consent_at TEXT,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_users_email ON users(lower(email)) WHERE email IS NOT NULL AND status <> 'deleted';
CREATE INDEX idx_users_company ON users(company_id, role);

CREATE TABLE tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('invite','reset')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE skills (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  UNIQUE (company_id, name)
);

CREATE TABLE user_skills (
  user_id INTEGER NOT NULL REFERENCES users(id),
  skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, skill_id)
);

-- Base pay and availability for workers (and supervisors who also do field work).
CREATE TABLE worker_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  base_salary_amount REAL NOT NULL DEFAULT 0,
  base_salary_basis TEXT NOT NULL DEFAULT 'none' CHECK (base_salary_basis IN ('none','monthly','hourly')),
  availability TEXT NOT NULL DEFAULT '[1,2,3,4,5]' -- ISO weekdays, 1 = Monday
);

CREATE TABLE sites (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  name TEXT NOT NULL,
  address TEXT,
  lat REAL,
  lng REAL,
  radius_m INTEGER NOT NULL DEFAULT 100,
  access_notes TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_sites_customer ON sites(customer_id);

CREATE TABLE services (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  description TEXT,
  sla_text TEXT,
  sla_hours REAL,
  default_pay_basis TEXT NOT NULL DEFAULT 'salary' CHECK (default_pay_basis IN ('salary','hourly','daily','fixed')),
  default_pay_rate REAL NOT NULL DEFAULT 0,
  checklist TEXT NOT NULL DEFAULT '[]', -- [{label, type, required}]
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE service_skills (
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (service_id, skill_id)
);

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  site_id INTEGER NOT NULL REFERENCES sites(id),
  service_id INTEGER REFERENCES services(id),
  title TEXT NOT NULL,
  notes TEXT,
  scheduled_start TEXT NOT NULL,
  scheduled_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN
    ('scheduled','assigned','in_progress','submitted','rework','admin_review','approved','cancelled')),
  supervisor_id INTEGER REFERENCES users(id),
  sla_text TEXT,
  sla_hours REAL,
  pay_basis TEXT NOT NULL DEFAULT 'salary',
  pay_rate REAL NOT NULL DEFAULT 0,
  arrival_status TEXT CHECK (arrival_status IN ('pending','confirmed','disputed','auto_confirmed')),
  visit_started_at TEXT,        -- first check-in of the current visit
  visit_verified INTEGER,       -- was that first check-in inside the site area
  late_alerted INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT,
  decided_at TEXT,
  rework_count INTEGER NOT NULL DEFAULT 0,
  cancelled_reason TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_jobs_company_start ON jobs(company_id, scheduled_start);
CREATE INDEX idx_jobs_supervisor ON jobs(supervisor_id);
CREATE INDEX idx_jobs_customer ON jobs(customer_id);

CREATE TABLE job_items (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  position INTEGER NOT NULL,
  label TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'tick' CHECK (type IN ('tick','photo','note','number')),
  required INTEGER NOT NULL DEFAULT 1,
  done_at TEXT,
  done_by INTEGER REFERENCES users(id),
  note TEXT,
  value REAL
);
CREATE INDEX idx_items_job ON job_items(job_id);

CREATE TABLE assignments (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  worker_id INTEGER NOT NULL REFERENCES users(id),
  pay_basis TEXT NOT NULL CHECK (pay_basis IN ('salary','hourly','daily','fixed')),
  pay_rate REAL NOT NULL DEFAULT 0,
  assigned_by INTEGER REFERENCES users(id),
  assigned_at TEXT NOT NULL,
  UNIQUE (job_id, worker_id)
);
CREATE INDEX idx_assignments_worker ON assignments(worker_id);

CREATE TABLE media (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  job_id INTEGER REFERENCES jobs(id),
  item_id INTEGER REFERENCES job_items(id),
  kind TEXT NOT NULL CHECK (kind IN ('item','checkin','rejection')),
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  file TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  lat REAL,
  lng REAL,
  taken_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_media_job ON media(job_id);

-- Append-only: corrections are new rows with a reason (BR-13).
CREATE TABLE attendance (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  worker_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('in','out')),
  lat REAL,
  lng REAL,
  accuracy_m REAL,
  distance_m REAL,
  inside INTEGER,
  verified INTEGER NOT NULL DEFAULT 0,
  late INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  device_time TEXT,
  server_time TEXT NOT NULL,
  at TEXT NOT NULL,             -- effective time: server time, or device time when captured offline
  offline INTEGER NOT NULL DEFAULT 0,
  clock_skew INTEGER NOT NULL DEFAULT 0,
  auto INTEGER NOT NULL DEFAULT 0,
  photo_id INTEGER REFERENCES media(id),
  client_id TEXT UNIQUE
);
CREATE INDEX idx_attendance_job ON attendance(job_id, worker_id, at);

CREATE TABLE arrivals (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  status TEXT NOT NULL CHECK (status IN ('confirmed','disputed','auto_confirmed')),
  by_user INTEGER REFERENCES users(id),
  reason TEXT,
  at TEXT NOT NULL
);

CREATE TABLE decisions (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  decision TEXT NOT NULL CHECK (decision IN ('approved','rejected','auto_approved','admin_approved','admin_rework','admin_cancelled')),
  reason_code TEXT,
  comment TEXT,
  rating INTEGER,
  by_user INTEGER REFERENCES users(id),
  at TEXT NOT NULL
);

CREATE TABLE decision_media (
  decision_id INTEGER NOT NULL REFERENCES decisions(id),
  media_id INTEGER NOT NULL REFERENCES media(id),
  PRIMARY KEY (decision_id, media_id)
);

CREATE TABLE item_media (
  item_id INTEGER NOT NULL REFERENCES job_items(id),
  media_id INTEGER NOT NULL REFERENCES media(id),
  PRIMARY KEY (item_id, media_id)
);

CREATE TABLE client_actions (      -- idempotency for offline sync retries
  client_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  response TEXT NOT NULL,
  at TEXT NOT NULL
);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  job_id INTEGER REFERENCES jobs(id),
  params TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at);

CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL,
  actor_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  data TEXT,
  lat REAL,
  lng REAL,
  at TEXT NOT NULL
);
CREATE INDEX idx_audit_company ON audit_log(company_id, at);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);

-- Audit rows and attendance rows can never be changed or removed (BR-13, NFR-10).
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER attendance_no_update BEFORE UPDATE ON attendance BEGIN SELECT RAISE(ABORT, 'attendance is append-only'); END;
CREATE TRIGGER attendance_no_delete BEFORE DELETE ON attendance BEGIN SELECT RAISE(ABORT, 'attendance is append-only'); END;
CREATE TRIGGER decisions_no_update BEFORE UPDATE ON decisions BEGIN SELECT RAISE(ABORT, 'decisions are append-only'); END;
