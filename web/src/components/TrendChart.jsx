// 14-day outcome chart: approved and rejected decisions per day, stacked (they sum to all decisions).
// Colours validated for colour-vision deficiency; legend + tooltip + hidden table so colour is never the only cue.
import { useState } from 'react';
import { useI18n } from '../i18n/index.jsx';

const APPROVED = '#3a7bb0';
const REJECTED = '#b42318';

export default function TrendChart({ days }) {
  const { t, fmt } = useI18n();
  const [hover, setHover] = useState(null);
  const W = 640; const H = 200; const left = 28; const bottom = 26; const top = 10;
  const max = Math.max(2, ...days.map((d) => d.approved + d.rejected));
  const step = Math.ceil(max / 4);
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
  const plotW = W - left - 8;
  const slot = plotW / days.length;
  const barW = Math.min(26, slot * 0.62);
  const y = (v) => top + (H - top - bottom) * (1 - v / (ticks.at(-1) || 1));
  const label = (d) => fmt.day(`${d.date}T08:00:00Z`);

  return (
    <figure style={{ margin: 0 }}>
      <div className="row small" style={{ gap: 16, marginBottom: 8 }} aria-hidden="true">
        <span className="row" style={{ gap: 6 }}><svg width="12" height="12"><rect width="12" height="12" rx="3" fill={APPROVED} /></svg>{t('dashboard.approved')}</span>
        <span className="row" style={{ gap: 6 }}><svg width="12" height="12"><rect width="12" height="12" rx="3" fill={REJECTED} /></svg>{t('dashboard.rejected')}</span>
      </div>
      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={t('dashboard.trendTitle')} style={{ display: 'block', direction: 'ltr' }}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={left} x2={W - 8} y1={y(v)} y2={y(v)} stroke={v === 0 ? '#b9c2c9' : '#e6eaed'} strokeWidth="1" />
              <text x={left - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#6b7a86">{v}</text>
            </g>
          ))}
          {days.map((d, i) => {
            const cx = left + slot * i + slot / 2;
            const x = cx - barW / 2;
            const yA = y(d.approved);
            const yR = y(d.approved + d.rejected);
            const gap = d.approved && d.rejected ? 2 : 0;
            return (
              <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={left + slot * i} y={top} width={slot} height={H - top - bottom} fill={hover === i ? '#f2f4f5' : 'transparent'} />
                {d.approved > 0 && <path d={bar(x, yA, barW, y(0) - yA, !d.rejected)} fill={APPROVED} />}
                {d.rejected > 0 && <path d={bar(x, yR, barW, yA - yR - gap, true)} fill={REJECTED} />}
                {(i % 2 === 0 || days.length < 8) && (
                  <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill="#6b7a86">{label(d).replace(/,.*$/, '')}</text>
                )}
              </g>
            );
          })}
        </svg>
        {hover != null && (
          <div className="small" role="tooltip" style={{
            position: 'absolute', top: 0, insetInlineStart: `${Math.min(78, (hover / days.length) * 100)}%`, background: '#1d2a33', color: '#fff',
            padding: '6px 10px', borderRadius: 6, pointerEvents: 'none', whiteSpace: 'nowrap',
          }}>
            <strong>{label(days[hover])}</strong><br />
            {t('dashboard.approved')}: {days[hover].approved} · {t('dashboard.rejected')}: {days[hover].rejected}
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>{t('dashboard.trendTitle')}</caption>
        <thead><tr><th>{t('common.date')}</th><th>{t('dashboard.approved')}</th><th>{t('dashboard.rejected')}</th></tr></thead>
        <tbody>{days.map((d) => <tr key={d.date}><td>{d.date}</td><td>{d.approved}</td><td>{d.rejected}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

// Bar with 4px rounded top, square base on the axis.
function bar(x, yTop, w, h, roundTop) {
  if (h <= 0) return '';
  const r = roundTop ? Math.min(4, h, w / 2) : 0;
  return `M${x},${yTop + h}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop + r}V${yTop + h}Z`;
}
