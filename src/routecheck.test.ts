import { describe, it, expect } from 'vitest';
import { isRoutePlausible } from './routecheck';

// Real-world coordinates
const FRA = { lat: 50.0333, lon: 8.5706 };
const IVL = { lat: 68.6073, lon: 27.4053 };
const DTW = { lat: 42.2124, lon: -83.3534 };
const CDG = { lat: 49.0097, lon: 2.5479 };
const GRO = { lat: 41.901, lon: 2.7606 };   // Girona
const CMN = { lat: 33.3675, lon: -7.59 };   // Casablanca
const RKV = { lat: 64.13, lon: -21.9406 };  // Reykjavík domestic
const AEY = { lat: 65.66, lon: -18.0727 };  // Akureyri
const NEAR_KEF = { lat: 64.1, lon: -22.3 }; // aircraft position over SW Iceland

function route(o: { lat: number; lon: number }, d: { lat: number; lon: number }) {
  return { originLat: o.lat, originLon: o.lon, destLat: d.lat, destLon: d.lon };
}

describe('isRoutePlausible', () => {
  it('accepts a great-circle overflight (DTW→CDG passing Iceland)', () => {
    expect(isRoutePlausible(route(DTW, CDG), NEAR_KEF)).toBe(true);
  });

  it('rejects a route nowhere near the aircraft (Girona→Casablanca over Iceland)', () => {
    expect(isRoutePlausible(route(GRO, CMN), NEAR_KEF)).toBe(false);
  });

  it('rejects FRA→IVL for an aircraft descending at Keflavík', () => {
    expect(isRoutePlausible(route(FRA, IVL), NEAR_KEF)).toBe(false);
  });

  it('accepts a short domestic hop with lateral slack (RKV→AEY seen mid-route)', () => {
    const midway = { lat: 65.1, lon: -20.5 };
    expect(isRoutePlausible(route(RKV, AEY), midway)).toBe(true);
  });

  it('accepts endpoints themselves (aircraft at the destination)', () => {
    expect(isRoutePlausible(route(FRA, RKV), NEAR_KEF)).toBe(true);
  });

  it('degenerate same-airport route: accepts only nearby aircraft', () => {
    expect(isRoutePlausible(route(RKV, RKV), NEAR_KEF)).toBe(true);   // ~20 km away
    expect(isRoutePlausible(route(GRO, GRO), NEAR_KEF)).toBe(false);  // ~3000 km away
  });

  it('gives benefit of the doubt when coordinates are missing', () => {
    expect(isRoutePlausible({ originLat: null, originLon: null, destLat: CDG.lat, destLon: CDG.lon }, NEAR_KEF)).toBe(true);
  });
});
