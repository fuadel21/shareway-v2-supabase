import React, { memo } from 'react';
import MapComponent from './MapComponent';

const RideRouteMap = memo(({ origin, destination, driverLocation, status }) => {
  if (!origin?.lat || !origin?.lng || !destination?.lat || !destination?.lng) {
    return <div className="h-full w-full bg-slate-100 flex items-center justify-center text-muted-foreground font-medium italic">Esperando puntos de ruta...</div>;
  }

  const itemsToDisplay = [{
    id: 'preview-route',
    type: 'ride',
    status: status || 'scheduled',
    origin,
    destination,
    driver_location: driverLocation
  }];

  return (
    <div className="h-full w-full relative">
      <MapComponent
        center={origin}
        zoom={10}
        itemsToDisplay={itemsToDisplay}
        selectedItemId="preview-route"
      />
    </div>
  );
});

export default RideRouteMap;
