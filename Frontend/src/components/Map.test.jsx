import { describe, expect, it, vi } from 'vitest';
import { BANGALORE_MAX_BOUNDS, clampToBangalore, DEFAULT_CENTER, DEFAULT_ZOOM, flyTo, updateCameraState } from './Map.jsx';

describe('SafeTour map camera state and framing', () => {
  it('is centered on Bangalore by default with appropriate zoom', () => {
    expect(DEFAULT_CENTER.latitude).toBeCloseTo(12.9716, 2);
    expect(DEFAULT_CENTER.longitude).toBeCloseTo(77.5946, 2);
    expect(DEFAULT_ZOOM).toBeGreaterThanOrEqual(10.5);
    expect(DEFAULT_ZOOM).toBeLessThanOrEqual(13);
  });

  it('defines max bounds around Bangalore', () => {
    const [[minLng, minLat], [maxLng, maxLat]] = BANGALORE_MAX_BOUNDS;
    expect(minLat).toBeLessThan(12.8);
    expect(maxLat).toBeGreaterThan(13.18);
    expect(minLng).toBeLessThan(77.45);
    expect(maxLng).toBeGreaterThan(77.8);
  });

  it('does not create a state update for an unchanged camera event', () => {
    const previous = {
      latitude: 12.9716,
      longitude: 77.5946,
      zoom: 11,
      bearing: 0,
      pitch: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
    };

    expect(updateCameraState(previous, { ...previous, padding: { ...previous.padding } })).toBe(previous);
  });

  it('updates camera state smoothly when camera moves', () => {
    const next = updateCameraState(
      { latitude: 12.9716, longitude: 77.5946, zoom: 11 },
      { latitude: 13.05, longitude: 77.62, zoom: 12 },
    );

    expect(next.latitude).toBe(13.05);
    expect(next.longitude).toBe(77.62);
    expect(next.zoom).toBe(12);
  });

  it('clamps point coordinates to Bangalore bounds', () => {
    expect(clampToBangalore({ latitude: 12.5, longitude: 78.0 })).toEqual({
      latitude: 12.8,
      longitude: 77.8,
    });
  });

  it('flies map camera to bounded Bangalore position', () => {
    const mapMock = { flyTo: vi.fn() };
    flyTo(mapMock, { latitude: 12.9716, longitude: 77.5946 });

    expect(mapMock.flyTo).toHaveBeenCalledWith({
      center: [77.5946, 12.9716],
      zoom: DEFAULT_ZOOM,
      essential: true,
    });
  });
});
