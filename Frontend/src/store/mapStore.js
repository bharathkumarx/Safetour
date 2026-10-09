import { create } from 'zustand';

export const BANGALORE_BOUNDS = {
  minLat: 12.8,
  maxLat: 13.18,
  minLng: 77.45,
  maxLng: 77.8,
};

export const TIME_BAND_OPTIONS = [
  { key: 'Morning', label: 'Morning', representativeHour: 8 },
  { key: 'Afternoon', label: 'Afternoon', representativeHour: 14 },
  { key: 'Evening', label: 'Evening', representativeHour: 18 },
  { key: 'Night', label: 'Night', representativeHour: 23 },
];

export function clampHour(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 22;
  }
  return Math.min(23, Math.max(0, Math.round(numericValue)));
}

export function getTimeBandForHour(inputHour) {
  const hour = clampHour(inputHour);
  if (hour >= 5 && hour <= 10) return 'Morning';
  if (hour >= 11 && hour <= 16) return 'Afternoon';
  if (hour >= 17 && hour <= 19) return 'Evening';
  return 'Night';
}

export function getRepresentativeHourForBand(band) {
  const match = TIME_BAND_OPTIONS.find((option) => option.key === band);
  return match ? match.representativeHour : 22;
}

export const useMapStore = create((set) => ({
  hour: 22,
  selectedCrimeTypes: [],
  dateRange: { from: '', to: '' },
  layerMode: 'risk',
  selectedPoint: null,
  isFilterPanelOpen: true,
  isDisclaimerOpen: true,
  setHour: (value) => set({ hour: clampHour(value) }),
  setSelectedCrimeTypes: (types) => set({ selectedCrimeTypes: Array.isArray(types) ? types : [] }),
  toggleCrimeType: (crimeType) => set((state) => {
    const exists = state.selectedCrimeTypes.includes(crimeType);
    return {
      selectedCrimeTypes: exists
        ? state.selectedCrimeTypes.filter((type) => type !== crimeType)
        : [...state.selectedCrimeTypes, crimeType],
    };
  }),
  setDateRange: (range) => set({ dateRange: range || { from: '', to: '' } }),
  setLayerMode: (mode) => set({ layerMode: mode === 'density' ? 'density' : 'risk' }),
  setSelectedPoint: (point) => set({ selectedPoint: point }),
  setFilterPanelOpen: (open) => set({ isFilterPanelOpen: Boolean(open) }),
  setDisclaimerOpen: (open) => set({ isDisclaimerOpen: Boolean(open) }),
}));

export function getTimeBandSummary(hour) {
  const timeBand = getTimeBandForHour(hour);
  return { timeBand, representativeHour: getRepresentativeHourForBand(timeBand) };
}
