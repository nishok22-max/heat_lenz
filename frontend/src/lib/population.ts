/**
 * Ahmedabad Municipal Corporation total population, Census of India 2011: 5,577,940.
 * Read directly from the official Primary Census Abstract ward file
 * (datasets/census/DDW_PCA2407_2011_MDDS with UI.xlsx, censusindia.gov.in NADA catalogue
 * 6665): the "Ahmadabad (M Corp.)" town row, which its 57 ward rows sum to exactly
 * (asserted in backend/scripts/build_ward_population.py).
 *
 * This is a TOTAL population count, not an "at-risk" subset. Per-ward counts for today's 48
 * wards come from the API (ZoneRisk.exposure.population_count, JRC GHS-POP 2020, labelled
 * MODELLED_PUBLISHED) - never multiply this by an invented fraction to manufacture an
 * "at-risk" number.
 */
export const AHMEDABAD_POPULATION_2011 = {
  value: 5_577_940,
  display: '5.58 M',
  citation: 'Census of India 2011, Primary Census Abstract, Ahmadabad (M Corp.): 5,577,940',
} as const

/**
 * Latest authoritative estimate: UN World Urbanization Prospects 2025 (UN Population Division),
 * File 21, the city of Ahmedabad for 2026. Extracted by backend/scripts/build_un_city_population.py
 * into backend/app/data/un_wup2025_ahmedabad.json; backend/tests/test_frontend_parity.py fails if
 * this constant and that file ever disagree.
 *
 * An ESTIMATE, not a count: no census has been taken since 2011 (Census 2027's population count
 * is in February 2027). The UN "city" is the whole built-up area including suburbs outside the
 * AMC boundary, so it is larger than the Census AMC figure above.
 */
export const AHMEDABAD_POPULATION_UN_2026 = {
  year: 2026,
  value: 7_667_167,
  display: '76.7 lakh',
  citation:
    'UN DESA Population Division, World Urbanization Prospects 2025, File 21: city of Ahmedabad (built-up area incl. suburbs), 2026 estimate',
} as const
