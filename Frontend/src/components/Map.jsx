import { useCallback, useRef, useState } from 'react';
import Map, { AttributionControl, NavigationControl } from 'react-map-gl/maplibre';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BANGALORE_BOUNDS } from '../store/mapStore.js';

export const DEFAULT_CENTER = { longitude: 77.5946, latitude: 12.9716 };
export const DEFAULT_ZOOM = 11.2;
export const FALLBACK_STYLE = 'https://tiles.openfreemap.org/styles/dark';
export const MIN_ZOOM = 8.0;
export const MAX_ZOOM = 18;
export const BANGALORE_MAX_BOUNDS = [
  [BANGALORE_BOUNDS.minLng - 0.5, BANGALORE_BOUNDS.minLat - 0.5],
  [BANGALORE_BOUNDS.maxLng + 0.5, BANGALORE_BOUNDS.maxLat + 0.5],
];
const CAMERA_EPSILON = 0.000001;

maplibregl.setWorkerUrl(maplibreWorkerUrl);

function samePadding(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;
  if (typeof left === 'number' || typeof right === 'number') return left === right;
  return left.top === right.top && left.right === right.right && left.bottom === right.bottom && left.left === right.left;
}

export function updateCameraState(previous, eventViewState) {
  if (!eventViewState) return previous;
  const unchanged =
    Math.abs(previous.latitude - eventViewState.latitude) < CAMERA_EPSILON &&
    Math.abs(previous.longitude - eventViewState.longitude) < CAMERA_EPSILON &&
    Math.abs(previous.zoom - eventViewState.zoom) < CAMERA_EPSILON &&
    previous.bearing === eventViewState.bearing &&
    previous.pitch === eventViewState.pitch &&
    samePadding(previous.padding, eventViewState.padding);
  return unchanged ? previous : eventViewState;
}

export function clampToBangalore(position) {
  return {
    latitude: Math.min(BANGALORE_BOUNDS.maxLat, Math.max(BANGALORE_BOUNDS.minLat, position.latitude)),
    longitude: Math.min(BANGALORE_BOUNDS.maxLng, Math.max(BANGALORE_BOUNDS.minLng, position.longitude)),
  };
}

export function flyTo(map, position, zoom = DEFAULT_ZOOM) {
  if (!map || typeof map.flyTo !== 'function') {
    return;
  }
  const boundedPosition = clampToBangalore(position);
  map.flyTo({ center: [boundedPosition.longitude, boundedPosition.latitude], zoom, essential: true });
}

export default function SafeTourMap({ children, selectedPoint, onMapReady }) {
  const mapRef = useRef(null);
  const [viewState, setViewState] = useState({
    latitude: DEFAULT_CENTER.latitude,
    longitude: DEFAULT_CENTER.longitude,
    zoom: DEFAULT_ZOOM,
  });
  const [styleError, setStyleError] = useState(null);
  const styleUrl = import.meta.env.VITE_MAP_STYLE_URL || FALLBACK_STYLE;

  const handleMove = useCallback((event) => {
    setViewState((previous) => updateCameraState(previous, event.viewState));
  }, []);

  if (styleError) {
    const isWebglError = /webgl2|required to display this map|gpu/i.test(styleError);
    return (
      <div className="map-fallback">
        <p>{isWebglError ? 'Map rendering unavailable in this browser.' : 'Map style unavailable.'}</p>
        <small>
          {isWebglError
            ? 'WebGL2 is required to render the MapLibre basemap. Enable hardware acceleration or use a WebGL2-capable browser.'
            : styleError}
        </small>
      </div>
    );
  }

  return (
    <div className="map-panel">
      <Map
        ref={mapRef}
        mapLib={maplibregl}
        viewState={viewState}
        onMove={handleMove}
        mapStyle={styleUrl}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        maxBounds={BANGALORE_MAX_BOUNDS}
        style={{ width: '100%', height: '100%' }}
        attributionControl={false}
        onLoad={(event) => {
          onMapReady?.(event.target);
        }}
        onError={(event) => {
          const message = event.error?.message || 'Map loading failed.';
          console.error('MapLibre failed to load', event);
          setStyleError(message);
        }}
      >
        <NavigationControl position="top-right" />
        <AttributionControl customAttribution="© OpenFreeMap, © OpenStreetMap contributors" />
        {children}
        {selectedPoint && (
          <div
            className="map-point-marker"
            style={{
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
            }}
          />
        )}
      </Map>
    </div>
  );
}
