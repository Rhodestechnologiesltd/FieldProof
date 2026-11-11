/** Offset in minutes of `timeZone` from UTC at the given instant (e.g. +240 for Mauritius). */
export function tzOffsetMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** UTC instant of local midnight for a YYYY-MM-DD date in `timeZone`. */
export function localDayStartUtc(dateStr, timeZone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d));
  const offset = tzOffsetMinutes(guess, timeZone);
  return new Date(guess.getTime() - offset * 60000);
}

/** YYYY-MM-DD of an instant in `timeZone`. */
export function localDate(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** [startUtc, endUtc) for a pay period 'YYYY-MM' in `timeZone`. */
export function monthRange(period, timeZone) {
  const [y, m] = period.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return [localDayStartUtc(`${period}-01`, timeZone), localDayStartUtc(next, timeZone)];
}

export function currentPeriod(now, timeZone) {
  return localDate(now, timeZone).slice(0, 7);
}

export const iso = (date) => date.toISOString();
export const addMinutes = (date, minutes) => new Date(date.getTime() + minutes * 60000);
