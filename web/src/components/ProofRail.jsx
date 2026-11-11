// The proof rail: each stage of a visit and what the system has verified about it.
import { useI18n } from '../i18n/index.jsx';
import { IconCheck, IconPin, IconFlag, IconX, IconClock, IconSend } from './icons.jsx';

export function railSteps(job, t, fmt) {
  const ins = job.attendance.filter((a) => a.kind === 'in');
  const firstIn = job.visitStartedAt ? ins.find((a) => a.at === job.visitStartedAt) || ins.at(-1) : null;
  const lastDecision = job.decisions.at(-1);
  const closed = job.status === 'cancelled';
  const steps = [];

  steps.push({
    key: 'assigned',
    label: t('rail.assigned'),
    state: job.workers.length ? 'done' : (closed ? 'idle' : 'current'),
    detail: job.workers.length ? job.workers.map((w) => w.name).join(', ') : t('rail.noWorkers'),
    Icon: IconCheck,
  });

  let arrived = { state: 'idle', detail: t('rail.due', { time: fmt.time(job.scheduledStart) }), Icon: IconPin };
  if (firstIn) {
    arrived = firstIn.verified
      ? { state: 'done', Icon: IconPin, detail: t('rail.verifiedAt', { time: fmt.time(firstIn.at), m: firstIn.distanceM ?? '?' }) }
      : { state: 'flag', Icon: IconFlag, detail: t('rail.flaggedAt', { time: fmt.time(firstIn.at), m: firstIn.distanceM ?? '?' }) };
  } else if (['assigned', 'scheduled', 'rework'].includes(job.status) && new Date(job.scheduledStart) < new Date()) {
    arrived = { state: 'current', Icon: IconClock, detail: t('rail.notYet') };
  }
  steps.push({ key: 'arrived', label: t('rail.arrived'), ...arrived });

  const arrivalMap = {
    pending: { state: 'current', Icon: IconClock, detail: t('rail.awaitingCustomer') },
    confirmed: { state: 'done', Icon: IconCheck, detail: t('rail.confirmedBy', { name: job.arrivals.at(-1)?.by || '' }) },
    auto_confirmed: { state: 'done', Icon: IconCheck, detail: t('rail.autoConfirmed') },
    disputed: { state: 'problem', Icon: IconX, detail: job.arrivals.at(-1)?.reason || t('arrival.disputed') },
  };
  steps.push({ key: 'confirmed', label: t('rail.confirmed'), ...(arrivalMap[job.arrivalStatus] || { state: 'idle', Icon: IconCheck, detail: '—' }) });

  const { done, total } = job.progress;
  steps.push({
    key: 'checklist', label: t('rail.checklist'), Icon: IconCheck,
    state: total && job.items.every((i) => i.doneAt || !i.required) && (done > 0 || job.submittedAt) ? 'done' : (job.status === 'in_progress' ? 'current' : 'idle'),
    detail: t('rail.itemsDone', { done, total }),
  });

  let submitted = { state: 'idle', Icon: IconSend, detail: '—' };
  if (job.submittedAt) submitted = { state: 'done', Icon: IconSend, detail: fmt.dateTime(job.submittedAt) };
  steps.push({ key: 'submitted', label: t('rail.submitted'), ...submitted });

  let decided = { state: 'idle', Icon: IconCheck, detail: t('rail.autoApproveIn', { h: job.autoApproveHours }) };
  if (job.status === 'submitted') decided = { state: 'current', Icon: IconClock, detail: t('rail.awaitingCustomer') };
  if (job.status === 'approved') {
    decided = { state: 'done', Icon: IconCheck, detail: lastDecision?.decision === 'auto_approved' ? t('rail.autoApproved') : t('rail.approvedBy', { name: lastDecision?.by || '' }) };
  }
  if (['rework', 'admin_review'].includes(job.status) && lastDecision) {
    decided = { state: 'problem', Icon: IconX, detail: `${t(`rejectReasons.${lastDecision.reasonCode}`)}${job.status === 'admin_review' ? ` (${t('status.admin_review')})` : ''}` };
  }
  if (closed) decided = { state: 'problem', Icon: IconX, detail: t('status.cancelled') };
  steps.push({ key: 'approved', label: t('rail.approved'), ...decided });
  return steps;
}

export default function ProofRail({ job }) {
  const { t, fmt } = useI18n();
  const steps = railSteps(job, t, fmt);
  return (
    <ol className="rail" style={{ '--steps': steps.length, listStyle: 'none', margin: 0, padding: 0 }} aria-label={t('rail.title')}>
      {steps.map(({ key, label, state, detail, Icon }) => (
        <li key={key} className={`rail-step ${state}`}>
          <div className="stamp"><Icon /></div>
          <div className="rail-label">{label}</div>
          <div className="rail-detail">{detail}</div>
        </li>
      ))}
    </ol>
  );
}
