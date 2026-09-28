# Health-impact datasets — status and provenance

Retrieved 18 Sep 2026. Covers **Stage 5** of the HeatLens architecture
(Health-Impact Model) and §7.1 of [`IMPLEMENTATION_PLAN.md`](../../docs/IMPLEMENTATION_PLAN.md).

---

## The headline

**The health data that would let you *calibrate* HeatLens is not publicly downloadable.**
This is not a search failure — it is the documented state of the field. `SIH_26083_Dataset_Links.pdf`
says so in its own summary table ("Calibrate and prove Plan B (HTSI): **No** — needs daily deaths
or admissions, must be requested"), and the key study's data-availability statement reads simply:
*"The data that has been used is confidential."*

What **is** available, and what I retrieved, is the next best thing: **published exposure–response
coefficients for Ahmedabad specifically**, from a peer-reviewed multi-city study. These are enough
to build the relative-risk layer described in §7.1 Option A — and they are strong.

---

## ✅ Retrieved

### `exposure_response_india.json`

Machine-readable exposure–response coefficients, structured for
`backend/app/services/health.py`. Two peer-reviewed sources.

**The number that matters:**

> **Ahmedabad: +24.9 % (95 % CI 21.7–28.2) increase in daily all-cause mortality** on heatwave
> days, defined as 2 consecutive days above the 97th percentile of daily mean temperature.
> Baseline ≈ 122 deaths/day. ≈ 300 attributable deaths/year.
> — de Bont et al., *Environ Int* 2024;184:108461 ([PMC11790314](https://pmc.ncbi.nlm.nih.gov/articles/PMC11790314/))

Three things make this unusually well-suited to HeatLens:

1. **Ahmedabad is the strongest-effect city of the ten studied** — 24.9 % vs Mumbai's 3.4 %, a
   7× spread. The city you already have 15 years of weather for is the city where heat matters most.
2. **The exposure definition is already implemented in your code.** The study's "Nth percentile of
   local temperature" is exactly what `plan_b.local_thresholds(daily, percentile=97.0)` computes,
   and the consecutive-day counter is the same one `services/ensemble.py` needs for `plan_d`'s
   `CUMULATIVE_DEBT` regime. No new machinery.
3. **It gives a dose–response, not just a threshold** — 7 pooled (percentile × duration)
   combinations from +12.2 % to +33.2 %, plus an intensity modifier of **+3.8 % per 1 % of
   temperature above the p97 threshold**. That supports a graded index rather than a binary flag.

Also included: Hyderabad absolute-threshold effects (+16 % at Tmax ≥ 40 °C, +17 % at
Heat Index > 54 °C — the latter maps directly onto your existing `hi_max` column) and the lag
structure (effect peaks **same day**, r = 0.273).

⚠️ **Two traps the file documents explicitly:**
- **Do not apply the pooled 14.7 % to Ahmedabad.** The city-specific value is 24.9 %.
- **Do not stack duration on top of intensity.** Duration looks significant alone (+1.4 %/day)
  but attenuates to null (−0.2 %) once mutually adjusted. Stacking both would double-count.

---

## ❌ Blocked — needs your action (2 minutes each)

Both files are on data.gov.in. I located their exact URLs and confirmed they exist, but the
download is **CAPTCHA-gated**, and I'm not able to complete CAPTCHAs. The direct file paths are
additionally WAF-blocked to non-browser clients (403), and the shared public API demo key is
rate-limit exhausted.

| File | Resource page | Direct file (403 to scripts) |
|---|---|---|
| NCDC heatstroke deaths, state-wise 2016–2021 | [resource page](https://www.data.gov.in/resource/state-wise-heatstroke-deaths-reported-under-heat-related-illness-surveillance-india-2016) | `RS_Session_255_AU_500.csv` |
| NCRB heat/sun-stroke deaths, state-wise 2018–2022 | [resource page](https://www.data.gov.in/resource/stateut-wise-number-deaths-due-heatsun-stroke-national-crime-record-bureau-ncrbfrom-2018) | `RS_Session_266_AU_359_A_i.csv` |

**Option 1 — click it (fastest).** Open the resource page → **Download** → solve the CAPTCHA →
save into this folder.

**Option 2 — your own API key (better, scriptable).** Register free at
[data.gov.in](https://www.data.gov.in/) → My Account → Generate API key, then:

```bash
curl -sL "https://api.data.gov.in/resource/eac349a8-3377-4c88-beea-256c91602e05?api-key=YOUR_KEY&format=csv&limit=100" -o datasets/health/ncdc_heatstroke_deaths_statewise_2016_2021.csv
```

```bash
curl -sL "https://api.data.gov.in/resource/3a5fab27-f844-4938-acc2-e47d8b14b53c?api-key=YOUR_KEY&format=csv&limit=100" -o datasets/health/ncrb_heat_sunstroke_deaths_statewise_2018_2022.csv
```

**Before you spend time on these — read what they actually contain.** I pulled their metadata:

- **NCDC file: 764 bytes.** Fields: `State/UT, 2016, 2017, 2018, 2019, 2020, 2021`. That's a
  **state × year** table — 36 rows. Source: Rajya Sabha Session 255, Unstarred Q.500.
- **NCRB file:** same shape, 2018–2022, State/UT × year. Source: Rajya Sabha Session 266,
  Unstarred Q.359. Its own note flags `NA` for several state-years.

**Neither can calibrate anything.** HeatLens needs *daily* counts for *one city*; these are
*annual* totals for *all states*. They are legitimately useful as a **context panel** on the
Methods page ("Gujarat reported N heatstroke deaths in 2021 — official surveillance is known to
undercount by an order of magnitude vs. the ~300/yr attributable estimate from the literature").
That contrast is actually a good slide. It is not a calibration input.

---

## ❌ Not obtainable — the real gap

**Daily all-cause mortality for Ahmedabad.** This is the single input that would convert
HeatLens from "uncalibrated model" to a validated claim, by letting you run
`plan_b.compare_indices()` for real.

It exists — de Bont et al. used it (Ahmedabad 2008–June 2019, ~122 deaths/day), and the
acknowledgements name the people who supplied it: **Dileep Mavalankar, Hem Dholakia and Amit Garg**
(Mavalankar is at IIPH Gandhinagar, which co-authored the original Ahmedabad Heat Action Plan).
The Hyderabad study documents the other route: a direct request to the municipal **Birth & Death
Registration Department**.

**Three routes, in order of likely success:**

1. **Municipal Birth & Death Registration Dept, Ahmedabad Municipal Corporation** — the route both
   studies used. A formal request from your college/mentor on letterhead, scoped to daily
   all-cause death counts (no personal identifiers), March–June 2010–2024.
2. **IIPH Gandhinagar / the HAP authors** — they hold the Ahmedabad series and have a track record
   of collaborating on exactly this.
3. **NCDC / MoHFW IHIP heat-illness surveillance** — daily heat-illness admissions rather than
   deaths; the dataset PDF suggests routing this through a mentor.

Lead time is weeks, not days. **Start route 1 now if you want it before the SIH finals** — it does
not block anything else in the build, and the plan is designed so Stage 5 ships honestly without it.

---

## ⚠️ Verified gotcha: your weather window breaks the threshold definition

I test-ran the join against `datasets/open_meteo/ahmedabad_hourly_MarJun_2010_2024.csv`. The
mechanics work — but the result is wrong by a factor of ~6, for a subtle reason worth knowing
before anyone wires this up.

**The studies use the *annual* 97th percentile. Your weather file is March–June only.**
The 97th percentile of a summer-only series is a far more extreme threshold than the 97th
percentile of a full year, so the heatwave detector fires far too rarely:

| Threshold basis | 2-day heatwave days/yr detected |
|---|---|
| Summer-only p97 (naive — what the file supports today) | **2.0** |
| Summer p91 (arithmetic proxy for annual p97) | 6.7 |
| **de Bont et al., Ahmedabad actual** (3.1 heatwaves/yr × 4.1 d) | **12.7** |

Annual p97 ≈ top 11 days of 365. Within a 122-day summer window that is ~9 % of days, i.e.
roughly the **p91** of the summer series — not p97.

**The fix is cheap: re-pull Open-Meteo for full calendar years.** Same endpoint, same
parameters, no API key, just `start_date=2010-01-01&end_date=2024-12-31` instead of the
March–June slice. Then compute a true annual percentile per year. The p91 proxy above is a
stopgap, not a substitute — it still under-detects, because the remaining gap comes from
comparing a single point series against the study's ERA5 grid mean over the municipal boundary.

Encouraging sign in the same test: **2010 has the highest summer p97 of all 15 years (36.97 °C),
and 2024 the second (37.91 °C)** — the 1 344-death year surfaces at the top without any tuning.

Two further alignment notes for whoever implements `services/health.py`:

- The studies use daily **mean** temperature. `results/ahmedabad_daily_2010_2024.csv` carries
  `ta_max`/`ta_min` but no true daily mean — compute it from the hourly file rather than using
  `(ta_max+ta_min)/2`, which is a different quantity.
- de Bont's sensitivity analysis found *weaker* associations when using max temperature instead of
  mean, with overlapping CIs. So a Tmax-based implementation is defensible but should be labelled
  as a deviation from the source definition.

---

## What this changes in the implementation plan

§7.1 offered three options for the Stage 5 health layer. **Option A is now concretely
buildable**, with better coefficients than assumed:

- `services/health.py` reads `exposure_response_india.json`, computes whether today matches a
  published heatwave definition (via `plan_b.local_thresholds`), and returns a **relative risk
  with its published confidence interval and citation attached**.
- The forecast table's last column becomes `relative_risk: 1.25 (1.22–1.28)` with an amber
  `MODELLED_UNCALIBRATED` badge and a footnote naming de Bont et al. 2024 — not "+18 %" from nowhere.
- `/validation/evidence-ledger` can now cite a real, peer-reviewed, **Ahmedabad-specific** source
  for the health layer, while still stating plainly that HeatLens's own indices are unvalidated.

That is a materially stronger position than the plan assumed: the health layer goes from
"literature-anchored, source TBD" to "literature-anchored, source named, city-specific, with CIs."

---

## Provenance

| Item | How obtained |
|---|---|
| Coefficients | Full text of PMC11790314 and PMC8843295, read via browser; values transcribed from Results §3.2–3.4, Tables 1–2 |
| data.gov.in URLs + field lists | `https://www.data.gov.in/backend/dms/v1/resource/<slug>?_format=json` (public metadata endpoint, no auth) |
| Confirmation that daily data is unavailable | Data-availability statements in both papers + `SIH_26083_Dataset_Links.pdf` §2 |

No value in `exposure_response_india.json` is estimated, interpolated or inferred. Every number is
transcribed from a published table or results sentence, with the source keyed per entry.
