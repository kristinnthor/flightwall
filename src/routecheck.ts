import { haversineKm } from './geo';

interface RouteEndpoints {
  originLat: number | null;
  originLon: number | null;
  destLat: number | null;
  destLon: number | null;
}

// A route is plausible when the aircraft lies roughly on the corridor between
// the two airports: detour factor ≤ 1.25, with an absolute slack floor so
// short hops aren't rejected for normal lateral deviation. Same-airport
// routes (positioning/sightseeing) just require the aircraft to be nearby.
const DETOUR_FACTOR = 1.25;
const SLACK_KM = 400;

export function isRoutePlausible(
  route: RouteEndpoints,
  pos: { lat: number; lon: number },
): boolean {
  const { originLat, originLon, destLat, destLon } = route;
  if (originLat === null || originLon === null || destLat === null || destLon === null) {
    return true; // cannot disprove without coordinates
  }
  const dOD = haversineKm(originLat, originLon, destLat, destLon);
  const dOP = haversineKm(originLat, originLon, pos.lat, pos.lon);
  const dPD = haversineKm(pos.lat, pos.lon, destLat, destLon);
  return dOP + dPD <= Math.max(dOD * DETOUR_FACTOR, dOD + SLACK_KM);
}
