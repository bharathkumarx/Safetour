import { Clock3 } from 'lucide-react';

export default function DataStatusBadge({ status, isLoading = false, error = null }) {
  const safeStatus = status || {};

  return (
    <div className="data-status-badge-wrap" aria-live="polite">
      <span className="demo-badge">Demo data</span>
      {isLoading && <span className="demo-badge neutral">Checking data status…</span>}
      {!isLoading && error && <span className="demo-badge neutral">Data status unavailable</span>}
      {!isLoading && !error && (
        <>
          {Boolean(safeStatus.isSynthetic ?? true) && (
            <span className="demo-badge warning">Historical/demo data — not a live crime feed</span>
          )}
          <div className="data-status-panel">
            <Clock3 size={14} />
            <span>{safeStatus.freshnessLabel || 'Historical/demo data — not a live crime feed'}</span>
            <span className="status-divider">•</span>
            <span>data through {safeStatus.latestIncidentAt ? new Date(safeStatus.latestIncidentAt).toLocaleDateString('en-IN') : 'Unavailable'}</span>
            <span className="status-divider">•</span>
            <span>{safeStatus.dataVersion ? `v${safeStatus.dataVersion}` : 'no version'}</span>
          </div>
        </>
      )}
    </div>
  );
}
