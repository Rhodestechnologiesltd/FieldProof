const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in metres between two lat/lng points (haversine). */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/**
 * BR-01: a check-in is Verified only when it is inside the site area and the GPS
 * accuracy is within the company limit.
 */
export function evaluatePosition({ lat, lng, accuracy }, site, company) {
  if (lat == null || lng == null || site.lat == null || site.lng == null) {
    return { distance: null, inside: false, verified: false };
  }
  const distance = Math.round(distanceMeters(lat, lng, site.lat, site.lng));
  const inside = distance <= (site.radius_m || company.default_radius_m);
  const accurate = accuracy != null && accuracy <= company.gps_accuracy_max_m;
  return { distance, inside, verified: inside && accurate };
}
