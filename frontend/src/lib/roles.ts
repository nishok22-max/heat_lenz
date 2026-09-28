/**
 * Dashboard viewing modes. The same backend data, chosen and worded for each audience. Stored in
 * the URL (?role=) so a link opens the same view, and remembered in the browser as a default.
 */
export const ROLES = [
  { id: 'people', label: 'People', long: 'People (citizens)' },
  { id: 'commissioner', label: 'Commissioner', long: 'Municipal Commissioner' },
  { id: 'health', label: 'Health Officer', long: 'Health Officer' },
  { id: 'workers', label: 'Outdoor Workers', long: 'Outdoor Workers & Employers' },
] as const

export type Role = (typeof ROLES)[number]['id']

export const DEFAULT_ROLE: Role = 'commissioner'
const STORAGE_KEY = 'heatlens.role'

export function isRole(v: string | null | undefined): v is Role {
  return ROLES.some((r) => r.id === v)
}

export function rememberedRole(): Role {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return isRole(v) ? v : DEFAULT_ROLE
  } catch {
    return DEFAULT_ROLE
  }
}

export function rememberRole(r: Role): void {
  try {
    localStorage.setItem(STORAGE_KEY, r)
  } catch {
    // private window / blocked storage: the URL still carries the role
  }
}
