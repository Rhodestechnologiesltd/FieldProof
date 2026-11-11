// One Server-Sent Events connection per signed-in session; components subscribe with useLive().
import { useEffect, useRef } from 'react';

const listeners = new Set();
let source = null;

export function startLive() {
  if (source || typeof EventSource === 'undefined') return;
  source = new EventSource('/api/events', { withCredentials: true });
  const relay = (type) => (e) => {
    let data = {};
    try { data = JSON.parse(e.data); } catch { /* ignore */ }
    for (const fn of listeners) fn({ ...data, type });
  };
  source.addEventListener('job', relay('job'));
  source.addEventListener('notification', relay('notification'));
  // When the connection comes back after a drop, ask every view to refresh.
  source.addEventListener('hello', relay('reconnect'));
}

export function stopLive() {
  source?.close();
  source = null;
}

export function emitLocal(event) {
  for (const fn of listeners) fn(event);
}

export function useLive(handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const fn = (e) => ref.current?.(e);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
}
