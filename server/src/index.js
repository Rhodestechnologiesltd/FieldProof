import { config } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { startScheduler } from './scheduler.js';

const db = openDb(config.dbFile);
const { app, ctx } = createApp({ db, config });
startScheduler(ctx);

const server = app.listen(config.port, () => {
  console.log(`FieldProof API listening on http://localhost:${config.port} (${config.env})`);
  if (!ctx.mailer.enabled) console.log('Email is not configured: emails are printed to this console.');
  if (!ctx.push.enabled) console.log('Web push is not configured: run `npm run vapid` and set VAPID_* variables.');
});

const shutdown = () => {
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
