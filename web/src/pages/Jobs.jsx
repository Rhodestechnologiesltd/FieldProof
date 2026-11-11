import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useResource } from '../api.js';
import { useSession } from '../session.jsx';
import { useI18n } from '../i18n/index.jsx';
import { Loading, ErrorBox, Empty, StatusTag, ArrivalTag, Progress, statusTone } from '../components/ui.jsx';
import { zonedToIso, todayIn, addDays } from '../device.js';
import { IconPlus, IconFlag, IconCalendar, IconList, IconDownload } from '../components/icons.jsx';

const STATUSES = ['scheduled', 'assigned', 'in_progress', 'submitted', 'rework', 'admin_review', 'approved', 'cancelled'];
const RANGES = ['today', 'week', 'upcoming', 'past', 'all'];

function mondayOf(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const dow = d.getUTCDay() || 7;
  return addDays(dateStr, 1 - dow);
}

export default function JobsPage() {
  const { t, fmt } = useI18n();
  const { company } = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tz = company.timezone;
  const today = todayIn(tz);
  const view = params.get('view') || 'list';
  const range = params.get('range') || 'week';
  const status = params.get('status') || '';
  const q = params.get('q') || '';
  const weekStart = params.get('week') || mondayOf(today);

  const set = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    setParams(next, { replace: true });
  };

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (view === 'week') {
      p.set('from', zonedToIso(weekStart, '00:00', tz));
      p.set('to', zonedToIso(addDays(weekStart, 7), '00:00', tz));
    } else {
      if (range === 'today') { p.set('from', zonedToIso(today, '00:00', tz)); p.set('to', zonedToIso(addDays(today, 1), '00:00', tz)); }
      if (range === 'week') { p.set('from', zonedToIso(today, '00:00', tz)); p.set('to', zonedToIso(addDays(today, 7), '00:00', tz)); }
      if (range === 'upcoming') p.set('from', new Date().toISOString());
      if (range === 'past') { p.set('to', new Date().toISOString()); p.set('order', 'desc'); }
      if (range === 'all') p.set('order', 'desc');
    }
    if (status) p.set('status', status);
    if (q) p.set('q', q);
    return `/jobs?${p.toString()}`;
  }, [view, range, status, q, weekStart, today, tz]);

  const { data, error, loading, reload } = useResource(query, { liveFilter: (e) => e.type === 'job' || e.type === 'reconnect' });
  const jobs = data || [];

  return (
    <div className="content">
      <div className="page-head">
        <div><h1>{t('jobs.title')}</h1><p>{t('jobs.subtitle')}</p></div>
        <div className="row">
          <a className="btn" href="/api/jobs/calendar.ics"><IconDownload />{t('jobs.calendarExport')}</a>
          <Link className="btn primary" to="/jobs/new"><IconPlus />{t('jobs.new')}</Link>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <div className="chips" role="group" aria-label={t('jobs.view')}>
          <button className="chip" aria-pressed={view === 'list'} onClick={() => set({ view: '' })}><IconList width={15} height={15} />{t('jobs.list')}</button>
          <button className="chip" aria-pressed={view === 'week'} onClick={() => set({ view: 'week' })}><IconCalendar width={15} height={15} />{t('jobs.week')}</button>
        </div>
        {view === 'list' ? (
          <div className="chips" role="group" aria-label={t('jobs.when')}>
            {RANGES.map((r) => <button key={r} className="chip" aria-pressed={range === r} onClick={() => set({ range: r })}>{t(`jobs.ranges.${r}`)}</button>)}
          </div>
        ) : (
          <div className="row" style={{ gap: 6 }}>
            <button className="btn small" onClick={() => set({ week: addDays(weekStart, -7) })}>{t('jobs.prevWeek')}</button>
            <button className="btn small" onClick={() => set({ week: '' })}>{t('jobs.thisWeek')}</button>
            <button className="btn small" onClick={() => set({ week: addDays(weekStart, 7) })}>{t('jobs.nextWeek')}</button>
          </div>
        )}
        <span className="grow" />
        <select className="select" style={{ width: 'auto' }} value={status} onChange={(e) => set({ status: e.target.value })} aria-label={t('common.status')}>
          <option value="">{t('jobs.anyStatus')}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
        </select>
        <input className="input" style={{ width: 220 }} type="search" placeholder={t('jobs.search')} defaultValue={q}
          onKeyDown={(e) => { if (e.key === 'Enter') set({ q: e.currentTarget.value }); }} onBlur={(e) => set({ q: e.currentTarget.value })} aria-label={t('jobs.search')} />
      </div>

      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : view === 'week' ? (
        <WeekView jobs={jobs} weekStart={weekStart} today={today} tz={tz} />
      ) : jobs.length === 0 ? (
        <div className="panel"><Empty title={t('jobs.emptyTitle')} action={<Link className="btn primary" to="/jobs/new">{t('jobs.new')}</Link>}>{t('jobs.emptyText')}</Empty></div>
      ) : (
        <div className="panel table-wrap">
          <table className="table">
            <thead>
              <tr><th>{t('jobs.when')}</th><th>{t('jobs.job')}</th><th>{t('jobs.people')}</th><th>{t('jobs.checklist')}</th><th>{t('common.status')}</th></tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="clickable" onClick={() => navigate(`/jobs/${j.id}`)}>
                  <td className="nowrap"><div className="cell-title">{fmt.time(j.scheduledStart)}–{fmt.time(j.scheduledEnd)}</div><div className="cell-sub">{fmt.day(j.scheduledStart)}</div></td>
                  <td>
                    <Link to={`/jobs/${j.id}`} className="cell-title" style={{ color: 'inherit', textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>{j.title}</Link>
                    <div className="cell-sub">{j.customer.name}, {j.site.name}</div>
                  </td>
                  <td>
                    <div className="cell-sub">{j.supervisor ? j.supervisor.name : <span className="tag warn">{t('jobs.noSupervisor')}</span>}</div>
                    <div>{j.workers.length ? j.workers.map((w) => w.name).join(', ') : <span className="tag warn">{t('jobs.noWorkers')}</span>}</div>
                  </td>
                  <td style={{ minWidth: 120 }}><Progress {...j.progress} /></td>
                  <td>
                    <div className="stack-sm">
                      <StatusTag status={j.status} />
                      {j.arrivalStatus && j.arrivalStatus !== 'confirmed' && j.arrivalStatus !== 'auto_confirmed' && <div><ArrivalTag status={j.arrivalStatus} /></div>}
                      {j.flagged && <div className="tag warn"><IconFlag width={12} height={12} />{t('jobs.flagged')}</div>}
                      {j.late && <div className="tag bad">{t('jobs.late')}</div>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function WeekView({ jobs, weekStart, today, tz }) {
  const { fmt } = useI18n();
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const dayOf = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  return (
    <div className="week">
      {days.map((d) => (
        <section key={d} className="week-day">
          <header className={d === today ? 'today' : ''}>{fmt.day(`${d}T08:00:00Z`)}</header>
          {jobs.filter((j) => dayOf(j.scheduledStart) === d).map((j) => (
            <Link key={j.id} to={`/jobs/${j.id}`} className={`week-job ${statusTone(j.status)}`}>
              <strong>{fmt.time(j.scheduledStart)}</strong> {j.title}
              <div className="cell-sub">{j.site.name}</div>
            </Link>
          ))}
        </section>
      ))}
    </div>
  );
}
