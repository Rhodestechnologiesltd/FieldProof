import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';
import { startLive, stopLive } from './live.js';

const SessionContext = createContext(null);

export function SessionProvider({ children, onLang }) {
  const [state, setState] = useState({ user: null, company: null, loading: true });

  const refresh = useCallback(async () => {
    try {
      const me = await api('/me');
      setState({ user: me.user, company: me.company, loading: false });
      onLang?.(me.user.lang);
      startLive();
      return me;
    } catch (err) {
      // Offline with a previous session: keep the cached identity so the worker app still opens.
      if (err.code === 'NETWORK') {
        try {
          const cached = JSON.parse(localStorage.getItem('fp-me') || 'null');
          if (cached) return setState({ ...cached, loading: false, offline: true });
        } catch { /* ignore */ }
      }
      setState({ user: null, company: null, loading: false });
      stopLive();
      return null;
    }
  }, [onLang]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (state.user) {
      try { localStorage.setItem('fp-me', JSON.stringify({ user: state.user, company: state.company })); } catch { /* ignore */ }
    }
  }, [state.user, state.company]);
  useEffect(() => {
    const onUnauthorized = () => { setState({ user: null, company: null, loading: false }); stopLive(); };
    window.addEventListener('fp:unauthorized', onUnauthorized);
    return () => window.removeEventListener('fp:unauthorized', onUnauthorized);
  }, []);

  const signOut = useCallback(async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    try { localStorage.removeItem('fp-me'); } catch { /* ignore */ }
    stopLive();
    setState({ user: null, company: null, loading: false });
  }, []);

  const setUser = useCallback((user) => setState((s) => ({ ...s, user })), []);

  return (
    <SessionContext.Provider value={{ ...state, refresh, signOut, setUser }}>
      {children}
    </SessionContext.Provider>
  );
}

export const useSession = () => useContext(SessionContext);

export const isStaff = (u) => u && (u.role === 'admin' || u.role === 'supervisor');
export const isField = (u) => u && (u.role === 'worker' || u.role === 'supervisor');
