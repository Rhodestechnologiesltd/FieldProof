// Worker home: today's jobs in time order, available offline.
import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import { useResource } from '../api.js';
import { useSession } from '../session.jsx';
import { useI18n } from '../i18n/index.jsx';
import { Loading, ErrorBox, Empty, StatusTag, Progress } from '../components/ui.jsx';
import { zonedToIso, todayIn, addDays } from '../device.js';

export default function Today() {
  const { t, fmt } = useI18n();
  const { user, company } = useSession();
  const today = todayIn(company.timezone);
  const query = useMemo(() => {
    const p = new URLSearchParams({ from: zonedToIso(addDays(today, -1), '00:00', company.timezone), to: zonedToIso(addDays(today, 7), '00:00', company.timezone), workerId: String(user.id) });
    return `/jobs?${p}`;
  }, [today, company.timezone, user.id]);
  const { data, loading, error, reload, stale } = useResource(query, { cacheKey: 'today', liveFilter: (e) => e.type === 'job' || e.type === 'reconnect' });
  const jobs = (data || []).filter((j) => j.status !== 'cancelled');
  const dayOf = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: company.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  const open = ['assigned', 'in_progress', 'rework'];
  const todays = jobs.filter((j) => dayOf(j.scheduledStart) === today || (open.includes(j.status) && dayOf(j.scheduledStart) < today));
  const later = jobs.filter((j) => dayOf(j.scheduledStart) > today);
  const current = todays.find((j) => j.status === 'in_progress') || todays.find((j) => open.includes(j.status));

  return (
    <div className="content narrow">
      <div className="page-head">
        <div><h1>{t('today.hello', { name: user.name.split(' ')[0] })}</h1><p>{fmt.date(`${today}T08:00:00Z`)} — {t('today.count', { n: todays.length })}</p></div>
      </div>
      {stale && <div className="alert warn" style={{ marginBottom: 12 }}>{t('offline.staleCopy')}</div>}
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : (
        <div className="stack">
          {todays.length === 0 ? <div className="panel"><Empty title={t('today.noneTitle')}>{t('today.noneText')}</Empty></div> : (
            <div>
              {todays.map((j) => (
                <Link key={j.id} to={`/jobs/${j.id}`} className={`job-card${current?.id === j.id ? ' current' : ''}`}>
                  <div className="row between">
                    <span className="time">{fmt.time(j.scheduledStart)}</span>
                    <StatusTag status={j.status} />
                  </div>
                  <div className="cell-title" style={{ marginTop: 4 }}>{j.title}</div>
                  <div className="cell-sub">{j.site.name}{j.site.address ? `, ${j.site.address}` : ''}</div>
                  {j.progress.total > 0 && <div style={{ marginTop: 10 }}><Progress {...j.progress} /></div>}
                  {current?.id === j.id && <div className="btn primary block" style={{ marginTop: 12 }}>{j.status === 'in_progress' ? t('today.continue') : t('today.start')}</div>}
                </Link>
              ))}
            </div>
          )}
          {later.length > 0 && (
            <section>
              <h2 style={{ margin: '12px 0 10px' }}>{t('today.coming')}</h2>
              {later.map((j) => (
                <Link key={j.id} to={`/jobs/${j.id}`} className="job-card">
                  <div className="row between"><strong>{fmt.day(j.scheduledStart)}, {fmt.time(j.scheduledStart)}</strong><StatusTag status={j.status} /></div>
                  <div>{j.title}</div>
                  <div className="cell-sub">{j.site.name}</div>
                </Link>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
