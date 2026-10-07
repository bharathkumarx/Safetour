# SafeTour — project context

SafeTour is a Bangalore-only safety web app (mobile app later).
MVP features:
1. Safety heatmap (filters: time of day, crime type, date range)
2. SafeScore 0-100 for any place/point with explainable breakdown
3. Safest route A->B compared with fastest route (safety-vs-speed slider)

NOTE: docs/SAFETOUR_PLAN.md mentions Python/FastAPI in places. IGNORE that. The stack below wins.
Only the ALGORITHMS in docs/SAFETOUR_PLAN.md section 5 apply, with the dataset-specific adjustments in this file.

## Stack (MERN, JavaScript only, ES modules: "type": "module")
- Backend/: Node 20 + Express, Mongoose (MongoDB Atlas), Zod, h3-js, kdbush + geokdbush, @turf/turf, d3-array,
  csv-parse, ngraph.graph + ngraph.path, helmet, cors, compression, express-rate-limit, pino + pino-http,
  node-cache, swagger-ui-express, dotenv
- Backend tests: Vitest + Supertest + mongodb-memory-server. Lint: ESLint + Prettier.
- Frontend/: React 18 + Vite (JavaScript/JSX), Tailwind, shadcn/ui (JS mode), react-map-gl + maplibre-gl,
  @tanstack/react-query, zustand, framer-motion, lucide-react. Tests: Vitest + Testing Library; e2e: Playwright.
- Data/: bangalore_crime_dataset.csv (provided by the user, do not regenerate or modify it)
- docs/: SAFETOUR_PLAN.md, API.md, openapi.yaml

## Backend layout
Backend/src/
  server.js, app.js, config/ (env.js, constants.js = ALL tunable constants),
  routes/, controllers/, services/ (dataStore.js loads data at startup),
  engine/ (timeWeight.js, kde.js, scoring.js, riskEngine.js), routing/ (graph.js, router.js),
  models/ (Incident.js, CellRisk.js), middleware/ (validate.js, errorHandler.js, rateLimit.js), utils/
Backend/scripts/: seedIncidents.js, buildRiskTables.js, buildGraph.js, benchmarkRoutes.js
Backend/tests/

## DATASET (Data/bangalore_crime_dataset.csv, ~1500 rows, SYNTHETIC, already cleaned)
Columns: latitude, longitude, crime_type, crime_severity (about 2-8, scale 0-10), date (YYYY-MM-DD, 2023-2024),
time (HH:MM), hour (0-23), area, lighting_score, cctv_score, crowd_density, police_proximity (all 0-1), is_night (0/1)
- File may be comma- OR tab-separated: auto-detect the delimiter.
- crime_type values include: Theft, Chain Snatching, Pickpocketing, Vehicle Theft, Robbery, Assault, Eve Teasing,
  Drug Offense, Vandalism, Cybercrime.
- EXCLUDED_CRIME_TYPES = ['Cybercrime'] (config constant): store them in MongoDB but exclude from heatmap, score and routing.
- EXCLUDED_AREAS_FROM_RANKING = ['Random Spread']: still used for scoring, just not listed in the area ranking.
- ALL spatial work uses latitude/longitude ONLY. The `area` column is a display label and may not match coordinates.
- Use the file's is_night column for night/day weighting. Time bands: Morning 05-11, Afternoon 11-17, Evening 17-20,
  Night 20-05. Representative query hours per band: 8, 14, 18, 23.
- Recency weight is measured from the NEWEST date in the dataset (not today's date).
- lighting/cctv/crowd/police values belong to each incident row. For a location, average them over nearby incidents.
  If there are too few nearby incidents, shrink toward the city average and lower the confidence.
- The UI must always show a "Demo data" badge and a short disclaimer.

## Algorithms
- H3 resolution 9 cells (h3-js v4: latLngToCell, cellToLatLng, polygonToCells, cellToBoundary, gridDisk)
- time weight: circular Gaussian, sigma_t = 2.5 h; recency half-life 365 days
- crime risk C: severity-weighted Gaussian KDE (sigma_s = 300 m; neighbours within 3*sigma via kdbush/geokdbush),
  then log(1+x), then percentile rank against all cells, giving 0-1
- environment vulnerability E = 1 - (0.30 lighting + 0.25 cctv + 0.25 police + 0.20 crowd_effect);
  night: lighting weight x1.4, crowd counts as protective; day: lighting weight x0.6; renormalise weights.
  For Pickpocketing/Chain Snatching dominated areas, very high crowd is NOT protective.
- Risk = 0.6*C + 0.4*E ; SafeScore = round(100*(1-Risk)); Bayesian shrinkage k=5 toward the city mean; confidence = n/(n+k)
- Labels: 80-100 Very Safe, 65-79 Safe, 50-64 Moderate, 35-49 Caution, 0-34 High Caution
- Routing: custom graph from OpenStreetMap, edge cost = length*(1+lambda*risk*4), A*, max detour 1.5x fastest.
- Heavy computation (KDE for all cells, edge risk) runs in offline scripts, NEVER in a request handler.
  Load cell risk and the graph into memory once at server startup.

## Rules
- JavaScript only (no TypeScript). JSDoc on exported functions. Small pure functions.
- Validate every request with Zod. Coordinates must be inside Bangalore: lat 12.80-13.18, lng 77.45-77.80.
- Error JSON: { error: { code, message, details? } }. Never leak stack traces.
- Every engine/service function gets Vitest tests; every route gets Supertest tests.
- No secrets in code; config via .env (keep .env.example updated).
- Neutral UI wording ("Higher caution"); never "dangerous area". Do not store user location on the server.
- UI style: dark glassmorphism; palette #22C55E #FACC15 #F97316 #EF4444; bg #0B1020; panels rgba(20,27,45,0.72) + backdrop-blur;
  Inter font; Lucide icons; mobile-first bottom sheet; accessible (keyboard, aria, colourblind-safe option).
- Conventional Commits. Before coding any task: list the plan and files you will touch. After: run tests/lint and report.