"use client";

import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import {
  computeDayData,
  interpolatePosition,
  formatTime,
  compassDirection,
  type DayData,
  type SunPosition,
} from "@/lib/sun-engine";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
mapboxgl.accessToken = MAPBOX_TOKEN;

interface MapViewProps {
  lat: number;
  lng: number;
  name: string;
  date: Date;
  onDateChange: (date: Date) => void;
  onBack: () => void;
}

type SheetPosition = "peek" | "half" | "full";

export default function MapView({
  lat,
  lng,
  name,
  date,
  onDateChange,
  onBack,
}: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);

  const [sheetPosition, setSheetPosition] = useState<SheetPosition>("peek");
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(Date.now());
  const [isPlaying, setIsPlaying] = useState(false);
  const playRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Precompute sun data for the day
  const dayData: DayData = useMemo(() => computeDayData(lat, lng, date), [lat, lng, date]);

  // Current interpolated position
  const currentPos: SunPosition | null = useMemo(
    () => interpolatePosition(dayData.positions, currentTimeMs),
    [dayData.positions, currentTimeMs]
  );

  // Time range for scrubber
  const timeRange = useMemo(() => {
    if (dayData.positions.length === 0) return { min: 0, max: 1 };
    return {
      min: dayData.positions[0].time,
      max: dayData.positions[dayData.positions.length - 1].time,
    };
  }, [dayData.positions]);

  // Clamp current time to range on data change
  useEffect(() => {
    const now = Date.now();
    if (now >= timeRange.min && now <= timeRange.max) {
      setCurrentTimeMs(now);
    } else {
      // Default to solar noon if "now" is outside the day range
      setCurrentTimeMs(dayData.times.solarNoon.getTime());
    }
  }, [timeRange, dayData.times.solarNoon]);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: [lng, lat],
      zoom: 17,
      pitch: 45,
      bearing: 0,
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    // Property marker
    const marker = new mapboxgl.Marker({
      color: "#d4a04a",
    })
      .setLngLat([lng, lat])
      .addTo(map);

    markerRef.current = marker;
    mapRef.current = map;

    // Fly to location
    map.once("load", () => {
      map.flyTo({
        center: [lng, lat],
        zoom: 18,
        pitch: 50,
        duration: 2000,
        essential: true,
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [lat, lng]);

  // Update light wedge on map when time changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !currentPos || currentPos.altitudeDeg < -1) return;

    // Create a directional wedge showing where light comes from
    const sunAzRad = currentPos.azimuth; // SunCalc: 0=south, CW
    // Convert to map bearing: mapbox uses 0=north, CW
    const mapBearing = (currentPos.azimuthDeg + 180) % 360; // direction FROM sun

    const wedgeLength = 0.002; // ~200m in degrees
    const wedgeSpread = 0.0008;
    const fromAz = (mapBearing * Math.PI) / 180;

    const tip1Lng = lng + wedgeLength * Math.sin(fromAz - 0.3);
    const tip1Lat = lat + wedgeLength * Math.cos(fromAz - 0.3);
    const tip2Lng = lng + wedgeLength * Math.sin(fromAz + 0.3);
    const tip2Lat = lat + wedgeLength * Math.cos(fromAz + 0.3);

    const wedgeGeoJSON: GeoJSON.Feature = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[[lng, lat], [tip1Lng, tip1Lat], [tip2Lng, tip2Lat], [lng, lat]]],
      },
      properties: {},
    };

    // Determine color based on altitude
    let color = "rgba(255, 200, 80, 0.15)"; // warm gold default
    if (currentPos.altitudeDeg > 30) {
      color = "rgba(255, 255, 200, 0.08)"; // neutral at midday
    } else if (currentPos.altitudeDeg < 2) {
      color = "rgba(80, 120, 200, 0.12)"; // cool blue at twilight
    }

    const source = map.getSource("light-wedge") as mapboxgl.GeoJSONSource;
    if (source) {
      source.setData(wedgeGeoJSON);
      map.setPaintProperty("light-wedge-fill", "fill-color", color);
    } else {
      // Only add if map is loaded
      if (map.isStyleLoaded()) {
        map.addSource("light-wedge", {
          type: "geojson",
          data: wedgeGeoJSON,
        });
        map.addLayer({
          id: "light-wedge-fill",
          type: "fill",
          source: "light-wedge",
          paint: {
            "fill-color": color,
            "fill-opacity": 0.6,
          },
        });
      }
    }
  }, [currentPos, lat, lng]);

  // Play/pause animation
  const togglePlay = useCallback(() => {
    if (isPlaying) {
      if (playRef.current) clearInterval(playRef.current);
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      const stepMs = 5 * 60 * 1000; // 5 min per tick
      playRef.current = setInterval(() => {
        setCurrentTimeMs((prev) => {
          const next = prev + stepMs;
          if (next > timeRange.max) {
            clearInterval(playRef.current);
            setIsPlaying(false);
            return timeRange.min;
          }
          return next;
        });
      }, 50); // 20fps = ~10x speed
    }
  }, [isPlaying, timeRange]);

  // Cleanup play interval
  useEffect(() => {
    return () => {
      if (playRef.current) clearInterval(playRef.current);
    };
  }, []);

  // Sheet heights
  const sheetHeightClass =
    sheetPosition === "full"
      ? "h-[70vh]"
      : sheetPosition === "half"
      ? "h-[40vh]"
      : "h-[160px]";

  const dateStr = date.toISOString().split("T")[0];

  // Light zones for display
  const eveningZones = dayData.lightZones.filter((z) => z.period === "evening");
  const morningZones = dayData.lightZones.filter((z) => z.period === "morning");

  // "Now" marker position as percentage
  const nowMs = Date.now();
  const nowPct =
    timeRange.max > timeRange.min
      ? ((nowMs - timeRange.min) / (timeRange.max - timeRange.min)) * 100
      : 0;
  const showNowMarker = nowPct >= 0 && nowPct <= 100;

  return (
    <div className="relative h-full flex flex-col">
      {/* Map */}
      <div ref={mapContainer} className="absolute inset-0" />

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-3 px-4 py-3 bg-gradient-to-b from-zinc-950/80 to-transparent">
        <button
          onClick={onBack}
          className="p-2 rounded-lg bg-zinc-900/60 hover:bg-zinc-800/80 transition-colors backdrop-blur-sm"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{name}</p>
        </div>
        <input
          type="date"
          value={dateStr}
          onChange={(e) => {
            const parts = e.target.value.split("-");
            const d = new Date(
              parseInt(parts[0]),
              parseInt(parts[1]) - 1,
              parseInt(parts[2]),
              12,
              0,
              0
            );
            onDateChange(d);
          }}
          className="px-3 py-1.5 bg-zinc-900/60 border border-zinc-700/40 rounded-lg
            text-white text-xs outline-none focus:border-amber-500/50
            [color-scheme:dark] backdrop-blur-sm"
        />
      </div>

      {/* Bottom sheet */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-20 bg-zinc-900/95 backdrop-blur-xl
          border-t border-zinc-700/40 rounded-t-2xl transition-all duration-300 ease-out
          ${sheetHeightClass} flex flex-col`}
      >
        {/* Drag handle */}
        <button
          onClick={() => {
            if (sheetPosition === "peek") setSheetPosition("half");
            else if (sheetPosition === "half") setSheetPosition("full");
            else setSheetPosition("peek");
          }}
          className="w-full flex justify-center py-2 cursor-pointer"
        >
          <div className="w-10 h-1 rounded-full bg-zinc-600" />
        </button>

        {/* Time scrubber — always visible */}
        <div className="px-4 pb-2">
          <div className="flex items-center gap-3">
            {/* Play/pause */}
            <button
              onClick={togglePlay}
              className="p-2 rounded-full bg-zinc-800 hover:bg-zinc-700 transition-colors flex-shrink-0"
            >
              {isPlaying ? (
                <svg
                  className="w-4 h-4 text-amber-400"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              ) : (
                <svg
                  className="w-4 h-4 text-amber-400"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            {/* Scrubber track */}
            <div className="flex-1 relative">
              <input
                type="range"
                min={timeRange.min}
                max={timeRange.max}
                value={currentTimeMs}
                onChange={(e) => setCurrentTimeMs(parseInt(e.target.value))}
                className="time-scrubber w-full"
                style={{
                  background: `linear-gradient(to right,
                    #b87333 0%,
                    #d4a04a 15%,
                    #e8d5a8 30%,
                    #ffffff 50%,
                    #e8d5a8 70%,
                    #d4a04a 85%,
                    #b87333 100%)`,
                }}
              />
              {/* "Now" marker */}
              {showNowMarker && (
                <div
                  className="absolute top-0 h-full flex flex-col items-center pointer-events-none"
                  style={{ left: `${nowPct}%` }}
                >
                  <div className="w-px h-full bg-white/40" />
                  <span className="text-[9px] text-zinc-400 mt-0.5">now</span>
                </div>
              )}
            </div>

            {/* Current time display */}
            <span className="text-sm font-mono text-amber-400 flex-shrink-0 w-20 text-right">
              {formatTime(new Date(currentTimeMs))}
            </span>
          </div>
        </div>

        {/* Peek data — elevation + direction */}
        <div className="px-4 pb-2 flex items-center gap-4 text-xs text-zinc-400">
          {currentPos && (
            <>
              <span>
                Elevation:{" "}
                <span className="text-white font-medium">
                  {currentPos.altitudeDeg.toFixed(1)}°
                </span>
              </span>
              <span>
                Direction:{" "}
                <span className="text-white font-medium">
                  {compassDirection(currentPos.azimuthDeg)} (
                  {currentPos.azimuthDeg.toFixed(0)}°)
                </span>
              </span>
              {currentPos.altitudeDeg < 0 && (
                <span className="text-blue-400">Below horizon</span>
              )}
            </>
          )}
        </div>

        {/* Expanded content (half + full) */}
        {sheetPosition !== "peek" && (
          <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
            {/* Key times */}
            <div>
              <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                Key Times —{" "}
                {date.toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <TimeCard
                  label="Sunrise"
                  time={formatTime(dayData.times.sunrise)}
                  icon="🌅"
                />
                <TimeCard
                  label="Solar Noon"
                  time={formatTime(dayData.times.solarNoon)}
                  icon="☀️"
                />
                <TimeCard
                  label="Sunset"
                  time={formatTime(dayData.times.sunset)}
                  icon="🌇"
                />
                <TimeCard
                  label="Dawn"
                  time={formatTime(dayData.times.dawn)}
                  icon="🌄"
                />
              </div>
            </div>

            {/* Evening light zones */}
            {eveningZones.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                  Evening Light Windows
                </h3>
                <div className="space-y-2">
                  {eveningZones.map((zone, i) => (
                    <ZoneCard key={i} zone={zone} />
                  ))}
                </div>
              </div>
            )}

            {/* Morning light zones */}
            {morningZones.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                  Morning Light Windows
                </h3>
                <div className="space-y-2">
                  {morningZones.map((zone, i) => (
                    <ZoneCard key={i} zone={zone} />
                  ))}
                </div>
              </div>
            )}

            {/* Full: Sun position table */}
            {sheetPosition === "full" && (
              <div>
                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                  Sun Positions (every 30 min)
                </h3>
                <div className="bg-zinc-800/50 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-zinc-700/50">
                        <th className="text-left px-3 py-2 text-zinc-400">
                          Time
                        </th>
                        <th className="text-right px-3 py-2 text-zinc-400">
                          Elevation
                        </th>
                        <th className="text-right px-3 py-2 text-zinc-400">
                          Azimuth
                        </th>
                        <th className="text-right px-3 py-2 text-zinc-400">
                          Direction
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {dayData.positions
                        .filter((_, i) => i % 6 === 0) // every 30 min (6 * 5min)
                        .map((pos, i) => (
                          <tr
                            key={i}
                            className="border-b border-zinc-800/50 hover:bg-zinc-800/30"
                          >
                            <td className="px-3 py-1.5 text-zinc-200">
                              {formatTime(new Date(pos.time))}
                            </td>
                            <td className="px-3 py-1.5 text-right text-zinc-300">
                              {pos.altitudeDeg.toFixed(1)}°
                            </td>
                            <td className="px-3 py-1.5 text-right text-zinc-300">
                              {pos.azimuthDeg.toFixed(0)}°
                            </td>
                            <td className="px-3 py-1.5 text-right text-zinc-300">
                              {compassDirection(pos.azimuthDeg)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TimeCard({
  label,
  time,
  icon,
}: {
  label: string;
  time: string;
  icon: string;
}) {
  return (
    <div className="bg-zinc-800/50 rounded-lg px-3 py-2 flex items-center gap-2">
      <span className="text-lg">{icon}</span>
      <div>
        <p className="text-[10px] text-zinc-500 uppercase">{label}</p>
        <p className="text-sm font-medium text-white">{time}</p>
      </div>
    </div>
  );
}

function ZoneCard({ zone }: { zone: { name: string; label: string; start: Date; end: Date } }) {
  const colorMap = {
    warm_light: "border-amber-500/30 bg-amber-500/5",
    golden_hour: "border-amber-400/40 bg-amber-400/10",
    twilight: "border-blue-400/30 bg-blue-400/5",
  };

  const color = colorMap[zone.name as keyof typeof colorMap] || colorMap.warm_light;

  return (
    <div className={`rounded-lg px-3 py-2 border ${color}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-white">{zone.label}</span>
        <span className="text-xs text-zinc-400">
          {formatTime(zone.start)} — {formatTime(zone.end)}
        </span>
      </div>
    </div>
  );
}
