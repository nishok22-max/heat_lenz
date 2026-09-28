import { Link } from 'react-router-dom'
import { Activity, ArrowRight, ShieldCheck } from 'lucide-react'
import { SunLogo } from '../components/layout/Sidebar'

const NAVY = '#13265C'

/** Every source listed here is used in the running app; the Methods page has the detail. */
const SOURCES: { name: string; use: string }[] = [
  { name: 'AMC Heat Action Plan 2019', use: 'Official alert thresholds and the actions each level asks for' },
  { name: 'Open-Meteo', use: 'Weather forecast per ward, and the 2010–2024 hourly archive' },
  { name: 'NOAA GSOD, Ahmedabad airport', use: 'Station thermometer used to check the weather inputs' },
  { name: 'NASA MODIS', use: 'Ground temperature per ward, by satellite' },
  { name: 'ESA WorldCover 2021', use: 'Buildings, trees, farmland and water per ward' },
  { name: 'Census 2011 and JRC GHS-POP', use: 'City and ward population, share aged 60+' },
  { name: 'de Bont et al. 2024', use: 'Published Ahmedabad heat and mortality study' },
  { name: 'Azhar et al. 2014', use: 'Daily deaths in the May 2010 heatwave, used to calibrate the score' },
  { name: 'ISO 7243, ISO 7933, UTCI', use: 'Published heat-stress standards' },
  { name: 'NDMA and MoHFW', use: 'Warning signs, first aid and outdoor-work guidance' },
]

export default function AboutView() {
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <section className="card p-7">
        <div className="flex items-center gap-3">
          <SunLogo className="h-11 w-11" />
          <div>
            <h1 className="text-[24px] font-semibold tracking-tight" style={{ color: NAVY }}>
              About HeatLens
            </h1>
            <p className="text-[13px] text-[#6B7A99]">Smart India Hackathon 2026 · Problem statement 26083</p>
          </div>
        </div>
        <p className="mt-5 max-w-3xl text-[15px] leading-relaxed text-[#3D4B6B]">
          HeatLens is a prototype heat early-warning tool for Ahmedabad. It forecasts heat for each of the city&apos;s 48 wards,
          shows which wards are under the most heat stress, and turns the city&apos;s own Heat Action Plan into clear actions for
          officials and plain advice for residents.
        </p>
        <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-[#6B7A99]">
          It is not an official AMC, IMD or NDMA system, and it sends no alerts: messages and alert feeds are previews only.
        </p>
      </section>

      <section className="card p-6">
        <h2 className="text-[17px] font-semibold" style={{ color: NAVY }}>
          Two measures, always named apart
        </h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-[#EDF1F7] p-4">
            <p className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: NAVY }}>
              <ShieldCheck className="h-[18px] w-[18px] text-[#15803D]" /> Official alert (AMC)
            </p>
            <p className="mt-1.5 text-[14px] leading-relaxed text-[#3D4B6B]">
              White, Yellow, Orange or Red, set by the day&apos;s highest temperature under the AMC Heat Action Plan 2019. It
              decides what residents are told to do and what the plan asks each department to do.
            </p>
          </div>
          <div className="rounded-xl border border-[#EDF1F7] p-4">
            <p className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: NAVY }}>
              <Activity className="h-[18px] w-[18px] text-[#C2410C]" /> Heat stress (HeatLens score)
            </p>
            <p className="mt-1.5 text-[14px] leading-relaxed text-[#3D4B6B]">
              A 0–100 score per ward that also counts humidity, sun and hot nights, calibrated on daily deaths in the May 2010
              heatwave. It can be high on a humid day with no official alert; extra steps it points to are shown to officials as
              HeatLens suggestions, never as the plan.
            </p>
          </div>
        </div>
      </section>

      <section className="card p-6">
        <h2 className="text-[17px] font-semibold" style={{ color: NAVY }}>
          Data and standards
        </h2>
        <dl className="mt-3 divide-y divide-[#EEF2F7]">
          {SOURCES.map((s) => (
            <div key={s.name} className="grid gap-1 py-2.5 sm:grid-cols-[240px_1fr]">
              <dt className="text-[14px] font-semibold" style={{ color: NAVY }}>
                {s.name}
              </dt>
              <dd className="text-[14px] text-[#51607F]">{s.use}</dd>
            </div>
          ))}
        </dl>
        <Link
          to="/methods"
          className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#1468D4] hover:underline"
        >
          How each number is made, and what is not built yet <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
    </div>
  )
}
