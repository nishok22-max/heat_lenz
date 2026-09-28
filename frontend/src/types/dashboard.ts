export type RiskBand = 'Extreme' | 'High' | 'Moderate' | 'Low'

export interface ComponentBreakdown {
  utci: number
  wbgt: number
  tmaxSurge: number
  heatDebt: number
}

export interface Zone {
  id: string
  name: string
  h3Index: string
  coordinates: [number, number][]
  center: [number, number]
  riskScore: number
  riskBand: RiskBand
  tempC: number
  humidity: number
  windKmh: number
  solarRadiationWm2: number
  atRiskPopulation: number
  safeWorkMinutes: number
  workloadStandard: string
  mortalityTier: string
  mortalityRR: number
  mortalityCI: [number, number]
  dominantDriver: string
  componentBreakdown: ComponentBreakdown
  recommendations: {
    workHours: string
    hydration: string
    coolingCentre: string
    vulnerableCheck: string
  }
}

export interface ForecastPoint {
  time: string
  tempC: number
  heatIndexC: number
  wbgtC?: number
  utciC?: number
  isCurrent?: boolean
  riskBand?: RiskBand
}

export interface VulnerableGroup {
  category: string
  count: number
  percentage: number
  color: string
}

export interface HeatAlert {
  id: string
  capVersion: string
  severity: string
  headline: string
  description: string
  translations: {
    en: {
      headline: string
      message: string
      instructions: string[]
    }
    hi: {
      headline: string
      message: string
      instructions: string[]
    }
    ta: {
      headline: string
      message: string
      instructions: string[]
    }
  }
}

export interface Intervention {
  id: string
  name: string
  description: string
  riskReduction: number
  safeWorkIncreaseMin: number
  popProtectedPct: number
  active: boolean
}
