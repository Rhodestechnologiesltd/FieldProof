// Device helpers: GPS position, photo compression, time-zone conversion.

/** One GPS reading. Throws { code: 'LOCATION_DENIED' | 'LOCATION_UNAVAILABLE' }. */
export function getPosition({ timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject({ code: 'LOCATION_UNAVAILABLE' });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      (err) => reject({ code: err.code === 1 ? 'LOCATION_DENIED' : 'LOCATION_UNAVAILABLE' }),
      { enableHighAccuracy: true, timeout, maximumAge: 10000 },
    );
  });
}

/** Resize and re-encode a photo to about 300 KB (NFR-05). */
export async function compressPhoto(file, maxSide = 1600, quality = 0.72) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    let q = quality;
    let blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
    while (blob && blob.size > 350_000 && q > 0.4) {
      q -= 0.1;
      blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
    }
    return blob || file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function tzOffsetMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return Math.round((Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - date.getTime()) / 60000);
}

/** Wall-clock date + time in the company's time zone -> ISO instant. */
export function zonedToIso(dateStr, timeStr, timeZone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const offset = tzOffsetMinutes(guess, timeZone);
  return new Date(guess.getTime() - offset * 60000).toISOString();
}

/** ISO instant -> { date: 'YYYY-MM-DD', time: 'HH:MM' } in the company's time zone. */
export function isoToZoned(iso, timeZone) {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return { date, time };
}

export const todayIn = (timeZone) => isoToZoned(new Date().toISOString(), timeZone).date;

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const directionsUrl = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
