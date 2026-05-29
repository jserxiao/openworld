import { useState, useRef, useCallback } from 'react';
import MapCanvas from './components/MapCanvas';

export default function App() {
  const mapRef = useRef(null);

  const handleMapGenerated = useCallback(() => {}, []);

  return (
    <MapCanvas
      ref={mapRef}
      onMapGenerated={handleMapGenerated}
    />
  );
}
