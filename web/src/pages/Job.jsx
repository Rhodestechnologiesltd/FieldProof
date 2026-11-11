import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useResource } from '../api.js';
import { useSession, isStaff } from '../session.jsx';
import { useI18n } from '../i18n/index.jsx';
import { Loading, ErrorBox, StatusTag, ArrivalTag, MediaThumb, Progress } from '../components/ui.jsx';
import ProofRail from '../components/ProofRail.jsx';
import SiteMap from '../components/SiteMap.jsx';
import { FieldPanel } from './JobField.jsx';
import { CustomerPanel } from './JobCustomer.jsx';
import { ManagePanel, ActivityLog } from './JobManage.jsx';
import { directionsUrl } from '../device.js';
import { IconRoute, IconFlag } from '../components/icons.jsx';

export default function JobPage() {
  const { id } = useParams();
  const { t, fmt } = useI18n();
  const { user } = useSession();
  const res = useResource(`/jobs/${id}`, {
    cacheKey: `job:${id}`,
    liveFilter: (e) => (e.type === 'job' && String(e.jobId) === String(id)) || e.type === 'reconnect',
  });
  const { data: job, error, loading, reload, setData, stale } = res;
  if (loading && !job) return <div className="content"><Loading /></div>;
  if (!job) return <div className="content"><ErrorBox error={error} onRetry={reload} /></div>;

  const assigned = job.workers.some((w) => w.id === user.id);
  const fieldOpen = assigned && ['assigned', 'in_progress', 'rework'].includes(job.status);
  const staff = isStaff(user);
  const checkPoints = job.attendance
    .filter((a) => a.lat != null)
    .map((a) => ({ lat: a.lat, lng: a.lng, ok: a.verified || a.kind === 'out', label: `${a.workerName}: ${t(a.kind === 'in' ? 'attendance.in' : 'attendance.out')} ${fmt.time(a.at)}` }));

  return (
    <div className="content">
      {stale && <div className="alert warn" style={{ marginBottom: 12 }}>{t('offline.staleCopy')}</div>}
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <StatusTag status={job.status} />
            <ArrivalTag status={job.arrivalStatus} />
            {job.reworkCount > 0 && <span className="tag warn">{t('job.reworkCount', { n: job.reworkCount })}</span>}
          </div>
          <h1>{job.title}</h1>
          <p>{job.customer.name}, {job.site.name} — {fmt.day(job.scheduledStart)}, {fmt.time(job.scheduledStart)}–{fmt.time(job.scheduledEnd)}</p>
        </div>
        {job.site.lat != null && (fieldOpen || user.role === 'worker') && (
          <a className="btn" href={directionsUrl(job.site.lat, job.site.lng)} target="_blank" rel="noreferrer"><IconRoute />{t('job.directions')}</a>
        )}
      </div>

      {!fieldOpen && (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-body"><ProofRail job={job} /></div>
        </section>
      )}

      {job.status === 'cancelled' && <div className="alert bad" style={{ marginBottom: 16 }}>{t('job.cancelledBecause', { reason: job.cancelledReason || '' })}</div>}

      <div className="job-grid">
        <div className="stack">
          {fieldOpen && <FieldPanel job={job} setJob={setData} reload={reload} />}
          {fieldOpen && <section className="panel"><div className="panel-body"><ProofRail job={job} /></div></section>}
          {user.role === 'customer' && <CustomerPanel job={job} setJob={setData} />}
          {!fieldOpen && <ChecklistView job={job} />}
          <AttendanceLog job={job} />
          <DecisionLog job={job} />
        </div>
        <div className="stack">
          {staff && <ManagePanel job={job} setJob={setData} />}
          <section className="panel">
            <div className="panel-head"><h3>{t('job.details')}</h3></div>
            <div className="panel-body stack">
              <dl className="kv">
                <dt>{t('job.customer')}</dt><dd>{job.customer.name}</dd>
                <dt>{t('job.site')}</dt><dd>{job.site.name}{job.site.address ? <><br /><span className="muted small">{job.site.address}</span></> : null}</dd>
                {job.service && <><dt>{t('job.service')}</dt><dd>{job.service.name}</dd></>}
                <dt>{t('job.supervisor')}</dt><dd>{job.supervisor ? job.supervisor.name : '—'}{job.supervisor?.phone && user.role !== 'customer' ? <><br /><a href={`tel:${job.supervisor.phone}`}>{job.supervisor.phone}</a></> : null}</dd>
                <dt>{t('job.team')}</dt><dd>{job.workers.length ? job.workers.map((w) => w.name).join(', ') : '—'}</dd>
                {job.site.accessNotes && <><dt>{t('job.access')}</dt><dd>{job.site.accessNotes}</dd></>}
                {job.notes && <><dt>{t('job.notes')}</dt><dd>{job.notes}</dd></>}
              </dl>
              {job.site.lat != null ? <SiteMap lat={job.site.lat} lng={job.site.lng} radius={job.site.radiusM} points={checkPoints} label={job.site.name} /> : <p className="small muted">{t('job.noPin')}</p>}
              {job.site.lat != null && <p className="small muted">{t('job.areaNote', { m: job.site.radiusM })}</p>}
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><h3>{t('job.sla')}</h3></div>
            <div className="panel-body">
              <p style={{ whiteSpace: 'pre-wrap' }}>{job.slaText || t('job.noSla')}</p>
              {job.slaHours != null && <p className="small muted" style={{ margin: 0 }}>{t('job.slaHours', { h: job.slaHours })}</p>}
            </div>
          </section>
          {staff && <ActivityLog jobId={job.id} />}
          {user.role !== 'customer' && !assigned && !staff && <Link to="/">{t('common.back')}</Link>}
        </div>
      </div>
    </div>
  );
}

export function ChecklistView({ job }) {
  const { t, fmt } = useI18n();
  return (
    <section className="panel">
      <div className="panel-head"><h3>{t('job.checklist')}</h3><div style={{ width: 160 }}><Progress {...job.progress} /></div></div>
      {job.items.length === 0 ? <p className="muted small" style={{ padding: '12px 18px', margin: 0 }}>{t('job.noChecklist')}</p> : (
        <ul className="checklist">
          {job.items.map((i) => (
            <li key={i.id} className="check-item">
              <span className="check-box" role="img" aria-checked={Boolean(i.doneAt)} aria-label={i.doneAt ? t('job.done') : t('job.notDone')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              </span>
              <div>
                <div className="check-label">{i.label}{!i.required && <span className="muted small"> ({t('common.optional')})</span>}</div>
                <div className="check-meta">
                  {i.doneAt ? t('job.doneAt', { time: fmt.dateTime(i.doneAt) }) : t(`itemType.${i.type}`)}
                  {i.value != null && <> — <strong>{fmt.number(i.value)}</strong></>}
                </div>
                {i.note && <div className="small" style={{ marginTop: 4 }}>{i.note}</div>}
                {i.media.length > 0 && <div className="thumbs">{i.media.map((m) => <MediaThumb key={m.id} id={m.id} caption={`${i.label} — ${fmt.dateTime(m.takenAt)}`} />)}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AttendanceLog({ job }) {
  const { t, fmt } = useI18n();
  if (!job.attendance.length) return null;
  return (
    <section className="panel">
      <div className="panel-head"><h3>{t('job.attendance')}</h3></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>{t('job.worker')}</th><th>{t('common.time')}</th><th>{t('job.where')}</th><th>{t('job.proof')}</th></tr></thead>
          <tbody>
            {job.attendance.map((a) => (
              <tr key={a.id || `${a.kind}-${a.at}`}>
                <td><div className="cell-title">{a.workerName}</div><div className="cell-sub">{t(a.kind === 'in' ? 'attendance.in' : 'attendance.out')}</div></td>
                <td className="nowrap">{fmt.time(a.at)}<div className="cell-sub">{fmt.day(a.at)}</div></td>
                <td className="nowrap">{a.distanceM != null ? t('job.metres', { m: a.distanceM }) : '—'}{a.accuracyM != null && <div className="cell-sub">± {a.accuracyM} m</div>}</td>
                <td>
                  <div className="chips">
                    {a.kind === 'in' && (a.verified ? <span className="tag ok">{t('attendance.verified')}</span> : <span className="tag warn"><IconFlag width={12} height={12} />{t('attendance.flagged')}</span>)}
                    {a.late && <span className="tag bad">{t('jobs.late')}</span>}
                    {a.offline && <span className="tag info">{t('attendance.offline')}</span>}
                    {a.clockSkew && <span className="tag idle">{t('attendance.clockSkew')}</span>}
                    {a.auto && <span className="tag idle">{t('attendance.auto')}</span>}
                    {a.pending && <span className="tag info">{t('offline.savedOnPhone')}</span>}
                  </div>
                  {a.reason && <div className="small" style={{ marginTop: 4 }}>{a.reason}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DecisionLog({ job }) {
  const { t, fmt } = useI18n();
  if (!job.decisions.length && !job.arrivals.length) return null;
  const events = [
    ...job.arrivals.map((a) => ({ at: a.at, key: `a${a.id}`, title: t(`arrival.${a.status}`), by: a.by, text: a.reason, tone: a.status === 'disputed' ? 'bad' : 'ok' })),
    ...job.decisions.map((d) => ({
      at: d.at, key: `d${d.id}`, title: t(`decision.${d.decision}`), by: d.by,
      text: [d.reasonCode && t(`rejectReasons.${d.reasonCode}`), d.comment].filter(Boolean).join(': '),
      rating: d.rating, media: d.media, tone: ['rejected', 'admin_cancelled'].includes(d.decision) ? 'bad' : 'ok',
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <section className="panel">
      <div className="panel-head"><h3>{t('job.customerRecord')}</h3></div>
      <ul className="attn-list">
        {events.map((e) => (
          <li key={e.key} style={{ padding: '11px 18px' }}>
            <div className="row between"><span className={`tag ${e.tone}`}>{e.title}</span><span className="small muted">{fmt.dateTime(e.at)}</span></div>
            <div className="small" style={{ marginTop: 4 }}>{e.by || t('job.system')}{e.rating ? ` — ${t('job.ratingOf', { n: e.rating })}` : ''}</div>
            {e.text && <div style={{ marginTop: 4 }}>{e.text}</div>}
            {e.media?.length > 0 && <div className="thumbs">{e.media.map((m) => <MediaThumb key={m} id={m} />)}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}
