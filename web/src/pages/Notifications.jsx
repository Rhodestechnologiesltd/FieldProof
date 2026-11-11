import { Link } from 'react-router-dom';
import { api, useResource } from '../api.js';
import { useI18n } from '../i18n/index.jsx';
import { Loading, ErrorBox, Empty } from '../components/ui.jsx';
import { emitLocal } from '../live.js';

export default function Notifications() {
  const { t, fmt } = useI18n();
  const { data, loading, error, reload } = useResource('/notifications', { liveFilter: (e) => e.type === 'notification' });
  const markAll = async () => { await api('/notifications/read', { method: 'POST', body: { all: true } }); reload(); emitLocal({ type: 'notification' }); };
  const markOne = (id) => api('/notifications/read', { method: 'POST', body: { ids: [id] } }).then(() => emitLocal({ type: 'notification' })).catch(() => {});
  return (
    <div className="content narrow">
      <div className="page-head">
        <div><h1>{t('notifications.title')}</h1></div>
        {data?.unread > 0 && <button className="btn" onClick={markAll}>{t('notifications.markAll')}</button>}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : !data.items.length ? <div className="panel"><Empty title={t('notifications.empty')}>{t('notifications.emptyText')}</Empty></div> : (
        <section className="panel">
          <ul className="attn-list">
            {data.items.map((n) => (
              <li key={n.id} style={{ background: n.readAt ? undefined : 'var(--hivis-soft)' }}>
                <Link to={n.jobId ? `/jobs/${n.jobId}` : '#'} onClick={() => !n.readAt && markOne(n.id)}>
                  <span className="grow">{t(`notif.${n.type}`, n.params)}</span>
                  <span className="small muted nowrap">{fmt.relative(n.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
