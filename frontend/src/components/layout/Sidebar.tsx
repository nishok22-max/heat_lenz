import { NavLink, useLocation } from 'react-router-dom'
import { PRIMARY, SECONDARY, type NavItemDef as Item } from '../../lib/nav'

function NavItem({ item, active }: { item: Item; active: boolean }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      className={`flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-[14px] transition-colors [@media(min-height:900px)]:py-2.5 ${
        active ? 'bg-white font-semibold text-[#13265C] shadow-[0_1px_2px_rgba(15,30,69,0.08)]' : 'text-[#51607F] hover:bg-white/70 hover:text-[#13265C]'
      }`}
    >
      <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-[#1468D4]' : 'text-[#8A97B1]'}`} strokeWidth={1.9} />
      <span>{item.label}</span>
    </NavLink>
  )
}

export function SunLogo({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <rect width="48" height="48" rx="12" fill="#13265C" />
      <g stroke="#F59E0B" strokeWidth="2.6" strokeLinecap="round">
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4
          return (
            <line
              key={i}
              x1={24 + Math.cos(a) * 11.5}
              y1={24 + Math.sin(a) * 11.5}
              x2={24 + Math.cos(a) * 15.5}
              y2={24 + Math.sin(a) * 15.5}
            />
          )
        })}
      </g>
      <circle cx="24" cy="24" r="7" fill="#FBBF24" />
    </svg>
  )
}

export default function Sidebar() {
  const { pathname } = useLocation()

  return (
    <aside className="hidden print:!hidden w-[228px] shrink-0 flex-col overflow-y-auto border-r border-[#E4EAF3] bg-[#EEF2F8] lg:flex">
      <NavLink to="/" className="flex items-center gap-2.5 px-5 pb-6 pt-5">
        <SunLogo />
        <div>
          <p className="text-[18px] font-bold leading-none tracking-tight text-[#13265C]">HeatLens</p>
          <p className="mt-1 text-[12px] text-[#6B7A99]">Heat early warning</p>
        </div>
      </NavLink>

      <p className="eyebrow px-6 pb-2">Monitor</p>
      <nav className="space-y-0.5 px-3">
        {PRIMARY.map((item) => (
          <NavItem key={item.to} item={item} active={item.match(pathname)} />
        ))}
      </nav>
      <p className="eyebrow px-6 pb-2 pt-6">Reference</p>
      <nav className="space-y-0.5 px-3">
        {SECONDARY.map((item) => (
          <NavItem key={item.to} item={item} active={item.match(pathname)} />
        ))}
      </nav>

      <div className="mt-auto px-5 pb-5 pt-6">
        <NavLink
          to="/about"
          className="block rounded-lg border border-[#DCE3EE] bg-white/60 px-3 py-2.5 text-[12px] leading-snug text-[#51607F] hover:bg-white"
        >
          <span className="block font-semibold text-[#13265C]">SIH 2026 · PS 26083</span>
          Prototype. Not an official AMC, IMD or NDMA system.
        </NavLink>
      </div>
    </aside>
  )
}
