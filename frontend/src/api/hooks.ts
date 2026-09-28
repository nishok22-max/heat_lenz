/**
 * TanStack Query hooks. One hook per endpoint — IMPLEMENTATION_PLAN.md §6.1.
 */
import { useMutation, useQueries, useQuery } from '@tanstack/react-query'
import { apiGet, apiPost, BASE_URL } from './client'
import type { components } from '../types/api'

type VersionInfo = components['schemas']['VersionInfo']
type CityInfo = components['schemas']['CityInfo']
export type RiskZonesResponse = components['schemas']['RiskZonesResponse']
export type ZoneDetailResponse = components['schemas']['ZoneDetailResponse']
export type ZoneRisk = components['schemas']['ZoneRisk']
export type ZoneHistoryPoint = components['schemas']['ZoneHistoryPoint']
export type HealthRisk = components['schemas']['HealthRisk']
export type ForecastResponse = components['schemas']['ForecastResponse']
export type ForecastDay = components['schemas']['ForecastDay']
export type HourlyResponse = components['schemas']['HourlyResponse']
export type HourlyPoint = components['schemas']['HourlyPoint']
export type AdvisoryResponse = components['schemas']['AdvisoryResponse']
export type Recommendation = components['schemas']['Recommendation']
export type DispatchRequest = components['schemas']['DispatchRequest']
export type DispatchResponse = components['schemas']['DispatchResponse']
export type TriggersResponse = components['schemas']['TriggersResponse']
export type TriggerGroup = components['schemas']['TriggerGroup']
export type HapAction = components['schemas']['HapAction']
export type WebhookPreview = components['schemas']['WebhookPreview']
export type WebhookRequest = components['schemas']['WebhookRequest']
export type ValidationStatus = components['schemas']['ValidationStatus']
export type EvidenceLedger = components['schemas']['EvidenceLedger']
export type LedgerEntry = components['schemas']['LedgerEntry']
export type Persona = 'construction' | 'elderly' | 'general'

export const DEFAULT_CITY = 'ahmedabad'

export function useMeta() {
  return useQuery({
    queryKey: ['meta'],
    queryFn: () => apiGet<VersionInfo>('/meta'),
  })
}

export function useCities() {
  return useQuery({
    queryKey: ['cities'],
    queryFn: () => apiGet<CityInfo[]>('/cities'),
  })
}

export function useCityZonesGeoJSON(cityId: string) {
  return useQuery({
    queryKey: ['city-zones-geojson', cityId],
    queryFn: () => apiGet<GeoJSON.FeatureCollection>(`/cities/${cityId}/zones`),
    staleTime: Infinity, // static geometry for the session
  })
}

/** The map payload. `date` may be historical or inside the live forecast window — the API resolves which. */
export function useRiskZones(cityId: string, date: string) {
  return useQuery({
    queryKey: ['risk-zones', cityId, date],
    queryFn: () => apiGet<RiskZonesResponse>(`/risk/zones?city=${cityId}&date=${date}`),
    enabled: Boolean(cityId && date),
  })
}

/** The same request as useRiskZones, for several dates at once (shared cache keys). */
export function useRiskZonesMany(cityId: string, dates: string[]) {
  return useQueries({
    queries: dates.map((date) => ({
      queryKey: ['risk-zones', cityId, date],
      queryFn: () => apiGet<RiskZonesResponse>(`/risk/zones?city=${cityId}&date=${date}`),
      enabled: Boolean(cityId && date),
    })),
  })
}

/** One day hour by hour: GET /forecast/{city}/hourly (backend/app/services/hourly.py). */
export function useHourly(cityId: string, date: string) {
  return useQuery({
    queryKey: ['hourly', cityId, date],
    queryFn: () => apiGet<HourlyResponse>(`/forecast/${cityId}/hourly?date=${date}`),
    enabled: Boolean(cityId && date),
  })
}

export function useHourlyMany(cityId: string, dates: string[]) {
  return useQueries({
    queries: dates.map((date) => ({
      queryKey: ['hourly', cityId, date],
      queryFn: () => apiGet<HourlyResponse>(`/forecast/${cityId}/hourly?date=${date}`),
      enabled: Boolean(cityId && date),
    })),
  })
}

export function useZoneDetail(zoneId: string | null, cityId: string, date: string, historyDays = 30) {
  return useQuery({
    queryKey: ['zone-detail', cityId, zoneId, date, historyDays],
    queryFn: () =>
      apiGet<ZoneDetailResponse>(
        `/risk/zones/${zoneId}?city=${cityId}&date=${date}&history_days=${historyDays}`,
      ),
    enabled: Boolean(zoneId && cityId && date),
  })
}

export function useForecast(cityId: string, days = 5) {
  return useQuery({
    queryKey: ['forecast', cityId, days],
    queryFn: () => apiGet<ForecastResponse>(`/forecast/${cityId}?days=${days}`),
    enabled: Boolean(cityId),
    // Server-side TTLCache already dedupes repeat pulls within its own window
    // (services/forecast.py) — this just avoids an extra client refetch on
    // every remount within the same session.
    staleTime: 5 * 60 * 1000,
  })
}

export function useAdvisory(zoneId: string | null, cityId: string, date: string, persona: Persona) {
  return useQuery({
    queryKey: ['advisory', cityId, zoneId, date, persona],
    queryFn: () =>
      apiGet<AdvisoryResponse>(
        `/advisory/${zoneId}?city=${cityId}&date=${date}&persona=${persona}`,
      ),
    enabled: Boolean(zoneId && cityId && date),
  })
}

export function useDispatchPreview() {
  return useMutation({
    mutationFn: (req: DispatchRequest) => apiPost<DispatchResponse>('/dispatch/preview', req),
  })
}

/** Heat Action Plan level and department actions for every zone on one date (dry run). */
export function useTriggers(cityId: string, date: string) {
  return useQuery({
    queryKey: ['triggers', cityId, date],
    queryFn: () => apiGet<TriggersResponse>(`/alerts/triggers?city=${cityId}&date=${date}`),
    enabled: Boolean(cityId && date),
  })
}

export function useTriggersMany(cityId: string, dates: string[]) {
  return useQueries({
    queries: dates.map((date) => ({
      queryKey: ['triggers', cityId, date],
      queryFn: () => apiGet<TriggersResponse>(`/alerts/triggers?city=${cityId}&date=${date}`),
      enabled: Boolean(cityId && date),
    })),
  })
}

export function useWebhookPreview() {
  return useMutation({
    mutationFn: (req: WebhookRequest) => apiPost<WebhookPreview>('/alerts/webhook-preview', req),
  })
}

/** Link to the dry-run CAP 1.2 document. A plain URL: the browser downloads or displays it. */
export function capUrl(cityId: string, date: string, minLevel: string = 'Yellow'): string {
  return `${BASE_URL}/alerts/cap?city=${cityId}&date=${date}&min_level=${minLevel}`
}

export function useValidationStatus() {
  return useQuery({
    queryKey: ['validation-status'],
    queryFn: () => apiGet<ValidationStatus>('/validation/status'),
    staleTime: Infinity, // repo artefacts: constant for the life of a session
  })
}

export function useEvidenceLedger() {
  return useQuery({
    queryKey: ['evidence-ledger'],
    queryFn: () => apiGet<EvidenceLedger>('/validation/evidence-ledger'),
    staleTime: Infinity,
  })
}
