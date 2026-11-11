import { useState } from 'react';
import { api, useResource } from '../api.js';
import { useSession } from '../session.jsx';
import { useI18n, LANGUAGES } from '../i18n/index.jsx';
import { Field, Modal, ErrorBox, Loading, Empty, Tabs, DayPicker, CopyBox, useAction, useToast } from '../components/ui.jsx';
import { IconPlus, IconX } from '../components/icons.jsx';

const ROLE_TABS = ['worker', 'supervisor', 'customer', 'admin'];

export default function People() {
  const { t, fmt } = useI18n();
  const { user, company } = useSession();
  const admin = user.role === 'admin';
  const [tab, setTab] = useState('worker');
  const people = useResource('/people');
  const skills = useResource('/skills');
  const customers = useResource('/customers');
  const [edit, setEdit] = useState(null);
  const [invited, setInvited] = useState(null);
  const list = (people.data || []).filter((p) => p.role === tab);
  const supervisors = (people.data || []).filter((p) => p.role === 'supervisor');
  const skillNames = (ids) => ids.map((id) => skills.data?.find((s) => s.id === id)?.name).filter(Boolean).join(', ');
  const supName = (id) => supervisors.find((s) => s.id === id)?.name;
  const custName = (id) => customers.data?.find((c) => c.id === id)?.name;

  return (
    <div className="content">
      <div className="page-head">
        <div><h1>{t('people.title')}</h1><p>{admin ? t('people.subtitle') : t('people.subtitleTeam')}</p></div>
        {admin && <button className="btn primary" onClick={() => setEdit({ role: tab })}><IconPlus />{t('people.invite')}</button>}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={ROLE_TABS.map((r) => ({ value: r, label: t(`people.tab_${r}`), count: (people.data || []).filter((p) => p.role === r).length }))} />
      <ErrorBox error={people.error} onRetry={people.reload} />
      {people.loading ? <Loading /> : list.length === 0 ? (
        <div className="panel"><Empty title={t('people.emptyTitle')} action={admin && <button className="btn primary" onClick={() => setEdit({ role: tab })}>{t('people.invite')}</button>}>{t(`people.empty_${tab}`)}</Empty></div>
      ) : (
        <div className="panel table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('common.name')}</th><th>{t('people.contact')}</th>
                {(tab === 'worker' || tab === 'supervisor') && <th>{t('people.skills')}</th>}
                {tab === 'worker' && <th>{t('people.supervisor')}</th>}
                {(tab === 'worker' || tab === 'supervisor') && <th>{t('people.basePay')}</th>}
                {tab === 'customer' && <th>{t('people.customer')}</th>}
                <th>{t('common.status')}</th><th />
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td className="cell-title">{p.name}</td>
                  <td><div>{p.email}</div><div className="cell-sub">{p.phone}</div></td>
                  {(tab === 'worker' || tab === 'supervisor') && <td>{skillNames(p.skills) || '—'}</td>}
                  {tab === 'worker' && <td>{supName(p.supervisorId) || '—'}</td>}
                  {(tab === 'worker' || tab === 'supervisor') && <td className="nowrap">{p.baseSalaryBasis === 'none' ? t('people.perJobOnly') : `${fmt.money(p.baseSalaryAmount)} ${t(`people.per_${p.baseSalaryBasis}`)}`}</td>}
                  {tab === 'customer' && <td>{custName(p.customerId) || '—'}</td>}
                  <td><span className={`tag ${p.status === 'active' ? 'ok' : p.status === 'invited' ? 'info' : 'idle'}`}>{t(`people.status_${p.status}`)}</span></td>
                  <td className="num">{admin && p.id !== user.id && <button className="btn small" onClick={() => setEdit(p)}>{t('common.edit')}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {admin && <SkillsPanel skills={skills} />}
      {edit && (
        <PersonModal
          person={edit} skills={skills.data || []} supervisors={supervisors} customers={customers.data || []} currency={company.currency}
          onClose={() => setEdit(null)}
          onSaved={(result) => { setEdit(null); people.reload(); if (result?.inviteLink) setInvited(result); }}
        />
      )}
      {invited && (
        <Modal open title={t('people.invitedTitle')} onClose={() => setInvited(null)} footer={<button className="btn primary" onClick={() => setInvited(null)}>{t('common.done')}</button>}>
          <div className="stack">
            <p>{t('people.invitedText', { name: invited.name, email: invited.email })}</p>
            <CopyBox value={invited.inviteLink} />
            <p className="small muted">{t('people.invitedNote')}</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SkillsPanel({ skills }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const { busy, error, run } = useAction();
  const add = (e) => { e.preventDefault(); run(async () => { await api('/skills', { method: 'POST', body: { name } }); setName(''); skills.reload(); }).catch(() => {}); };
  const remove = (id) => run(async () => { await api(`/skills/${id}`, { method: 'DELETE' }); skills.reload(); }).catch(() => {});
  return (
    <section className="panel" style={{ marginTop: 20 }}>
      <div className="panel-head"><h3>{t('people.skillsTitle')}</h3></div>
      <div className="panel-body stack-sm">
        <p className="small muted">{t('people.skillsText')}</p>
        <div className="chips">
          {(skills.data || []).map((s) => (
            <span key={s.id} className="chip">{s.name}<button type="button" className="icon-btn" style={{ width: 22, height: 22 }} onClick={() => remove(s.id)} aria-label={t('people.removeSkill', { name: s.name })}><IconX width={13} height={13} /></button></span>
          ))}
        </div>
        <form className="row" onSubmit={add}>
          <input className="input" style={{ maxWidth: 240 }} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('people.newSkill')} aria-label={t('people.newSkill')} />
          <button className="btn" disabled={busy || !name.trim()}>{t('common.add')}</button>
        </form>
        <ErrorBox error={error} />
      </div>
    </section>
  );
}

function PersonModal({ person, skills, supervisors, customers, currency, onClose, onSaved }) {
  const { t } = useI18n();
  const toast = useToast();
  const isNew = !person.id;
  const [f, setF] = useState({
    role: person.role || 'worker', name: person.name || '', email: person.email || '', phone: person.phone || '', lang: person.lang || 'en',
    supervisorId: person.supervisorId || '', customerId: person.customerId || '', skills: person.skills || [],
    baseSalaryBasis: person.baseSalaryBasis || 'none', baseSalaryAmount: person.baseSalaryAmount ?? 0, availability: person.availability || [1, 2, 3, 4, 5],
  });
  const [confirm, setConfirm] = useState(null);
  const { busy, error, run } = useAction();
  const field = f.role === 'worker' || f.role === 'supervisor';
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = () => run(async () => {
    const body = {
      name: f.name, email: f.email || null, phone: f.phone || null, lang: f.lang,
      supervisorId: f.supervisorId ? Number(f.supervisorId) : null, skills: f.skills,
      baseSalaryBasis: f.baseSalaryBasis, baseSalaryAmount: Number(f.baseSalaryAmount) || 0, availability: f.availability,
    };
    if (isNew) {
      const r = await api('/people', { method: 'POST', body: { ...body, role: f.role, customerId: f.customerId ? Number(f.customerId) : null } });
      onSaved(r);
    } else {
      await api(`/people/${person.id}`, { method: 'PATCH', body });
      toast(t('common.saved'));
      onSaved();
    }
  }).catch(() => {});

  const act = (kind) => run(async () => {
    if (kind === 'resend') { const r = await api(`/people/${person.id}/resend-invite`, { method: 'POST' }); onSaved({ ...person, inviteLink: r.inviteLink }); }
    if (kind === 'disable') { await api(`/people/${person.id}/status`, { method: 'POST', body: { status: 'disabled' } }); onSaved(); }
    if (kind === 'enable') { await api(`/people/${person.id}/status`, { method: 'POST', body: { status: 'active' } }); onSaved(); }
    if (kind === 'delete') { await api(`/people/${person.id}`, { method: 'DELETE' }); onSaved(); }
  }).catch(() => {});

  return (
    <Modal open wide title={isNew ? t('people.invite') : t('people.editPerson', { name: person.name })} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={busy || !f.name || !f.email} onClick={save}>{isNew ? t('people.sendInvite') : t('common.save')}</button></>}>
      <div className="stack">
        {isNew && (
          <Field label={t('people.role')}>
            <select className="select" value={f.role} onChange={set('role')}>
              {ROLE_TABS.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
            </select>
          </Field>
        )}
        <div className="grid-2">
          <Field label={t('common.name')}><input className="input" value={f.name} onChange={set('name')} /></Field>
          <Field label={t('common.language')}>
            <select className="select" value={f.lang} onChange={set('lang')}>{LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</select>
          </Field>
        </div>
        <div className="grid-2">
          <Field label={t('common.email')} hint={isNew ? t('people.emailHint') : null}><input className="input" type="email" value={f.email} onChange={set('email')} /></Field>
          <Field label={t('common.phone')}><input className="input" type="tel" value={f.phone} onChange={set('phone')} /></Field>
        </div>
        {f.role === 'customer' && isNew && (
          <Field label={t('people.customer')} hint={t('people.customerHint')}>
            <select className="select" value={f.customerId} onChange={set('customerId')}>
              <option value="">{t('common.choose')}</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        )}
        {f.role === 'worker' && (
          <Field label={t('people.supervisor')} hint={t('people.supervisorHint')}>
            <select className="select" value={f.supervisorId} onChange={set('supervisorId')}>
              <option value="">{t('common.none')}</option>
              {supervisors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        )}
        {field && (
          <>
            <div className="field">
              <span className="label">{t('people.skills')}</span>
              <div className="chips">{skills.map((s) => <button key={s.id} type="button" className="chip" aria-pressed={f.skills.includes(s.id)} onClick={() => setF({ ...f, skills: f.skills.includes(s.id) ? f.skills.filter((x) => x !== s.id) : [...f.skills, s.id] })}>{s.name}</button>)}</div>
              {skills.length === 0 && <span className="hint">{t('people.noSkills')}</span>}
            </div>
            <div className="field"><span className="label">{t('people.workDays')}</span><DayPicker value={f.availability} onChange={(availability) => setF({ ...f, availability })} /></div>
            <div className="grid-2">
              <Field label={t('people.baseSalary')} hint={t('people.baseSalaryHint')}>
                <select className="select" value={f.baseSalaryBasis} onChange={set('baseSalaryBasis')}>
                  <option value="none">{t('people.perJobOnly')}</option>
                  <option value="monthly">{t('people.monthly')}</option>
                  <option value="hourly">{t('people.hourly')}</option>
                </select>
              </Field>
              {f.baseSalaryBasis !== 'none' && <Field label={t('people.amount', { currency })}><input className="input" type="number" min={0} step="0.01" value={f.baseSalaryAmount} onChange={set('baseSalaryAmount')} /></Field>}
            </div>
          </>
        )}
        <ErrorBox error={error} />
        {!isNew && (
          <div className="panel"><div className="panel-body stack-sm">
            <strong>{t('people.account')}</strong>
            <div className="row">
              {person.status === 'invited' && <button className="btn small" disabled={busy} onClick={() => act('resend')}>{t('people.resend')}</button>}
              {person.status === 'active' && <button className="btn small" disabled={busy} onClick={() => act('disable')}>{t('people.disable')}</button>}
              {person.status === 'disabled' && <button className="btn small" disabled={busy} onClick={() => act('enable')}>{t('people.enable')}</button>}
              <button className="btn small danger" onClick={() => setConfirm('delete')}>{t('people.remove')}</button>
            </div>
            {confirm === 'delete' && (
              <div className="alert bad stack-sm"><div>{t('people.removeWarning')}</div><button className="btn danger solid small" disabled={busy} onClick={() => act('delete')}>{t('people.removeConfirm', { name: person.name })}</button></div>
            )}
          </div></div>
        )}
      </div>
    </Modal>
  );
}
