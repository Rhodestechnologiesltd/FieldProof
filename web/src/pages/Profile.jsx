import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { useI18n, LANGUAGES } from '../i18n/index.jsx';
import { Field, ErrorBox, useAction, useToast } from '../components/ui.jsx';
import { IconDownload } from '../components/icons.jsx';

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function PushSetting() {
  const { t } = useI18n();
  const [state, setState] = useState('checking');
  const { busy, error, run } = useAction();
  useEffect(() => {
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return setState('unsupported');
      const key = await api('/push/key').catch(() => null);
      if (!key?.enabled) return setState('server-off');
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? 'on' : 'off');
    })();
  }, []);
  const enable = () => run(async () => {
    const key = await api('/push/key');
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key.publicKey) });
    await api('/push/subscribe', { method: 'POST', body: sub.toJSON() });
    setState('on');
  }).catch(() => {});
  const disable = () => run(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) { await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }); await sub.unsubscribe(); }
    setState('off');
  }).catch(() => {});
  return (
    <div className="stack-sm">
      <p className="muted" style={{ margin: 0 }}>{t(`profile.push_${state.replace('-', '_')}`)}</p>
      {state === 'off' && <button className="btn" disabled={busy} onClick={enable}>{t('profile.enablePush')}</button>}
      {state === 'on' && <button className="btn" disabled={busy} onClick={disable}>{t('profile.disablePush')}</button>}
      <ErrorBox error={error} />
    </div>
  );
}

export default function Profile() {
  const { t, setLang } = useI18n();
  const { user, setUser, signOut } = useSession();
  const toast = useToast();
  const [f, setF] = useState({ name: user.name, phone: user.phone || '', lang: user.lang });
  const [pw, setPw] = useState({ current: '', next: '' });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = useAction();
  const pass = useAction();
  const del = useAction();

  return (
    <div className="content narrow stack">
      <div className="page-head" style={{ marginBottom: 0 }}><div><h1>{t('profile.title')}</h1><p>{user.email} — {t(`roles.${user.role}`)}</p></div></div>

      <form className="panel" onSubmit={(e) => { e.preventDefault(); save.run(async () => { const r = await api('/me', { method: 'PATCH', body: { ...f, phone: f.phone || null } }); setUser(r.user); setLang(r.user.lang); toast(t('common.saved')); }).catch(() => {}); }}>
        <div className="panel-body stack">
          <h2>{t('profile.details')}</h2>
          <div className="grid-2">
            <Field label={t('common.name')}><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label={t('common.phone')}><input className="input" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          </div>
          <Field label={t('common.language')}>
            <select className="select" value={f.lang} onChange={(e) => setF({ ...f, lang: e.target.value })}>{LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</select>
          </Field>
          <ErrorBox error={save.error} />
          <div><button className="btn primary" disabled={save.busy}>{t('common.save')}</button></div>
        </div>
      </form>

      <form className="panel" onSubmit={(e) => { e.preventDefault(); pass.run(async () => { await api('/me/password', { method: 'POST', body: pw }); setPw({ current: '', next: '' }); toast(t('profile.passwordChanged')); }).catch(() => {}); }}>
        <div className="panel-body stack">
          <h2>{t('profile.password')}</h2>
          <div className="grid-2">
            <Field label={t('profile.currentPassword')}><input className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
            <Field label={t('auth.newPassword')} hint={t('auth.passwordHint')}><input className="input" type="password" autoComplete="new-password" minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
          </div>
          <ErrorBox error={pass.error} />
          <div><button className="btn" disabled={pass.busy || !pw.current || pw.next.length < 8}>{t('profile.changePassword')}</button></div>
        </div>
      </form>

      <section className="panel"><div className="panel-body stack">
        <h2>{t('profile.notifications')}</h2>
        <PushSetting />
        <div className="row"><a className="btn" href="/api/jobs/calendar.ics"><IconDownload />{t('profile.calendar')}</a></div>
      </div></section>

      <section className="panel"><div className="panel-body stack">
        <h2>{t('profile.privacy')}</h2>
        <p className="muted" style={{ margin: 0 }}>{t('profile.privacyText')}</p>
        <div className="row"><a className="btn" href="/api/me/export"><IconDownload />{t('profile.exportData')}</a></div>
        {user.role === 'customer' ? (
          <>
            {!confirmDelete ? <div><button className="btn danger" onClick={() => setConfirmDelete(true)}>{t('profile.deleteAccount')}</button></div> : (
              <div className="alert bad stack-sm">
                <div>{t('profile.deleteWarning')}</div>
                <div className="row">
                  <button className="btn danger solid" disabled={del.busy} onClick={() => del.run(async () => { await api('/me', { method: 'DELETE' }); await signOut(); }).catch(() => {})}>{t('profile.deleteConfirm')}</button>
                  <button className="btn ghost" onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</button>
                </div>
              </div>
            )}
            <ErrorBox error={del.error} />
          </>
        ) : <p className="small muted" style={{ margin: 0 }}>{t('profile.staffDelete')}</p>}
      </div></section>

      <div><button className="btn" onClick={signOut}>{t('common.signOut')}</button></div>
    </div>
  );
}
