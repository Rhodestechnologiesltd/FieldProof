import 'dotenv/config';
import path from 'node:path';

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';

function required(name, devDefault) {
  const value = process.env[name];
  if (value) return value;
  if (isProd) throw new Error(`Missing required environment variable ${name}`);
  return devDefault;
}

export const config = {
  env,
  isProd,
  port: Number(process.env.PORT || 3000),
  jwtSecret: required('JWT_SECRET', 'dev-only-insecure-secret-change-me'),
  dbFile: process.env.DATABASE_FILE || path.resolve('data/fieldproof.db'),
  uploadDir: process.env.UPLOAD_DIR || path.resolve('data/uploads'),
  appUrl: (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, ''),
  webDist: process.env.WEB_DIST || path.resolve('../web/dist'),
  signupCode: process.env.SIGNUP_CODE || '',
  trustProxy: process.env.TRUST_PROXY === 'true',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 8) * 1024 * 1024,
  schedulerIntervalMs: Number(process.env.SCHEDULER_INTERVAL_MS || 60_000),
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    secure: process.env.SMTP_SECURE === 'true',
    from: process.env.MAIL_FROM || 'FieldProof <no-reply@example.com>',
  },
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  },
};
