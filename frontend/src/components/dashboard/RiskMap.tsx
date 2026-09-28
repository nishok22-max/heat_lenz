/**
 * Ward map coloured by each ward's MEASURED ground temperature (MODIS land-surface temperature,
 * March-June 2022-2026) compared with the city average - the one ward-level heat signal the data
 * supports (backend/app/services/spatial.py). Colours follow the design reference's red -> green
 * scale; the legend names what they actually mean.
 */
import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet'
import { geoJSON, type Layer } from 'leaflet'
import type { Feature } from 'geojson'
import { Map as MapIcon, Minus, Plus, LocateFixed } from 'lucide-react'
import 'leaflet/dist/leaflet.css'
import type { ZoneRisk } from '../../api/hooks'
import { SURFACE_BINS, surfaceColor } from '../../lib/surface'
import { groundHeat, lakh, stressWord } from '../../lib/plain'
import { SCORE_LEGEND, scoreColor } from '../../lib/dashboard'

const LEGEND = ['Much hotter', 'Hotter', 'About average', 'Cooler', 'Much cooler']
const CENTER: [number, number] = [23.03, 72.58]

function Controls({ geojson }: { geojson: GeoJSON.FeatureCollection }) {
  const map = useMap()
  const fit = () => {
    const b = geoJSON(geojson).getBounds()
    if (b.isValid()) map.fitBounds(b, { padding: [12, 12] })
  }
  useEffect(() => {
    map.invalidateSize()
    fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geojson])
  // The panel resizes with the window (the dashboard fills the screen); keep tiles and fit in step.
  useEffect(() => {
    const el = map.getContainer()
    const ro = new ResizeObserver(() => {
      map.invalidateSize()
      fit()
    })
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, geojson])
  const btn = 'flex h-10 w-10 items-center justify-center text-[#13265C] hover:bg-[#F4F8FC]'
  return (
    <div className="absolute left-3 top-1/2 z-[1000] -translate-y-1/2 overflow-hidden rounded-xl border border-[#E3EBF5] bg-white shadow-sm">
      <button className={btn} onClick={() => map.zoomIn()} aria-label="Zoom in">
        <Plus className="h-5 w-5" />
      </button>
      <button className={`${btn} border-t border-[#EEF2F7]`} onClick={() => map.zoomOut()} aria-label="Zoom out">
        <Minus className="h-5 w-5" />
      </button>
      <button className={`${btn} border-t border-[#EEF2F7]`} onClick={fit} aria-label="Reset view">
        <LocateFixed className="h-5 w-5" />
      </button>
    </div>
  )
}

interface Props {
  geojson: GeoJSON.FeatureCollection | undefined
  zones: ZoneRisk[]
  onSelect: (zoneId: string) => void
  which?: 'day' | 'night'
  selectedId?: string | null
  title?: string
  mapClassName?: string
  /** 'surface' (default): measured ground heat. 'score': the HeatLens 0-100 score for the date. */
  colorBy?: 'surface' | 'score'
}

export default function RiskMap({
  geojson,
  zones,
  onSelect,
  which = 'day',
  selectedId = null,
  title = 'Risk Map',
  mapClassName = 'h-[300px]',
  colorBy = 'surface',
}: Props) {
  const byId = useMemo(() => new Map(zones.map((z) => [z.zone_id, z])), [zones])
  const anomaly = (z: ZoneRisk | undefined) =>
    which === 'day' ? z?.surface_temperature?.lst_day_anomaly_c : z?.surface_temperature?.lst_night_anomaly_c

  return (
    <section className="flex h-full flex-col card p-5 xl:min-h-0 xl:p-4 [@media(min-height:960px)]:xl:p-5">
      <h2 className="flex items-center gap-2 text-[16px] font-semibold text-[#13265C]">
        <MapIcon className="h-[18px] w-[18px] text-[#8A97B1]" strokeWidth={1.9} />
        {title}
      </h2>
      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3 sm:flex-row">
        <div className={`relative min-w-0 flex-none overflow-hidden sm:flex-1 rounded-xl border border-[#E8EEF6] ${mapClassName}`}>
          {geojson && (
            <MapContainer center={CENTER} zoom={11} zoomControl={false} scrollWheelZoom={false} className="h-full w-full">
              {/* OpenStreetMap's own tiles - no API key (CARTO's basemaps now stamp "API key
                  required" on every tile). A soft greyscale filter gives the light base map of the
                  design reference so the ward colours carry the meaning. */}
              <TileLayer
                url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                className="heatlens-light-tiles"
                maxZoom={19}
              />
              <GeoJSON
                key={`${zones.length}-${which}-${colorBy}-${selectedId ?? ''}-${zones[0]?.calibrated_score ?? ''}`}
                data={geojson}
                style={(f?: Feature) => {
                  const z = byId.get(String(f?.properties?.zone_id ?? ''))
                  const sel = selectedId != null && f?.properties?.zone_id === selectedId
                  return {
                    color: sel ? '#13265C' : '#FFFFFF',
                    weight: sel ? 3 : 1,
                    fillColor: (colorBy === 'score' ? z && scoreColor(z.calibrated_score) : surfaceColor(anomaly(z))) ?? '#CBD5E1',
                    fillOpacity: 0.78,
                  }
                }}
                onEachFeature={(f: Feature, layer: Layer) => {
                  const id = String(f.properties?.zone_id ?? '')
                  const z = byId.get(id)
                  const name = String(f.properties?.name ?? id)
                  const people = z?.exposure.population_count
                  layer.bindTooltip(
                    `<strong>${name}</strong><br/>${
                      colorBy === 'score' && z ? `${stressWord(z.risk_band)} · score ${z.calibrated_score.toFixed(0)}` : groundHeat(anomaly(z)).word
                    }${people != null ? `<br/>${lakh(people)} people` : ''}`,
                    { sticky: true },
                  )
                  layer.on('click', () => onSelect(id))
                }}
              />
              <Controls geojson={geojson} />
            </MapContainer>
          )}
        </div>
        <div className={`max-h-full ${colorBy === 'score' ? 'sm:w-[172px]' : 'sm:w-[148px]'} shrink-0 self-start overflow-y-auto overflow-x-hidden rounded-xl border border-[#E8EEF6] px-3 py-2 [@media(min-height:900px)]:py-3`}>
          {colorBy === 'score' ? (
            <>
              <ul className="space-y-1.5 [@media(min-height:900px)]:space-y-2.5">
                {SCORE_LEGEND.map((b) => (
                  <li key={b.label} className="flex items-center gap-2.5 whitespace-nowrap text-[14px] text-[#13265C]">
                    <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: b.color }} />
                    {b.label}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] leading-snug text-[#6B7A99] [@media(min-height:900px)]:mt-3">
                HeatLens heat-stress score (0–100). Darker = higher score.
              </p>
            </>
          ) : (
            <>
            <ul className="space-y-1.5 [@media(min-height:900px)]:space-y-2.5">
              {SURFACE_BINS.map((b, i) => (
                <li key={b.color} className="flex items-center gap-2.5 whitespace-nowrap text-[14px] text-[#13265C]">
                  <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: b.color }} />
                  {LEGEND[i]}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] leading-snug text-[#6B7A99] [@media(min-height:900px)]:mt-3">
              Ground heat vs city average, {which === 'day' ? 'daytime' : 'night'}. Satellite, Mar–Jun.
            </p>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
