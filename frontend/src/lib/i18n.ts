/**
 * Small, fixed EN/HI/GU phrase set for PublicView — IMPLEMENTATION_PLAN.md
 * §6.2. Deliberately not a general translation layer: the same reasoning as
 * backend/app/services/advisory.py's dispatch templates applies — a small,
 * reviewable set of fixed phrases bounds the translation risk, rather than
 * machine-translating arbitrary generated text. These specific strings mirror
 * the ones already used (and unit-tested) on the backend, so the SMS/WhatsApp
 * preview and this page never disagree with each other in the same language.
 *
 * NOT verified by a native speaker — review before any real deployment.
 * Escaped as \uXXXX (generated programmatically) rather than literal script
 * in this source file, matching advisory.py's own convention.
 */

export type Lang = 'en' | 'hi' | 'gu'

export const LANGUAGE_LABEL: Record<Lang, string> = { en: 'English', hi: 'हिन्दी', gu: 'ગુજરાતી' }

export const STRINGS: Record<Lang, Record<string, string>> = {
  en: {
    official_alert: 'Official heat alert (AMC)',
    level_green: 'No heat alert',
    level_yellow: 'Yellow: hot day',
    level_orange: 'Orange: heat alert',
    level_red: 'Red: extreme heat alert',
    emergency: 'Very unwell from the heat? Call 108',
    title: 'HeatLens',
    what_to_do: 'What to do today',
    what_to_do_that_day: 'What to do on this day',
    drink_water: 'Drink water regularly',
    avoid_sun_peak: 'Stay out of direct sun in the hottest hours',
    peak_hours: 'Hottest hours',
    check_elderly: 'Check on elderly neighbours',
    stay_indoors: 'Stay indoors if possible',
    illustrative: 'This is an illustrative preview, not a real alert',
    full_advisory: 'Full advisory →',
    low: 'Low',
    moderate: 'Moderate',
    high: 'High',
    extreme: 'Extreme',
  },
  hi: {
    official_alert: 'आधिकारिक गर्मी चेतावनी (AMC)',
    level_green: 'कोई गर्मी चेतावनी नहीं',
    level_yellow: 'पीला: गर्म दिन',
    level_orange: 'नारंगी: गर्मी की चेतावनी',
    level_red: 'लाल: अत्यधिक गर्मी की चेतावनी',
    emergency: 'गर्मी से बहुत बीमार? 108 पर कॉल करें',
    title: 'हीटलेंस',
    what_to_do: 'आज क्या करें',
    what_to_do_that_day: 'इस दिन क्या करें',
    drink_water: 'पानी पिएं',
    avoid_sun_peak: 'सबसे गर्म घंटों में सीधी धूप से बचें',
    peak_hours: 'सबसे गर्म घंटे',
    check_elderly: 'बुजुर्ग पड़ोसियों का हालचाल लें',
    stay_indoors: 'यथासंभव घर के अंदर रहें',
    illustrative: 'यह एक उदाहरण पूर्वावलोकन है, वास्तविक अलर्ट नहीं',
    full_advisory: 'पूर्ण सलाह →',
    low: 'कम',
    moderate: 'मध्यम',
    high: 'उच्च',
    extreme: 'अत्यधिक',
  },
  gu: {
    official_alert: 'સત્તાવાર ગરમી ચેતવણી (AMC)',
    level_green: 'કોઈ ગરમી ચેતવણી નથી',
    level_yellow: 'પીળો: ગરમ દિવસ',
    level_orange: 'નારંગી: ગરમીની ચેતવણી',
    level_red: 'લાલ: અતિશય ગરમીની ચેતવણી',
    emergency: 'ગરમીથી ખૂબ બીમાર? 108 પર કૉલ કરો',
    title: 'હીટલેન્સ',
    what_to_do: 'આજે શું કરવું',
    what_to_do_that_day: 'આ દિવસે શું કરવું',
    drink_water: 'પાણી પીવો',
    avoid_sun_peak: 'સૌથી ગરમ કલાકોમાં સીધા તડકાથી બચો',
    peak_hours: 'સૌથી ગરમ કલાકો',
    check_elderly: 'વડીલ પડોશીઓના ખબરઅંતર પૂછો',
    stay_indoors: 'શક્ય હોય તો ઘરની અંદર રહો',
    illustrative: 'આ એક ઉદાહરણ પૂર્વાવલોકન છે, વાસ્તવિક ચેતવણી નથી',
    full_advisory: 'સંપૂર્ણ સલાહ →',
    low: 'ઓછું',
    moderate: 'મધ્યમ',
    high: 'ઊંચું',
    extreme: 'અત્યંત',
  },
}

export function bandWord(lang: Lang, band: string): string {
  const key = band.toLowerCase()
  return STRINGS[lang][key] ?? band
}
