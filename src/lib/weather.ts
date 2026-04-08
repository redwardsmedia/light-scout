export interface HourlyWeather {
  time: string; // ISO timestamp
  cloudcover: number;
  cloudcover_low: number;
  cloudcover_mid: number;
  cloudcover_high: number;
  precipitation_probability: number;
}

export interface WeatherData {
  hourly: HourlyWeather[];
  timezone: string;
}

export type SkyCondition = "clear" | "partly_cloudy" | "cloudy" | "overcast";

export interface SkyInfo {
  condition: SkyCondition;
  label: string;
  cloudLow: number;
  warning?: string;
}

/**
 * Fetch hourly weather from Open-Meteo (free, no API key).
 */
export async function fetchWeather(
  lat: number,
  lng: number,
  date: Date
): Promise<WeatherData | null> {
  const dateStr = date.toISOString().split("T")[0];
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=cloudcover,cloudcover_low,cloudcover_mid,cloudcover_high,precipitation_probability&timezone=auto&start_date=${dateStr}&end_date=${dateStr}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();

    const hourly: HourlyWeather[] = data.hourly.time.map(
      (t: string, i: number) => ({
        time: t,
        cloudcover: data.hourly.cloudcover[i],
        cloudcover_low: data.hourly.cloudcover_low[i],
        cloudcover_mid: data.hourly.cloudcover_mid[i],
        cloudcover_high: data.hourly.cloudcover_high[i],
        precipitation_probability: data.hourly.precipitation_probability[i],
      })
    );

    return { hourly, timezone: data.timezone };
  } catch {
    return null;
  }
}

/**
 * Get sky condition for a given time by interpolating hourly weather data.
 */
export function getSkyAtTime(
  weather: WeatherData,
  timeMs: number
): SkyInfo {
  const targetDate = new Date(timeMs);
  const targetHour = targetDate.getHours();

  // Find the closest hourly entry
  let closest = weather.hourly[0];
  for (const h of weather.hourly) {
    const hDate = new Date(h.time);
    if (hDate.getHours() <= targetHour) {
      closest = h;
    }
  }

  const cloudLow = closest.cloudcover_low;

  if (cloudLow < 30) {
    return { condition: "clear", label: "Clear", cloudLow };
  } else if (cloudLow < 60) {
    return { condition: "partly_cloudy", label: "Partly cloudy", cloudLow };
  } else if (cloudLow < 80) {
    return {
      condition: "cloudy",
      label: "Low clouds",
      cloudLow,
      warning: "Golden hour may be flat",
    };
  } else {
    return {
      condition: "overcast",
      label: "Overcast",
      cloudLow,
      warning: "Consider rescheduling",
    };
  }
}

/**
 * Get weather clearness score 0-1 for the shoot windows algorithm.
 */
export function weatherClearnessScore(sky: SkyInfo): number {
  if (sky.condition === "clear") return 1.0;
  if (sky.condition === "partly_cloudy") return 0.7;
  if (sky.condition === "cloudy") return 0.3;
  return 0.1;
}
