import { Layer, Source } from 'react-map-gl/maplibre';
import { BANGALORE_BOUNDS } from '../store/mapStore.js';

export const HEATMAP_SOURCE_ID = 'safetour-heatmap';
export const RISK_LAYER_ID = 'heatmap-layer';
export const DENSITY_LAYER_ID = 'heatmap-circles';

export function isValidBangaloreCoordinate(lng, lat) {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= BANGALORE_BOUNDS.minLng &&
    lng <= BANGALORE_BOUNDS.maxLng &&
    lat >= BANGALORE_BOUNDS.minLat &&
    lat <= BANGALORE_BOUNDS.maxLat
  );
}

export function toHeatmapGeoJSON(data, layerMode = 'risk') {
  const features = Array.isArray(data?.features) ? data.features : [];
  return {
    type: 'FeatureCollection',
    features: features
      .filter(
        (feature) =>
          feature?.geometry?.type === 'Point' &&
          Array.isArray(feature.geometry.coordinates) &&
          feature.geometry.coordinates.length >= 2 &&
          isValidBangaloreCoordinate(feature.geometry.coordinates[0], feature.geometry.coordinates[1]),
      )
      .map((feature) => ({
        ...feature,
        properties: {
          ...feature.properties,
          visualWeight:
            layerMode === 'risk'
              ? Math.max(0, Math.min(1, 1 - Number(feature.properties?.score ?? 0) / 100))
              : Math.max(0, Math.min(1, Number(feature.properties?.weight ?? 0))),
        },
      })),
  };
}

export function createRiskHeatmapPaint() {
  return {
    'heatmap-weight': [
      'interpolate',
      ['linear'],
      ['get', 'visualWeight'],
      0,
      0,
      0.42,
      0,
      0.52,
      0.15,
      0.65,
      0.55,
      0.75,
      0.85,
      1.0,
      1.0,
    ],
    'heatmap-intensity': [
      'interpolate',
      ['linear'],
      ['zoom'],
      9,
      0.6,
      11,
      0.9,
      13,
      1.2,
      15,
      1.5,
    ],
    'heatmap-radius': [
      'interpolate',
      ['linear'],
      ['zoom'],
      9,
      14,
      11,
      24,
      13,
      36,
      15,
      48,
    ],
    'heatmap-color': [
      'interpolate',
      ['linear'],
      ['heatmap-density'],
      0,
      'rgba(0, 0, 0, 0)',
      0.18,
      'rgba(0, 0, 0, 0)',
      0.35,
      'rgba(250, 204, 21, 0.45)',
      0.55,
      'rgba(249, 115, 22, 0.72)',
      0.75,
      'rgba(239, 68, 68, 0.88)',
      1.0,
      'rgba(220, 38, 38, 0.96)',
    ],
    'heatmap-opacity': [
      'interpolate',
      ['linear'],
      ['zoom'],
      9,
      0.7,
      11,
      0.82,
      14,
      0.75,
      16,
      0.6,
    ],
  };
}

export function createDensityCirclePaint() {
  return {
    'circle-radius': [
      'interpolate',
      ['linear'],
      ['zoom'],
      9,
      ['interpolate', ['linear'], ['get', 'visualWeight'], 0, 1.5, 1, 4.5],
      12,
      ['interpolate', ['linear'], ['get', 'visualWeight'], 0, 2.5, 1, 7],
      15,
      ['interpolate', ['linear'], ['get', 'visualWeight'], 0, 4, 1, 11],
    ],
    'circle-color': [
      'interpolate',
      ['linear'],
      ['get', 'visualWeight'],
      0,
      'rgba(59, 130, 246, 0.45)',
      0.25,
      'rgba(14, 165, 233, 0.6)',
      0.5,
      'rgba(250, 204, 21, 0.75)',
      0.75,
      'rgba(249, 115, 22, 0.85)',
      1,
      'rgba(239, 68, 68, 0.9)',
    ],
    'circle-opacity': 0.78,
    'circle-stroke-color': 'rgba(255, 255, 255, 0.35)',
    'circle-stroke-width': 0.75,
  };
}

export default function HeatmapLayer({ data, layerMode = 'risk', enabled = true }) {
  const geojson = toHeatmapGeoJSON(data, layerMode);

  if (!enabled || geojson.features.length === 0) {
    return null;
  }

  const isRiskMode = layerMode === 'risk';
  const isDensityMode = layerMode === 'density';

  return (
    <Source id={HEATMAP_SOURCE_ID} type="geojson" data={geojson}>
      <Layer
        id={RISK_LAYER_ID}
        type="heatmap"
        source={HEATMAP_SOURCE_ID}
        paint={createRiskHeatmapPaint()}
        layout={{ visibility: isRiskMode ? 'visible' : 'none' }}
      />
      <Layer
        id={DENSITY_LAYER_ID}
        type="circle"
        source={HEATMAP_SOURCE_ID}
        paint={createDensityCirclePaint()}
        layout={{ visibility: isDensityMode ? 'visible' : 'none' }}
      />
    </Source>
  );
}
