// Customer home: what needs their action first, then live and upcoming visits, then history.
import { Link } from 'react-router-dom';
import { useResource } from '../api.js';
import { useSession } from '../session.jsx';
import { useI18n } from '../i18n/index.jsx';
import { Loading, ErrorBox, Empty, StatusTag, ArrivalTag, Progress } from '../components/ui.jsx';

function JobRow({ j }) {
  const { fmt } = useI18n();
  return (
    <Link to={`/jobs/${j.id}`} className="job-card">
      <div className="row between">
        <strong>{fmt.day(j.scheduledStart)}, {fmt.time(j.scheduledStart)}</strong>
        <span className="row" style={{ gap: 6 }}><ArrivalTag status={j.arrivalStatus === 'pending' ? 'pending' : null} /><StatusTag status={j.status} /></span>
      </div>
      <div className="cell-title" style={{ marginTop: 4 }}>{j.title}</div>
      <div className="cell-sub">{j.site.name}{j.workers.length ? ` — ${j.workers.map((w) => w.name).join(', ')}` : ''}</div>
      {j.status === 'in_progress' && j.progress.total > 0 && <div style={{ marginTop: 10 }}><Progress {...j.progress} /></div>}
    </Link>
  );
}

export default function CustomerHome() {
  const { t } = useI18n();
  const { company } = useSession();
  const { data, loading, error, reload } = useResource('/jobs?order=desc&limit=200', { liveFilter: (e) => e.type === 'job' || e.type === 'reconnect' });
  if (loading && !data) return <div className="content"><Loading /></div>;
  const jobs = data || [];
  const action = jobs.filter((j) => j.arrivalStatus === 'pending' || j.status === 'submitted');
  const live = jobs.filter((j) => !action.includes(j) && ['in_progress', 'rework', 'admin_review'].includes(j.status));
  const upcoming = jobs.filter((j) => ['scheduled', 'assigned'].includes(j.status)).reverse();
  const past = jobs.filter((j) => ['approved', 'cancelled'].includes(j.status)).slice(0, 20);
  const section = (title, list, empty) => (
    <section>
      <h2 style={{ margin: '4px 0 10px' }}>{title}</h2>
      {list.length ? list.map((j) => <JobRow key={j.id} j={j} />) : <p className="muted">{empty}</p>}
    </section>
  );
  return (
    <div className="content narrow">
      <div className="page-head"><div><h1>{t('customerHome.title')}</h1><p>{t('customerHome.subtitle', { company: company.name })}</p></div></div>
      <ErrorBox error={error} onRetry={reload} />
      {jobs.length === 0 ? <div className="panel"><Empty title={t('customerHome.emptyTitle')}>{t('customerHome.emptyText')}</Empty></div> : (
        <div className="stack">
          {action.length > 0 && section(t('customerHome.needsYou'), action, '')}
          {section(t('customerHome.now'), live, t('customerHome.noneNow'))}
          {section(t('customerHome.upcoming'), upcoming, t('customerHome.noneUpcoming'))}
          {section(t('customerHome.past'), past, t('customerHome.nonePast'))}
        </div>
      )}
    </div>
  );
}
