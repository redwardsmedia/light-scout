"use client";

import { useState, useCallback } from "react";
import LandingView from "@/components/LandingView";
import MapView from "@/components/MapView";

interface Location {
  lat: number;
  lng: number;
  name: string;
}

export default function Home() {
  const [location, setLocation] = useState<Location | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  const handleAddressSelect = useCallback(
    (lat: number, lng: number, name: string) => {
      setLocation({ lat, lng, name });
    },
    []
  );

  const handleDateChange = useCallback((date: Date) => {
    setSelectedDate(date);
  }, []);

  const handleBack = useCallback(() => {
    setLocation(null);
  }, []);

  if (!location) {
    return (
      <LandingView
        onAddressSelect={handleAddressSelect}
        selectedDate={selectedDate}
        onDateChange={handleDateChange}
      />
    );
  }

  return (
    <MapView
      lat={location.lat}
      lng={location.lng}
      name={location.name}
      date={selectedDate}
      onDateChange={handleDateChange}
      onBack={handleBack}
    />
  );
}
