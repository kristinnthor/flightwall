export interface Config {
  lat: number;
  lon: number;
  radiusKm: number;
  label?: string;
  /** Minutes of flight path drawn on the map. 0 shows positions with no trail.
   *  Optional so configs saved before the map view existed stay valid. */
  trailMinutes?: number;
  /** Pin the aircraft feed to one base URL instead of trying the built-in
   *  list. Set it to test a source; leave unset for automatic failover. */
  apiBase?: string;
}

/** Normalized airborne aircraft (ground/positionless targets are filtered out upstream). */
export interface Aircraft {
  hex: string;
  callsign: string | null;
  registration: string | null;
  typeCode: string | null;
  altitudeFt: number;
  groundSpeedKt: number | null;
  verticalRateFpm: number | null;
  distanceKm: number;
  /** Bearing from the home point to the aircraft — NOT the aircraft's heading. */
  bearingDeg: number;
  /** True track over ground in degrees, when the feed reports it. */
  track: number | null;
  lat: number;
  lon: number;
}

export interface Route {
  airlineName: string | null;
  originCode: string | null;
  originCity: string | null;
  originLat: number | null;
  originLon: number | null;
  destCode: string | null;
  destCity: string | null;
  destLat: number | null;
  destLon: number | null;
}

export interface Photo {
  thumbnailUrl: string;
  pageLink: string;
  photographer: string;
}
