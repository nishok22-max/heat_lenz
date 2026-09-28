# HTSI Algorithm Benchmark Report

> **Scope:** Structural comparison on Ahmedabad 2010-2024 (March-June, ERA5 reanalysis).
> No daily health outcomes are available. Metrics below are proxy measures.
> Statistical superiority claims require `compare_indices()` on real mortality/admission data.

---

## 1. May 2010 Rank (Key Event Detection)

May 2010 = Ahmedabad heatwave, ~1,344 excess deaths (Azhar et al. 2014).
Rank 1 = index correctly identifies that May as the most dangerous of 15 years.

```
             index  may2010_mean  all_may_mean  may2010_rank
       Tmax (degC)         42.61         40.86             2
   IMD Tmax (degC)         41.73         40.00             1
 Heat Index (degC)         42.32         41.05             2
       WBGT (degC)         32.22         32.15             7
       UTCI (degC)         53.68         51.90             2
        HTSI basic          2.50          3.60             7
         HTSI+UTCI          8.58          5.73             3
 HTSI+X (dry-heat)          7.99          5.50             3
HTSI+UTCI+X (full)         13.22          7.37             2
      PHD (Plan C)         86.27         76.56             3
```

**Finding:** HTSI basic (WBGT-only) ranks May 2010 at rank **7** — misses the dry-heat event.
HTSI+UTCI+X (full) ranks it at rank 2 and HTSI+X (dry-heat) at rank 3, out of 15 years.

---

## 2. Spearman rho vs IMD Tmax May-mean (Cross-Year Discriminability)

```
             index  spearman_rho  p_value
   IMD Tmax (degC)         1.000   0.0000
       UTCI (degC)         0.825   0.0002
       Tmax (degC)         0.786   0.0005
      PHD (Plan C)         0.768   0.0008
 Heat Index (degC)         0.661   0.0073
       WBGT (degC)         0.411   0.1283
HTSI+UTCI+X (full)         0.289   0.2957
         HTSI+UTCI         0.182   0.5159
 HTSI+X (dry-heat)         0.164   0.5585
        HTSI basic        -0.039   0.8894
```

Higher rho = index tracks the same year-to-year severity signal as IMD Tmax.

---

## 3. False-Alarm Rate & Missed-Event Rate vs IMD Heat-Wave Days

> IMD heat-wave days are NOT health outcomes. This is a consistency check only.

```
             index  flagged_days  imd_hw_days  false_alarm_rate  missed_event_rate
       Tmax (degC)           657            5             0.992                0.0
   IMD Tmax (degC)           402            5             0.988                0.0
 Heat Index (degC)            19            5             0.947                0.8
       WBGT (degC)           300            5             0.990                0.4
       UTCI (degC)           225            5             0.991                0.6
        HTSI basic            24            5             1.000                1.0
         HTSI+UTCI            34            5             1.000                1.0
 HTSI+X (dry-heat)            30            5             1.000                1.0
HTSI+UTCI+X (full)            48            5             1.000                1.0
      PHD (Plan C)          1453            5             0.997                0.0
```

---

## 4. May 2010 Component Breakdown (15-31 May)

```
      date  ta_max  tw_max  wbgt_max  utci_max    D   N   H   C    L    U   X  htsi_basic  htsi_utci  htsi_tmax  htsi_full
2010-05-15    41.6   25.47     31.90     52.48 0.00 0.0 0.0 0.0 0.00 0.00 0.0        0.00       0.00       0.00       0.00
2010-05-16    42.1   25.68     32.21     52.90 0.00 0.0 0.0 0.0 0.00 0.00 0.1        0.00       0.00       0.72       0.72
2010-05-17    42.8   25.26     32.31     53.65 0.00 0.0 0.0 0.0 0.00 0.41 0.8        0.00       3.67       5.65       9.12
2010-05-18    43.3   23.68     31.40     54.24 0.00 0.0 0.0 0.0 0.00 1.01 1.3        0.00       8.75       9.02      16.98
2010-05-19    43.6   24.86     32.34     55.04 0.00 1.2 0.0 0.0 0.00 1.81 1.6       12.27      25.55      21.91      33.73
2010-05-20    45.2   25.72     33.73     56.38 0.30 1.7 0.0 1.0 0.00 3.14 3.2       25.55      44.06      41.01      55.68
2010-05-21    45.4   25.47     33.25     56.94 0.00 0.7 0.0 0.0 0.15 3.71 3.4        8.62      34.78      28.64      49.07
2010-05-22    44.6   26.22     33.55     55.99 0.13 0.0 0.0 1.0 0.08 2.75 2.6        8.07      28.42      23.91      40.76
2010-05-23    44.5   25.73     33.12     55.29 0.00 0.0 0.0 0.0 0.10 2.05 2.5        0.91      17.78      17.38      31.45
2010-05-24    44.7   25.67     32.51     55.56 0.00 0.0 0.0 0.0 0.03 2.32 2.7        0.28      19.26      18.06      33.65
2010-05-25    43.8   25.22     32.14     54.82 0.00 0.0 0.0 0.0 0.02 1.59 1.8        0.14      13.58      12.39      24.18
2010-05-26    43.0   26.07     32.58     53.78 0.00 0.0 0.0 0.0 0.00 0.54 1.0        0.00       4.82       7.01      11.50
2010-05-27    43.0   25.99     32.40     53.67 0.00 0.0 0.0 0.0 0.00 0.44 1.0        0.00       3.91       7.01      10.65
2010-05-28    43.3   25.83     32.62     53.91 0.00 0.0 0.0 0.0 0.00 0.68 1.3        0.00       5.97       9.02      14.45
2010-05-29    42.2   25.89     32.54     52.52 0.00 0.0 0.0 0.0 0.00 0.00 0.2        0.00       0.00       1.44       1.44
2010-05-30    41.4   25.50     32.50     52.24 0.00 0.0 0.0 0.0 0.00 0.00 0.0        0.00       0.00       0.00       0.00
2010-05-31    41.6   25.56     31.66     52.23 0.00 0.1 0.0 0.0 0.00 0.00 0.0        1.08       1.08       1.08       1.08
```

**Key finding:** D=0 throughout (WBGT never exceeded P90 = 33.43 degC).
U (UTCI excess) and X (Tmax excess) are the components that correctly fire in this dry-heat event.

---

## 5. Algorithm Changes Summary

| Change | Rationale | Impact |
|--------|-----------|--------|
| Add X = max(0, Tmax - P90_Tmax) | WBGT suppressed in dry air; Tmax is not | Correctly flags May 2010 |
| ta_max_p in local_thresholds | Acclimatisation-aware threshold for X | Localised climatology |
| Fix lag NaN propagation | Missing lags were silently 0 | Accurate L near season start |
| Scale 6.0 to 5.5 | Balance index range with added X signal | Avoids score ceiling |

---

## 6. Limitations

- All improvements are **structural**, not **health-validated**.
- The correct public claim: 'HTSI+UTCI+X (full) ranks the May 2010 event at rank 2 of 15 years;
  HTSI basic ranks it at rank 7. Full validation requires daily mortality/admission data.'
