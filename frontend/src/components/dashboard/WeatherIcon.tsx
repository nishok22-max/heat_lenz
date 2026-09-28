import { Thermometer } from 'lucide-react'

function Sun({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true">
      <g stroke="#F59E0B" strokeWidth="3" strokeLinecap="round">
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4
          return <line key={i} x1={24 + Math.cos(a) * 14} y1={24 + Math.sin(a) * 14} x2={24 + Math.cos(a) * 20} y2={24 + Math.sin(a) * 20} />
        })}
      </g>
      <circle cx="24" cy="24" r="9.5" fill="#FBBF24" />
    </svg>
  )
}

function CloudShape({ x = 0, y = 0, scale = 1 }: { x?: number; y?: number; scale?: number }) {
  return (
    <path
      transform={`translate(${x} ${y}) scale(${scale})`}
      d="M14 38 h22 a8 8 0 0 0 0 -16 a11 11 0 0 0 -21 -2 a8 8 0 0 0 -1 18 z"
      fill="#BFDBFE"
      stroke="#93C5FD"
      strokeWidth="1.5"
    />
  )
}

function PartlyCloudy({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true">
      <g stroke="#F59E0B" strokeWidth="2.6" strokeLinecap="round">
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4
          return <line key={i} x1={18 + Math.cos(a) * 10} y1={16 + Math.sin(a) * 10} x2={18 + Math.cos(a) * 14} y2={16 + Math.sin(a) * 14} />
        })}
      </g>
      <circle cx="18" cy="16" r="7" fill="#FBBF24" />
      <CloudShape x={4} y={4} scale={0.95} />
    </svg>
  )
}

function Cloudy({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true">
      <CloudShape x={0} y={-2} />
    </svg>
  )
}

/**
 * Daytime cloud cover (%, Open-Meteo forecast) -> sun / partly cloudy / cloudy. When the source
 * has no cloud data (the 2010-2024 archive) a neutral thermometer is shown instead of guessing.
 */
export default function WeatherIcon({ cloudPct, size = 44 }: { cloudPct: number | null | undefined; size?: number }) {
  if (cloudPct == null) return <Thermometer style={{ width: size * 0.8, height: size * 0.8 }} className="text-[#F97316]" strokeWidth={1.8} />
  if (cloudPct < 25) return <Sun size={size} />
  if (cloudPct < 70) return <PartlyCloudy size={size} />
  return <Cloudy size={size} />
}
