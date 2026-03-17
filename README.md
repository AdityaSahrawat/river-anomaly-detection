# River Anomaly Detection (Sentinel‑2 → Water Area → API)

This repo turns Sentinel‑2 scenes into a simple **river water-area time series**, then serves it via a small **Go JSON API** (the frontend is optional).

## What’s happening (backend flow)

1. **(Pipeline)** Create `server/data/processed/*.tif` (multi-band GeoTIFFs per scene).
2. **(Timeseries)** Convert those rasters into `server/data/river_area_timeseries.csv`.
3. **(API)** Go server reads the CSV and returns JSON with `% change` + anomaly flags.

---

## Quickstart (backend)

### 0) Prereqs

- Python 3.x (with geospatial deps)
- Go 1.22+

### 1) Create a Python env + install deps

From the repo root:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r server/req.txt
```

### 2) Generate the timeseries CSV

This reads `server/data/processed/*.tif` and writes `server/data/river_area_timeseries.csv`.

```bash
source .venv/bin/activate
python server/app/pipeline/water_area_timeseries.py
```

Useful env vars:

- `PROCESSED_DIR` (default: `server/data/processed`)
- `OUT_CSV` (default: `server/data/river_area_timeseries.csv`)
- `NDWI_THRESHOLD` (default: `0.1`)

Example:

```bash
NDWI_THRESHOLD=0.2 python server/app/pipeline/water_area_timeseries.py
```

### 3) Run the Go API

```bash
cd server/app
go run .
```

Health check:

```bash
curl http://localhost:8080/healthz
```

Timeseries:

```bash
curl "http://localhost:8080/api/timeseries?pctDrop=-0.4"
```

#### API behavior

- The server reads the CSV from `TIMESERIES_CSV` if set.
- Otherwise it looks for `server/data/river_area_timeseries.csv`.
- It returns rows sorted by date and computes:
  - `pct_change` = change vs previous row (only when previous area > 0)
  - `anomaly` when `pct_change < pctDrop` (default `pctDrop=-0.4`)

Backend env vars:

- `ADDR` (default `:8080`)
- `TIMESERIES_CSV` (optional override)
- `CORS_ORIGIN` (comma-separated allowlist; defaults to common localhost ports)

---

## Repo layout

- `server/app/main.go`: Go API (`/healthz`, `/api/timeseries`)
- `server/app/pipeline/`: Python pipeline utilities
- `server/data/river_area_timeseries.csv`: API source-of-truth CSV
- `server/data/processed/`: processed per-scene GeoTIFFs (input to CSV generation)
- `frontend/`: Next.js dashboard (consumes the Go API; Next.js API is intentionally disabled)

---

## Frontend (optional)

If you want the dashboard:

```bash
cd frontend
npm install
```

Create `frontend/.env.local`:

- `NEXT_PUBLIC_API_BASE=http://localhost:8080`
- `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=...` (required for the map)
- `NEXT_PUBLIC_RIVER_GEOJSON_URL=/river.geojson` (optional overlay)

Run:

```bash
npm run dev
```
