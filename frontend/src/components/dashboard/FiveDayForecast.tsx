import { CalendarDays } from 'lucide-react'
import { BAND_PILL, dayMonth, weekdayShort } from '../../lib/dashboard'
import { HAP_COLOR, type HapLevel } from '../../lib/hap'
import { LEVEL_PLAIN } from '../../lib/plain'
import WeatherIcon from './WeatherIcon'

export interface ForecastColumn {
  date: string
  maxTaC: number | null
  /** HeatLens heat-stress band in the most affected ward. */
  band: string | null
  /** How many wards are at that band. */
  bandWards: number | null
  /** Official AMC alert level for the day. */
  level: HapLevel | null
  cloudPct: number | null
}

export default function FiveDayForecast({ days, title }: { days: ForecastColumn[]; title: string }) {
  return (
    <section className="flex h-full flex-col card p-5 xl:min-h-0 xl:p-4 [@media(min-height:960px)]:xl:p-5">
      <h2 className="flex items-center gap-2 text-[16px] font-semibold text-[#13265C]">
        <CalendarDays className="h-[18px] w-[18px] text-[#8A97B1]" strokeWidth={1.9} />
        {title}
      </h2>
      <div className="mt-3 grid min-h-0 flex-1 grid-cols-5 overflow-hidden rounded-xl border border-[#EDF1F7]">
        {days.map((d, i) => {
          const pill = d.band ? BAND_PILL[d.band] : null
          const alert = d.level != null && d.level !== 'Green'
          return (
            <div
              key={d.date}
              className={`flex flex-col items-center justify-between gap-1 px-1.5 py-2.5 text-center ${
                i > 0 ? 'border-l border-[#EDF1F7]' : 'bg-[#F8FAFD]'
              }`}
            >
              <div>
                <p className="text-[14px] font-semibold text-[#13265C]">{i === 0 ? 'Today' : weekdayShort(d.date)}</p>
                <p className="text-[12px] text-[#8A97B1]">{dayMonth(d.date)}</p>
              </div>
              <WeatherIcon cloudPct={d.cloudPct} size={38} />
              <p className="text-[20px] font-semibold tabular-nums text-[#13265C]">
                {d.maxTaC == null ? '—' : `${Math.round(d.maxTaC)}°`}
              </p>
              <p
                className="flex items-center gap-1 whitespace-nowrap text-[11.5px] font-medium"
                style={{ color: alert ? HAP_COLOR[d.level as HapLevel] : '#6B7A99' }}
                title="Official AMC alert (Heat Action Plan 2019)"
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: d.level ? HAP_COLOR[d.level] : '#CBD5E1' }}
                />
                {d.level ? (alert ? LEVEL_PLAIN[d.level].headline : 'No alert') : '—'}
              </p>
              {pill ? (
                <span
                  className="w-full max-w-[88px] rounded-md py-1 text-[12.5px] font-semibold"
                  style={{ backgroundColor: pill.bg, color: pill.fg }}
                  title={
                    d.bandWards != null
                      ? `HeatLens heat stress: ${d.band} in ${d.bandWards} of 48 wards (the most affected)`
                      : undefined
                  }
                >
                  {d.band}
                </span>
              ) : (
                <span className="py-1 text-sm text-[#8A97B1]">—</span>
              )}
            </div>
          )
        })}
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-[#6B7A99]">
        <span>
          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[#94A3B8] align-middle" />
          Official AMC alert
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-3 rounded-sm border border-[#CBD5E1] bg-[#F1F5F9] align-middle" />
          HeatLens heat stress, most affected ward
        </span>
      </p>
    </section>
  )
}
