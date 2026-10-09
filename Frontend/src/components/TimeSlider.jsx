import { useEffect, useMemo, useState } from 'react';
import { MoonStar, SunMedium } from 'lucide-react';
import { getTimeBandForHour, TIME_BAND_OPTIONS } from '../store/mapStore.js';

export function useDebouncedValue(value, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

export default function TimeSlider({ value, onChange, selectedTimeBand }) {
  const [draftValue, setDraftValue] = useState(value ?? 22);
  const effectiveBand = selectedTimeBand || getTimeBandForHour(value ?? draftValue);
  const representativeHour = TIME_BAND_OPTIONS.find((option) => option.key === effectiveBand)?.representativeHour ?? 22;

  useEffect(() => {
    setDraftValue(value ?? 22);
  }, [value]);

  const hourLabel = useMemo(() => String(draftValue).padStart(2, '0'), [draftValue]);

  return (
    <div className="time-slider-panel" aria-label="Time filter controls">
      <div className="time-slider-header">
        <div className="time-slider-icon">
          {draftValue >= 20 || draftValue <= 4 ? <MoonStar size={18} /> : <SunMedium size={18} />}
        </div>
        <div>
          <div className="label-muted">Current hour</div>
          <div className="time-slider-value">{hourLabel}:00</div>
        </div>
      </div>

      <div className="band-chip-row" aria-label="Time of day quick select">
        {TIME_BAND_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            className={`band-chip ${effectiveBand === option.key ? 'selected' : ''}`}
            onClick={() => onChange?.(option.representativeHour)}
            aria-pressed={effectiveBand === option.key}
          >
            {option.label}
          </button>
        ))}
      </div>

      <label className="sr-only" htmlFor="time-slider-control">
        Select hour of day
      </label>
      <input
        id="time-slider-control"
        type="range"
        min="0"
        max="23"
        step="1"
        value={draftValue}
        onChange={(event) => {
          const nextValue = Number(event.target.value);
          setDraftValue(nextValue);
          onChange?.(nextValue);
        }}
        aria-label="Select hour"
      />

      <div className="time-band-meta">
        <span>Time band: {effectiveBand}</span>
        <span>Representative hour {representativeHour}:00</span>
      </div>
    </div>
  );
}
