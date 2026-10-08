# SafeTour REST API

Base URL: `/api/v1`. All responses use `{ data: ... }`; errors use
`{ error: { code, message, details? } }`.

The API serves synthetic historical/demo data and is **not a live crime feed**.
Every score, heatmap, and area response includes a `freshness` object with
`dataVersion`, `dataThrough`, and `isSynthetic`.

## Endpoints

- `GET /health` — process health and configured data version.
- `GET /data-status` — metadata, historical range, and freshness.
- `GET /score` (alias `/score/point`) — `lat`, `lng`, optional `hour` (0–23);
  returns SafeScore 0–100, label, risk, confidence, and component breakdown.
- `GET /heatmap` (alias `/heatmap/cells`) — optional `band` (`Morning`,
  `Afternoon`, `Evening`, `Night`), returns persisted H3 cell risks.
- `GET /areas` — incident counts by display area, excluding configured ranking
  exclusions.

Coordinates are restricted to the Bangalore bounding box
(latitude 12.80–13.18, longitude 77.45–77.80). OpenAPI UI is available at
`/api/docs`.

The process loads incidents and persisted risk tables once at startup. It polls
metadata `dataVersion` (default every 30 seconds, configurable with
`DATA_POLL_SECONDS`, or disabled with `0`) and atomically reloads in-memory data
when it changes. Swagger UI is available at `/docs`.
