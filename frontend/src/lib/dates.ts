/** Small date helpers. Dates are plain 'YYYY-MM-DD' strings throughout, as the API uses. */

/** 'Tue 22 Sep' — parsed as a local date so a bare 'YYYY-MM-DD' never shifts a day across time zones. */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

export function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function dayOfWeek(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
  })
}

/** Seeded demo date: the peak of the May 2010 heatwave (~1,344 excess deaths, Azhar et al. 2014). */
export const DEMO_DATE = '2010-05-21'
