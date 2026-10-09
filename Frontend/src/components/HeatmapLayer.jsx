import { Layer, Source } from 'react-map-gl/maplibre';

const DEFAULT_HEATMAP_PAINT = {
  'heatmap-weight': ['interpolate', ['linear'], ['get', 'weight'], 0, 0, 1, 1],
  'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 0.5, 10, 1.5],
  'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 6, 10, 18],
  'heatmap-color': [
    'interpolate',
    ['linear'],
    ['heatmap-density'],
    0,
    'rgba(17, 24, 39, 0)',
    0.2,
    '#22c55e',
    0.45,
    '#facc15',
    0.7,
    '#f97316',
    1,
    '#ef4444',
  ],
  'heatmap-opacity': 0.82,
};

const DEFAULT_CIRCLE_PAINT = {
  'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2, 14, 8],
  'circle-color': [
    'interpolate',
    ['linear'],
    ['get', 'weight'],
    0,
    '#22c55e',
    0.25,
    '#3b82f6',
    0.5,
    '#facc15',
    0.75,
    '#f97316',
    1,
    '#ef4444',
  ],
  'circle-opacity': 0.8,
};

export default function HeatmapLayer({ data, layerMode = 'risk', enabled = true }) {
  if (!enabled || !data || !data.features || data.features.length === 0) {
    return null;
  }

  const geojson = {
    type: 'FeatureCollection',
    features: data.features.filter((feature) => feature && feature.geometry),
  };

  return (
    <Source id="safetour-heatmap" type="geojson" data={geojson}>
      <Layer
        id="heatmap-layer"
        type="heatmap"
        paint={DEFAULT_HEATMAP_PAINT}
        layout={{ visibility: enabled ? 'visible' : 'none' }}
      />
      <Layer
        id="heatmap-circles"
        type="circle"
        paint={DEFAULT_CIRCLE_PAINT}
        layout={{ visibility: layerMode === 'density' ? 'visible' : 'visible' }}
      />
    </Source>
  );
}
