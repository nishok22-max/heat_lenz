/**
 * The residents' page: one phone screen, big type, plain language, language toggle. A citizen
 * following an alert link sees this, not the officials' console (it sits outside the nav layout).
 *
 * What it says to do follows the official AMC alert level only (lib/advice.ts, the same list the
 * dashboard and the forecast show), in the small fixed phrase set of lib/i18n.ts. The rule engine's
 * per-rule titles are not shown here: several are actions for the city, not for a resident. The
 * hottest hours are the day's own (hourly UTCI of 38 °C or more), not a fixed clock time.
 */
import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Clock, Phone } from 'lucide-react'
import { DEFAULT_CITY, useAdvisory, useForecast, useHourlyMany } from '../api/hooks'
import { ErrorMessage } from '../components/layout/StateMessage'
import { SunLogo } from '../components/layout/Sidebar'
import { LANGUAGE_LABEL, STRINGS, type Lang } from '../lib/i18n'
import { HAP_COLOR, isHapLevel } from '../lib/hap'
import { EMERGENCY_NUMBER } from '../lib/heatIllness'
import { longDate } from '../lib/dates'
import { hourLabel } from '../lib/dashboard'
import { residentTips } from '../lib/advice'
import ChatAssistant from '../components/chat/ChatAssistant'

export default function PublicView() {
  const { zoneId } = useParams<{ zoneId: string }>()
  const [searchParams] = useSearchParams()
  const [lang, setLang] = useState<Lang>('en')

  // No ?date — e.g. a hand-typed link — falls back to today rather than a blank screen.
  const requested = searchParams.get('date')
  const forecast = useForecast(DEFAULT_CITY, 5)
  const today = forecast.data?.issue_date
  const date = requested ?? today ?? ''

  const { data, isLoading, error, refetch } = useAdvisory(zoneId ?? null, DEFAULT_CITY, date, 'general')
  const hourlyDates = useMemo(() => (date ? [date] : []), [date])
  const hourly = useHourlyMany(DEFAULT_CITY, hourlyDates)[0]?.data
  const t = STRINGS[lang]
  // Residents see the official AMC alert level, the same as the dashboard's People view.
  const level = data && isHapLevel(data.hap_trigger) ? data.hap_trigger : null
  const bg = level === 'Green' ? '#166534' : level ? HAP_COLOR[level] : '#334155'
  const heatwave = data?.health.exposure_tier === 'heatwave'
  const peak =
    hourly?.peak_start_hour != null && hourly?.peak_end_hour != null
      ? `${hourLabel(hourly.peak_start_hour)} – ${hourLabel(hourly.peak_end_hour)}`
      : null
  const tips = residentTips(level, lang, peak != null)

  const formattedDate = useMemo(() => {
    if (!date) return ''
    const [y, m, d] = date.split('-').map(Number)
    const dt = new Date(y, m - 1, d)
    const locale = lang === 'hi' ? 'hi-IN' : lang === 'gu' ? 'gu-IN' : 'en-IN'
    return dt.toLocaleDateString(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }, [date, lang])

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-5 py-6 text-white" style={{ backgroundColor: bg }}>
      <div className="flex items-center justify-between">
        <Link to="/" aria-label="Back to dashboard" className="rounded-lg p-1.5 text-white/80 hover:bg-white/10">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div role="group" aria-label="Language" className="flex gap-1 rounded-full bg-black/15 p-1">
          {(['en', 'hi', 'gu'] as Lang[]).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              aria-pressed={lang === l}
              className={`rounded-full px-3 py-1 text-xs font-medium ${lang === l ? 'bg-white text-neutral-900' : 'text-white/85'}`}
            >
              {LANGUAGE_LABEL[l]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8 flex items-center gap-2.5">
        <SunLogo className="h-8 w-8" />
        <p className="text-xl font-semibold tracking-tight">{t.title}</p>
      </div>

      {(isLoading || (!requested && forecast.isLoading)) && (
        <p role="status" className="mt-6 text-white/90">
          …
        </p>
      )}
      {error && (
        <div className="mt-6 rounded-lg bg-white p-3 text-neutral-900">
          <ErrorMessage error={error} title="Could not load this alert." onRetry={() => refetch()} />
        </div>
      )}
      {!requested && forecast.isError && (
        <div className="mt-6 rounded-lg bg-white p-3 text-neutral-900">
          <ErrorMessage error={forecast.error} title="Could not find a date to show." />
        </div>
      )}

      {data && level && (
        <>
          <p className="mt-8 text-xs font-semibold uppercase tracking-[0.08em] text-white/75">{t.official_alert}</p>
          <p className="mt-1 text-[44px] font-bold leading-[1.05] tracking-tight">{t[`level_${level.toLowerCase()}`]}</p>
          <p className="mt-2 text-sm text-white/80">{formattedDate || longDate(date)}</p>

          <div className="mt-8 rounded-2xl bg-white/12 p-5 ring-1 ring-white/15">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/75">
              {date === today ? t.what_to_do : t.what_to_do_that_day}
            </p>
            <ul className="mt-3 space-y-3 text-[17px] leading-snug">
              {tips.map((tip) => (
                <li key={tip.key} className="flex items-start gap-3">
                  <tip.icon className="mt-0.5 h-5 w-5 shrink-0 text-white/85" strokeWidth={2} />
                  {tip.text}
                </li>
              ))}
            </ul>
            {peak && (
              <p className="mt-4 flex items-center gap-2 border-t border-white/15 pt-3 text-sm text-white/85">
                <Clock className="h-4 w-4" />
                {t.peak_hours}: <span className="font-semibold text-white">{peak}</span>
              </p>
            )}
          </div>

          {heatwave && (
            <div className="mt-5 rounded-xl bg-black/20 p-4 text-sm">
              <p className="font-semibold">Heatwave conditions</p>
              <p className="mt-1 text-white/90">
                Studies of past Ahmedabad heatwaves found daily deaths about {Math.round((data.health.relative_risk - 1) * 100)}%
                higher than on other days. This is a published pattern, not a prediction for any person.
              </p>
              {lang !== 'en' && <p className="mt-2 text-xs text-white/60">(English only)</p>}
            </div>
          )}

          <a
            href={`tel:${EMERGENCY_NUMBER}`}
            className="mt-5 flex items-center justify-center gap-2 rounded-2xl bg-white py-4 text-lg font-bold text-[#B91C1C] shadow-lg"
          >
            <Phone className="h-5 w-5" />
            {t.emergency}
          </a>

          <p className="mt-auto pt-8 text-center text-xs text-white/60">{t.illustrative}</p>

          {zoneId && (
            <Link
              to={`/advisory/${zoneId}?date=${date}`}
              className="mt-3 block rounded-xl bg-white/15 py-3 text-center text-sm font-medium hover:bg-white/25"
            >
              {t.full_advisory || 'Full advisory →'}
            </Link>
          )}
        </>
      )}
      <ChatAssistant audience="public" />
    </main>
  )
}
