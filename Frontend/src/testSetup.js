import '@testing-library/jest-dom/vitest';
import React from 'react';
import { vi } from 'vitest';

const MockMap = React.forwardRef(({ children }, ref) =>
  React.createElement('div', { ref, 'data-testid': 'map-shell' }, children)
);
MockMap.displayName = 'MockMap';

vi.mock('react-map-gl/maplibre', () => ({
  default: MockMap,
  NavigationControl: () => null,
  AttributionControl: () => null,
  Layer: () => null,
  Source: () => null,
}));