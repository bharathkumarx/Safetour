import { describe, expect, it } from 'vitest';
import { updateCameraState } from './Map.jsx';

describe('SafeTour map camera state', () => {
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

  it('clamps moved cameras to Bangalore bounds', () => {
    const next = updateCameraState(
      { latitude: 12.9716, longitude: 77.5946, zoom: 11 },
      { latitude: 20, longitude: 70, zoom: 11 },
    );

    expect(next.latitude).toBe(13.18);
    expect(next.longitude).toBe(77.45);
  });
});
