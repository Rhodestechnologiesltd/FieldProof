// The worker's on-site panel: GPS check-in, checklist with photos, submit and check out.
// Every action works offline: it is saved on the phone and sent when the connection returns.
import { useRef, useState } from 'react';
import { useSession } from '../session.jsx';
import { useI18n, errorText } from '../i18n/index.jsx';
import { fieldAction, useOutbox, pendingFor } from '../offline.js';
import { getPosition, compressPhoto } from '../device.js';
import { Field, MediaThumb, Progress, useToast } from '../components/ui.jsx';
import { IconPin, IconCamera, IconCheck, IconSend, IconFlag } from '../components/icons.jsx';

function myLastEvent(job, userId) {
  return job.attendance.filter((a) => a.workerId === userId).at(-1);
}

export function FieldPanel({ job, setJob }) {
  const { t, fmt } = useI18n();
  const { user } = useSession();
  const toast = useToast();
  const { queue } = useOutbox();
  const pending = pendingFor(queue, job.id);
  const last = myLastEvent(job, user.id);
  const onSite = last?.kind === 'in';

  // Check-in flow state
  const [phase, setPhase] = useState('idle'); // idle | locating | needReason | denied
  const [pos, setPos] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const applyLocal = (patch) => setJob((j) => ({ ...j, ...patch(j) }));

  const doCheckIn = async (position, why) => {
    setBusy(true);
    setErr(null);
    try {
      const body = { ...(position || {}), reason: why || undefined };
      const r = await fieldAction({ type: 'check-in', jobId: job.id, body });
      if (r.queued) {
        applyLocal((j) => ({
          status: 'in_progress',
          attendance: [...j.attendance, { kind: 'in', workerId: user.id, workerName: user.name, at: r.entry.createdAt, offline: true, pending: true, verified: false, reason: why, lat: position?.lat, lng: position?.lng }],
        }));
        toast(t('offline.queuedToast'));
      } else {
        setJob(r.job);
        toast(r.verified ? t('field.checkedInVerified', { m: r.distance }) : t('field.checkedInFlagged'));
      }
      setPhase('idle');
      setReason('');
    } catch (e) {
      if (e.code === 'REASON_REQUIRED') {
        setRefusal(e.details || {});
        setPhase('needReason');
      } else {
        setErr(e);
        setPhase('idle');
      }
    } finally {
      setBusy(false);
    }
  };

  const startCheckIn = async () => {
    setPhase('locating');
    setErr(null);
    try {
      const p = await getPosition();
      setPos(p);
      await doCheckIn(p);
    } catch (e) {
      if (e.code === 'LOCATION_DENIED' || e.code === 'LOCATION_UNAVAILABLE') {
        setPos(null);
        setRefusal({ noGps: true, code: e.code });
        setPhase('needReason');
      } else {
        setErr(e);
        setPhase('idle');
      }
    }
  };

  const checkOut = async () => {
    setBusy(true);
    setErr(null);
    try {
      let p = {};
      try { p = await getPosition({ timeout: 8000 }); } catch { /* checkout without GPS is allowed */ }
      const r = await fieldAction({ type: 'check-out', jobId: job.id, body: p });
      if (r.queued) {
        applyLocal((j) => ({ attendance: [...j.attendance, { kind: 'out', workerId: user.id, workerName: user.name, at: r.entry.createdAt, offline: true, pending: true }] }));
      } else setJob(r.job);
      toast(t('field.checkedOut'));
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      let p = {};
      try { p = await getPosition({ timeout: 8000 }); } catch { /* submit without GPS is allowed */ }
      const r = await fieldAction({ type: 'submit', jobId: job.id, body: p });
      if (r.queued) {
        applyLocal((j) => ({ status: 'submitted', submittedAt: r.entry.createdAt, attendance: [...j.attendance, { kind: 'out', workerId: user.id, workerName: user.name, at: r.entry.createdAt, offline: true, pending: true }] }));
        toast(t('offline.queuedToast'));
      } else {
        setJob(r.job);
        toast(t('field.submitted'));
      }
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  const requiredLeft = job.items.filter((i) => i.required && !i.doneAt).length;

  return (
    <div className="stack">
      {!onSite ? (
        <section className="checkin-panel stack-sm" aria-live="polite">
          <h2>{job.status === 'rework' ? t('field.reworkTitle') : t('field.arriveTitle')}</h2>
          <p className="muted">{t('field.arriveText', { site: job.site.name, m: job.site.radiusM })}</p>
          {phase === 'needReason' ? (
            <div className="stack-sm">
              {refusal?.noGps ? (
                <div className="alert warn">{t(refusal.code === 'LOCATION_DENIED' ? 'field.gpsDenied' : 'field.gpsUnavailable')}</div>
              ) : (
                <div>
                  <div className="distance">{refusal?.distance != null ? t('job.metres', { m: refusal.distance }) : '—'}</div>
                  <div className="muted">{refusal?.inside ? t('field.weakGps', { acc: refusal.accuracy ?? '?' }) : t('field.outsideArea', { m: refusal?.radius ?? job.site.radiusM })}</div>
                </div>
              )}
              <Field label={<span style={{ color: '#fff' }}>{t('field.reasonLabel')}</span>}>
                <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('field.reasonPlaceholder')} />
              </Field>
              <div className="row">
                <button className="btn primary" disabled={busy || reason.trim().length < 3} onClick={() => doCheckIn(pos, reason.trim())}><IconFlag />{t('field.checkInWithReason')}</button>
                <button className="btn ghost" disabled={busy} onClick={startCheckIn}>{t('field.tryAgain')}</button>
              </div>
            </div>
          ) : (
            <button className="btn primary big" disabled={busy || phase === 'locating'} onClick={startCheckIn}>
              <IconPin />{phase === 'locating' ? t('field.locating') : t('field.checkIn')}
            </button>
          )}
          {err && <div className="alert bad">{errorText(t, err)}</div>}
        </section>
      ) : (
        <section className="panel">
          <div className="panel-body row between">
            <div>
              <div className="cell-title">{t('field.onSiteSince', { time: fmt.time(last.at) })}</div>
              <div className="small muted">{last.pending ? t('offline.savedOnPhone') : last.verified ? t('attendance.verified') : t('attendance.flagged')}</div>
            </div>
            <button className="btn small" disabled={busy} onClick={checkOut}>{t('field.checkOut')}</button>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-head"><h3>{t('job.checklist')}</h3><div style={{ width: 160 }}><Progress {...job.progress} /></div></div>
        <ul className="checklist">
          {job.items.map((item) => (
            <ChecklistRow key={item.id} item={item} job={job} enabled={onSite} setJob={setJob} queued={pending.some((p) => p.itemId === item.id)} />
          ))}
        </ul>
        {!job.items.length && <p className="muted small" style={{ padding: '12px 18px' }}>{t('job.noChecklist')}</p>}
      </section>

      {onSite && (
        <section className="panel"><div className="panel-body stack-sm">
          {requiredLeft > 0 && <p className="muted" style={{ margin: 0 }}>{t('field.itemsLeft', { n: requiredLeft })}</p>}
          <button className="btn dark big" disabled={busy || requiredLeft > 0 || job.status !== 'in_progress'} onClick={submit}><IconSend />{t('field.submit')}</button>
          <p className="small muted" style={{ margin: 0 }}>{t('field.submitNote')}</p>
          {err && onSite && <div className="alert bad">{errorText(t, err)}</div>}
        </div></section>
      )}
    </div>
  );
}

function ChecklistRow({ item, job, enabled, setJob, queued }) {
  const { t, fmt } = useI18n();
  const toast = useToast();
  const fileRef = useRef(null);
  const [note, setNote] = useState(item.note || '');
  const [value, setValue] = useState(item.value ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [localPhotos, setLocalPhotos] = useState([]);
  const done = Boolean(item.doneAt);

  const send = async (body, photos = []) => {
    setBusy(true);
    setErr(null);
    try {
      let lat; let lng;
      if (photos.length) {
        try { const p = await getPosition({ timeout: 5000 }); lat = p.lat; lng = p.lng; } catch { /* photo without GPS */ }
      }
      const r = await fieldAction({ type: 'item', jobId: job.id, itemId: item.id, body: { ...body, lat, lng }, photos });
      if (r.queued) {
        setJob((j) => {
          const items = j.items.map((i) => (i.id === item.id ? { ...i, doneAt: body.done ? r.entry.createdAt : null, note: body.note ?? i.note, value: body.value ?? i.value } : i));
          return { ...j, items, progress: { done: items.filter((i) => i.doneAt).length, total: items.length } };
        });
        toast(t('offline.queuedToast'));
      } else {
        setJob(r.job);
        setLocalPhotos([]);
      }
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  const onPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const blob = await compressPhoto(file);
    setLocalPhotos((xs) => [...xs, URL.createObjectURL(blob)]);
    await send({ done: true }, [blob]);
  };

  const toggle = () => {
    if (item.type === 'tick') return send({ done: !done });
    if (item.type === 'photo') return done ? send({ done: false }) : fileRef.current?.click();
    if (item.type === 'note') return done ? send({ done: false }) : send({ done: true, note });
    if (item.type === 'number') return done ? send({ done: false }) : send({ done: true, value: value === '' ? null : Number(value) });
    return null;
  };

  return (
    <li className="check-item">
      <button type="button" className="check-box" role="checkbox" aria-checked={done} disabled={!enabled || busy} onClick={toggle} aria-label={item.label}>
        <IconCheck />
      </button>
      <div className="stack-sm">
        <div>
          <div className="check-label">{item.label}{!item.required && <span className="muted small"> ({t('common.optional')})</span>}</div>
          <div className="check-meta">{done ? t('job.doneAt', { time: fmt.time(item.doneAt) }) : t(`itemType.${item.type}`)}{queued && ` — ${t('offline.savedOnPhone')}`}</div>
        </div>
        {item.type === 'photo' && (
          <>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
            {enabled && <div><button type="button" className="btn small" disabled={busy} onClick={() => fileRef.current?.click()}><IconCamera />{done ? t('field.addPhoto') : t('field.takePhoto')}</button></div>}
          </>
        )}
        {item.type === 'note' && enabled && !done && (
          <div className="row"><textarea className="textarea grow" style={{ minHeight: 60 }} value={note} onChange={(e) => setNote(e.target.value)} aria-label={item.label} /><button className="btn small" disabled={busy || (item.required && !note.trim())} onClick={() => send({ done: true, note })}>{t('common.save')}</button></div>
        )}
        {item.type === 'note' && done && item.note && <div className="small">{item.note}</div>}
        {item.type === 'number' && enabled && !done && (
          <div className="row"><input className="input" style={{ width: 120 }} type="number" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} aria-label={item.label} /><button className="btn small" disabled={busy || value === ''} onClick={() => send({ done: true, value: Number(value) })}>{t('common.save')}</button></div>
        )}
        {item.type === 'number' && done && item.value != null && <div className="small"><strong>{fmt.number(item.value)}</strong></div>}
        {(item.media.length > 0 || localPhotos.length > 0) && (
          <div className="thumbs">
            {item.media.map((m) => <MediaThumb key={m.id} id={m.id} caption={fmt.dateTime(m.takenAt)} />)}
            {localPhotos.map((src) => <MediaThumb key={src} src={src} />)}
          </div>
        )}
        {err && <div className="small" style={{ color: 'var(--bad)' }}>{errorText(t, err)}</div>}
      </div>
    </li>
  );
}
