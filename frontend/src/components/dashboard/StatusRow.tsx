import type { CSSProperties, ReactNode } from 'react'

export interface StatusCard {
  key: string
  icon: ReactNode
  label: string
  value: string
  sub?: string
  valueColor?: string
  /** Soft background for the headline card (the official alert colour). */
  bg?: string
  /** Strong colour for the headline card's left edge. */
  accent?: string
  hint?: string
  /** The first card of a row: the day's headline, drawn a little larger. */
  headline?: boolean
}

/** One row of status cards: a small label, one large value, one line of context. */
export default function StatusRow({ cards }: { cards: StatusCard[] }) {
  return (
    <div
      className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:[grid-template-columns:var(--status-cols)]"
      style={{ '--status-cols': `minmax(0,1.35fr) repeat(${Math.max(1, cards.length - 1)}, minmax(0,1fr))` } as CSSProperties}
    >
      {cards.map((c) => (
        <div
          key={c.key}
          title={c.hint}
          style={{
            ...(c.bg ? { backgroundColor: c.bg } : {}),
            ...(c.accent ? { boxShadow: `inset 3px 0 0 ${c.accent}` } : {}),
          }}
          className={`card flex min-w-0 flex-col justify-between gap-2 overflow-hidden px-4 py-3.5 ${
            c.headline ? 'col-span-2 md:col-span-1' : ''
          }`}
        >
          <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#6B7A99]">
            <span className="shrink-0 [&>svg]:h-4 [&>svg]:w-4">{c.icon}</span>
            <span className="truncate">{c.label}</span>
          </p>
          <div className="min-w-0">
            <p
              className={`truncate font-semibold leading-tight tracking-tight tabular-nums ${
                c.headline ? 'text-[22px]' : 'text-[21px]'
              }`}
              style={{ color: c.valueColor ?? '#13265C' }}
            >
              {c.value}
            </p>
            {c.sub && <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-[#6B7A99]">{c.sub}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}
