import { useState } from 'react';
import { api, useResource } from '../api.js';
import { useSession } from '../session.jsx';
import { useI18n } from '../i18n/index.jsx';
import { Field, Modal, ErrorBox, Loading, Empty, useAction, useToast } from '../components/ui.jsx';
import SiteMap from '../components/SiteMap.jsx';
import { IconPlus, IconPin } from '../components/icons.jsx';

export default function Customers() {
  const { t } = useI18n();
  const { user } = useSession();
  const admin = user.role === 'admin';
  const { data, loading, error, reload } = useResource('/customers');
  const [edit, setEdit] = useState(null); // {customer} | {site, customer}

  return (
    <div className="content">
      <div className="page-head">
        <div><h1>{t('customers.title')}</h1><p>{t('customers.subtitle')}</p></div>
        {admin && <button className="btn primary" onClick={() => setEdit({ customer: {} })}><IconPlus />{t('customers.add')}</button>}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading ? <Loading /> : data.length === 0 ? (
        <div className="panel"><Empty title={t('customers.emptyTitle')} action={admin && <button className="btn primary" onClick={() => setEdit({ customer: {} })}>{t('customers.add')}</button>}>{t('customers.emptyText')}</Empty></div>
      ) : (
        <div className="stack">
          {data.map((c) => (
            <section key={c.id} className="panel">
              <div className="panel-head">
                <div>
                  <h3>{c.name}</h3>
                  <div className="small muted">{t(`customers.type_${c.type}`)}{c.email ? ` — ${c.email}` : ''}{c.phone ? ` — ${c.phone}` : ''}</div>
                </div>
                {admin && (
                  <div className="row">
                    <button className="btn small" onClick={() => setEdit({ customer: c })}>{t('common.edit')}</button>
                    <button className="btn small" onClick={() => setEdit({ customer: c, site: {} })}><IconPlus />{t('customers.addSite')}</button>
                  </div>
                )}
              </div>
              {c.sites.length === 0 ? <p className="muted small" style={{ padding: '12px 18px', margin: 0 }}>{t('customers.noSites')}</p> : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>{t('customers.site')}</th><th>{t('customers.address')}</th><th>{t('customers.area')}</th><th /></tr></thead>
                    <tbody>
                      {c.sites.map((s) => (
                        <tr key={s.id}>
                          <td className="cell-title">{s.name}</td>
                          <td>{s.address || '—'}{s.lat == null && <div><span className="tag warn"><IconPin width={12} height={12} />{t('customers.noPin')}</span></div>}</td>
                          <td className="nowrap">{t('customers.radius', { m: s.radiusM })}</td>
                          <td className="num">{admin && <button className="btn small" onClick={() => setEdit({ customer: c, site: s })}>{t('common.edit')}</button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
      {edit && !edit.site && <CustomerModal customer={edit.customer} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {edit?.site && <SiteModal customer={edit.customer} site={edit.site} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function CustomerModal({ customer, onClose, onSaved }) {
  const { t } = useI18n();
  const toast = useToast();
  const [f, setF] = useState({ name: customer.name || '', type: customer.type || 'business', email: customer.email || '', phone: customer.phone || '' });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { busy, error, run } = useAction();
  const save = () => run(async () => {
    const body = { ...f, email: f.email || null, phone: f.phone || null };
    if (customer.id) await api(`/customers/${customer.id}`, { method: 'PATCH', body });
    else await api('/customers', { method: 'POST', body });
    toast(t('common.saved'));
    onSaved();
  }).catch(() => {});
  const remove = () => run(async () => { await api(`/customers/${customer.id}`, { method: 'DELETE' }); onSaved(); }).catch(() => {});
  return (
    <Modal open title={customer.id ? t('customers.edit') : t('customers.add')} onClose={onClose}
      footer={<>{customer.id && <button className="btn danger" style={{ marginInlineEnd: 'auto' }} onClick={() => setConfirmDelete(true)}>{t('common.delete')}</button>}<button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={busy || !f.name} onClick={save}>{t('common.save')}</button></>}>
      <div className="stack">
        <Field label={t('common.name')}><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={t('customers.typeLabel')}>
          <select className="select" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            <option value="business">{t('customers.type_business')}</option>
            <option value="household">{t('customers.type_household')}</option>
          </select>
        </Field>
        <div className="grid-2">
          <Field label={t('common.email')}><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label={t('common.phone')}><input className="input" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        </div>
        <p className="small muted">{t('customers.contactsNote')}</p>
        {confirmDelete && (
          <div className="alert bad stack-sm">
            <div>{t('customers.deleteWarning')}</div>
            <button className="btn danger solid small" disabled={busy} onClick={remove}>{t('customers.deleteConfirm')}</button>
          </div>
        )}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function SiteModal({ customer, site, onClose, onSaved }) {
  const { t } = useI18n();
  const toast = useToast();
  const [f, setF] = useState({
    name: site.name || '', address: site.address || '', lat: site.lat ?? null, lng: site.lng ?? null,
    radiusM: site.radiusM || 100, accessNotes: site.accessNotes || '',
  });
  const [geo, setGeo] = useState({ busy: false, msg: '' });
  const { busy, error, run } = useAction();

  const findAddress = async () => {
    if (!f.address) return;
    setGeo({ busy: true, msg: '' });
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(f.address)}`);
      const [hit] = await res.json();
      if (hit) { setF((x) => ({ ...x, lat: Number(hit.lat), lng: Number(hit.lon) })); setGeo({ busy: false, msg: '' }); }
      else setGeo({ busy: false, msg: t('customers.addressNotFound') });
    } catch {
      setGeo({ busy: false, msg: t('customers.addressNotFound') });
    }
  };

  const save = () => run(async () => {
    const body = { ...f, address: f.address || null, accessNotes: f.accessNotes || null, radiusM: Number(f.radiusM) };
    if (site.id) await api(`/sites/${site.id}`, { method: 'PATCH', body });
    else await api(`/customers/${customer.id}/sites`, { method: 'POST', body });
    toast(t('common.saved'));
    onSaved();
  }).catch(() => {});
  const archive = () => run(async () => { await api(`/sites/${site.id}`, { method: 'DELETE' }); onSaved(); }).catch(() => {});

  return (
    <Modal open wide title={site.id ? t('customers.editSite') : t('customers.addSiteFor', { name: customer.name })} onClose={onClose}
      footer={<>{site.id && <button className="btn danger" style={{ marginInlineEnd: 'auto' }} onClick={archive}>{t('customers.archiveSite')}</button>}<button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={busy || !f.name} onClick={save}>{t('common.save')}</button></>}>
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <Field label={t('customers.siteName')}><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={t('customers.address')}>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
              <button type="button" className="btn" disabled={geo.busy || !f.address} onClick={findAddress}>{t('customers.findOnMap')}</button>
            </div>
          </Field>
          {geo.msg && <div className="small" style={{ color: 'var(--warn)' }}>{geo.msg}</div>}
          <Field label={t('customers.radiusLabel')} hint={t('customers.radiusHint')}>
            <input className="input" type="number" min={20} max={5000} step={10} value={f.radiusM} onChange={(e) => setF({ ...f, radiusM: e.target.value })} />
          </Field>
          <Field label={t('customers.accessNotes')} hint={t('customers.accessHint')}><textarea className="textarea" value={f.accessNotes} onChange={(e) => setF({ ...f, accessNotes: e.target.value })} /></Field>
          <ErrorBox error={error} />
        </div>
        <div className="stack-sm">
          <SiteMap tall lat={f.lat} lng={f.lng} radius={Number(f.radiusM)} onPick={(lat, lng) => setF((x) => ({ ...x, lat, lng }))} />
          <p className="small muted">{f.lat != null ? t('customers.pinSet', { lat: f.lat.toFixed(5), lng: f.lng.toFixed(5) }) : t('customers.pinHelp')}</p>
        </div>
      </div>
    </Modal>
  );
}
