export default function Legend({ layerMode = 'risk' }) {
  const isRisk = layerMode === 'risk';
  const layers = isRisk
    ? [
        { color: 'rgba(255, 255, 255, 0.08)', label: 'Low / baseline' },
        { color: '#facc15', label: 'Moderate' },
        { color: '#f97316', label: 'Higher caution' },
        { color: '#ef4444', label: 'Highest caution' },
      ]
    : [
        { color: '#3b82f6', label: 'Low density' },
        { color: '#0ea5e9', label: 'Medium density' },
        { color: '#facc15', label: 'High density' },
        { color: '#ef4444', label: 'Highest density' },
      ];

  const description = isRisk
    ? 'Risk hotspots glow from yellow to red over areas with elevated calculated risk.'
    : 'Density shows relative incident concentration in the selected time band.';

  return (
    <div className="legend-panel">
      <div className="legend-header">{isRisk ? 'Risk scale' : 'Density scale'}</div>
      <div className="legend-bar" aria-hidden="true">
        {layers.map((item) => (
          <span key={item.label} style={{ background: item.color }} title={item.label} />
        ))}
      </div>
      <p>{description}</p>
    </div>
  );
}
