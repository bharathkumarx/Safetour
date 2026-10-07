# Bangalore crime dataset dictionary

The source CSV is synthetic demo data and is not modified by the import process.

| Column | Meaning |
| --- | --- |
| `latitude` | Incident latitude in decimal degrees. |
| `longitude` | Incident longitude in decimal degrees. |
| `crime_type` | Display crime category. |
| `crime_severity` | Severity from 0 (lowest) to 10 (highest). |
| `date` | Incident date in `YYYY-MM-DD` format. |
| `time` | Incident time in `HH:MM` 24-hour format. |
| `hour` | Integer hour from 0 through 23. |
| `area` | Display area label; spatial calculations use coordinates. |
| `lighting_score` | Lighting quality from 0 to 1. |
| `cctv_score` | CCTV coverage from 0 to 1. |
| `crowd_density` | Crowd density from 0 to 1. |
| `police_proximity` | Police proximity from 0 to 1. |
| `is_night` | Source-provided night flag, 0 or 1. |

Cleaning rules:

- The delimiter is auto-detected as comma or tab.
- Rows must validate with the import schema.
- Coordinates must be inside the Bangalore bounding box (12.80–13.18 latitude,
  77.45–77.80 longitude).
- Severity and all environment scores must be in their documented ranges.
- Dates must be real ISO calendar dates; times must be valid 24-hour values.
- `hour` must be an integer from 0 through 23.
- Invalid rows are dropped and grouped by validation reason.
- Recency is measured from the newest valid date in the file using a 365-day
  half-life.
- Cybercrime incidents are retained but marked excluded for heatmap, scoring,
  and routing.
