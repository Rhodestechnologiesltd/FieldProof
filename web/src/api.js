import { useCallback, useEffect, useRef, useState } from 'react';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { useLive } from './live.js';

export class ApiError extends Error {
  constructor(status, code, details) {
    super(code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Call the API. State-changing requests carry the CSRF header the server expects. */
export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (method !== 'GET') headers['X-Requested-With'] = 'fetch';
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method, credentials: 'same-origin', headers,
      body: form || (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new ApiError(0, 'NETWORK');
  }
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('fp:unauthorized'));
    throw new ApiError(res.status, data?.error?.code || 'SERVER_ERROR', data?.error?.details);
  }
  return data;
}

/**
 * Load a resource and keep it fresh. With `cacheKey`, the last good copy is kept on the device
 * and shown when offline (the worker app's jobs and checklist).
 * `liveFilter(event)` returns true when a live event should trigger a reload.
 */
export function useResource(path, { cacheKey, liveFilter, skip } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: !skip, stale: false });
  const pathRef = useRef(path);
  pathRef.current = path;

  const load = useCallback(async (quiet) => {
    if (!path || skip) return;
    if (!quiet) setState((s) => ({ ...s, loading: true }));
    try {
      const data = await api(path);
      if (pathRef.current !== path) return;
      setState({ data, error: null, loading: false, stale: false });
      if (cacheKey) idbSet(cacheKey, data).catch(() => {});
    } catch (error) {
      if (error.code === 'NETWORK' && cacheKey) {
        const cached = await idbGet(cacheKey).catch(() => null);
        if (cached) return setState({ data: cached, error: null, loading: false, stale: true });
      }
      setState((s) => ({ ...s, error, loading: false }));
    }
  }, [path, cacheKey, skip]);

  useEffect(() => { load(false); }, [load]);
  useLive((event) => { if (liveFilter && liveFilter(event)) load(true); });

  const setData = useCallback((updater) => setState((s) => {
    const data = typeof updater === 'function' ? updater(s.data) : updater;
    if (cacheKey && data) idbSet(cacheKey, data).catch(() => {});
    return { ...s, data };
  }), [cacheKey]);

  return { ...state, reload: () => load(true), setData };
}
