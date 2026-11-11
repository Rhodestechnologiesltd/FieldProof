import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { useI18n, LANGUAGES, errorText } from '../i18n/index.jsx';
import { Field, ErrorBox, Loading, useAction } from '../components/ui.jsx';
import { IconPin, IconCheck, IconSend } from '../components/icons.jsx';

function AuthFrame({ children }) {
  const { t, lang, setLang } = useI18n();
  return (
    <div className="auth">
      <section className="auth-side">
        <div>
          <div className="brand" style={{ padding: 0, marginBottom: 32 }}><img src="/icon.svg" alt="" />FieldProof</div>
          <h1>{t('auth.tagline')}</h1>
          <div className="proof">
            <div><span className="s"><IconPin /></span>{t('auth.point1')}</div>
            <div><span className="s"><IconCheck /></span>{t('auth.point2')}</div>
            <div><span className="s"><IconSend /></span>{t('auth.point3')}</div>
          </div>
        </div>
        <div className="foot small">
          <label className="sr-only" htmlFor="auth-lang">{t('common.language')}</label>
          <select id="auth-lang" className="select" style={{ width: 'auto', background: 'transparent', color: '#e9eef1', borderColor: '#4a5a66' }} value={lang} onChange={(e) => setLang(e.target.value)}>
            {LANGUAGES.map((l) => <option key={l.code} value={l.code} style={{ color: '#1d2a33' }}>{l.label}</option>)}
          </select>
        </div>
      </section>
      <main className="auth-main"><div className="auth-card">{children}</div></main>
    </div>
  );
}

export function Login() {
  const { t } = useI18n();
  const { refresh } = useSession();
  const [form, setForm] = useState({ email: '', password: '', remember: true });
  const { busy, error, run } = useAction();
  const submit = (e) => {
    e.preventDefault();
    run(async () => { await api('/auth/login', { method: 'POST', body: form }); await refresh(); }).catch(() => {});
  };
  return (
    <AuthFrame>
      <form className="stack" onSubmit={submit}>
        <div><h2>{t('auth.signInTitle')}</h2><p className="muted">{t('auth.signInSub')}</p></div>
        <Field label={t('common.email')}><input className="input" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label={t('auth.password')}><input className="input" type="password" autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
        <label className="check"><input type="checkbox" checked={form.remember} onChange={(e) => setForm({ ...form, remember: e.target.checked })} />{t('auth.remember')}</label>
        <ErrorBox error={error} />
        <button className="btn primary block" disabled={busy}>{t('auth.signIn')}</button>
        <div className="row between small">
          <Link to="/forgot">{t('auth.forgot')}</Link>
          <Link to="/register">{t('auth.registerLink')}</Link>
        </div>
      </form>
    </AuthFrame>
  );
}

export function Register() {
  const { t, lang } = useI18n();
  const { refresh } = useSession();
  const [form, setForm] = useState({ companyName: '', name: '', email: '', password: '', signupCode: '' });
  const { busy, error, run } = useAction();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      await api('/auth/register-company', { method: 'POST', body: { ...form, lang, signupCode: form.signupCode || undefined } });
      await refresh();
    }).catch(() => {});
  };
  return (
    <AuthFrame>
      <form className="stack" onSubmit={submit}>
        <div><h2>{t('auth.registerTitle')}</h2><p className="muted">{t('auth.registerSub')}</p></div>
        <Field label={t('auth.companyName')}><input className="input" required value={form.companyName} onChange={set('companyName')} /></Field>
        <Field label={t('auth.yourName')}><input className="input" autoComplete="name" required value={form.name} onChange={set('name')} /></Field>
        <Field label={t('common.email')}><input className="input" type="email" autoComplete="email" required value={form.email} onChange={set('email')} /></Field>
        <Field label={t('auth.password')} hint={t('auth.passwordHint')}><input className="input" type="password" autoComplete="new-password" minLength={8} required value={form.password} onChange={set('password')} /></Field>
        <Field label={t('auth.signupCode')} hint={t('auth.signupCodeHint')}><input className="input" value={form.signupCode} onChange={set('signupCode')} /></Field>
        <ErrorBox error={error} />
        <button className="btn primary block" disabled={busy}>{t('auth.createAccount')}</button>
        <p className="small muted">{t('auth.registerNote')}</p>
        <Link className="small" to="/login">{t('auth.haveAccount')}</Link>
      </form>
    </AuthFrame>
  );
}

export function Forgot() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <AuthFrame>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/auth/forgot', { method: 'POST', body: { email } }); setSent(true); }).catch(() => {}); }}>
        <div><h2>{t('auth.forgotTitle')}</h2><p className="muted">{t('auth.forgotSub')}</p></div>
        {sent ? <div className="alert ok">{t('auth.forgotSent')}</div> : (
          <>
            <Field label={t('common.email')}><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <ErrorBox error={error} />
            <button className="btn primary block" disabled={busy}>{t('auth.sendLink')}</button>
          </>
        )}
        <Link className="small" to="/login">{t('auth.backToSignIn')}</Link>
      </form>
    </AuthFrame>
  );
}

export function Reset() {
  const { t } = useI18n();
  const { token } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <AuthFrame>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/auth/reset', { method: 'POST', body: { token, password } }); setDone(true); }).catch(() => {}); }}>
        <h2>{t('auth.resetTitle')}</h2>
        {done ? (
          <>
            <div className="alert ok">{t('auth.resetDone')}</div>
            <button type="button" className="btn primary block" onClick={() => navigate('/login')}>{t('auth.signIn')}</button>
          </>
        ) : (
          <>
            <Field label={t('auth.newPassword')} hint={t('auth.passwordHint')}><input className="input" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <ErrorBox error={error} />
            <button className="btn primary block" disabled={busy}>{t('auth.setPassword')}</button>
          </>
        )}
      </form>
    </AuthFrame>
  );
}

export function Invite() {
  const { t, setLang } = useI18n();
  const { token } = useParams();
  const { refresh } = useSession();
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();
  useEffect(() => {
    api(`/auth/invite/${token}`).then((d) => { setInfo(d); if (d.lang) setLang(d.lang); }).catch(setLoadError);
  }, [token, setLang]);
  if (loadError) return <AuthFrame><div className="stack"><h2>{t('auth.inviteTitle')}</h2><div className="alert bad">{errorText(t, loadError)}</div><Link to="/login">{t('auth.backToSignIn')}</Link></div></AuthFrame>;
  if (!info) return <Loading full />;
  return (
    <AuthFrame>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/auth/accept-invite', { method: 'POST', body: { token, password, remember: info.role === 'worker' } }); await refresh(); }).catch(() => {}); }}>
        <div><h2>{t('auth.inviteTitle')}</h2><p className="muted">{t('auth.inviteSub', { company: info.company, role: t(`roles.${info.role}`) })}</p></div>
        <dl className="kv"><dt>{t('common.name')}</dt><dd>{info.name}</dd><dt>{t('common.email')}</dt><dd>{info.email}</dd></dl>
        <Field label={t('auth.choosePassword')} hint={t('auth.passwordHint')}><input className="input" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <ErrorBox error={error} />
        <button className="btn primary block" disabled={busy}>{t('auth.joinTeam')}</button>
      </form>
    </AuthFrame>
  );
}
