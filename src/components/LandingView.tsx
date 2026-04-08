"use client";

import { useRef, useEffect, useState } from "react";
import mapboxgl from "mapbox-gl";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

interface LandingViewProps {
  onAddressSelect: (lat: number, lng: number, name: string) => void;
  selectedDate: Date;
  onDateChange: (date: Date) => void;
}

export default function LandingView({
  onAddressSelect,
  selectedDate,
  onDateChange,
}: LandingViewProps) {
  const geocoderRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<
    Array<{ place_name: string; center: [number, number] }>
  >([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Geocode using Mapbox Geocoding API directly (simpler than search-js for this case)
  useEffect(() => {
    if (!query || query.length < 3) {
      setSuggestions([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
            query
          )}.json?access_token=${MAPBOX_TOKEN}&types=address,place&limit=5&country=us`
        );
        const data = await res.json();
        if (data.features) {
          setSuggestions(data.features);
          setShowSuggestions(true);
        }
      } catch {
        // Silently fail on geocode errors
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handleSelect = (feature: {
    place_name: string;
    center: [number, number];
  }) => {
    setShowSuggestions(false);
    setQuery(feature.place_name);
    onAddressSelect(feature.center[1], feature.center[0], feature.place_name);
  };

  const dateStr = selectedDate.toISOString().split("T")[0];

  return (
    <div className="relative h-screen flex flex-col items-center justify-center overflow-hidden">
      {/* Animated gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950" />
      <div className="absolute inset-0 opacity-20 animate-pulse bg-gradient-to-tr from-amber-900/30 via-transparent to-blue-900/30" />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-8 px-6 max-w-xl w-full">
        {/* Wordmark */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-3">
            <svg
              width="36"
              height="36"
              viewBox="0 0 36 36"
              fill="none"
              className="text-amber-400"
            >
              <circle
                cx="18"
                cy="18"
                r="8"
                fill="currentColor"
                opacity="0.9"
              />
              {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
                <line
                  key={angle}
                  x1={18 + 11 * Math.cos((angle * Math.PI) / 180)}
                  y1={18 + 11 * Math.sin((angle * Math.PI) / 180)}
                  x2={18 + 15 * Math.cos((angle * Math.PI) / 180)}
                  y2={18 + 15 * Math.sin((angle * Math.PI) / 180)}
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              ))}
            </svg>
            <h1 className="text-4xl font-semibold tracking-tight text-white">
              Light Scout
            </h1>
          </div>
          <p className="text-zinc-400 text-lg">
            Know your light before you arrive
          </p>
        </div>

        {/* Address input */}
        <div className="relative w-full" ref={geocoderRef}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            placeholder="Enter a property address..."
            className="w-full px-5 py-4 bg-zinc-900/80 border border-zinc-700/50 rounded-xl
              text-white text-lg placeholder-zinc-500 outline-none
              focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30
              backdrop-blur-sm transition-all"
          />
          <svg
            className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>

          {/* Suggestions dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full mt-2 w-full bg-zinc-900/95 border border-zinc-700/50 rounded-xl overflow-hidden backdrop-blur-sm z-50">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onMouseDown={() => handleSelect(s)}
                  className="w-full text-left px-5 py-3 text-sm text-zinc-200 hover:bg-amber-500/10 hover:text-white transition-colors border-b border-zinc-800/50 last:border-0"
                >
                  {s.place_name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Date picker */}
        <div className="flex items-center gap-3">
          <label className="text-sm text-zinc-400">Date</label>
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
            className="px-4 py-2 bg-zinc-900/80 border border-zinc-700/50 rounded-lg
              text-white text-sm outline-none focus:border-amber-500/50
              [color-scheme:dark] transition-all"
          />
        </div>

        {/* Branding */}
        <p className="text-zinc-600 text-xs mt-8">by Redwards Media</p>
      </div>
    </div>
  );
}
