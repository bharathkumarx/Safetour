import { useCallback, useEffect, useRef, useState } from 'react';
import Map, { AttributionControl, NavigationControl } from 'react-map-gl/maplibre';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BANGALORE_BOUNDS } from '../store/mapStore.js';

const DEFAULT_CENTER = { longitude: 77.5946, latitude: 12.9716 };
const DEFAULT_ZOOM = 11;
const FALLBACK_STYLE = 'https://tiles.openfreemap.org/styles/dark';
const CAMERA_EPSILON = 0.000001;

maplibregl.setWorkerUrl(maplibreWorkerUrl);

function samePadding(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;
  if (typeof left === 'number' || typeof right === 'number') return left === right;
  return left.top === right.top && left.right === right.right && left.bottom === right.bottom && left.left === right.left;
}

export function updateCameraState(previous, eventViewState) {
  const next = clampToBangalore({
    latitude: eventViewState.latitude,
    longitude: eventViewState.longitude,
  });
  const nextViewState = {
    ...eventViewState,
    latitude: next.latitude,
    longitude: next.longitude,
  };
  const unchanged =
    Math.abs(previous.latitude - nextViewState.latitude) < CAMERA_EPSILON &&
    Math.abs(previous.longitude - nextViewState.longitude) < CAMERA_EPSILON &&
    Math.abs(previous.zoom - nextViewState.zoom) < CAMERA_EPSILON &&
    previous.bearing === nextViewState.bearing &&
    previous.pitch === nextViewState.pitch &&
    samePadding(previous.padding, nextViewState.padding);
  return unchanged ? previous : nextViewState;
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

  useEffect(() => {
    const map = mapRef.current?.getMap?.();
    if (map && typeof onMapReady === 'function') {
      onMapReady(map);
    }
  }, [onMapReady]);

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
        style={{ width: '100%', height: '100%' }}
        attributionControl={false}
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
