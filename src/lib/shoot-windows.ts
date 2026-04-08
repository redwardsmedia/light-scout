import { type DayData, type SunPosition, interpolatePosition, formatTime, compassDirection } from "./sun-engine";
import { type WeatherData, getSkyAtTime, weatherClearnessScore, type SkyInfo } from "./weather";

export interface ShootWindow {
  startMs: number;
  endMs: number;
  startLabel: string;
  endLabel: string;
  score: number;
  sky: SkyInfo;
  description: string;
  compassDir: string;
  avgElevation: number;
}

/**
 * Score each 15-minute window and return top 3 grouped shoot blocks.
 *
 * The key insight: golden hour and warm light are dramatically better for
 * real estate photography than midday. The scoring must reflect that —
 * midday should NEVER appear as a "best" window unless weather forces it.
 */
export function computeShootWindows(
  dayData: DayData,
  weather: WeatherData | null
): ShootWindow[] {
  const { positions, times } = dayData;
  if (positions.length === 0) return [];

  const step = 15 * 60 * 1000; // 15 min
  const sunriseMs = times.sunrise.getTime();
  const sunsetMs = times.sunset.getTime();

  interface Slot {
    timeMs: number;
    score: number;
    pos: SunPosition;
    sky: SkyInfo;
  }

  const slots: Slot[] = [];

  for (let ms = sunriseMs; ms <= sunsetMs; ms += step) {
    const pos = interpolatePosition(positions, ms);
    if (!pos || pos.altitudeDeg < 0) continue;

    const sky = weather
      ? getSkyAtTime(weather, ms)
      : { condition: "clear" as const, label: "Clear", cloudLow: 0 };

    // --- Light quality score (0-1) ---
    // This is the primary factor. Golden hour is king.
    let lightScore = 0;
    const alt = pos.altitudeDeg;

    if (alt >= 0 && alt <= 6) {
      // Golden hour zone: peak score
      lightScore = 1.0;
    } else if (alt > 6 && alt <= 15) {
      // Warm light zone: very good
      lightScore = 0.8 - (alt - 6) * 0.04; // 0.8 → 0.44
    } else if (alt > 15 && alt <= 30) {
      // Decent directional light
      lightScore = 0.3 - (alt - 15) * 0.015; // 0.3 → 0.075
    } else {
      // High sun: flat, unflattering for facades
      lightScore = 0;
    }

    // Weather clearness (0-1)
    const clearScore = weatherClearnessScore(sky);

    // Time practicality (0-1): prefer 7am-7pm
    const hour = new Date(ms).getHours();
    let practScore = 0;
    if (hour >= 8 && hour <= 18) practScore = 1.0;
    else if (hour >= 7 || hour <= 19) practScore = 0.6;

    // Weighted total — light quality is the gate
    const totalScore =
      lightScore * 0.60 +
      clearScore * 0.25 +
      practScore * 0.15;

    slots.push({ timeMs: ms, score: totalScore, pos, sky });
  }

  // Group consecutive high-scoring slots into blocks
  // Higher threshold (0.4) so midday never qualifies on its own
  const threshold = 0.5;
  const blocks: Slot[][] = [];
  let currentBlock: Slot[] = [];

  for (const slot of slots) {
    if (slot.score >= threshold) {
      currentBlock.push(slot);
    } else {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock);
        currentBlock = [];
      }
    }
  }
  if (currentBlock.length > 0) blocks.push(currentBlock);

  // Convert blocks to ShootWindows
  const windows: ShootWindow[] = blocks.map((block) => {
    const avgScore = block.reduce((s, b) => s + b.score, 0) / block.length;
    const bestSlot = block.reduce((best, b) => (b.score > best.score ? b : best), block[0]);
    const avgElev = block.reduce((s, b) => s + b.pos.altitudeDeg, 0) / block.length;

    return {
      startMs: block[0].timeMs,
      endMs: block[block.length - 1].timeMs + step,
      startLabel: formatTime(new Date(block[0].timeMs)),
      endLabel: formatTime(new Date(block[block.length - 1].timeMs + step)),
      score: avgScore,
      sky: bestSlot.sky,
      description: describeWindow(bestSlot.pos, avgElev),
      compassDir: compassDirection(bestSlot.pos.azimuthDeg),
      avgElevation: avgElev,
    };
  });

  return windows.sort((a, b) => b.score - a.score).slice(0, 3);
}

function describeWindow(pos: SunPosition, avgElev: number): string {
  const dir = compassDirection(pos.azimuthDeg);

  if (avgElev < 6) {
    return `Golden hour light from the ${dir.toLowerCase()}`;
  }
  if (avgElev < 15) {
    return `Warm directional light from the ${dir.toLowerCase()}`;
  }
  if (avgElev < 30) {
    return `Good facade light, sun at ${avgElev.toFixed(0)}° from ${dir}`;
  }
  return `High sun, even lighting from ${dir}`;
}
