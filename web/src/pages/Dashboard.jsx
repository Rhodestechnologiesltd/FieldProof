import { Link } from 'react-router-dom';
import { useResource } from '../api.js';
import { useSession } from '../session.jsx';
import { useI18n } from '../i18n/index.jsx';
import { Loading, ErrorBox, Empty } from '../components/ui.jsx';
import TrendChart from '../components/TrendChart.jsx';
import { IconPlus } from '../components/icons.jsx';

function AttentionList({ title, items, render, emptyText }) {
  return (
    <section className="panel">
      <div className="panel-head"><h3>{title}</h3><span className="muted small">{items.length}</span></div>
      {items.length === 0 ? <p className="muted small" style={{ padding: '12px 18px', margin: 0 }}>{emptyText}</p> : (
        <ul className="attn-list">
          {items.slice(0, 6).map((j) => <li key={`${j.id}-${j.at || ''}`}><Link to={`/jobs/${j.id}`}>{render(j)}</Link></li>)}
        </ul>
      )}
    </section>
  );
}

export default function Dashboard() {
  const { t, fmt } = useI18n();
  const { user } = useSession();
  const { data, error, loading, reload } = useResource('/dashboard', { liveFilter: () => true });
  if (loading && !data) return <div className="content"><Loading /></div>;
  if (error && !data) return <div className="content"><ErrorBox error={error} onRetry={reload} /></div>;
  const d = data;
  const s = d.today.byStatus;
  const inField = (s.in_progress || 0);
  const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
  const reasonsTotal = d.rejectionReasons.reduce((a, r) => a + r.n, 0);

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>{t('dashboard.title')}</h1>
          <p>{fmt.date(`${d.today.date}T08:00:00Z`)}{user.role === 'supervisor' ? ` — ${t('dashboard.yourJobsOnly')}` : ''}</p>
        </div>
        <Link className="btn primary" to="/jobs/new"><IconPlus />{t('jobs.new')}</Link>
      </div>

      <div className="kpis" style={{ marginBottom: 20 }}>
        <Link className="kpi" to="/jobs?range=today"><div className="v">{d.today.total}</div><div className="k">{t('dashboard.jobsToday')}</div></Link>
        <Link className="kpi" to="/jobs?range=today&status=in_progress"><div className="v">{inField}</div><div className="k">{t('dashboard.onSiteNow')}</div></Link>
        <Link className={`kpi${d.late.length ? ' alarm' : ''}`} to="/jobs?range=today"><div className="v">{d.late.length}</div><div className="k">{t('dashboard.late')}</div></Link>
        <div className={`kpi${d.flagged.length ? ' alarm' : ''}`}><div className="v">{d.flagged.length}</div><div className="k">{t('dashboard.flaggedToday')}</div></div>
        <Link className="kpi" to="/jobs?status=submitted&range=all"><div className="v">{d.awaitingApproval.length}</div><div className="k">{t('dashboard.awaitingCustomer')}</div></Link>
        <div className={`kpi${d.slaBreaches.length ? ' alarm' : ''}`}><div className="v">{d.slaBreaches.length}</div><div className="k">{t('dashboard.slaBreaches')}</div></div>
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <AttentionList
            title={t('dashboard.lateTitle')} items={d.late} emptyText={t('dashboard.noneLate')}
            render={(j) => (<><span className="grow"><span className="cell-title">{j.title}</span><br /><span className="cell-sub">{j.site}</span></span><span className="tag bad">{t('dashboard.dueAt', { time: fmt.time(j.scheduled_start) })}</span></>)}
          />
          <AttentionList
            title={t('dashboard.flaggedTitle')} items={d.flagged} emptyText={t('dashboard.noneFlagged')}
            render={(j) => (<><span className="grow"><span className="cell-title">{j.worker}, {j.site}</span><br /><span className="cell-sub">{t('dashboard.metresAway', { m: j.distance_m ?? '?' })}: {j.reason}</span></span><span className="small muted nowrap">{fmt.time(j.at)}</span></>)}
          />
          <AttentionList
            title={t('dashboard.disputesTitle')} items={d.disputes} emptyText={t('dashboard.noneDisputes')}
            render={(j) => (<><span className="grow"><span className="cell-title">{j.title}</span><br /><span className="cell-sub">{j.site}</span></span><span className="tag bad">{t('arrival.disputed')}</span></>)}
          />
          <AttentionList
            title={t('dashboard.reworkTitle')} items={[...d.adminReview, ...d.rework]} emptyText={t('dashboard.noneRework')}
            render={(j) => (<><span className="grow"><span className="cell-title">{j.title}</span><br /><span className="cell-sub">{j.site} — {t('dashboard.rejections', { n: j.rework_count })}</span></span><span className={`tag ${j.status === 'admin_review' ? 'bad' : 'warn'}`}>{t(`status.${j.status}`)}</span></>)}
          />
        </div>
        <div className="stack">
          <section className="panel">
            <div className="panel-head"><h3>{t('dashboard.trendTitle')}</h3></div>
            <div className="panel-body"><TrendChart days={d.trend} /></div>
          </section>
          <section className="panel">
            <div className="panel-head"><h3>{t('dashboard.last30')}</h3></div>
            <div className="panel-body">
              <dl className="kv">
                <dt>{t('dashboard.verifiedShare')}</dt><dd><strong>{pct(d.metrics.verifiedCheckinShare)}</strong> <span className="muted small">{t('dashboard.ofCheckins', { n: d.metrics.checkins30d })}</span></dd>
                <dt>{t('dashboard.avgApproval')}</dt><dd><strong>{d.metrics.avgApprovalHours == null ? '—' : t('dashboard.hoursShort', { h: fmt.number(Math.round(d.metrics.avgApprovalHours * 10) / 10) })}</strong></dd>
                <dt>{t('dashboard.approvals')}</dt><dd>{d.metrics.approvals30d}</dd>
                <dt>{t('dashboard.rejectionsLabel')}</dt><dd>{d.metrics.rejections30d}</dd>
              </dl>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><h3>{t('dashboard.reasonsTitle')}</h3></div>
            <div className="panel-body">
              {d.rejectionReasons.length === 0 ? <Empty>{t('dashboard.noRejections')}</Empty> : (
                <ul className="bar-list">
                  {d.rejectionReasons.map((r) => (
                    <li key={r.code}>
                      <div className="row between small"><span>{t(`rejectReasons.${r.code}`)}</span><strong>{r.n}</strong></div>
                      <div className="bar"><span style={{ width: `${(r.n / reasonsTotal) * 100}%` }} /></div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
          <AttentionList
            title={t('dashboard.awaitingTitle')} items={d.awaitingApproval} emptyText={t('dashboard.noneAwaiting')}
            render={(j) => (<><span className="grow"><span className="cell-title">{j.title}</span><br /><span className="cell-sub">{j.site}</span></span><span className="small muted nowrap">{fmt.relative(j.submitted_at)}</span></>)}
          />
        </div>
      </div>
    </div>
  );
}
