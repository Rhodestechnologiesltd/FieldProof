import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useI18n } from '../i18n/index.jsx';
import { Loading, ErrorBox, Empty } from '../components/ui.jsx';

const ENTITIES = ['job', 'user', 'customer', 'site', 'service', 'skill', 'company'];

export default function Audit() {
  const { t, fmt } = useI18n();
  const [entity, setEntity] = useState('');
  const [rows, setRows] = useState([]);
  const [state, setState] = useState({ loading: true, error: null, done: false });

  const load = async (before) => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const p = new URLSearchParams({ limit: '100' });
      if (entity) p.set('entity', entity);
      if (before) p.set('before', String(before));
      const data = await api(`/audit?${p}`);
      setRows((r) => (before ? [...r, ...data] : data));
      setState({ loading: false, error: null, done: data.length < 100 });
    } catch (error) {
      setState({ loading: false, error, done: true });
    }
  };
  useEffect(() => { load(); }, [entity]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = (a) => { const s = t(`audit.${a}`); return s === `audit.${a}` ? a : s; };

  return (
    <div className="content">
      <div className="page-head">
        <div><h1>{t('audit.title')}</h1><p>{t('audit.subtitle')}</p></div>
        <select className="select" style={{ width: 'auto' }} value={entity} onChange={(e) => setEntity(e.target.value)} aria-label={t('audit.filter')}>
          <option value="">{t('audit.everything')}</option>
          {ENTITIES.map((e) => <option key={e} value={e}>{t(`audit.entity_${e}`)}</option>)}
        </select>
      </div>
      <ErrorBox error={state.error} />
      {rows.length === 0 && !state.loading ? <div className="panel"><Empty title={t('audit.empty')} /></div> : (
        <div className="panel table-wrap">
          <table className="table">
            <thead><tr><th>{t('common.time')}</th><th>{t('audit.who')}</th><th>{t('audit.what')}</th><th>{t('audit.record')}</th><th>{t('audit.where')}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{fmt.dateTime(r.at)}</td>
                  <td>{r.actor || t('job.system')}</td>
                  <td>{label(r.action)}{r.data?.reason && <div className="cell-sub">{r.data.reason}</div>}{r.data?.comment && <div className="cell-sub">{r.data.comment}</div>}</td>
                  <td className="nowrap">{r.entity === 'job' ? <Link to={`/jobs/${r.entityId}`}>{t('audit.entity_job')} #{r.entityId}</Link> : `${t(`audit.entity_${r.entity}`)} #${r.entityId ?? ''}`}</td>
                  <td className="nowrap small">{r.lat != null ? `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {state.loading && <Loading />}
      {!state.done && !state.loading && rows.length > 0 && <div style={{ marginTop: 12 }}><button className="btn" onClick={() => load(rows.at(-1).id)}>{t('audit.more')}</button></div>}
      <p className="small muted" style={{ marginTop: 12 }}>{t('audit.note')}</p>
    </div>
  );
}
