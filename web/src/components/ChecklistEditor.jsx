import { useI18n } from '../i18n/index.jsx';
import { IconUp, IconDown, IconTrash, IconPlus } from './icons.jsx';

const TYPES = ['tick', 'photo', 'note', 'number'];

/** Edit a checklist template: label, item type, required flag, order. */
export default function ChecklistEditor({ value, onChange }) {
  const { t } = useI18n();
  const update = (i, patch) => onChange(value.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const move = (i, d) => {
    const next = [...value];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    onChange(next);
  };
  return (
    <fieldset className="checklist-editor" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="label" style={{ fontWeight: 500, marginBottom: 4 }}>{t('checklist.title')}</legend>
      {value.length === 0 && <p className="small muted">{t('checklist.empty')}</p>}
      {value.map((it, i) => (
        <div className="ce-row" key={i}>
          <input className="input" aria-label={t('checklist.label')} placeholder={t('checklist.labelPlaceholder')} required value={it.label} onChange={(e) => update(i, { label: e.target.value })} />
          <select className="select" aria-label={t('checklist.type')} value={it.type} onChange={(e) => update(i, { type: e.target.value })}>
            {TYPES.map((x) => <option key={x} value={x}>{t(`itemType.${x}`)}</option>)}
          </select>
          <label className="check small"><input type="checkbox" checked={it.required} onChange={(e) => update(i, { required: e.target.checked })} />{t('common.required')}</label>
          <div className="row" style={{ gap: 2 }}>
            <button type="button" className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('checklist.moveUp')}><IconUp /></button>
            <button type="button" className="icon-btn" disabled={i === value.length - 1} onClick={() => move(i, 1)} aria-label={t('checklist.moveDown')}><IconDown /></button>
            <button type="button" className="icon-btn" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={t('common.delete')}><IconTrash /></button>
          </div>
        </div>
      ))}
      <button type="button" className="btn small" style={{ marginTop: 10 }} onClick={() => onChange([...value, { label: '', type: 'tick', required: true }])}><IconPlus />{t('checklist.add')}</button>
    </fieldset>
  );
}
