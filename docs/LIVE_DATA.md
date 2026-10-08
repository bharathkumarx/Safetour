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

Real daily data requires an official, authorized source. No such source is
configured or claimed by this project.
