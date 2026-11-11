import { useEffect, useState } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { useSession } from '../session.jsx';
import { useI18n, LANGUAGES } from '../i18n/index.jsx';
import { useResource, api } from '../api.js';
import { useOutbox, syncOutbox, clearFailed } from '../offline.js';
import { Modal, useAction, ErrorBox } from './ui.jsx';
import {
  IconDashboard, IconJobs, IconCustomers, IconServices, IconPeople, IconMoney, IconLog, IconSettings,
  IconBell, IconUser, IconMenu, IconToday, IconOffline,
} from './icons.jsx';

function navFor(role) {
  const items = {
    dashboard: { to: '/dashboard', key: 'nav.dashboard', Icon: IconDashboard },
    jobs: { to: '/jobs', key: 'nav.jobs', Icon: IconJobs },
    today: { to: '/today', key: 'nav.today', Icon: IconToday },
    customers: { to: '/customers', key: 'nav.customers', Icon: IconCustomers },
    services: { to: '/services', key: 'nav.services', Icon: IconServices },
    people: { to: '/people', key: 'nav.people', Icon: IconPeople },
    earnings: { to: '/earnings', key: 'nav.earnings', Icon: IconMoney },
    myEarnings: { to: '/my-earnings', key: 'nav.myEarnings', Icon: IconMoney },
    audit: { to: '/audit', key: 'nav.audit', Icon: IconLog },
    settings: { to: '/settings', key: 'nav.settings', Icon: IconSettings },
    myJobs: { to: '/my-jobs', key: 'nav.myJobs', Icon: IconJobs },
    notifications: { to: '/notifications', key: 'nav.notifications', Icon: IconBell },
    profile: { to: '/profile', key: 'nav.profile', Icon: IconUser },
  };
  const pick = (...k) => k.map((x) => items[x]);
  switch (role) {
    case 'admin': return pick('dashboard', 'jobs', 'customers', 'people', 'services', 'earnings', 'audit', 'settings');
    case 'supervisor': return pick('dashboard', 'jobs', 'today', 'people', 'customers', 'services', 'earnings', 'myEarnings');
    case 'worker': return pick('today', 'myEarnings', 'notifications', 'profile');
    default: return pick('myJobs', 'notifications', 'profile');
  }
}

function ConsentModal() {
  const { user, setUser } = useSession();
  const { t } = useI18n();
  const { busy, error, run } = useAction();
  if (!user || user.consentAt) return null;
  const field = user.role === 'worker' || user.role === 'supervisor';
  return (
    <Modal
      open title={t('consent.title')}
      footer={(
        <button className="btn primary" disabled={busy} onClick={() => run(async () => {
          const r = await api('/me/consent', { method: 'POST' });
          setUser({ ...user, consentAt: r.consentAt });
        }).catch(() => {})}>{t('consent.agree')}</button>
      )}
    >
      <div className="stack-sm">
        <p>{t('consent.intro')}</p>
        <ul>
          <li>{t('consent.data')}</li>
          {field && <li>{t('consent.location')}</li>}
          {field && <li>{t('consent.photos')}</li>}
          <li>{t('consent.rights')}</li>
          <li>{t('consent.law')}</li>
        </ul>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function OutboxBanner() {
  const { t } = useI18n();
  const { queue, failed, syncing } = useOutbox();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return (
    <>
      {!online && (
        <div className="banner offline" role="status"><IconOffline width={18} height={18} /><span>{t('offline.banner', { n: queue.length })}</span></div>
      )}
      {online && queue.length > 0 && (
        <div className="banner sync" role="status">
          <span className="grow">{syncing ? t('offline.syncing', { n: queue.length }) : t('offline.waiting', { n: queue.length })}</span>
          {!syncing && <button className="btn small" onClick={() => syncOutbox()}>{t('offline.syncNow')}</button>}
        </div>
      )}
      {failed.length > 0 && (
        <div className="banner failed" role="alert">
          <span className="grow">{t('offline.failed', { n: failed.length })} {failed.map((f) => t(`errors.${f.error}`)).filter((v, i, a) => a.indexOf(v) === i).join(' ')}</span>
          <button className="btn small" onClick={() => clearFailed()}>{t('common.dismiss')}</button>
        </div>
      )}
    </>
  );
}

export default function Layout({ children }) {
  const { user, company, signOut } = useSession();
  const { t, lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const nav = navFor(user.role);
  const { data: notes } = useResource('/notifications', { liveFilter: (e) => e.type === 'notification' || e.type === 'reconnect' });
  const unread = notes?.unread || 0;
  useEffect(() => { setOpen(false); }, [location.pathname]);

  const changeLang = async (l) => {
    setLang(l);
    try { await api('/me', { method: 'PATCH', body: { lang: l } }); } catch { /* keep local choice */ }
  };

  return (
    <div className="shell">
      <aside className={`sidebar${open ? ' open' : ''}`} aria-label={t('nav.main')}>
        <Link to="/" className="brand"><img src="/icon.svg" alt="" />FieldProof</Link>
        <div className="brand-company">{company?.name}</div>
        <nav className="nav">
          {nav.map(({ to, key, Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon />{t(key)}
              {to === '/notifications' && unread > 0 && <span className="nav-badge">{unread}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="nav-foot stack-sm">
          <div>{user.name}<br /><span>{t(`roles.${user.role}`)}</span></div>
          <div className="row" style={{ gap: 14 }}>
            <Link to="/profile">{t('nav.profile')}</Link>
            <a href="#signout" onClick={(e) => { e.preventDefault(); signOut(); }}>{t('common.signOut')}</a>
          </div>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <div className="main">
        <header className="topbar">
          <button className="icon-btn mobile-only" onClick={() => setOpen(true)} aria-label={t('nav.menu')}><IconMenu /></button>
          <span className="title mobile-only">{company?.name}</span>
          <span className="grow" />
          <label className="sr-only" htmlFor="lang-select">{t('common.language')}</label>
          <select id="lang-select" className="select" style={{ width: 'auto', minHeight: 36 }} value={lang} onChange={(e) => changeLang(e.target.value)}>
            {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
          <Link to="/notifications" className="icon-btn" aria-label={t('nav.notifications')}>
            <IconBell />{unread > 0 && <span className="dot">{unread > 99 ? '99+' : unread}</span>}
          </Link>
          <Link to="/profile" className="icon-btn" aria-label={t('nav.profile')}><IconUser /></Link>
        </header>
        <OutboxBanner />
        {children}
      </div>
      <nav className="bottom-nav" aria-label={t('nav.main')}>
        {nav.slice(0, 4).map(({ to, key, Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}><Icon />{t(key)}</NavLink>
        ))}
        {nav.length > 4 && <button onClick={() => setOpen(true)}><IconMenu />{t('nav.more')}</button>}
      </nav>
      <ConsentModal />
    </div>
  );
}
