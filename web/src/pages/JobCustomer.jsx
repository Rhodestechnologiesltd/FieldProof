// Customer actions: confirm the team's arrival, then approve or reject the finished work against the SLA.
import { useState } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n/index.jsx';
import { Field, ErrorBox, Stars, MediaThumb, useAction, useToast } from '../components/ui.jsx';
import { compressPhoto } from '../device.js';
import { IconCheck, IconX, IconCamera } from '../components/icons.jsx';

const REASONS = ['incomplete', 'poor_quality', 'damage', 'not_as_agreed', 'sla_missed', 'other'];

export function CustomerPanel({ job, setJob }) {
  return (
    <>
      {job.arrivalStatus === 'pending' && <ArrivalCard job={job} setJob={setJob} />}
      {job.status === 'submitted' && <ApprovalCard job={job} setJob={setJob} />}
    </>
  );
}

function ArrivalCard({ job, setJob }) {
  const { t, fmt } = useI18n();
  const toast = useToast();
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  const first = job.attendance.find((a) => a.kind === 'in' && a.at === job.visitStartedAt) || job.attendance.filter((a) => a.kind === 'in').at(-1);
  const act = (action) => run(async () => {
    const r = await api(`/jobs/${job.id}/arrival`, { method: 'POST', body: { action, reason: reason || undefined } });
    setJob(r);
    toast(action === 'confirm' ? t('customer.arrivalConfirmed') : t('customer.arrivalDisputed'));
  }).catch(() => {});
  return (
    <section className="panel" style={{ borderColor: 'var(--hivis-deep)', borderWidth: 2 }}>
      <div className="panel-body stack-sm">
        <h2>{t('customer.arrivalTitle')}</h2>
        {first && (
          <p>{t('customer.arrivalText', { name: first.workerName, time: fmt.time(first.at) })}{' '}
            {first.verified ? <span className="tag ok">{t('customer.verifiedOnSite', { m: first.distanceM })}</span> : <span className="tag warn">{t('attendance.flagged')}</span>}
          </p>
        )}
        <p className="small muted">{job.visitVerified ? t('customer.autoConfirmNote', { n: job.autoConfirmMinutes }) : t('customer.flaggedNote')}</p>
        {disputing ? (
          <div className="stack-sm">
            <Field label={t('customer.disputeReason')}><textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <div className="row">
              <button className="btn danger solid" disabled={busy || reason.trim().length < 3} onClick={() => act('dispute')}>{t('customer.sendDispute')}</button>
              <button className="btn ghost" onClick={() => setDisputing(false)}>{t('common.cancel')}</button>
            </div>
          </div>
        ) : (
          <div className="row">
            <button className="btn ok solid" disabled={busy} onClick={() => act('confirm')}><IconCheck />{t('customer.confirmArrival')}</button>
            <button className="btn danger" disabled={busy} onClick={() => setDisputing(true)}><IconX />{t('customer.notHere')}</button>
          </div>
        )}
        <ErrorBox error={error} />
      </div>
    </section>
  );
}

function ApprovalCard({ job, setJob }) {
  const { t } = useI18n();
  const toast = useToast();
  const [mode, setMode] = useState(null); // approve | reject
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [photos, setPhotos] = useState([]); // {id, url}
  const { busy, error, run } = useAction();

  const addPhoto = (e) => run(async () => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const blob = await compressPhoto(file);
    const form = new FormData();
    form.append('jobId', job.id);
    form.append('kind', 'rejection');
    form.append('file', blob, 'evidence.jpg');
    const m = await api('/media', { method: 'POST', form });
    setPhotos((xs) => [...xs, { id: m.id, url: URL.createObjectURL(blob) }]);
  }).catch(() => {});

  const decide = (decision) => run(async () => {
    const body = decision === 'approve'
      ? { decision, rating, comment: comment || undefined }
      : { decision, reasonCode, comment, mediaIds: photos.map((p) => p.id) };
    const r = await api(`/jobs/${job.id}/decision`, { method: 'POST', body });
    setJob(r);
    toast(decision === 'approve' ? t('customer.approvedToast') : t('customer.rejectedToast'));
  }).catch(() => {});

  return (
    <section className="panel" style={{ borderColor: 'var(--hivis-deep)', borderWidth: 2 }}>
      <div className="panel-body stack">
        <div>
          <h2>{t('customer.reviewTitle')}</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>{t('customer.reviewText', { h: job.autoApproveHours })}</p>
        </div>
        <div className="alert info"><strong>{t('job.sla')}:</strong> {job.slaText || t('job.noSla')}</div>
        {!mode && (
          <div className="row">
            <button className="btn ok solid" onClick={() => setMode('approve')}><IconCheck />{t('customer.approve')}</button>
            <button className="btn danger" onClick={() => setMode('reject')}><IconX />{t('customer.reject')}</button>
          </div>
        )}
        {mode === 'approve' && (
          <div className="stack-sm">
            <Field label={t('customer.rating')}><Stars value={rating} onChange={setRating} /></Field>
            <Field label={t('customer.commentOptional')}><textarea className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
            <div className="row">
              <button className="btn ok solid" disabled={busy} onClick={() => decide('approve')}>{t('customer.approveWork')}</button>
              <button className="btn ghost" onClick={() => setMode(null)}>{t('common.cancel')}</button>
            </div>
          </div>
        )}
        {mode === 'reject' && (
          <div className="stack-sm">
            <Field label={t('customer.rejectReason')}>
              <select className="select" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} required>
                <option value="">{t('common.choose')}</option>
                {REASONS.map((r) => <option key={r} value={r}>{t(`rejectReasons.${r}`)}</option>)}
              </select>
            </Field>
            <Field label={t('customer.whatWrong')} hint={t('customer.whatWrongHint')}><textarea className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
            <div className="row">
              <label className="btn small"><IconCamera />{t('customer.addEvidence')}<input type="file" accept="image/*" hidden onChange={addPhoto} /></label>
              <div className="thumbs" style={{ marginTop: 0 }}>{photos.map((p) => <MediaThumb key={p.id} src={p.url} />)}</div>
            </div>
            <div className="row">
              <button className="btn danger solid" disabled={busy || !reasonCode || comment.trim().length < 3} onClick={() => decide('reject')}>{t('customer.sendRejection')}</button>
              <button className="btn ghost" onClick={() => setMode(null)}>{t('common.cancel')}</button>
            </div>
          </div>
        )}
        <ErrorBox error={error} />
      </div>
    </section>
  );
}
