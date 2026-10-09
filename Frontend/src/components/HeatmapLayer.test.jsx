import { describe, expect, it } from 'vitest';
import HeatmapLayer, {
  createDensityCirclePaint,
  createRiskHeatmapPaint,
  DENSITY_LAYER_ID,
  HEATMAP_SOURCE_ID,
  isValidBangaloreCoordinate,
  RISK_LAYER_ID,
  toHeatmapGeoJSON,
} from './HeatmapLayer.jsx';

const feature = (score, weight = 0.25, coordinates = [77.5946, 12.9716]) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates },
  properties: { h3: 'cell', score, weight, n: 4 },
});

describe('heatmap GeoJSON presentation mapping', () => {
  it('derives risk intensity from the backend SafeScore', () => {
    const result = toHeatmapGeoJSON({ features: [feature(80)] }, 'risk');
    expect(result.features[0].properties.visualWeight).toBeCloseTo(0.2);
  });

  it('uses backend density weight for density mode', () => {
    const result = toHeatmapGeoJSON({ features: [feature(80, 0.65)] }, 'density');
    expect(result.features[0].properties.visualWeight).toBe(0.65);
  });

  it('keeps only point geometries within Bangalore bounds', () => {
    const result = toHeatmapGeoJSON({
      features: [
        feature(80, 0.2, [77.5946, 12.9716]), // Valid Bangalore point
        feature(80, 0.2, [72.8777, 19.076]), // Mumbai point outside Bangalore
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: {} },
      ],
    });
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry.coordinates).toEqual([77.5946, 12.9716]);
  });

  it('validates Bangalore coordinate boundaries strictly', () => {
    expect(isValidBangaloreCoordinate(77.5946, 12.9716)).toBe(true);
    expect(isValidBangaloreCoordinate(77.0, 12.9716)).toBe(false);
    expect(isValidBangaloreCoordinate(77.5946, 14.0)).toBe(false);
    expect(isValidBangaloreCoordinate(NaN, 12.9716)).toBe(false);
  });
});

describe('MapLibre paint and layer definitions', () => {
  it('creates risk heatmap paint with transparent 0-density baseline and yellow-to-red ramp', () => {
    const paint = createRiskHeatmapPaint();
    expect(paint['heatmap-weight']).toBeDefined();
    expect(paint['heatmap-color'][4]).toBe('rgba(0, 0, 0, 0)');
    expect(paint['heatmap-radius']).toBeDefined();
    expect(paint['heatmap-intensity']).toBeDefined();
    expect(paint['heatmap-opacity']).toBeDefined();

    // Verify color ramp contains transparent zero density and does not contain green blanket colors
    const colorStops = paint['heatmap-color'];
    const colorStrings = colorStops.filter((stop) => typeof stop === 'string');
    expect(colorStrings.some((c) => c.includes('34, 197, 94'))).toBe(false);
    expect(colorStrings.some((c) => c.includes('239, 68, 68') || c.includes('220, 38, 38'))).toBe(true);
  });

  it('creates density circle paint with density-dependent radius and translucent colors', () => {
    const paint = createDensityCirclePaint();
    expect(paint['circle-radius']).toBeDefined();
    expect(paint['circle-color']).toBeDefined();
    expect(paint['circle-opacity']).toBeLessThanOrEqual(0.85);
  });

  it('configures Risk mode layer visibility without rendering active circles', () => {
    const element = HeatmapLayer({
      data: { features: [feature(80)] },
      layerMode: 'risk',
      enabled: true,
    });

    expect(element.props.id).toBe(HEATMAP_SOURCE_ID);
    const children = element.props.children;
    const riskLayer = children.find((child) => child.props.id === RISK_LAYER_ID);
    const densityLayer = children.find((child) => child.props.id === DENSITY_LAYER_ID);

    expect(riskLayer.props.layout.visibility).toBe('visible');
    expect(densityLayer.props.layout.visibility).toBe('none');
  });

  it('configures Density mode layer visibility without active risk heatmap', () => {
    const element = HeatmapLayer({
      data: { features: [feature(80, 0.5)] },
      layerMode: 'density',
      enabled: true,
    });

    const children = element.props.children;
    const riskLayer = children.find((child) => child.props.id === RISK_LAYER_ID);
    const densityLayer = children.find((child) => child.props.id === DENSITY_LAYER_ID);

    expect(riskLayer.props.layout.visibility).toBe('none');
    expect(densityLayer.props.layout.visibility).toBe('visible');
  });

  it('returns null when disabled or when data is empty', () => {
    expect(HeatmapLayer({ data: null, enabled: true })).toBeNull();
    expect(HeatmapLayer({ data: { features: [] }, enabled: true })).toBeNull();
    expect(HeatmapLayer({ data: { features: [feature(80)] }, enabled: false })).toBeNull();
  });
});

