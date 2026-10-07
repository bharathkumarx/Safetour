# SafeTour

SafeTour is a Bangalore-only safety web app built as a JavaScript MERN monorepo.
The MVP will provide a safety heatmap, explainable SafeScore, and safety-aware
route comparisons. The included dataset is synthetic demo data.

## Stack

- **Backend:** Node 20, Express, MongoDB/Mongoose, Zod, Vitest, Supertest
- **Frontend:** React 18, Vite, Tailwind CSS, MapLibre, React Query, Zustand

## Setup

```bash
cp Backend/.env.example Backend/.env
cp Frontend/.env.example Frontend/.env
cd Backend && npm install
cd ../Frontend && npm install
```

Start MongoDB locally, then run the services in separate terminals:

```bash
cd Backend && npm run dev
cd Frontend && npm run dev
```

Or use Docker Compose:

```bash
docker compose up --build
```

The API health endpoint is available at
`http://localhost:3000/api/v1/health`.

## Verification

```bash
cd Backend && npm test && npm run lint
cd ../Frontend && npm run build && npm test
```

The UI always identifies itself as using demo data and is not emergency guidance.