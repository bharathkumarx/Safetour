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
H3 CellRisk record, and stores one global sorted raw-KDE percentile reference
plus the global city mean crime risk used by Prompt 02. Incremental refreshes
never advance that reference.

The ingestion CLI refreshes only cells within 900 m of each newly ingested
non-excluded incident. It recomputes all four representative hours, writes
CellRisk records first with unordered bulk upserts, then advances the metadata
data version. The process emits cell-change hooks for the future road-edge
refresher; no HTTP request runs this computation.

```bash
npm run ingest -- --file Data/demo_live_incidents.csv --source demo
npm run demo:verify
npm run demo:reset
```

The demo verifier resets demo data, captures Koramangala scores for hours 22
and 23, ingests the fixture, reloads the in-memory store, and prints the
before/after score, risk, crime component (C), environment component (E),
confidence, and nearby count. Environment averaging and Bayesian shrinkage
mean that the non-increasing SafeScore guarantee applies when a severe new
incident's environment values equal the local averages; it does not apply to
every possible incident.

Real daily data requires an official, authorized source. No such source is
configured or claimed by this project.
