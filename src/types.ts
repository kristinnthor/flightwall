export interface Config {
  lat: number;
  lon: number;
  radiusKm: number;
  label?: string;
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
  bearingDeg: number;
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
