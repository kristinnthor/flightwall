const R_EARTH_KM = 6371;
const toRad = (d: number): number => (d * Math.PI) / 180;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.sqrt(a));
}

export function initialBearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Kilometres east/north of (lat0, lon0) — equirectangular approximation for a
 * scope centred on the home point. East is +x, north is +y; screen-space y is
 * flipped by the caller, not here.
 *
 * Longitude is scaled by the cosine of the MEAN latitude rather than of lat0.
 * Using lat0 alone keeps the map linear in lon but overstates east-west
 * distance for targets well north or south of home (~2% at 300 km in Iceland's
 * latitudes); the mean-latitude form holds within ~0.1% across the whole 460 km
 * config range.
 */
export function projectLocalKm(
  lat0: number,
  lon0: number,
  lat: number,
  lon: number,
): { xKm: number; yKm: number } {
  // Normalize into [-180, 180) so a scope straddling the antimeridian does not
  // project targets most of the way around the globe.
  const dLon = ((((lon - lon0 + 180) % 360) + 360) % 360) - 180;
  const meanLat = toRad((lat0 + lat) / 2);
  return {
    xKm: toRad(dLon) * R_EARTH_KM * Math.cos(meanLat),
    yKm: toRad(lat - lat0) * R_EARTH_KM,
  };
}
