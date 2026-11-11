import { useState } from 'react';
import { api, useResource } from '../api.js';
import { useSession } from '../session.jsx';
import { useI18n } from '../i18n/index.jsx';
import { Field, Modal, ErrorBox, Loading, Empty, useAction, useToast } from '../components/ui.jsx';
import ChecklistEditor from '../components/ChecklistEditor.jsx';
import { IconPlus } from '../components/icons.jsx';

export default function Services() {
  const { t, fmt } = useI18n();
  const { user, company } = useSession();
  const admin = user.role === 'admin';
  const { data, loading, error, reload } = useResource('/services');
  const skills = useResource('/skills');
  const [edit, setEdit] = useState(null);
  const skillName = (id) => skills.data?.find((s) => s.id === id)?.name;

  return (
    <div className="content">
      <div className="page-head">
        <div><h1>{t('services.title')}</h1><p>{t('services.subtitle')}</p></div>
        {admin && <button className="btn primary" onClick={() => setEdit({})}><IconPlus />{t('services.add')}</button>}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading ? <Loading /> : data.length === 0 ? (
        <div className="panel"><Empty title={t('services.emptyTitle')} action={admin && <button className="btn primary" onClick={() => setEdit({})}>{t('services.add')}</button>}>{t('services.emptyText')}</Empty></div>
      ) : (
        <div className="panel table-wrap">
          <table className="table">
            <thead><tr><th>{t('services.name')}</th><th>{t('services.checklistCol')}</th><th>{t('services.slaCol')}</th><th>{t('services.payCol')}</th><th>{t('services.skillsCol')}</th><th /></tr></thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id}>
                  <td><div className="cell-title">{s.name}</div><div className="cell-sub">{s.description}</div></td>
                  <td className="nowrap">{t('services.items', { n: s.checklist.length, photos: s.checklist.filter((i) => i.type === 'photo').length })}</td>
                  <td>{s.slaHours != null ? t('services.withinHours', { h: s.slaHours }) : '—'}</td>
                  <td className="nowrap">{t(`pay.${s.defaultPayBasis}`)}{s.defaultPayBasis !== 'salary' && <div className="cell-sub">{fmt.money(s.defaultPayRate)}</div>}</td>
                  <td>{s.skills.map(skillName).filter(Boolean).join(', ') || '—'}</td>
                  <td className="num">{admin && <button className="btn small" onClick={() => setEdit(s)}>{t('common.edit')}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <ServiceModal service={edit} skills={skills.data || []} currency={company.currency} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function ServiceModal({ service, skills, currency, onClose, onSaved }) {
  const { t } = useI18n();
  const toast = useToast();
  const [f, setF] = useState({
    name: service.name || '', description: service.description || '', slaText: service.slaText || '', slaHours: service.slaHours ?? '',
    defaultPayBasis: service.defaultPayBasis || 'salary', defaultPayRate: service.defaultPayRate ?? 0,
    checklist: service.checklist || [], skills: service.skills || [],
  });
  const { busy, error, run } = useAction();
  const save = () => run(async () => {
    const body = { ...f, description: f.description || null, slaText: f.slaText || null, slaHours: f.slaHours === '' ? null : Number(f.slaHours), defaultPayRate: Number(f.defaultPayRate) || 0 };
    if (service.id) await api(`/services/${service.id}`, { method: 'PATCH', body });
    else await api('/services', { method: 'POST', body });
    toast(t('common.saved'));
    onSaved();
  }).catch(() => {});
  const archive = () => run(async () => { await api(`/services/${service.id}`, { method: 'DELETE' }); onSaved(); }).catch(() => {});
  const toggleSkill = (id) => setF((x) => ({ ...x, skills: x.skills.includes(id) ? x.skills.filter((s) => s !== id) : [...x.skills, id] }));

  return (
    <Modal open wide title={service.id ? t('services.edit') : t('services.add')} onClose={onClose}
      footer={<>{service.id && <button className="btn danger" style={{ marginInlineEnd: 'auto' }} onClick={archive}>{t('services.archive')}</button>}<button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={busy || !f.name} onClick={save}>{t('common.save')}</button></>}>
      <div className="stack">
        <div className="grid-2">
          <Field label={t('services.name')}><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={t('services.description')}><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        </div>
        <div className="grid-2">
          <Field label={t('services.slaText')} hint={t('services.slaTextHint')}><textarea className="textarea" value={f.slaText} onChange={(e) => setF({ ...f, slaText: e.target.value })} /></Field>
          <Field label={t('services.slaHours')} hint={t('services.slaHoursHint')}><input className="input" type="number" min={0} step="0.5" value={f.slaHours} onChange={(e) => setF({ ...f, slaHours: e.target.value })} /></Field>
        </div>
        <div className="grid-2">
          <Field label={t('pay.defaultBasis')} hint={t('pay.basisHint')}>
            <select className="select" value={f.defaultPayBasis} onChange={(e) => setF({ ...f, defaultPayBasis: e.target.value })}>
              {['salary', 'hourly', 'daily', 'fixed'].map((b) => <option key={b} value={b}>{t(`pay.${b}`)}</option>)}
            </select>
          </Field>
          {f.defaultPayBasis !== 'salary' && <Field label={t('pay.rateLabel', { currency })}><input className="input" type="number" min={0} step="0.01" value={f.defaultPayRate} onChange={(e) => setF({ ...f, defaultPayRate: e.target.value })} /></Field>}
        </div>
        <div className="field">
          <span className="label">{t('services.requiredSkills')}</span>
          {skills.length === 0 ? <span className="hint">{t('services.noSkillsYet')}</span> : (
            <div className="chips">{skills.map((s) => <button key={s.id} type="button" className="chip" aria-pressed={f.skills.includes(s.id)} onClick={() => toggleSkill(s.id)}>{s.name}</button>)}</div>
          )}
        </div>
        <ChecklistEditor value={f.checklist} onChange={(checklist) => setF({ ...f, checklist })} />
        <p className="small muted">{t('services.templateNote')}</p>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
