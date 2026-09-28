import { useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { DEFAULT_CITY, useCityZonesGeoJSON, useForecast, useRiskZones } from '../api/hooks'
import { DEMO_DATE } from '../lib/dates'
import RiskMap from '../components/dashboard/RiskMap'
import WardPanel from '../components/dashboard/WardPanel'

function useToday(): string {
  const [params] = useSearchParams()
  const forecast = useForecast(DEFAULT_CITY, 5)
  return params.get('mode') === 'history' ? (params.get('date') ?? DEMO_DATE) : (forecast.data?.issue_date ?? '')
}

/** Full-page ward map: measured ground heat by day or by night. Clicking a ward opens its details. */
export default function CityMapView() {
  const today = useToday()
  const geo = useCityZonesGeoJSON(DEFAULT_CITY)
  const risk = useRiskZones(DEFAULT_CITY, today)
  const [which, setWhich] = useState<'day' | 'night'>('day')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const zones = risk.data?.zones ?? []
  const selected = zones.find((z) => z.zone_id === selectedId) ?? null

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 xl:h-full">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#13265C]">City Map</h1>
        <div className="flex overflow-hidden rounded-lg border border-[#DCE6F2] bg-white text-sm">
          {(['day', 'night'] as const).map((w) => (
            <button
              key={w}
              onClick={() => setWhich(w)}
              className={`px-4 py-2 ${which === w ? 'bg-[#E3EEFB] font-semibold text-[#1468D4]' : 'text-[#13265C]'}`}
            >
              {w === 'day' ? 'Hottest by day' : 'Hottest at night'}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[1fr_400px]">
        <RiskMap
          geojson={geo.data}
          zones={zones}
          which={which}
          title="Ground heat by ward"
          mapClassName="h-[460px] xl:h-auto"
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <WardPanel zone={selected} date={today} onClose={() => setSelectedId(null)} />
      </div>
    </div>
  )
}

/** "Health & Advice": the advisory is the same city-wide, so open it for the first ward. */
export function AdviceRedirect() {
  const today = useToday()
  const [params] = useSearchParams()
  const risk = useRiskZones(DEFAULT_CITY, today)
  const first = risk.data?.zones[0]?.zone_id
  if (!first) return <p className="p-6 text-sm text-[#6B7A99]">Loading…</p>
  // Keep ?for= (who the advice is for) and replay mode when arriving from another page.
  const next = new URLSearchParams(params)
  next.set('date', today)
  return <Navigate to={`/advisory/${first}?${next.toString()}`} replace />
}
