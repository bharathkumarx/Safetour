import { AlertTriangle, Filter, Layers3 } from 'lucide-react';

export default function FilterPanel({
  meta,
  isLoading,
  error,
  onRetry,
  selectedCrimeTypes,
  onToggleCrimeType,
  dateRange,
  onDateRangeChange,
  layerMode,
  onLayerModeChange,
}) {
  const crimeTypes = Array.isArray(meta?.crimeTypes) ? meta.crimeTypes.filter((type) => type !== 'Cybercrime') : [];

  return (
    <aside className="filter-panel">
      <div className="panel-header">
        <div className="panel-title-wrap">
          <Filter size={16} />
          <strong>Filters</strong>
        </div>
      </div>

      {isLoading ? (
        <div className="panel-state">Loading safe-area filters…</div>
      ) : error ? (
        <div className="panel-state error-state">
          <AlertTriangle size={14} />
          <span>Could not load filters.</span>
          <button type="button" className="link-button" onClick={onRetry}>Retry</button>
        </div>
      ) : (
        <>
          <div className="filter-block">
            <label className="field-label">Crime type</label>
            <div className="chip-list">
              {crimeTypes.length === 0 ? (
                <span className="muted-text">No eligible crime types available.</span>
              ) : (
                crimeTypes.map((crimeType) => (
                  <button
                    key={crimeType}
                    type="button"
                    className={`chip ${selectedCrimeTypes.includes(crimeType) ? 'selected' : ''}`}
                    onClick={() => onToggleCrimeType(crimeType)}
                    aria-pressed={selectedCrimeTypes.includes(crimeType)}
                  >
                    {crimeType}
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="filter-block">
            <label className="field-label">Date range</label>
            <div className="date-grid">
              <label>
                <span>From</span>
                <input
                  type="date"
                  value={dateRange?.from || ''}
                  onChange={(event) => onDateRangeChange({ ...dateRange, from: event.target.value })}
                />
              </label>
              <label>
                <span>To</span>
                <input
                  type="date"
                  value={dateRange?.to || ''}
                  onChange={(event) => onDateRangeChange({ ...dateRange, to: event.target.value })}
                />
              </label>
            </div>
          </div>

          <div className="filter-block">
            <label className="field-label">Layer</label>
            <div className="segment-control" aria-label="Heatmap layer mode">
              <button
                type="button"
                className={layerMode === 'risk' ? 'active' : ''}
                onClick={() => onLayerModeChange('risk')}
              >
                <Layers3 size={14} /> Risk
              </button>
              <button
                type="button"
                className={layerMode === 'density' ? 'active' : ''}
                onClick={() => onLayerModeChange('density')}
              >
                <Layers3 size={14} /> Density
              </button>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
