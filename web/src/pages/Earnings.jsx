import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { useResource } from '../api.js';
import { useSession } from '../session.jsx';
import { useI18n } from '../i18n/index.jsx';
import { Loading, ErrorBox, Empty, StatusTag } from '../components/ui.jsx';
import { todayIn } from '../device.js';
import { IconDownload } from '../components/icons.jsx';

function usePeriod() {
  const { company } = useSession();
  const [period, setPeriod] = useState(todayIn(company.timezone).slice(0, 7));
  return [period, setPeriod];
}

function PeriodPicker({ period, setPeriod }) {
  const { t } = useI18n();
  return (
    <label className="row" style={{ gap: 8 }}>
      <span className="muted">{t('earnings.period')}</span>
      <input className="input" style={{ width: 170 }} type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
    </label>
  );
}

const basisText = (t, fmt, l) => (l.basis === 'salary' ? t('pay.salary') : `${t(`pay.${l.basis}`)}, ${fmt.money(l.rate)}`);

export function TeamEarnings() {
  const { t, fmt } = useI18n();
  const [period, setPeriod] = usePeriod();
  const [open, setOpen] = useState(null);
  const { data, loading, error, reload } = useResource(`/earnings?period=${period}`, { liveFilter: (e) => e.type === 'job' });
  const totals = data?.workers.reduce((a, w) => ({ hours: a.hours + w.hours, earned: a.earned + w.earned, pending: a.pending + w.pending }), { hours: 0, earned: 0, pending: 0 });
  return (
    <div className="content">
      <div className="page-head">
        <div><h1>{t('earnings.teamTitle')}</h1><p>{t('earnings.teamSubtitle')}</p></div>
        <div className="row">
          <PeriodPicker period={period} setPeriod={setPeriod} />
          <a className="btn" href={`/api/earnings/export.csv?period=${period}`}><IconDownload />{t('earnings.exportCsv')}</a>
        </div>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : !data.workers.length ? <div className="panel"><Empty title={t('earnings.noWorkers')} /></div> : (
        <div className="panel table-wrap">
          <table className="table">
            <thead><tr><th>{t('earnings.worker')}</th><th className="num">{t('common.hours')}</th><th className="num">{t('earnings.jobsApproved')}</th><th className="num">{t('earnings.base')}</th><th className="num">{t('earnings.earned')}</th><th className="num">{t('earnings.pending')}</th><th className="num">{t('earnings.total')}</th></tr></thead>
            <tbody>
              {data.workers.map((w) => (
                <Fragment key={w.id}>
                  <tr className="clickable" onClick={() => setOpen(open === w.id ? null : w.id)} aria-expanded={open === w.id}>
                    <td><div className="cell-title">{w.name}</div><div className="cell-sub">{t(`roles.${w.role}`)}</div></td>
                    <td className="num">{fmt.number(w.hours)}</td>
                    <td className="num">{w.jobsCompleted}</td>
                    <td className="num">{w.base.basis === 'monthly' ? fmt.money(w.base.amount) : w.base.basis === 'hourly' ? t('earnings.perHour', { amount: fmt.money(w.base.rate) }) : '—'}</td>
                    <td className="num">{fmt.money(w.earned)}</td>
                    <td className="num">{w.pending ? fmt.money(w.pending) : '—'}</td>
                    <td className="num cell-title">{fmt.money(w.total)}</td>
                  </tr>
                  {open === w.id && (
                    <tr><td colSpan={7} style={{ background: 'var(--paper)' }}>
                      {w.lines.length === 0 ? <span className="muted small">{t('earnings.noJobs')}</span> : (
                        <table className="table">
                          <tbody>
                            {w.lines.map((l) => (
                              <tr key={l.jobId}>
                                <td><Link to={`/jobs/${l.jobId}`}>{l.title}</Link><div className="cell-sub">{l.site}, {fmt.date(l.date)}</div></td>
                                <td>{basisText(t, fmt, l)}</td>
                                <td className="num">{fmt.number(l.hours)} h</td>
                                <td><StatusTag status={l.status} /></td>
                                <td className="num">{fmt.money(l.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td></tr>
                  )}
                </Fragment>
              ))}
              <tr>
                <td className="cell-title">{t('earnings.total')}</td>
                <td className="num cell-title">{fmt.number(Math.round(totals.hours * 100) / 100)}</td><td /><td />
                <td className="num cell-title">{fmt.money(totals.earned)}</td><td className="num cell-title">{fmt.money(totals.pending)}</td>
                <td className="num cell-title">{fmt.money(totals.earned + totals.pending)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted" style={{ marginTop: 12 }}>{t('earnings.estimateNote')}</p>
    </div>
  );
}

export function MyEarnings() {
  const { t, fmt } = useI18n();
  const [period, setPeriod] = usePeriod();
  const { data, loading, error, reload } = useResource(`/earnings/me?period=${period}`, { cacheKey: `earnings:${period}`, liveFilter: (e) => e.type === 'job' });
  return (
    <div className="content narrow">
      <div className="page-head">
        <div><h1>{t('earnings.myTitle')}</h1><p>{t('earnings.mySubtitle')}</p></div>
        <PeriodPicker period={period} setPeriod={setPeriod} />
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data && (
        <div className="stack">
          <section className="panel"><div className="panel-body stack-sm">
            <div className="muted">{t('earnings.estimateSoFar')}</div>
            <div className="money-hero">{fmt.money(data.total)}</div>
            <div className="grid-3" style={{ marginTop: 12 }}>
              <div><div className="muted small">{t('earnings.earned')}</div><strong>{fmt.money(data.earned)}</strong></div>
              <div><div className="muted small">{t('earnings.pending')}</div><strong>{fmt.money(data.pending)}</strong></div>
              <div><div className="muted small">{t('earnings.hoursWorked')}</div><strong>{fmt.number(data.hours)}</strong></div>
            </div>
            {data.base.basis === 'monthly' && <p className="small muted" style={{ margin: 0 }}>{t('earnings.includesBase', { amount: fmt.money(data.base.amount) })}</p>}
            {data.base.basis === 'hourly' && <p className="small muted" style={{ margin: 0 }}>{t('earnings.hourlyBase', { amount: fmt.money(data.base.rate) })}</p>}
          </div></section>
          <section className="panel">
            <div className="panel-head"><h3>{t('earnings.byJob')}</h3></div>
            {data.lines.length === 0 ? <Empty>{t('earnings.noJobs')}</Empty> : (
              <ul className="attn-list">
                {data.lines.map((l) => (
                  <li key={l.jobId}>
                    <Link to={`/jobs/${l.jobId}`}>
                      <span className="grow"><span className="cell-title">{l.title}</span><br /><span className="cell-sub">{fmt.date(l.date)} — {fmt.number(l.hours)} h — {basisText(t, fmt, l)}</span></span>
                      <span style={{ textAlign: 'end' }}><strong>{fmt.money(l.amount)}</strong><br /><span className={`tag ${l.state === 'earned' ? 'ok' : 'warn'}`}>{t(`earnings.state_${l.state}`)}</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="small muted">{t('earnings.estimateNote')}</p>
        </div>
      )}
    </div>
  );
}
