import '@testing-library/jest-dom/vitest';
import React from 'react';
import { vi } from 'vitest';

vi.mock('react-map-gl/maplibre', () => ({
  default: React.forwardRef(({ children }, ref) => React.createElement('div', { ref, 'data-testid': 'map-shell' }, children)),
  NavigationControl: () => null,
  AttributionControl: () => null,
  Layer: () => null,
  Source: () => null,
}));
