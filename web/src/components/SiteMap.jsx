// Leaflet map of a site and its check-in area. In picker mode, a click or drag moves the pin.
import { useEffect, useRef } from 'react';
import L from 'leaflet';

const MAURITIUS = [-20.25, 57.55];

export default function SiteMap({ lat, lng, radius, points = [], onPick, tall, label }) {
  const el = useRef(null);
  const map = useRef(null);
  const layers = useRef(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    if (!el.current || map.current) return undefined;
    map.current = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: Boolean(onPick) })
      .setView(lat != null ? [lat, lng] : MAURITIUS, lat != null ? 16 : 10);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map.current);
    layers.current = L.layerGroup().addTo(map.current);
    if (onPick) map.current.on('click', (e) => pickRef.current?.(e.latlng.lat, e.latlng.lng));
    return () => { map.current?.remove(); map.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pointsKey = JSON.stringify(points);
  useEffect(() => {
    if (!map.current) return;
    const group = layers.current;
    group.clearLayers();
    const bounds = [];
    if (lat != null && lng != null) {
      L.circle([lat, lng], { radius: radius || 100, color: '#1d2a33', weight: 1.5, fillColor: '#f2b705', fillOpacity: 0.18 }).addTo(group);
      const pin = L.circleMarker([lat, lng], { radius: 8, color: '#1d2a33', weight: 3, fillColor: '#f2b705', fillOpacity: 1 }).addTo(group);
      if (label) pin.bindTooltip(label);
      bounds.push([lat, lng]);
    }
    for (const p of points) {
      if (p.lat == null) continue;
      L.circleMarker([p.lat, p.lng], {
        radius: 6, color: '#fff', weight: 2, fillColor: p.ok ? '#1f7a4d' : '#a6510a', fillOpacity: 1,
      }).bindTooltip(p.label || '').addTo(group);
      bounds.push([p.lat, p.lng]);
    }
    if (bounds.length > 1) map.current.fitBounds(bounds, { padding: [36, 36], maxZoom: 17 });
    else if (bounds.length === 1) map.current.setView(bounds[0], Math.max(map.current.getZoom(), 15));
  }, [lat, lng, radius, pointsKey, label]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className={`map${tall ? ' tall' : ''}`} />;
}
