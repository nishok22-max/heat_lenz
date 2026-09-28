import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Bell, CalendarDays, MapPin, Search, Users } from 'lucide-react'
import { DEFAULT_CITY, useCityZonesGeoJSON, useForecast, useTriggers } from '../../api/hooks'
import { DEMO_DATE } from '../../lib/dates'
import { dayMonth } from '../../lib/dashboard'
import { PRIMARY, SECONDARY } from '../../lib/nav'
import { ROLES, isRole, rememberRole, rememberedRole, type Role } from '../../lib/roles'

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])
  return now
}

/**
 * The status indicator doubles as the data-mode switch: "Live Data" (Open-Meteo forecast) or the
 * 2010 heatwave replay. In replay it says so - it never shows "Live" over historical data.
 */
function DataStatus() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const replay = params.get('mode') === 'history'
  const replayDate = params.get('date') ?? DEMO_DATE

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const go = (history: boolean) => {
    setOpen(false)
    if (history) navigate(`/?mode=history&date=${DEMO_DATE}`)
    else setParams({})
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={replay ? 'Replay mode' : 'Live data'}
        className="flex items-center gap-2 rounded-lg px-2 py-1 text-[15px] text-[#13265C] hover:bg-[#EEF4FB]"
      >
        <span className={`h-2.5 w-2.5 rounded-full ${replay ? 'bg-amber-500' : 'bg-[#22A559]'}`} />
        <span className="hidden sm:inline">{replay ? `Replay · ${dayMonth(replayDate)} ${replayDate.slice(0, 4)}` : 'Live Data'}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-[1100] mt-1 w-60 rounded-xl border border-[#E3EBF5] bg-white py-1 text-sm shadow-lg">
          <button onClick={() => go(false)} className="block w-full px-4 py-2 text-left text-[#13265C] hover:bg-[#F4F8FC]">
            Live data (Open-Meteo forecast)
          </button>
          <button onClick={() => go(true)} className="block w-full px-4 py-2 text-left text-[#13265C] hover:bg-[#F4F8FC]">
            2010 heatwave replay (21 May 2010)
          </button>
        </div>
      )}
    </div>
  )
}

/** "View as" - switches the dashboard between audiences (lib/roles.ts). Dashboard only. */
function RoleSwitcher() {
  const [params, setParams] = useSearchParams()
  const current = isRole(params.get('role')) ? (params.get('role') as Role) : rememberedRole()
  return (
    <label className="flex shrink-0 items-center gap-2 text-[14px] text-[#13265C]">
      <Users className="hidden h-5 w-5 text-[#1468D4] sm:block" strokeWidth={1.8} />
      <span className="hidden whitespace-nowrap text-[#6B7A99] xl:inline">View as</span>
      <select
        value={current}
        onChange={(e) => {
          const r = e.target.value as Role
          rememberRole(r)
          const next = new URLSearchParams(params)
          next.set('role', r)
          setParams(next)
        }}
        className="h-10 rounded-lg border border-[#E4EAF3] bg-white px-3 text-[14px] font-semibold text-[#13265C]"
      >
        {ROLES.map((r) => (
          <option key={r.id} value={r.id} title={r.long}>
            {r.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function WardSearch() {
  const navigate = useNavigate()
  const geo = useCityZonesGeoJSON(DEFAULT_CITY)
  const [params] = useSearchParams()
  const [q, setQ] = useState('')
  const wards = useMemo(
    () =>
      (geo.data?.features ?? [])
        .map((f) => ({ id: String(f.properties?.zone_id ?? ''), name: String(f.properties?.name ?? '') }))
        .filter((w) => w.id && w.name)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [geo.data],
  )

  const open = (value: string) => {
    const w = wards.find((x) => x.name.toLowerCase() === value.trim().toLowerCase())
    if (!w) return
    const date = params.get('date')
    navigate(`/zones/${w.id}${date ? `?date=${date}` : ''}`)
    setQ('')
  }

  return (
    <label className="hidden h-10 w-full min-w-0 max-w-[240px] items-center gap-2.5 rounded-lg border border-[#E4EAF3] bg-[#F5F7FB] px-3 md:flex min-[1440px]:max-w-[320px]">
      <Search className="h-[18px] w-[18px] text-[#6B7A99]" />
      <input
        list="ward-names"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          if (wards.some((w) => w.name === e.target.value)) open(e.target.value)
        }}
        onKeyDown={(e) => e.key === 'Enter' && open(q)}
        placeholder="Search 48 wards…"
        className="w-full bg-transparent text-sm text-[#13265C] placeholder-[#8A97B1] outline-none"
      />
      <datalist id="ward-names">
        {wards.map((w) => (
          <option key={w.id} value={w.name} />
        ))}
      </datalist>
    </label>
  )
}

export default function Header() {
  const now = useClock()
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const forecast = useForecast(DEFAULT_CITY, 5)
  const replay = params.get('mode') === 'history'
  const today = replay ? (params.get('date') ?? DEMO_DATE) : (forecast.data?.issue_date ?? '')
  const triggers = useTriggers(DEFAULT_CITY, today)
  const level = triggers.data?.groups[0]?.level
  const alertOn = level != null && level !== 'Green'

  return (
    <>
    <header className="flex print:hidden h-[64px] shrink-0 items-center gap-2 sm:gap-4 [@media(min-height:900px)]:h-[72px] border-b border-[#E4EAF3] bg-white px-3 sm:px-4 min-[1440px]:px-6">
      <div
        className={`${pathname === '/' ? 'hidden sm:flex' : 'flex'} shrink-0 items-center gap-2 whitespace-nowrap text-[15px] font-semibold text-[#13265C]`}
      >
        <MapPin className="h-[18px] w-[18px] text-[#1468D4]" />
        Ahmedabad<span className="hidden font-normal text-[#6B7A99] sm:inline">, Gujarat</span>
      </div>
      {pathname === '/' && <RoleSwitcher />}
      <WardSearch />

      <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3 min-[1440px]:gap-5">
        <div className="hidden items-center gap-2.5 whitespace-nowrap text-[#13265C] xl:flex">
          <CalendarDays className="h-6 w-6" strokeWidth={1.8} />
          <div className="leading-tight">
            <p className="text-[15px]">
              {now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
            <p className="text-[14px]">{now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</p>
          </div>
        </div>
        <DataStatus />
        <Link
          to="/heat-stress"
          className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-[#E4EAF3] bg-white text-[#13265C] hover:bg-[#F5F7FB]"
          title={alertOn ? `AMC heat alert active: ${level}` : 'No AMC heat alert'}
        >
          <Bell className="h-5 w-5" strokeWidth={1.8} />
          {alertOn && <span className="absolute right-2.5 top-2.5 h-2.5 w-2.5 rounded-full bg-[#EF4444] ring-2 ring-white" />}
        </Link>
      </div>
    </header>
    {/* The sidebar is hidden below 1024px; keep every page reachable with a compact row. */}
    <nav className="flex print:hidden shrink-0 gap-1 overflow-x-auto border-b border-[#E4EAF3] bg-white px-3 py-2 lg:hidden">
      {[...PRIMARY, ...SECONDARY].map((item) => {
        const Icon = item.icon
        const active = item.match(pathname)
        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${
              active ? 'bg-[#E3EEFB] font-semibold text-[#1468D4]' : 'text-[#13265C]'
            }`}
          >
            <Icon className="h-4 w-4" strokeWidth={1.8} />
            {item.label}
          </NavLink>
        )
      })}
    </nav>
    </>
  )
}
