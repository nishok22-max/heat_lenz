import {
  House,
  ChartColumn,
  Shield,
  SlidersHorizontal,
  HeartPulse,
  FileText,
  MapPin,
  BookOpen,
  type LucideIcon,
} from 'lucide-react'

export interface NavItemDef {
  to: string
  label: string
  icon: LucideIcon
  match: (path: string) => boolean
}

// "Interventions" shows measured intervention evidence; it does not simulate effects.
export const PRIMARY: NavItemDef[] = [
  { to: '/', label: 'Dashboard', icon: House, match: (p) => p === '/' },
  { to: '/forecast', label: 'Forecast', icon: ChartColumn, match: (p) => p.startsWith('/forecast') },
  { to: '/heat-stress', label: 'Heat Stress', icon: Shield, match: (p) => p.startsWith('/heat-stress') },
  { to: '/interventions', label: 'Interventions', icon: SlidersHorizontal, match: (p) => p.startsWith('/interventions') },
  { to: '/advice', label: 'Health & Advice', icon: HeartPulse, match: (p) => p.startsWith('/advi') },
  { to: '/reports', label: 'Reports', icon: FileText, match: (p) => p.startsWith('/reports') },
]

export const SECONDARY: NavItemDef[] = [
  { to: '/map', label: 'City Map', icon: MapPin, match: (p) => p.startsWith('/map') || p.startsWith('/zones') },
  { to: '/methods', label: 'Methods & Evidence', icon: BookOpen, match: (p) => p.startsWith('/methods') },
]
