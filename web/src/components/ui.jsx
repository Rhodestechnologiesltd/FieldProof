import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useI18n, errorText } from '../i18n/index.jsx';
import { IconX, IconStar } from './icons.jsx';

export function Loading({ full }) {
  return <div className={`loading${full ? ' full' : ''}`} role="status"><div className="spinner" /><span className="sr-only">Loading</span></div>;
}

export function ErrorBox({ error, onRetry }) {
  const { t } = useI18n();
  if (!error) return null;
  return (
    <div className="alert bad row between" role="alert">
      <span>{errorText(t, error)}</span>
      {onRetry && <button className="btn small" onClick={onRetry}>{t('common.retry')}</button>}
    </div>
  );
}

export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      {title && <h3>{title}</h3>}
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Field({ label, hint, error, children, htmlFor }) {
  return (
    <label className="field" htmlFor={htmlFor}>
      <span className="label">{label}</span>
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="error">{error}</span>}
    </label>
  );
}

export function Modal({ open, title, onClose, children, footer, wide }) {
  const ref = useRef(null);
  const { t } = useI18n();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`modal${wide ? ' wide' : ''}`} onCancel={(e) => { e.preventDefault(); onClose?.(); }} aria-labelledby="modal-title">
      {open && (
        <>
          <div className="modal-head">
            <h2 id="modal-title">{title}</h2>
            {onClose && <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}><IconX /></button>}
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-foot">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

const STATUS_TONE = {
  scheduled: 'idle', assigned: 'info', in_progress: 'live', submitted: 'warn', rework: 'bad', admin_review: 'bad', approved: 'ok', cancelled: 'idle',
};
export const statusTone = (s) => STATUS_TONE[s] || 'idle';

export function StatusTag({ status }) {
  const { t } = useI18n();
  return <span className={`tag ${statusTone(status)}`}>{t(`status.${status}`)}</span>;
}

const ARRIVAL_TONE = { pending: 'warn', confirmed: 'ok', auto_confirmed: 'ok', disputed: 'bad' };
export function ArrivalTag({ status }) {
  const { t } = useI18n();
  if (!status) return null;
  return <span className={`tag ${ARRIVAL_TONE[status]}`}>{t(`arrival.${status}`)}</span>;
}

export function Progress({ done, total }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="row" style={{ gap: 8 }}>
      <div className="progress grow" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total}><span style={{ width: `${pct}%` }} /></div>
      <span className="small muted nowrap">{done}/{total}</span>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button key={tab.value} role="tab" aria-selected={value === tab.value} onClick={() => onChange(tab.value)}>
          {tab.label}{tab.count != null ? ` (${tab.count})` : ''}
        </button>
      ))}
    </div>
  );
}

export function Stars({ value, onChange }) {
  const { t } = useI18n();
  return (
    <div className="stars" role="group" aria-label={t('customer.rating')}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" aria-pressed={n <= (value || 0)} aria-label={`${n}/5`} onClick={() => onChange(n)}><IconStar /></button>
      ))}
    </div>
  );
}

/** Photo from the API, opened full size on click. */
export function MediaThumb({ id, src, caption }) {
  const [open, setOpen] = useState(false);
  const url = src || `/api/media/${id}`;
  return (
    <>
      <button type="button" className="thumb-btn" onClick={() => setOpen(true)}><img className="thumb" src={url} alt={caption || ''} loading="lazy" /></button>
      {open && (
        <div className="lightbox" role="dialog" aria-modal="true" onClick={() => setOpen(false)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} tabIndex={-1}>
          <div><img src={url} alt={caption || ''} />{caption && <div className="cap">{caption}</div>}</div>
        </div>
      )}
    </>
  );
}

/** Weekday picker, ISO numbering (1 = Monday). */
export function DayPicker({ value, onChange }) {
  const { t } = useI18n();
  const toggle = (d) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort());
  return (
    <div className="days">
      {[1, 2, 3, 4, 5, 6, 7].map((d) => (
        <button key={d} type="button" className="chip" aria-pressed={value.includes(d)} onClick={() => toggle(d)}>{t(`days.${d}`)}</button>
      ))}
    </div>
  );
}

// ---------- Toasts ----------
const ToastContext = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, tone) => {
    const id = Math.random();
    setItems((xs) => [...xs, { id, text, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((x) => <div key={x.id} className={`toast${x.tone === 'bad' ? ' bad' : ''}`}>{x.text}</div>)}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

/** Run an async action with busy state and error capture. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(async (fn) => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}

export function CopyBox({ value }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-box">
      <input className="input" readOnly value={value} onFocus={(e) => e.target.select()} />
      <button type="button" className="btn" onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); } catch { /* ignore */ } }}>
        {copied ? t('common.copied') : t('common.copy')}
      </button>
    </div>
  );
}
