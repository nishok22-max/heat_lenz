# HeatLens

Heatwave early-warning and decision-support system for Ahmedabad.
Smart India Hackathon 2026 · Problem Statement 26083 · Team Hydra.

HeatLens translates raw weather forecasts into direct human thermal stress impacts: physiological thermal indices (UTCI, WBGT, Humidex), ward-level microclimate exposure, AMC Heat Action Plan alert triggers, and actionable public health advisories. Every indicator carries an evidence badge for transparent traceability.

## Repository Layout

```
backend/            FastAPI API (app/) and rule tables (rules/)
frontend/           React + TypeScript + Vite dashboard
htsi/               Science engine: Plans A–D (thermal metrics, HTSI, heat debt, ensemble)
datasets/           Runtime datasets loaded by the API
results/            Precomputed outputs loaded at API startup
deploy/             Production deployment configs (nginx)
```

## Quick Start

### Option 1: Run Locally

#### 1. Backend (Python 3.12+)

Install backend runtime dependencies and launch the FastAPI server:

```bash
pip install -r backend/requirements-runtime.txt
uvicorn app.main:app --app-dir backend --port 8000
```

The API will be available at `http://localhost:8000` (docs at `http://localhost:8000/docs`).

#### 2. Frontend (Node 20+)

In a second terminal, install dependencies and start the Vite dev server:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

---

### Option 2: Run with Docker

To build and run both frontend and backend in a unified container:

```bash
docker build -t heatlens .
docker run -p 8000:8000 heatlens
```

Access the complete application at `http://localhost:8000`.
