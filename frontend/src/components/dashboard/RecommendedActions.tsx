import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ChevronRight,
  Droplet,
  HardHat,
  HeartPulse,
  Home,
  ListChecks,
  Megaphone,
  Stethoscope,
  Sun,
  Umbrella,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { SOURCE_LABEL, type ActionRow, type ActionSource } from '../../lib/actions'

const ICON: Record<string, LucideIcon> = {
  hydration: Droplet,
  cooling_centre: Umbrella,
  cooling_centre_activation: Umbrella,
  vulnerable_check: Users,
  work_hours: HardHat,
  work_hours_restriction: HardHat,
  public_awareness: Megaphone,
  readiness_check: Stethoscope,
  hospital_preparedness: Stethoscope,
  emergency_readiness: Stethoscope,
  power_supply_protection: Zap,
  health_alert: HeartPulse,
  // resident tips (lib/advice.ts)
  water: Droplet,
  sun: Sun,
  indoors: Home,
  elderly: Users,
  work: HardHat,
}

const SOURCE_STYLE: Record<ActionSource, string> = {
  plan: 'bg-[#EAF2FD] text-[#1459B8]',
  suggestion: 'bg-[#FFF4E5] text-[#9A4B00]',
  advice: 'bg-[#F1F4F9] text-[#51607F]',
}

export default function RecommendedActions({
  rows,
  loading,
  title = 'Actions today',
  note,
  showSource = true,
}: {
  rows: ActionRow[]
  loading: boolean
  title?: string
  /** One line above the list, e.g. what the plan asks at today's level. */
  note?: ReactNode
  showSource?: boolean
}) {
  return (
    <section className="flex h-full flex-col card p-5 xl:min-h-0 xl:p-4 [@media(min-height:960px)]:xl:p-5">
      <h2 className="flex items-center gap-2 text-[16px] font-semibold text-[#13265C]">
        <ListChecks className="h-[18px] w-[18px] text-[#8A97B1]" strokeWidth={1.9} />
        {title}
      </h2>
      {note && <div className="mt-1.5 text-[12.5px] leading-snug text-[#6B7A99]">{note}</div>}
      <div className="mt-3 min-h-0 overflow-y-auto rounded-xl border border-[#EDF1F7]">
        {loading && <p className="px-4 py-4 text-sm text-[#6B7A99]">Loading…</p>}
        {!loading && rows.length === 0 && (
          <p className="px-4 py-4 text-sm text-[#6B7A99]">No actions are needed at today&apos;s level.</p>
        )}
        {!loading &&
          rows.map((r, i) => {
            const Icon = ICON[r.kind] ?? ChevronRight
            return (
              <Link
                key={r.key}
                to={r.to}
                className={`group flex items-start gap-3 px-3.5 py-2.5 text-[14px] leading-snug text-[#13265C] hover:bg-[#F8FAFD] ${
                  i > 0 ? 'border-t border-[#EDF1F7]' : ''
                }`}
              >
                <Icon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-[#1468D4]" strokeWidth={1.9} />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2">{r.text}</span>
                  {showSource && (
                    <span className={`mt-1 inline-block rounded px-1.5 py-px text-[11px] font-medium ${SOURCE_STYLE[r.source]}`}>
                      {SOURCE_LABEL[r.source]}
                    </span>
                  )}
                </span>
                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-[#B4BFD3] group-hover:text-[#13265C]" />
              </Link>
            )
          })}
      </div>
    </section>
  )
}
