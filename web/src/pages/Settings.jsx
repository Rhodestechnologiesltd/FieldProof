import { useEffect, useState } from 'react';
import { api, useResource } from '../api.js';
import { useSession } from '../session.jsx';
import { useI18n, LANGUAGES } from '../i18n/index.jsx';
import { Field, ErrorBox, Loading, useAction, useToast } from '../components/ui.jsx';

const RULES = [
  ['default_radius_m', 20, 5000],
  ['gps_accuracy_max_m', 10, 1000],
  ['checkin_early_min', 0, 720],
  ['late_grace_min', 0, 240],
  ['arrival_autoconfirm_min', 5, 1440],
  ['approval_autoapprove_hours', 1, 720],
  ['max_rework', 0, 10],
];

export default function Settings() {
  const { t } = useI18n();
  const { refresh } = useSession();
  const toast = useToast();
  const { data, loading, error } = useResource('/company');
  const [f, setF] = useState(null);
  const save = useAction();
  useEffect(() => { if (data) setF(data); }, [data]);
  if (loading || !f) return <div className="content"><Loading /><ErrorBox error={error} /></div>;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = (e) => {
    e.preventDefault();
    save.run(async () => {
      const body = { name: f.name, timezone: f.timezone, currency: f.currency, default_lang: f.default_lang };
      for (const [k] of RULES) body[k] = Number(f[k]);
      setF(await api('/company', { method: 'PATCH', body }));
      await refresh();
      toast(t('common.saved'));
    }).catch(() => {});
  };

  return (
    <div className="content narrow">
      <div className="page-head"><div><h1>{t('settings.title')}</h1><p>{t('settings.subtitle')}</p></div></div>
      <form className="stack" onSubmit={submit}>
        <section className="panel"><div className="panel-body stack">
          <h2>{t('settings.company')}</h2>
          <Field label={t('settings.name')}><input className="input" value={f.name} onChange={set('name')} /></Field>
          <div className="grid-3">
            <Field label={t('settings.timezone')} hint={t('settings.timezoneHint')}><input className="input" value={f.timezone} onChange={set('timezone')} /></Field>
            <Field label={t('settings.currency')}><input className="input" maxLength={3} value={f.currency} onChange={set('currency')} /></Field>
            <Field label={t('settings.language')}>
              <select className="select" value={f.default_lang} onChange={set('default_lang')}>{LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</select>
            </Field>
          </div>
        </div></section>
        <section className="panel"><div className="panel-body stack">
          <div><h2>{t('settings.rules')}</h2><p className="muted small" style={{ margin: '4px 0 0' }}>{t('settings.rulesText')}</p></div>
          <div className="grid-2">
            {RULES.map(([k, min, max]) => (
              <Field key={k} label={t(`settings.${k}`)} hint={t(`settings.${k}_hint`)}>
                <input className="input" type="number" min={min} max={max} value={f[k]} onChange={set(k)} />
              </Field>
            ))}
          </div>
        </div></section>
        <ErrorBox error={save.error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" disabled={save.busy}>{t('settings.save')}</button></div>
      </form>
    </div>
  );
}
