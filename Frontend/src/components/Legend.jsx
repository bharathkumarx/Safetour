export default function Legend({ layerMode = 'risk' }) {
  const layers = [
    { color: '#22c55e', label: 'Safer' },
    { color: '#facc15', label: 'Moderate' },
    { color: '#f97316', label: 'Higher caution' },
    { color: '#ef4444', label: 'Highest caution' },
  ];

  const description =
    layerMode === 'density'
      ? 'Density shows relative incident concentration in the selected time band.'
      : 'Risk shows the estimated safety score on a 0–1 scale for the active time band.';

  return (
    <div className="legend-panel">
      <div className="legend-header">{layerMode === 'risk' ? 'Risk scale' : 'Density scale'}</div>
      <div className="legend-bar" aria-hidden="true">
        {layers.map((item) => (
          <span key={item.label} style={{ background: item.color }} title={item.label} />
        ))}
      </div>
      <p>{description}</p>
    </div>
  );
}
