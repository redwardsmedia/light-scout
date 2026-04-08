import SunCalc from "suncalc";

export interface SunPosition {
  time: number; // epoch ms
  azimuth: number; // radians, 0=south, clockwise
  altitude: number; // radians, negative = below horizon
  azimuthDeg: number; // degrees, 0=north, clockwise (compass bearing)
  altitudeDeg: number; // degrees
}

export interface SunTimes {
  sunrise: Date;
  sunset: Date;
  solarNoon: Date;
  goldenHourStart: Date; // evening golden hour start
  goldenHourEnd: Date; // evening golden hour end
  goldenHourMorningStart: Date;
  goldenHourMorningEnd: Date;
  dawn: Date;
  dusk: Date;
}

export interface LightZone {
  name: "warm_light" | "golden_hour" | "twilight";
  label: string;
  start: Date;
  end: Date;
  period: "morning" | "evening";
}

export interface DayData {
  positions: SunPosition[]; // 144 positions (every 5 min, ~12 hrs)
  times: SunTimes;
  lightZones: LightZone[];
  lat: number;
  lng: number;
  date: Date;
}

/**
 * Convert SunCalc azimuth (0=south, clockwise) to compass bearing (0=north, clockwise)
 */
function toCompassBearing(azimuthRad: number): number {
  let deg = (azimuthRad * 180) / Math.PI + 180;
  if (deg >= 360) deg -= 360;
  return deg;
}

/**
 * Precompute 144+ sun positions for the given day.
 * Iterates from sunrise-30min to sunset+30min in 5-min steps using epoch arithmetic (DST-safe).
 */
export function computeDayData(
  lat: number,
  lng: number,
  date: Date
): DayData {
  // Get sun times for the day
  const times = SunCalc.getTimes(date, lat, lng);

  // Build our SunTimes
  const sunTimes: SunTimes = {
    sunrise: times.sunrise,
    sunset: times.sunset,
    solarNoon: times.solarNoon,
    goldenHourStart: times.goldenHour,
    goldenHourEnd: times.sunset,
    goldenHourMorningStart: times.sunrise,
    goldenHourMorningEnd: times.goldenHourEnd,
    dawn: times.dawn,
    dusk: times.dusk,
  };

  // Iterate from 30 min before sunrise to 30 min after sunset, 5-min steps
  const startMs = times.dawn.getTime() - 30 * 60 * 1000;
  const endMs = times.dusk.getTime() + 30 * 60 * 1000;
  const stepMs = 5 * 60 * 1000; // 5 minutes

  const positions: SunPosition[] = [];
  for (let ms = startMs; ms <= endMs; ms += stepMs) {
    const t = new Date(ms);
    const pos = SunCalc.getPosition(t, lat, lng);
    positions.push({
      time: ms,
      azimuth: pos.azimuth,
      altitude: pos.altitude,
      azimuthDeg: toCompassBearing(pos.azimuth),
      altitudeDeg: (pos.altitude * 180) / Math.PI,
    });
  }

  // Compute light zones by iterating 1-min steps
  const lightZones = computeLightZones(lat, lng, times);

  return {
    positions,
    times: sunTimes,
    lightZones,
    lat,
    lng,
    date,
  };
}

/**
 * Custom light zones: Warm Light (2-10 deg), Golden Hour (-1 to 6 deg), Twilight (-6 to -1 deg)
 * Scanned in 1-minute steps for accuracy.
 */
function computeLightZones(
  lat: number,
  lng: number,
  times: SunCalc.GetTimesResult
): LightZone[] {
  const zones: LightZone[] = [];
  const oneMin = 60 * 1000;

  // Evening zones: scan from solar noon to dusk+30min
  const eveningStart = times.solarNoon.getTime();
  const eveningEnd = times.dusk.getTime() + 30 * oneMin;

  let warmStart: number | null = null;
  let warmEnd: number | null = null;
  let goldenStart: number | null = null;
  let goldenEnd: number | null = null;
  let twilightStart: number | null = null;
  let twilightEnd: number | null = null;

  for (let ms = eveningStart; ms <= eveningEnd; ms += oneMin) {
    const pos = SunCalc.getPosition(new Date(ms), lat, lng);
    const altDeg = (pos.altitude * 180) / Math.PI;

    // Warm Light: 2 to 10 degrees (descending)
    if (altDeg <= 10 && altDeg >= 2) {
      if (warmStart === null) warmStart = ms;
      warmEnd = ms;
    }
    // Golden Hour: -1 to 6 degrees
    if (altDeg <= 6 && altDeg >= -1) {
      if (goldenStart === null) goldenStart = ms;
      goldenEnd = ms;
    }
    // Twilight: -6 to -1 degrees
    if (altDeg <= -1 && altDeg >= -6) {
      if (twilightStart === null) twilightStart = ms;
      twilightEnd = ms;
    }
  }

  if (warmStart && warmEnd) {
    zones.push({
      name: "warm_light",
      label: "Warm Light",
      start: new Date(warmStart),
      end: new Date(warmEnd),
      period: "evening",
    });
  }
  if (goldenStart && goldenEnd) {
    zones.push({
      name: "golden_hour",
      label: "Golden Hour",
      start: new Date(goldenStart),
      end: new Date(goldenEnd),
      period: "evening",
    });
  }
  if (twilightStart && twilightEnd) {
    zones.push({
      name: "twilight",
      label: "Blue Hour",
      start: new Date(twilightStart),
      end: new Date(twilightEnd),
      period: "evening",
    });
  }

  // Morning zones: scan from dawn-30min to solar noon
  const morningStart = times.dawn.getTime() - 30 * oneMin;
  const morningEnd = times.solarNoon.getTime();

  let mTwilightStart: number | null = null;
  let mTwilightEnd: number | null = null;
  let mGoldenStart: number | null = null;
  let mGoldenEnd: number | null = null;
  let mWarmStart: number | null = null;
  let mWarmEnd: number | null = null;

  for (let ms = morningStart; ms <= morningEnd; ms += oneMin) {
    const pos = SunCalc.getPosition(new Date(ms), lat, lng);
    const altDeg = (pos.altitude * 180) / Math.PI;

    if (altDeg >= -6 && altDeg <= -1) {
      if (mTwilightStart === null) mTwilightStart = ms;
      mTwilightEnd = ms;
    }
    if (altDeg >= -1 && altDeg <= 6) {
      if (mGoldenStart === null) mGoldenStart = ms;
      mGoldenEnd = ms;
    }
    if (altDeg >= 2 && altDeg <= 10) {
      if (mWarmStart === null) mWarmStart = ms;
      mWarmEnd = ms;
    }
  }

  if (mTwilightStart && mTwilightEnd) {
    zones.push({
      name: "twilight",
      label: "Blue Hour",
      start: new Date(mTwilightStart),
      end: new Date(mTwilightEnd),
      period: "morning",
    });
  }
  if (mGoldenStart && mGoldenEnd) {
    zones.push({
      name: "golden_hour",
      label: "Golden Hour",
      start: new Date(mGoldenStart),
      end: new Date(mGoldenEnd),
      period: "morning",
    });
  }
  if (mWarmStart && mWarmEnd) {
    zones.push({
      name: "warm_light",
      label: "Warm Light",
      start: new Date(mWarmStart),
      end: new Date(mWarmEnd),
      period: "morning",
    });
  }

  return zones;
}

/**
 * Interpolate sun position from precomputed array for 60fps scrubbing.
 */
export function interpolatePosition(
  positions: SunPosition[],
  timeMs: number
): SunPosition | null {
  if (positions.length === 0) return null;
  if (timeMs <= positions[0].time) return positions[0];
  if (timeMs >= positions[positions.length - 1].time)
    return positions[positions.length - 1];

  // Binary search for bracket
  let lo = 0;
  let hi = positions.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (positions[mid].time <= timeMs) lo = mid;
    else hi = mid;
  }

  const a = positions[lo];
  const b = positions[hi];
  const t = (timeMs - a.time) / (b.time - a.time);

  return {
    time: timeMs,
    azimuth: a.azimuth + (b.azimuth - a.azimuth) * t,
    altitude: a.altitude + (b.altitude - a.altitude) * t,
    azimuthDeg: a.azimuthDeg + (b.azimuthDeg - a.azimuthDeg) * t,
    altitudeDeg: a.altitudeDeg + (b.altitudeDeg - a.altitudeDeg) * t,
  };
}

/**
 * Format time for display using Intl (DST-safe).
 */
export function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/**
 * Get compass direction label from degrees.
 */
export function compassDirection(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const idx = Math.round(deg / 22.5) % 16;
  return dirs[idx];
}
