import { describe, expect, it } from 'vitest';
import { getTimeBandForHour } from './mapStore.js';

describe('map store time bands', () => {
  it.each([
    [4, 'Night'],
    [5, 'Morning'],
    [10, 'Morning'],
    [11, 'Afternoon'],
    [16, 'Afternoon'],
    [17, 'Evening'],
    [19, 'Evening'],
    [20, 'Night'],
    [22, 'Night'],
    [23, 'Night'],
  ])('maps hour %i to %s', (hour, expected) => {
    expect(getTimeBandForHour(hour)).toBe(expected);
  });
});
