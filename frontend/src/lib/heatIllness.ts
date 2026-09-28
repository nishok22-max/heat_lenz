/**
 * Heat-illness signs, first aid and an emergency kit, as published by India's National Disaster
 * Management Authority on its Heat Wave page (retrieved 2026-09-23). Wording kept as published;
 * only spelling slips on the page are corrected ("Ederna" -> oedema, "Heat Stoke" -> heat stroke).
 * The emergency number is the one AMC's own plan names: "108 Emergency Service" (AMC Heat Action
 * Plan 2019, p.17, the plan backend/rules/hap_rules.toml cites).
 */

export const NDMA_HEAT_WAVE_URL = 'https://ndma.gov.in/Natural-Hazards/Heat-Wave'
export const NDMA_SOURCE = 'National Disaster Management Authority (NDMA), Heat Wave page'

export const EMERGENCY_NUMBER = '108'
export const EMERGENCY_SOURCE = 'AMC Heat Action Plan 2019: "108 Emergency Service"'

export interface Illness {
  name: string
  level: 'mild' | 'serious' | 'emergency'
  signs: string[]
}

export const HEAT_ILLNESSES: Illness[] = [
  {
    name: 'Heat cramps',
    level: 'mild',
    signs: ['Swelling (oedema)', 'Fainting', 'Fever below 39 °C (102 °F)'],
  },
  {
    name: 'Heat exhaustion',
    level: 'serious',
    signs: ['Fatigue', 'Weakness', 'Dizziness', 'Headache', 'Nausea', 'Vomiting', 'Muscle cramps', 'Sweating'],
  },
  {
    name: 'Heat stroke',
    level: 'emergency',
    signs: ['Body temperature 40 °C (104 °F) or more', 'Delirium', 'Seizures', 'Coma'],
  },
]

/** "If you think someone is suffering from the heat" - NDMA, in the order published. */
export const FIRST_AID: string[] = [
  'Move the person to a cool place under the shade',
  'Give water or a rehydrating drink (if the person is still conscious)',
  'Fan the person',
  'Cool the person by putting a cool wet cloth on his/her face/body',
  'Loosen clothes for better ventilation',
  'Do not give alcohol, caffeine or aerated drink',
  'Consult a doctor if symptoms get worse or are long lasting or the person is unconscious',
]

/** NDMA "Emergency Kit". */
export const HEAT_KIT: string[] = [
  'Water bottle',
  'Umbrella / hat or cap / head cover',
  'Hand towel',
  'Hand fan',
  'Electrolyte / glucose / oral rehydration',
]
