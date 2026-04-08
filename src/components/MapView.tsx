"use client";

import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import {
  computeDayData,
  interpolatePosition,
  formatTime,
  compassDirection,
  projectSunToMap,
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
const SHEET_HEIGHTS = { peek: 160, half: 40, full: 70 }; // px or vh

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
  const [mapLoaded, setMapLoaded] = useState(false);
  const playRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Swipe gesture state
  const touchStartY = useRef<number>(0);
  const touchStartSheet = useRef<SheetPosition>("peek");

  // Pulse animation
  const pulseRef = useRef<number>(0);

  // Precompute sun data for the day
  const dayData: DayData = useMemo(
    () => computeDayData(lat, lng, date),
    [lat, lng, date]
  );

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

  // Snap points for scrubber (sunrise, golden hour, noon, golden hour, sunset)
  const snapPoints = useMemo(() => {
    const points: { time: number; label: string }[] = [
      { time: dayData.times.sunrise.getTime(), label: "Sunrise" },
      { time: dayData.times.solarNoon.getTime(), label: "Noon" },
      { time: dayData.times.sunset.getTime(), label: "Sunset" },
    ];
    // Add golden hour boundaries
    for (const zone of dayData.lightZones) {
      if (zone.name === "golden_hour") {
        points.push({ time: zone.start.getTime(), label: `${zone.label} start` });
        points.push({ time: zone.end.getTime(), label: `${zone.label} end` });
      }
    }
    return points.sort((a, b) => a.time - b.time);
  }, [dayData]);

  // Golden hour zones as percentages for scrubber highlights
  const scrubberZones = useMemo(() => {
    const range = timeRange.max - timeRange.min;
    if (range <= 0) return [];
    return dayData.lightZones
      .filter((z) => z.name === "golden_hour" || z.name === "warm_light")
      .map((z) => ({
        left: ((z.start.getTime() - timeRange.min) / range) * 100,
        width:
          ((z.end.getTime() - z.start.getTime()) / range) * 100,
        color:
          z.name === "golden_hour"
            ? "rgba(212, 160, 74, 0.4)"
            : "rgba(212, 160, 74, 0.2)",
      }));
  }, [dayData.lightZones, timeRange]);

  // Clamp current time to range on data change
  useEffect(() => {
    const now = Date.now();
    if (now >= timeRange.min && now <= timeRange.max) {
      setCurrentTimeMs(now);
    } else {
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

    const marker = new mapboxgl.Marker({ color: "#d4a04a" })
      .setLngLat([lng, lat])
      .addTo(map);

    markerRef.current = marker;
    mapRef.current = map;

    map.once("load", () => {
      map.flyTo({
        center: [lng, lat - 0.002], // offset south so arc is visible above center
        zoom: 16,
        pitch: 30,
        duration: 2000,
        essential: true,
      });

      // Build initial arc data
      const initArcCoords: [number, number][] = dayData.positions
        .filter((p) => p.altitudeDeg > -2)
        .map((p) => projectSunToMap(p, lat, lng));
      const initArcGeoJSON: GeoJSON.Feature = initArcCoords.length >= 2
        ? { type: "Feature", geometry: { type: "LineString", coordinates: initArcCoords }, properties: {} }
        : { type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: {} };
      map.addSource("sun-arc", {
        type: "geojson",
        data: initArcGeoJSON as GeoJSON.Feature,
        lineMetrics: true,
      });

      map.addSource("sun-arc-glow", {
        type: "geojson",
        data: initArcGeoJSON as GeoJSON.Feature,
        lineMetrics: true,
      });

      map.addSource("sun-dot", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addSource("sun-dot-pulse", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addSource("light-wedge", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      // Glow layer (wider, transparent)
      map.addLayer({
        id: "sun-arc-glow-layer",
        type: "line",
        source: "sun-arc-glow",
        paint: {
          "line-color": "#d4a04a",
          "line-width": 18,
          "line-opacity": 0.25,
          "line-blur": 6,
        },
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
      });

      // Main arc line with gradient
      map.addLayer({
        id: "sun-arc-layer",
        type: "line",
        source: "sun-arc",
        paint: {
          "line-width": 4,
          "line-opacity": 0.9,
          "line-gradient": [
            "interpolate",
            ["linear"],
            ["line-progress"],
            0, "#b87333",
            0.15, "#d4a04a",
            0.3, "#e8d5a8",
            0.5, "#ffffff",
            0.7, "#e8d5a8",
            0.85, "#d4a04a",
            1, "#b87333",
          ],
        },
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
      });

      // Light wedge fill
      map.addLayer({
        id: "light-wedge-fill",
        type: "fill",
        source: "light-wedge",
        paint: {
          "fill-color": "rgba(255, 200, 80, 0.15)",
          "fill-opacity": 0.6,
        },
      });

      // Sun dot pulse (outer glow)
      map.addLayer({
        id: "sun-dot-pulse-layer",
        type: "circle",
        source: "sun-dot-pulse",
        paint: {
          "circle-radius": 18,
          "circle-color": "#d4a04a",
          "circle-opacity": 0.25,
          "circle-blur": 0.5,
        },
      });

      // Sun dot (solid center)
      map.addLayer({
        id: "sun-dot-layer",
        type: "circle",
        source: "sun-dot",
        paint: {
          "circle-radius": 9,
          "circle-color": "#f0c96e",
          "circle-opacity": 0.95,
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "rgba(255, 255, 255, 0.6)",
        },
      });

      setMapLoaded(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, [lat, lng]);

  // Update sun arc on map when day data changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // Build arc LineString from all positions above horizon
    const arcCoords: [number, number][] = dayData.positions
      .filter((p) => p.altitudeDeg > -2)
      .map((p) => projectSunToMap(p, lat, lng));

    if (arcCoords.length < 2) return;

    const arcGeoJSON: GeoJSON.Feature = {
      type: "Feature",
      geometry: { type: "LineString", coordinates: arcCoords },
      properties: {},
    };

    const arcSource = map.getSource("sun-arc") as mapboxgl.GeoJSONSource;
    const glowSource = map.getSource("sun-arc-glow") as mapboxgl.GeoJSONSource;
    if (arcSource) arcSource.setData(arcGeoJSON);
    if (glowSource) glowSource.setData(arcGeoJSON);
  }, [dayData, lat, lng, mapLoaded]);

  // Update sun dot + light wedge on time change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !currentPos) return;

    // Sun dot position
    const dotPos = projectSunToMap(currentPos, lat, lng);

    const dotGeoJSON: GeoJSON.Feature = {
      type: "Feature",
      geometry: { type: "Point", coordinates: dotPos },
      properties: {},
    };

    const dotSource = map.getSource("sun-dot") as mapboxgl.GeoJSONSource;
    const pulseSource = map.getSource("sun-dot-pulse") as mapboxgl.GeoJSONSource;
    if (dotSource) dotSource.setData(dotGeoJSON);
    if (pulseSource) pulseSource.setData(dotGeoJSON);

    // Light wedge
    if (currentPos.altitudeDeg >= -1) {
      const mapBearing = (currentPos.azimuthDeg + 180) % 360;
      const fromAz = (mapBearing * Math.PI) / 180;
      const wedgeLength = 0.002;

      const tip1Lng =
        lng + (wedgeLength * Math.sin(fromAz - 0.3)) / Math.cos((lat * Math.PI) / 180);
      const tip1Lat = lat + wedgeLength * Math.cos(fromAz - 0.3);
      const tip2Lng =
        lng + (wedgeLength * Math.sin(fromAz + 0.3)) / Math.cos((lat * Math.PI) / 180);
      const tip2Lat = lat + wedgeLength * Math.cos(fromAz + 0.3);

      const wedgeGeoJSON: GeoJSON.Feature = {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [[lng, lat], [tip1Lng, tip1Lat], [tip2Lng, tip2Lat], [lng, lat]],
          ],
        },
        properties: {},
      };

      let color = "rgba(255, 200, 80, 0.15)";
      if (currentPos.altitudeDeg > 30) color = "rgba(255, 255, 200, 0.08)";
      else if (currentPos.altitudeDeg < 2) color = "rgba(80, 120, 200, 0.12)";

      const wedgeSource = map.getSource("light-wedge") as mapboxgl.GeoJSONSource;
      if (wedgeSource) {
        wedgeSource.setData(wedgeGeoJSON);
        map.setPaintProperty("light-wedge-fill", "fill-color", color);
      }
    }
  }, [currentPos, lat, lng, mapLoaded]);

  // Pulse animation for sun dot
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    let frame: number;
    const animate = () => {
      pulseRef.current += 0.03;
      const scale = 18 + 6 * Math.sin(pulseRef.current); // 12-24 radius
      const opacity = 0.2 + 0.12 * Math.sin(pulseRef.current);

      try {
        map.setPaintProperty("sun-dot-pulse-layer", "circle-radius", scale);
        map.setPaintProperty("sun-dot-pulse-layer", "circle-opacity", opacity);
      } catch {
        // Layer may not exist yet
      }

      frame = requestAnimationFrame(animate);
    };

    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [mapLoaded]);

  // Play/pause animation
  const togglePlay = useCallback(() => {
    if (isPlaying) {
      if (playRef.current) clearInterval(playRef.current);
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      const stepMs = 5 * 60 * 1000;
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
      }, 50);
    }
  }, [isPlaying, timeRange]);

  useEffect(() => {
    return () => {
      if (playRef.current) clearInterval(playRef.current);
    };
  }, []);

  // Scrubber snap — find nearest snap point within 2% of range
  const handleScrubberChange = useCallback(
    (value: number) => {
      const snapThreshold = (timeRange.max - timeRange.min) * 0.02;
      for (const sp of snapPoints) {
        if (Math.abs(value - sp.time) < snapThreshold) {
          setCurrentTimeMs(sp.time);
          return;
        }
      }
      setCurrentTimeMs(value);
    },
    [snapPoints, timeRange]
  );

  // Swipe gestures for bottom sheet
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      touchStartY.current = e.touches[0].clientY;
      touchStartSheet.current = sheetPosition;
    },
    [sheetPosition]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const deltaY = touchStartY.current - e.changedTouches[0].clientY;
      const threshold = 50;

      if (deltaY > threshold) {
        // Swipe up
        if (touchStartSheet.current === "peek") setSheetPosition("half");
        else if (touchStartSheet.current === "half") setSheetPosition("full");
      } else if (deltaY < -threshold) {
        // Swipe down
        if (touchStartSheet.current === "full") setSheetPosition("half");
        else if (touchStartSheet.current === "half") setSheetPosition("peek");
      }
    },
    []
  );

  // Sheet heights
  const sheetHeightClass =
    sheetPosition === "full"
      ? "h-[70vh]"
      : sheetPosition === "half"
      ? "h-[40vh]"
      : "h-[160px]";

  const dateStr = date.toISOString().split("T")[0];
  const eveningZones = dayData.lightZones.filter((z) => z.period === "evening");
  const morningZones = dayData.lightZones.filter((z) => z.period === "morning");

  // "Now" marker
  const nowMs = Date.now();
  const nowPct =
    timeRange.max > timeRange.min
      ? ((nowMs - timeRange.min) / (timeRange.max - timeRange.min)) * 100
      : 0;
  const showNowMarker = nowPct >= 0 && nowPct <= 100;

  // Scrubber current position %
  const scrubPct =
    timeRange.max > timeRange.min
      ? ((currentTimeMs - timeRange.min) / (timeRange.max - timeRange.min)) * 100
      : 0;

  return (
    <div className="relative h-screen flex flex-col">
      {/* Map */}
      <div className="absolute inset-0">
        <div ref={mapContainer} className="w-full h-full" />
      </div>

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-3 px-4 py-3 bg-gradient-to-b from-zinc-950/80 to-transparent">
        <button
          onClick={onBack}
          className="p-2 rounded-lg bg-zinc-900/60 hover:bg-zinc-800/80 transition-colors backdrop-blur-sm"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
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
            const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 12, 0, 0);
            onDateChange(d);
          }}
          className="px-3 py-1.5 bg-zinc-900/60 border border-zinc-700/40 rounded-lg text-white text-xs outline-none focus:border-amber-500/50 [color-scheme:dark] backdrop-blur-sm"
        />
      </div>

      {/* Bottom sheet */}
      <div
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
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

        {/* Custom time scrubber */}
        <div className="px-4 pb-2">
          <div className="flex items-center gap-3">
            {/* Play/pause */}
            <button
              onClick={togglePlay}
              className="p-2 rounded-full bg-zinc-800 hover:bg-zinc-700 transition-colors flex-shrink-0"
            >
              {isPlaying ? (
                <svg className="w-4 h-4 text-amber-400" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-amber-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            {/* Styled scrubber track */}
            <div className="flex-1 relative h-8 flex items-center">
              {/* Track background */}
              <div
                className="absolute left-0 right-0 h-1.5 rounded-full"
                style={{
                  background: `linear-gradient(to right,
                    #6b4c2a 0%, #b87333 10%, #d4a04a 20%, #e8d5a8 35%,
                    #ffffff 50%, #e8d5a8 65%, #d4a04a 80%, #b87333 90%, #6b4c2a 100%)`,
                }}
              />

              {/* Golden hour zone highlights on track */}
              {scrubberZones.map((zone, i) => (
                <div
                  key={i}
                  className="absolute h-3 rounded-full"
                  style={{
                    left: `${zone.left}%`,
                    width: `${zone.width}%`,
                    background: zone.color,
                    top: "50%",
                    transform: "translateY(-50%)",
                    boxShadow: `0 0 8px ${zone.color}`,
                  }}
                />
              ))}

              {/* "Now" marker */}
              {showNowMarker && (
                <div
                  className="absolute flex flex-col items-center pointer-events-none z-10"
                  style={{ left: `${nowPct}%`, top: "50%", transform: "translate(-50%, -50%)" }}
                >
                  <div className="w-px h-6 bg-white/50" />
                  <span className="text-[8px] text-zinc-500 mt-0.5 absolute -bottom-3">now</span>
                </div>
              )}

              {/* Range input (invisible, sits on top for interaction) */}
              <input
                type="range"
                min={timeRange.min}
                max={timeRange.max}
                value={currentTimeMs}
                onChange={(e) => handleScrubberChange(parseInt(e.target.value))}
                className="absolute inset-0 w-full opacity-0 cursor-pointer z-20"
                style={{ height: "44px", margin: "-10px 0" }}
              />

              {/* Custom thumb */}
              <div
                className="absolute w-5 h-5 rounded-full bg-amber-400 border-2 border-white/40 shadow-lg shadow-amber-500/30 pointer-events-none z-10 transition-transform"
                style={{
                  left: `${scrubPct}%`,
                  top: "50%",
                  transform: "translate(-50%, -50%)",
                }}
              />
            </div>

            {/* Time display */}
            <span className="text-sm font-mono text-amber-400 flex-shrink-0 w-20 text-right tabular-nums">
              {formatTime(new Date(currentTimeMs))}
            </span>
          </div>
        </div>

        {/* Peek data */}
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
                  {compassDirection(currentPos.azimuthDeg)} ({currentPos.azimuthDeg.toFixed(0)}°)
                </span>
              </span>
              {currentPos.altitudeDeg < 0 && (
                <span className="text-blue-400">Below horizon</span>
              )}
            </>
          )}
        </div>

        {/* Expanded content */}
        {sheetPosition !== "peek" && (
          <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
            <div>
              <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                Key Times —{" "}
                {date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <TimeCard label="Sunrise" time={formatTime(dayData.times.sunrise)} icon="sunrise" />
                <TimeCard label="Solar Noon" time={formatTime(dayData.times.solarNoon)} icon="sun" />
                <TimeCard label="Sunset" time={formatTime(dayData.times.sunset)} icon="sunset" />
                <TimeCard label="Dawn" time={formatTime(dayData.times.dawn)} icon="dawn" />
              </div>
            </div>

            {eveningZones.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                  Evening Light Windows
                </h3>
                <div className="space-y-2">
                  {eveningZones.map((zone, i) => (
                    <ZoneCard key={i} zone={zone} onJump={(t) => setCurrentTimeMs(t)} />
                  ))}
                </div>
              </div>
            )}

            {morningZones.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                  Morning Light Windows
                </h3>
                <div className="space-y-2">
                  {morningZones.map((zone, i) => (
                    <ZoneCard key={i} zone={zone} onJump={(t) => setCurrentTimeMs(t)} />
                  ))}
                </div>
              </div>
            )}

            {sheetPosition === "full" && (
              <div>
                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                  Sun Positions (every 30 min)
                </h3>
                <div className="bg-zinc-800/50 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-zinc-700/50">
                        <th className="text-left px-3 py-2 text-zinc-400">Time</th>
                        <th className="text-right px-3 py-2 text-zinc-400">Elevation</th>
                        <th className="text-right px-3 py-2 text-zinc-400">Azimuth</th>
                        <th className="text-right px-3 py-2 text-zinc-400">Direction</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dayData.positions
                        .filter((_, i) => i % 6 === 0)
                        .map((pos, i) => (
                          <tr
                            key={i}
                            className="border-b border-zinc-800/50 hover:bg-zinc-800/30 cursor-pointer"
                            onClick={() => setCurrentTimeMs(pos.time)}
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

// --- Sub-components ---

function TimeCard({
  label,
  time,
  icon,
}: {
  label: string;
  time: string;
  icon: string;
}) {
  const icons: Record<string, React.ReactNode> = {
    sunrise: (
      <svg className="w-5 h-5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path d="M12 2v3m0 0a5 5 0 015 5H7a5 5 0 015-5z" />
        <path d="M4.22 10H2m4.36-5.64L5.05 3.05M20 10h-2m-1.58-5.64l1.31-1.31" />
        <line x1="2" y1="14" x2="22" y2="14" />
      </svg>
    ),
    sun: (
      <svg className="w-5 h-5 text-yellow-400" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="12" r="5" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
          <line
            key={a}
            x1={12 + 7.5 * Math.cos((a * Math.PI) / 180)}
            y1={12 + 7.5 * Math.sin((a * Math.PI) / 180)}
            x2={12 + 10 * Math.cos((a * Math.PI) / 180)}
            y2={12 + 10 * Math.sin((a * Math.PI) / 180)}
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        ))}
      </svg>
    ),
    sunset: (
      <svg className="w-5 h-5 text-orange-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path d="M12 8v3m0 0a5 5 0 015 5H7a5 5 0 015-5z" />
        <path d="M4.22 16H2m4.36-5.64L5.05 9.05M20 16h-2m-1.58-5.64l1.31-1.31" />
        <line x1="2" y1="20" x2="22" y2="20" />
      </svg>
    ),
    dawn: (
      <svg className="w-5 h-5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path d="M12 5v2m0 0a4 4 0 014 4H8a4 4 0 014-4z" />
        <line x1="3" y1="14" x2="21" y2="14" />
        <line x1="3" y1="18" x2="21" y2="18" strokeOpacity="0.4" />
      </svg>
    ),
  };

  return (
    <div className="bg-zinc-800/50 rounded-lg px-3 py-2 flex items-center gap-2.5">
      {icons[icon] || <span className="w-5 h-5" />}
      <div>
        <p className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</p>
        <p className="text-sm font-medium text-white">{time}</p>
      </div>
    </div>
  );
}

function ZoneCard({
  zone,
  onJump,
}: {
  zone: { name: string; label: string; start: Date; end: Date };
  onJump: (timeMs: number) => void;
}) {
  const colorMap = {
    warm_light: "border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10",
    golden_hour: "border-amber-400/40 bg-amber-400/10 hover:bg-amber-400/15",
    twilight: "border-blue-400/30 bg-blue-400/5 hover:bg-blue-400/10",
  };

  const color = colorMap[zone.name as keyof typeof colorMap] || colorMap.warm_light;

  return (
    <button
      onClick={() => onJump(zone.start.getTime())}
      className={`w-full rounded-lg px-3 py-2 border ${color} transition-colors text-left`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-white">{zone.label}</span>
        <span className="text-xs text-zinc-400">
          {formatTime(zone.start)} — {formatTime(zone.end)}
        </span>
      </div>
    </button>
  );
}
