import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo, useState, useCallback } from 'react';
import DataStatusBadge from './components/DataStatusBadge.jsx';
import DisclaimerModal from './components/DisclaimerModal.jsx';
import FilterPanel from './components/FilterPanel.jsx';
import HeatmapLayer from './components/HeatmapLayer.jsx';
import SafeTourMap from './components/Map.jsx';
import Legend from './components/Legend.jsx';
import TimeSlider, { useDebouncedValue } from './components/TimeSlider.jsx';
import { useDataStatus, useHeatmap, useMeta } from './lib/api.js';
import { useMapStore, getTimeBandForHour } from './store/mapStore.js';
import ErrorBoundary from './components/ErrorBoundary.jsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function AppContent() {
  const {
    hour,
    selectedCrimeTypes,
    dateRange,
    layerMode,
    setHour,
    toggleCrimeType,
    setDateRange,
    setLayerMode,
    selectedPoint,
  } = useMapStore();
  const [mapReady, setMapReady] = useState(false);

  const timeBand = getTimeBandForHour(hour);
  const debouncedHour = useDebouncedValue(hour, 300);
  const debouncedTimeBand = getTimeBandForHour(debouncedHour);

  const metaQuery = useMeta();
  const dataStatusQuery = useDataStatus();

  const heatmapParams = useMemo(() => ({
    hour: debouncedHour,
    timeBand: debouncedTimeBand,
    layer: layerMode,
    crimeType: selectedCrimeTypes,
    from: dateRange.from || undefined,
    to: dateRange.to || undefined,
  }), [debouncedHour, debouncedTimeBand, layerMode, selectedCrimeTypes, dateRange.from, dateRange.to]);

  const heatmapQuery = useHeatmap(heatmapParams);
  const handleMapReady = useCallback(() => setMapReady(true), []);

  return (
    <main className="app-shell">
      <ErrorBoundary
        fallback={(error, reload) => (
          <div className="map-fallback">
            <h2>Map Unavailable</h2>
            <p style={{ margin: '0.5rem 0', maxWidth: '500px' }}>{error?.message || 'Failed to load map'}</p>
            <button
              type="button"
              onClick={reload}
              style={{
                marginTop: '1rem',
                padding: '0.75rem 1.5rem',
                background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                border: 'none',
                borderRadius: '10px',
                color: '#052e16',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Reload Map
            </button>
          </div>
        )}
      >
        <SafeTourMap selectedPoint={selectedPoint} onMapReady={handleMapReady}>
          <HeatmapLayer data={heatmapQuery.data} layerMode={layerMode} enabled={mapReady && !!heatmapQuery.data} />
        </SafeTourMap>
      </ErrorBoundary>

      <div className="top-bar">
        <FilterPanel
          meta={metaQuery.data}
          isLoading={metaQuery.isLoading}
          error={metaQuery.error}
          onRetry={() => metaQuery.refetch()}
          selectedCrimeTypes={selectedCrimeTypes}
          onToggleCrimeType={toggleCrimeType}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          layerMode={layerMode}
          onLayerModeChange={setLayerMode}
        />
        <DataStatusBadge
          status={dataStatusQuery.data}
          isLoading={dataStatusQuery.isLoading}
          error={dataStatusQuery.error}
        />
      </div>

      <Legend layerMode={layerMode} />

      <div className="bottom-controls">
        <TimeSlider value={hour} onChange={setHour} selectedTimeBand={timeBand} />
        {heatmapQuery.isLoading && <div className="loading-pill">Refreshing heatmap…</div>}
        {heatmapQuery.error && (
          <div className="loading-pill danger" role="alert">
            <span>Heatmap unavailable: {heatmapQuery.error.message}</span>
            <button type="button" className="link-button" onClick={() => heatmapQuery.refetch()}>
              Retry
            </button>
          </div>
        )}
      </div>

      <DisclaimerModal />
    </main>
  );
}

function AppWithRootBoundary() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppWithRootBoundary />
    </QueryClientProvider>
  );
}
