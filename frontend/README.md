# HeatLens frontend

React 19 + TypeScript + Vite, Tailwind v4, TanStack Query, react-router, react-leaflet, Recharts.
The plan, and the reasoning behind every page, is in
[`../docs/IMPLEMENTATION_PLAN.md`](../docs/IMPLEMENTATION_PLAN.md) (§6 Frontend design, §8 phases).

## Run

The dev server proxies `/api` to the FastAPI backend on `127.0.0.1:8000`, so start that first
(see the plan's §10, or [`../docs/DEMO_WALKTHROUGH.md`](../docs/DEMO_WALKTHROUGH.md)).

```bash
npm install
npm run dev
```

## Scripts

| Script | Does |
|---|---|
| `npm run dev` | Vite dev server on :5173 |
| `npm run build` | `tsc -b` then production build |
| `npm run lint` | oxlint |
| `npm run gen:types` | Regenerate `src/types/api.ts` from the **running** backend's OpenAPI schema. Run after any backend schema change |

## Pages

| Route | Page | Purpose |
|---|---|---|
| `/` | Dashboard | Map of the 127 zones. **Live forecast** (Today, D+1…D+5) or **Historical replay** (seeded on 21 May 2010). `?mode=history&date=…` is shareable |
| `/zones/:id?date=` | ZoneView | One zone: trend, mortality risk, driver breakdown, heat debt |
| `/forecast` | ForecastView | The D+1…D+5 table with mortality relative risk |
| `/advisory/:id?date=` | AdvisoryView | Heat Action Plan triggers, persona advisory, CAP preview, simulated dispatch |
| `/methods` | MethodsView | Evidence ledger, what is and is not validated, benchmark |
| `/public/:id?date=` | PublicView | Citizen-facing, phone-sized, EN/HI/GU. Sits outside the nav layout |

## Two rules worth knowing

- **Every value that is not directly measured carries an evidence badge** (`components/layout/EvidenceBadge.tsx`).
- **Tables the backend owns are duplicated here** — band thresholds (`lib/bands.ts`), HAP levels
  (`lib/hap.ts`), evidence labels, and the Hindi/Gujarati band words (`lib/i18n.ts`). They are
  checked against the backend by `backend/tests/test_frontend_parity.py`, so a change on one side
  fails the tests instead of silently contradicting the other.

`--reload`/HMR were unreliable on this checkout (see the plan's Phase 2 notes): restart the dev
servers after edits if a change does not appear.
