# Live data status

SafeTour currently has no real-time or public incident API. The baseline CSV
and `Data/demo_live_incidents.csv` are synthetic data. The demo fixture is
provided only to exercise ingestion and is labelled as demo data in the
product; it must not be interpreted as police or live incident information.

Incident ingestion is source-agnostic. CSV files use automatic comma/tab
delimiter detection and are validated before normalization. Invalid rows are
dropped with a reason, while Cybercrime rows are retained with `excluded=true`
so they are unavailable to heatmap, scoring, and routing calculations.

The metadata singleton records the frozen recency reference, latest incident,
historical range, data version, and freshness. An incident without
`is_night` uses `hour >= 20 || hour < 5` as the documented fallback.

## Risk refresh pipeline

`npm run build:risk` is the periodic/nightly full rebuild. It uses all stored
non-excluded incidents, advances `recencyReferenceAt` to the newest stored
incident timestamp, recomputes every incident's recency weight, rebuilds every
H3 CellRisk record, and stores one sorted raw-KDE percentile reference per
representative band plus the global city mean crime risk used by Prompt 02.
Each reference contains covered cells only. Incremental refreshes never
advance those references.

The ingestion CLI refreshes only cells within 900 m of each newly ingested
non-excluded incident. It recomputes all four representative hours, writes
CellRisk records first with unordered bulk upserts, then advances the metadata
data version. The process emits cell-change hooks for the future road-edge
refresher; no HTTP request runs this computation.

The frozen global city crime mean is the `cityMeanRisk` metadata value
(currently `0.5`, retained under that historical field name). It is the
baseline shrinkage mean in:

`crime = crimePercentile * confidence + cityMeanCrime * (1 - confidence)`.

The verifier labels this as `frozenCityMeanCrime`. Its former
`cityMeanCrime` column displayed the shrinkage numerator
`crime - crimePercentile * confidence`, which is not the mean and varied as
confidence/percentile changed. Incremental ingestion does not recompute the frozen mean; only the full
rebuild may replace it.

Crime percentile rank is against **COVERED cells in the frozen reference**:
cells with at least one non-excluded incident within 3*sigma_s (900 m).
Empty cells use crime percentile 0, then the unchanged Bayesian shrinkage
formula applies the frozen city mean because confidence is zero. This keeps
empty cells from being treated as high-percentile crime locations.

Direct `scorePoint` calls evaluate the exact requested hour using the circular
time-weight. Stored CellRisk records are computed per time band at their
representative hours (8, 14, 18, and 23), so hours 22 and 23 read the same
stored Night band even though direct score calculations can differ slightly.
SafeTour scores are therefore computed per time band for persisted risk tables;
changing direct point scoring to snap hours would be a separate behavior
change.

```bash
npm run ingest -- --file Data/demo_live_incidents.csv --source demo
npm run demo:verify
npm run demo:reset
```

The demo verifier resets demo data, captures Marathahalli scores for hours 22
and 23, ingests the fixture, reloads the in-memory store, and prints the
before/after score, label, confidence, and nearby count. Environment averaging and Bayesian shrinkage
mean that the non-increasing SafeScore guarantee applies when a severe new
incident's environment values equal the local averages; it does not apply to
every possible incident.

## Score distribution on the synthetic dataset

On the current synthetic baseline, covered-cell scores are concentrated in
Moderate, Caution, and High Caution. This is a limitation of the synthetic
dataset, not automatically a model defect. The rows have relatively narrow
environmental values, so lighting, CCTV, police proximity, and crowd
conditions do not vary enough to spread the environment component across the
full score range. Real data with more varied environmental conditions is
expected to widen the score distribution.

The frozen city crime mean is `cityMeanRisk` (currently `0.5`). It is the
global mean used by Bayesian crime shrinkage:

`crime = C * confidence + cityMeanCrime * (1 - confidence)`,

where `confidence = n / (n + 5)` and `C` is the covered-cell percentile rank.
The full rebuild computes and stores it in the singleton `metadata` document;
incremental ingestion never recomputes it. Older verifier output labelled a
derived shrinkage numerator as `cityMeanCrime`, which explained its apparent
before/after change; the actual frozen city mean remained `0.5`.

Persisted scores are computed per time band using representative hours
(Morning 8, Afternoon 14, Evening 18, Night 23). `scorePoint()` still uses
the exact requested hour for its time-weight calculation, and returns
`timeBand` and `representativeHour` to make this distinction explicit. Thus
persisted Night scores for hours 22 and 23 come from the same representative
band calculation.

Real daily data requires an official, authorized source. No such source is
configured or claimed by this project.
