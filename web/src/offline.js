// Offline outbox for field actions (NFR-04). Actions are captured with device time and GPS,
// stored on the phone, and sent in order when the connection returns. Each action carries a
// clientId so a retry is never applied twice on the server.
import { useEffect, useState } from 'react';
import { get, set } from 'idb-keyval';
import { api, ApiError } from './api.js';
import { emitLocal } from './live.js';

const OUTBOX = 'outbox';
const FAILED = 'outbox-failed';
const subscribers = new Set();
let syncing = false;

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const notify = async () => {
  const [queue, failed] = await Promise.all([get(OUTBOX), get(FAILED)]);
  for (const fn of subscribers) fn({ queue: queue || [], failed: failed || [], syncing });
};

async function perform(entry, offline) {
  const body = { ...entry.body, clientId: entry.id, deviceTime: entry.createdAt, offline };
  if (entry.photos?.length) {
    const ids = [];
    for (const [i, blob] of entry.photos.entries()) {
      const form = new FormData();
      form.append('jobId', entry.jobId);
      form.append('kind', entry.photoKind || 'item');
      form.append('takenAt', entry.createdAt);
      if (entry.body.lat != null) { form.append('lat', entry.body.lat); form.append('lng', entry.body.lng); }
      form.append('file', blob, `photo-${i}.jpg`);
      const m = await api('/media', { method: 'POST', form });
      ids.push(m.id);
    }
    if (entry.type === 'item') body.mediaIds = [...(body.mediaIds || []), ...ids];
    if (entry.type === 'check-in') body.photoId = ids[0];
  }
  const path = {
    'check-in': `/jobs/${entry.jobId}/check-in`,
    'check-out': `/jobs/${entry.jobId}/check-out`,
    item: `/jobs/${entry.jobId}/items/${entry.itemId}`,
    submit: `/jobs/${entry.jobId}/submit`,
  }[entry.type];
  return api(path, { method: 'POST', body });
}

/**
 * Run a field action now; if the phone is offline, queue it and resolve with { queued: true }.
 * Server-side refusals (e.g. reason required) are thrown so the screen can respond.
 */
export async function fieldAction({ type, jobId, itemId, body = {}, photos = [], photoKind }) {
  const entry = { id: newId(), type, jobId, itemId, body, photos, photoKind, createdAt: new Date().toISOString() };
  const queue = (await get(OUTBOX)) || [];
  if (navigator.onLine && queue.length === 0) {
    try {
      return await perform(entry, false);
    } catch (err) {
      if (!(err instanceof ApiError) || err.code !== 'NETWORK') throw err;
    }
  }
  await set(OUTBOX, [...((await get(OUTBOX)) || []), entry]);
  notify();
  return { queued: true, entry };
}

/** Send queued actions in order. Stops at the first network failure. */
export async function syncOutbox() {
  if (syncing) return;
  syncing = true;
  notify();
  try {
    for (;;) {
      const queue = (await get(OUTBOX)) || [];
      if (!queue.length) break;
      const [entry, ...rest] = queue;
      try {
        await perform(entry, true);
        await set(OUTBOX, rest);
        emitLocal({ type: 'job', jobId: entry.jobId, change: 'synced' });
      } catch (err) {
        if (err.code === 'NETWORK' || err.status >= 500) break;
        // Refused by the server (e.g. the job was cancelled): keep a record and tell the worker.
        await set(OUTBOX, rest);
        await set(FAILED, [...((await get(FAILED)) || []), { ...entry, photos: [], error: err.code, failedAt: new Date().toISOString() }]);
        emitLocal({ type: 'job', jobId: entry.jobId, change: 'sync-failed' });
      }
      notify();
    }
  } finally {
    syncing = false;
    notify();
  }
}

export async function clearFailed() {
  await set(FAILED, []);
  notify();
}

export function useOutbox() {
  const [state, setState] = useState({ queue: [], failed: [], syncing: false });
  useEffect(() => {
    subscribers.add(setState);
    notify();
    return () => subscribers.delete(setState);
  }, []);
  return state;
}

export function startSyncLoop() {
  window.addEventListener('online', () => syncOutbox());
  setInterval(() => { if (navigator.onLine) syncOutbox(); }, 30_000);
  if (navigator.onLine) syncOutbox();
}

export function pendingFor(queue, jobId) {
  return queue.filter((e) => String(e.jobId) === String(jobId));
}
