import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, useResource } from '../api.js';
import { useSession } from '../session.jsx';
import { useI18n } from '../i18n/index.jsx';
import { Field, ErrorBox, Loading, Empty, useAction } from '../components/ui.jsx';
import ChecklistEditor from '../components/ChecklistEditor.jsx';
import { zonedToIso, todayIn, addDays } from '../device.js';

export default function JobNew() {
  const { t } = useI18n();
  const { user, company } = useSession();
  const navigate = useNavigate();
  const customers = useResource('/customers');
  const services = useResource('/services');
  const supervisors = useResource('/people?role=supervisor', { skip: user.role !== 'admin' });
  const [f, setF] = useState({
    customerId: '', siteId: '', serviceId: '', title: '', notes: '',
    date: addDays(todayIn(company.timezone), 1), start: '08:00', end: '12:00',
    supervisorId: '', slaText: '', slaHours: '', payBasis: 'salary', payRate: 0,
    repeat: '', repeatCount: 4, checklist: [],
  });
  const { busy, error, run } = useAction();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const customer = useMemo(() => customers.data?.find((c) => String(c.id) === String(f.customerId)), [customers.data, f.customerId]);

  useEffect(() => {
    if (customer?.sites.length === 1) setF((x) => ({ ...x, siteId: String(customer.sites[0].id) }));
  }, [customer]);

  const pickService = (id) => {
    const s = services.data?.find((x) => String(x.id) === String(id));
    setF((x) => ({
      ...x, serviceId: id,
      checklist: s ? s.checklist : x.checklist,
      slaText: s?.slaText || '', slaHours: s?.slaHours ?? '',
      payBasis: s?.defaultPayBasis || 'salary', payRate: s?.defaultPayRate ?? 0,
    }));
  };

  if (customers.loading || services.loading) return <div className="content"><Loading /></div>;
  if (!customers.data?.length) {
    return <div className="content narrow"><div className="panel"><Empty title={t('jobNew.noCustomersTitle')} action={<Link className="btn primary" to="/customers">{t('jobNew.addCustomer')}</Link>}>{t('jobNew.noCustomersText')}</Empty></div></div>;
  }

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const tz = company.timezone;
      const job = await api('/jobs', {
        method: 'POST',
        body: {
          customerId: Number(f.customerId), siteId: Number(f.siteId), serviceId: f.serviceId ? Number(f.serviceId) : null,
          title: f.title || undefined, notes: f.notes || null,
          scheduledStart: zonedToIso(f.date, f.start, tz),
          scheduledEnd: zonedToIso(f.end <= f.start ? addDays(f.date, 1) : f.date, f.end, tz),
          supervisorId: f.supervisorId ? Number(f.supervisorId) : null,
          slaText: f.slaText || null, slaHours: f.slaHours === '' ? null : Number(f.slaHours),
          payBasis: f.payBasis, payRate: Number(f.payRate) || 0,
          checklist: f.checklist,
          repeat: f.repeat ? { every: f.repeat, count: Number(f.repeatCount) } : undefined,
        },
      });
      navigate(`/jobs/${job.id}`);
    }).catch(() => {});
  };

  return (
    <div className="content narrow">
      <div className="page-head"><div><h1>{t('jobNew.title')}</h1><p>{t('jobNew.subtitle')}</p></div></div>
      <form className="stack" onSubmit={submit}>
        <section className="panel"><div className="panel-body stack">
          <h2>{t('jobNew.whereWhat')}</h2>
          <div className="grid-2">
            <Field label={t('jobNew.customer')}>
              <select className="select" required value={f.customerId} onChange={(e) => setF((x) => ({ ...x, customerId: e.target.value, siteId: '' }))}>
                <option value="">{t('common.choose')}</option>
                {customers.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label={t('jobNew.site')} hint={customer && !customer.sites.length ? t('jobNew.noSites') : null}>
              <select className="select" required value={f.siteId} onChange={set('siteId')} disabled={!customer}>
                <option value="">{t('common.choose')}</option>
                {customer?.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid-2">
            <Field label={t('jobNew.service')} hint={t('jobNew.serviceHint')}>
              <select className="select" value={f.serviceId} onChange={(e) => pickService(e.target.value)}>
                <option value="">{t('jobNew.noService')}</option>
                {services.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label={t('jobNew.jobTitle')} hint={t('jobNew.jobTitleHint')}><input className="input" value={f.title} onChange={set('title')} maxLength={160} /></Field>
          </div>
        </div></section>

        <section className="panel"><div className="panel-body stack">
          <h2>{t('jobNew.when')}</h2>
          <div className="grid-3">
            <Field label={t('common.date')}><input className="input" type="date" required value={f.date} onChange={set('date')} /></Field>
            <Field label={t('common.start')}><input className="input" type="time" required value={f.start} onChange={set('start')} /></Field>
            <Field label={t('common.end')}><input className="input" type="time" required value={f.end} onChange={set('end')} /></Field>
          </div>
          <p className="small muted">{t('jobNew.timezoneNote', { tz: company.timezone })}</p>
          <div className="grid-2">
            <Field label={t('jobNew.repeat')}>
              <select className="select" value={f.repeat} onChange={set('repeat')}>
                <option value="">{t('jobNew.repeatNone')}</option>
                <option value="day">{t('jobNew.repeatDay')}</option>
                <option value="week">{t('jobNew.repeatWeek')}</option>
                <option value="month">{t('jobNew.repeatMonth')}</option>
              </select>
            </Field>
            {f.repeat && <Field label={t('jobNew.occurrences')}><input className="input" type="number" min={2} max={52} value={f.repeatCount} onChange={set('repeatCount')} /></Field>}
          </div>
        </div></section>

        <section className="panel"><div className="panel-body stack">
          <h2>{t('jobNew.teamPay')}</h2>
          {user.role === 'admin' && (
            <Field label={t('jobNew.supervisor')} hint={t('jobNew.supervisorHint')}>
              <select className="select" value={f.supervisorId} onChange={set('supervisorId')}>
                <option value="">{t('jobNew.assignLater')}</option>
                {supervisors.data?.filter((s) => s.status === 'active').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          )}
          <div className="grid-2">
            <Field label={t('pay.basisLabel')} hint={t('pay.basisHint')}>
              <select className="select" value={f.payBasis} onChange={set('payBasis')}>
                {['salary', 'hourly', 'daily', 'fixed'].map((b) => <option key={b} value={b}>{t(`pay.${b}`)}</option>)}
              </select>
            </Field>
            {f.payBasis !== 'salary' && (
              <Field label={t('pay.rateLabel', { currency: company.currency })}><input className="input" type="number" min={0} step="0.01" value={f.payRate} onChange={set('payRate')} /></Field>
            )}
          </div>
        </div></section>

        <section className="panel"><div className="panel-body stack">
          <h2>{t('jobNew.slaChecklist')}</h2>
          <div className="grid-2">
            <Field label={t('services.slaText')}><textarea className="textarea" value={f.slaText} onChange={set('slaText')} /></Field>
            <Field label={t('services.slaHours')} hint={t('services.slaHoursHint')}><input className="input" type="number" min={0} step="0.5" value={f.slaHours} onChange={set('slaHours')} /></Field>
          </div>
          <ChecklistEditor value={f.checklist} onChange={(checklist) => setF((x) => ({ ...x, checklist }))} />
          <Field label={t('jobNew.notes')} hint={t('jobNew.notesHint')}><textarea className="textarea" value={f.notes} onChange={set('notes')} /></Field>
        </div></section>

        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Link className="btn ghost" to="/jobs">{t('common.cancel')}</Link>
          <button className="btn primary" disabled={busy}>{f.repeat ? t('jobNew.createMany', { n: f.repeatCount }) : t('jobNew.create')}</button>
        </div>
      </form>
    </div>
  );
}
