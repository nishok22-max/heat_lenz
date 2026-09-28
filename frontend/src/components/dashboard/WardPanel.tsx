/**
 * Ward details for the City Map, in plain English. Every value comes from the ward's ZoneRisk:
 * - HeatLens score, air temperature, UTCI, WBGT, night minimum: on live dates, the forecast at this
 *   ward's own model grid cell (wards in the same cell share values); on historical dates the
 *   city-level record - ZoneRisk.weather_basis says which, and the panel shows it;
 * - "Why is it so hot here?": backend/app/services/explain.py, built from the ward's measured
 *   ground temperature and land cover;
 * - the ground make-up bars: ESA WorldCover 2021.
 */
import { Link } from 'react-router-dom'
import { ChevronRight, X } from 'lucide-react'
import type { ZoneRisk } from '../../api/hooks'
import { BAND_PILL, utciCategory } from '../../lib/dashboard'
import { lakh, scoreDeaths } from '../../lib/plain'
import { weatherBasisShort } from '../../lib/surface'

const c = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)} °C`)

function Stat({ label, value, note, hint }: { label: string; value: string; note: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-[#E8EEF6] px-3 py-2.5" title={hint}>
      <p className="text-[12px] text-[#6B7A99]">{label}</p>
      <p className="text-[20px] font-bold leading-tight text-[#13265C]">{value}</p>
      <p className="text-[12px] leading-snug text-[#3D4B6B]">{note}</p>
    </div>
  )
}

function Bar({ label, pct, city, color }: { label: string; pct: number; city: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-[12px] text-[#3D4B6B]">
        <span>{label}</span>
        <span>
          <strong className="text-[#13265C]">{pct.toFixed(0)}%</strong>{' '}
          <span className="text-[#8A97B1]">city {city.toFixed(0)}%</span>
        </span>
      </div>
      <div className="relative mt-1 h-2 rounded-full bg-[#EEF2F7]">
        <div className="h-2 rounded-full" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: color }} />
        <div
          className="absolute top-[-3px] h-[14px] w-[2px] bg-[#13265C]/50"
          style={{ left: `${Math.min(100, city)}%` }}
          title="City average"
        />
      </div>
    </div>
  )
}

export default function WardPanel({
  zone,
  date,
  onClose,
  detailsLink = true,
}: {
  zone: ZoneRisk | null
  date: string
  /** Omitted on the ward's own page, where there is nothing to close. */
  onClose?: () => void
  /** Off on the ward's own page, where the link would point to itself. */
  detailsLink?: boolean
}) {
  if (!zone) {
    return (
      <section className="flex h-full items-center justify-center card p-6 text-center">
        <p className="text-[15px] text-[#3D4B6B]">Click any ward on the map to see how hot it is, and why.</p>
      </section>
    )
  }
  const t = zone.thermal
  const pill = BAND_PILL[zone.risk_band]
  const lc = zone.land_cover
  const people = zone.exposure.population_count
  const ownForecast = (zone.weather_basis ?? '').startsWith('Open-Meteo forecast for this ward')

  return (
    <section className="flex h-full min-h-0 flex-col overflow-y-auto card p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-[22px] font-bold leading-tight text-[#13265C]">{zone.name}</h2>
          <p className="text-[13px] text-[#6B7A99]">{people != null ? `About ${lakh(people)} people live here` : zone.zone_id}</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="rounded-lg p-1 text-[#6B7A99] hover:bg-[#F4F8FC]" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <p className="mt-4 text-[12px] font-bold uppercase tracking-wide text-[#6B7A99]">
        {ownForecast ? 'Heat today · forecast for this part of the city' : 'Heat today · same for the whole city'}
      </p>
      {zone.weather_basis && (
        <p className="mt-0.5 text-[11.5px] leading-snug text-[#8A97B1]" title={zone.weather_basis}>
          {weatherBasisShort(zone.weather_basis)}
        </p>
      )}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div
          className="col-span-2 flex items-center justify-between rounded-xl border border-[#E8EEF6] px-3 py-2.5"
          title={`HeatLens heat-stress score (0–100): combines UTCI, WBGT, how far today is above normal, and heat built up over hot nights. ${scoreDeaths(zone.score_mortality, zone.calibrated_score).detail}`}
        >
          <div>
            <p className="text-[12px] text-[#6B7A99]">HeatLens score (0–100)</p>
            <p className="text-[24px] font-bold leading-tight text-[#13265C]">{zone.calibrated_score.toFixed(0)}</p>
            <p className="text-[12px] text-[#3D4B6B]">{scoreDeaths(zone.score_mortality, zone.calibrated_score).word}</p>
          </div>
          {pill && (
            <span
              className="rounded-md px-3 py-1.5 text-[14px] font-semibold"
              style={{ backgroundColor: pill.bg, color: pill.fg }}
            >
              {zone.risk_band}
            </span>
          )}
        </div>
        <Stat label="Air temperature (max)" value={c(t.ta_max_c)} note="The hottest the air gets today." />
        <Stat
          label="In the sun (UTCI)"
          value={c(t.utci_max_c)}
          note={utciCategory(t.utci_max_c)}
          hint="UTCI: how hot it feels to the body, counting sun, wind and humidity (published UTCI scale)."
        />
        <Stat
          label="Work safety (WBGT)"
          value={c(t.wbgt_max_c)}
          note={
            t.wbgt_max_c != null && t.wbgt_max_c >= 33
              ? 'Above 33 °C: rest only, no hard outdoor work.'
              : 'Below the 33 °C "rest only" limit.'
          }
          hint="WBGT: heat + humidity + sun, the standard used for outdoor work safety (ISO 7243)."
        />
        <Stat label="Lowest tonight" value={c(t.night_min_ta_c)} note="How cool the air gets at night." />
      </div>

      <p className="mt-5 text-[12px] font-bold uppercase tracking-wide text-[#6B7A99]">Why is it so hot here?</p>
      <ul className="mt-2 space-y-2">
        {(zone.why_hot ?? []).map((s) => (
          <li key={s} className="flex gap-2 text-[14px] leading-snug text-[#13265C]">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#EF4444]" />
            {s}
          </li>
        ))}
      </ul>

      {lc && (
        <>
          <p className="mt-5 text-[12px] font-bold uppercase tracking-wide text-[#6B7A99]">What the ground is made of</p>
          <div className="mt-2 space-y-2.5">
            <Bar label="Buildings and roads" pct={lc.built_up_pct} city={lc.city_built_up_pct} color="#EF4444" />
            <Bar label="Trees" pct={lc.trees_pct} city={lc.city_trees_pct} color="#22A559" />
            <Bar label="Farmland" pct={lc.cropland_pct} city={lc.city_cropland_pct} color="#FBBF24" />
            <Bar label="Water" pct={lc.water_pct} city={lc.city_water_pct} color="#1468D4" />
          </div>
          <p className="mt-2 text-[11px] text-[#8A97B1]">
            ESA WorldCover 2021 satellite land map. Ground heat: NASA MODIS, March–June.
          </p>
        </>
      )}

      {detailsLink && (
        <Link
          to={`/zones/${zone.zone_id}?date=${date}`}
          className="mt-4 flex items-center justify-between rounded-xl border border-[#E8EEF6] px-3 py-2.5 text-[14px] font-semibold text-[#1468D4] hover:bg-[#F7FAFE]"
        >
          Full ward details
          <ChevronRight className="h-4 w-4" />
        </Link>
      )}
    </section>
  )
}
