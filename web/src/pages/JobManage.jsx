// Admin and supervisor controls on a job: supervisor, team, schedule, cancel, admin review, activity.
import { useState } from 'react';
import { api, useResource } from '../api.js';
import { useSession } from '../session.jsx';
import { useI18n, errorText } from '../i18n/index.jsx';
import { Field, Modal, ErrorBox, Loading, useAction, useToast } from '../components/ui.jsx';
import { isoToZoned, zonedToIso, addDays } from '../device.js';
import { IconPlus, IconX } from '../components/icons.jsx';

export function ManagePanel({ job, setJob }) {
  const { t } = useI18n();
  const { user, company } = useSession();
  const toast = useToast();
  const [modal, setModal] = useState(null); // workers | supervisor | edit | cancel | review
  const { busy, error, run } = useAction();
  const canManage = user.role === 'admin' || job.supervisor?.id === user.id;
  const closed = ['approved', 'cancelled'].includes(job.status);
  if (!canManage) return null;

  const removeWorker = (w) => run(async () => {
    setJob(await api(`/jobs/${job.id}/assignments/${w.id}`, { method: 'DELETE' }));
    toast(t('manage.removed', { name: w.name }));
  }).catch(() => {});

  return (
    <section className="panel">
      <div className="panel-head"><h3>{t('manage.title')}</h3></div>
      <div className="panel-body stack">
        <div>
          <div className="row between"><span className="label" style={{ fontWeight: 500 }}>{t('job.supervisor')}</span>
            {user.role === 'admin' && !closed && <button className="btn small" onClick={() => setModal('supervisor')}>{job.supervisor ? t('manage.change') : t('manage.assign')}</button>}
          </div>
          <div className="muted">{job.supervisor ? job.supervisor.name : t('jobs.noSupervisor')}</div>
        </div>
        <div>
          <div className="row between"><span className="label" style={{ fontWeight: 500 }}>{t('job.team')}</span>
            {!closed && job.status !== 'submitted' && <button className="btn small" onClick={() => setModal('workers')}><IconPlus />{t('manage.addWorker')}</button>}
          </div>
          {job.workers.length === 0 ? <div className="muted">{t('jobs.noWorkers')}</div> : (
            <ul className="attn-list" style={{ marginTop: 6 }}>
              {job.workers.map((w) => (
                <li key={w.id} className="row between" style={{ padding: '6px 0' }}>
                  <span>{w.name}<br /><span className="small muted">{t(`pay.${w.payBasis}`)}{w.payBasis !== 'salary' ? ` — ${w.payRate} ${company.currency}` : ''}</span></span>
                  {!closed && !job.attendance.some((a) => a.workerId === w.id) && (
                    <button className="icon-btn" disabled={busy} onClick={() => removeWorker(w)} aria-label={t('manage.removeWorker', { name: w.name })}><IconX /></button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <ErrorBox error={error} />
        <div className="row">
          {['scheduled', 'assigned'].includes(job.status) && <button className="btn small" onClick={() => setModal('edit')}>{t('manage.editSchedule')}</button>}
          {job.status === 'admin_review' && user.role === 'admin' && <button className="btn small primary" onClick={() => setModal('review')}>{t('manage.resolveReview')}</button>}
          {!closed && <button className="btn small danger" onClick={() => setModal('cancel')}>{t('manage.cancelJob')}</button>}
        </div>
      </div>
      {modal === 'workers' && <AssignWorkers job={job} setJob={setJob} onClose={() => setModal(null)} />}
      {modal === 'supervisor' && <AssignSupervisor job={job} setJob={setJob} onClose={() => setModal(null)} />}
      {modal === 'edit' && <EditSchedule job={job} setJob={setJob} onClose={() => setModal(null)} />}
      {modal === 'cancel' && <CancelJob job={job} setJob={setJob} onClose={() => setModal(null)} />}
      {modal === 'review' && <AdminReview job={job} setJob={setJob} onClose={() => setModal(null)} />}
    </section>
  );
}

function AssignWorkers({ job, setJob, onClose }) {
  const { t, fmt } = useI18n();
  const { company } = useSession();
  const toast = useToast();
  const { data, loading, reload } = useResource(`/jobs/${job.id}/candidates`);
  const [pay, setPay] = useState({ basis: job.payBasis || 'salary', rate: job.payRate ?? 0 });
  const [overlap, setOverlap] = useState(null);
  const { busy, error, run, setError } = useAction();

  const assign = (c, acknowledgeConflict = false) => run(async () => {
    try {
      const r = await api(`/jobs/${job.id}/assignments`, {
        method: 'POST', body: { workerId: c.id, payBasis: pay.basis, payRate: Number(pay.rate) || 0, acknowledgeConflict },
      });
      setJob(r);
      setOverlap(null);
      toast(t('manage.assigned', { name: c.name }));
      reload();
    } catch (e) {
      if (e.code === 'OVERLAP') { setOverlap({ worker: c, jobs: e.details }); setError(null); return; }
      throw e;
    }
  }).catch(() => {});

  return (
    <Modal open wide title={t('manage.assignTitle')} onClose={onClose}>
      <div className="stack">
        <div className="grid-2">
          <Field label={t('pay.basisLabel')} hint={t('manage.payHint')}>
            <select className="select" value={pay.basis} onChange={(e) => setPay({ ...pay, basis: e.target.value })}>
              {['salary', 'hourly', 'daily', 'fixed'].map((b) => <option key={b} value={b}>{t(`pay.${b}`)}</option>)}
            </select>
          </Field>
          {pay.basis !== 'salary' && <Field label={t('pay.rateLabel', { currency: company.currency })}><input className="input" type="number" min={0} step="0.01" value={pay.rate} onChange={(e) => setPay({ ...pay, rate: e.target.value })} /></Field>}
        </div>
        {overlap && (
          <div className="alert warn stack-sm">
            <div>{t('manage.overlapText', { name: overlap.worker.name })}</div>
            <ul style={{ margin: 0 }}>{overlap.jobs.map((j) => <li key={j.id}>{j.title}, {fmt.dateTime(j.start)}–{fmt.time(j.end)}</li>)}</ul>
            <div className="row"><button className="btn small" disabled={busy} onClick={() => assign(overlap.worker, true)}>{t('manage.assignAnyway')}</button><button className="btn small ghost" onClick={() => setOverlap(null)}>{t('common.cancel')}</button></div>
          </div>
        )}
        <ErrorBox error={error} />
        {loading ? <Loading /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('common.name')}</th><th>{t('manage.skills')}</th><th>{t('manage.availability')}</th><th>{t('manage.conflicts')}</th><th /></tr></thead>
              <tbody>
                {data.map((c) => (
                  <tr key={c.id}>
                    <td><div className="cell-title">{c.name}</div><div className="cell-sub">{t(`roles.${c.role}`)}</div></td>
                    <td>{c.skillMatch === 1 ? <span className="tag ok">{t('manage.allSkills')}</span> : c.skillMatch > 0 ? <span className="tag warn">{t('manage.someSkills', { pct: Math.round(c.skillMatch * 100) })}</span> : <span className="tag bad">{t('manage.noSkills')}</span>}</td>
                    <td>{c.available ? <span className="tag ok">{t('manage.works')}</span> : <span className="tag idle">{t('manage.dayOff')}</span>}</td>
                    <td>{c.conflicts.length ? <span className="tag warn">{t('manage.otherJobs', { n: c.conflicts.length })}</span> : <span className="muted small">{t('common.none')}</span>}</td>
                    <td className="num">{c.assigned ? <span className="tag info">{t('manage.onJob')}</span> : <button className="btn small primary" disabled={busy} onClick={() => assign(c)}>{t('manage.assign')}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.length === 0 && <p className="muted">{t('manage.noCandidates')}</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}

function AssignSupervisor({ job, setJob, onClose }) {
  const { t } = useI18n();
  const { data, loading } = useResource(`/jobs/${job.id}/supervisor-candidates`);
  const { busy, error, run } = useAction();
  const choose = (id) => run(async () => { setJob(await api(`/jobs/${job.id}/supervisor`, { method: 'POST', body: { supervisorId: id } })); onClose(); }).catch(() => {});
  return (
    <Modal open title={t('manage.supervisorTitle')} onClose={onClose}>
      {loading ? <Loading /> : (
        <div className="stack">
          <ErrorBox error={error} />
          <table className="table">
            <thead><tr><th>{t('common.name')}</th><th>{t('manage.expertise')}</th><th>{t('manage.load')}</th><th /></tr></thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id}>
                  <td className="cell-title">{s.name}</td>
                  <td>{s.skillMatch === 1 ? <span className="tag ok">{t('manage.allSkills')}</span> : <span className="tag warn">{t('manage.someSkills', { pct: Math.round(s.skillMatch * 100) })}</span>}</td>
                  <td>{t('manage.jobsThatDay', { n: s.jobsThatDay })}</td>
                  <td className="num"><button className="btn small primary" disabled={busy || job.supervisor?.id === s.id} onClick={() => choose(s.id)}>{t('manage.assign')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.length === 0 && <p className="muted">{t('manage.noSupervisors')}</p>}
        </div>
      )}
    </Modal>
  );
}

function EditSchedule({ job, setJob, onClose }) {
  const { t } = useI18n();
  const { company } = useSession();
  const tz = company.timezone;
  const s = isoToZoned(job.scheduledStart, tz);
  const e = isoToZoned(job.scheduledEnd, tz);
  const [f, setF] = useState({ title: job.title, date: s.date, start: s.time, end: e.time, notes: job.notes || '' });
  const { busy, error, run } = useAction();
  const save = () => run(async () => {
    setJob(await api(`/jobs/${job.id}`, {
      method: 'PATCH',
      body: {
        title: f.title, notes: f.notes || null, scheduledStart: zonedToIso(f.date, f.start, tz),
        scheduledEnd: zonedToIso(f.end <= f.start ? addDays(f.date, 1) : f.date, f.end, tz),
      },
    }));
    onClose();
  }).catch(() => {});
  return (
    <Modal open title={t('manage.editSchedule')} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={busy} onClick={save}>{t('common.save')}</button></>}>
      <div className="stack">
        <Field label={t('jobNew.jobTitle')}><input className="input" value={f.title} onChange={(ev) => setF({ ...f, title: ev.target.value })} /></Field>
        <div className="grid-3">
          <Field label={t('common.date')}><input className="input" type="date" value={f.date} onChange={(ev) => setF({ ...f, date: ev.target.value })} /></Field>
          <Field label={t('common.start')}><input className="input" type="time" value={f.start} onChange={(ev) => setF({ ...f, start: ev.target.value })} /></Field>
          <Field label={t('common.end')}><input className="input" type="time" value={f.end} onChange={(ev) => setF({ ...f, end: ev.target.value })} /></Field>
        </div>
        <Field label={t('jobNew.notes')}><textarea className="textarea" value={f.notes} onChange={(ev) => setF({ ...f, notes: ev.target.value })} /></Field>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function CancelJob({ job, setJob, onClose }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Modal open title={t('manage.cancelJob')} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>{t('common.back')}</button><button className="btn danger solid" disabled={busy || reason.trim().length < 3} onClick={() => run(async () => { setJob(await api(`/jobs/${job.id}/cancel`, { method: 'POST', body: { reason } })); onClose(); }).catch(() => {})}>{t('manage.confirmCancel')}</button></>}>
      <div className="stack">
        <p>{t('manage.cancelText')}</p>
        <Field label={t('manage.cancelReason')}><textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function AdminReview({ job, setJob, onClose }) {
  const { t } = useI18n();
  const [action, setAction] = useState('rework');
  const [comment, setComment] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Modal open title={t('manage.resolveReview')} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={busy || comment.trim().length < 3} onClick={() => run(async () => { setJob(await api(`/jobs/${job.id}/review`, { method: 'POST', body: { action, comment } })); onClose(); }).catch(() => {})}>{t('common.save')}</button></>}>
      <div className="stack">
        <p>{t('manage.reviewText', { n: job.reworkCount })}</p>
        <div className="stack-sm" role="radiogroup">
          {['rework', 'approve', 'cancel'].map((a) => (
            <label key={a} className="check"><input type="radio" name="review" checked={action === a} onChange={() => setAction(a)} />{t(`manage.review_${a}`)}</label>
          ))}
        </div>
        <Field label={t('manage.reviewComment')}><textarea className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

export function ActivityLog({ jobId }) {
  const { t, fmt } = useI18n();
  const [open, setOpen] = useState(false);
  const { data, loading, error } = useResource(`/jobs/${jobId}/audit`, { skip: !open, liveFilter: (e) => open && e.type === 'job' && String(e.jobId) === String(jobId) });
  return (
    <section className="panel">
      <div className="panel-head"><h3>{t('job.activity')}</h3><button className="btn small" onClick={() => setOpen(!open)}>{open ? t('common.hide') : t('common.show')}</button></div>
      {open && (loading ? <Loading /> : error ? <div className="panel-body">{errorText(t, error)}</div> : (
        <ul className="attn-list">
          {data.map((a) => (
            <li key={a.id} style={{ padding: '9px 18px' }} className="small">
              <div className="row between"><strong>{t(`audit.${a.action}`) === `audit.${a.action}` ? a.action : t(`audit.${a.action}`)}</strong><span className="muted">{fmt.dateTime(a.at)}</span></div>
              <div className="muted">{a.actor || t('job.system')}{a.lat != null ? ` — ${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}` : ''}</div>
            </li>
          ))}
        </ul>
      ))}
    </section>
  );
}
