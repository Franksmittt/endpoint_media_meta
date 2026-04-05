# Agency billing & performance portal

Meta Ads **billing** (PDF receipts + invoice CSV), **performance** (Ads Manager export), and **client-facing dashboards**, with cent-level reconciliation checks.

## Quick start

```powershell
cd C:\Users\User1\OneDrive\Desktop\overlay
python -m pip install -r client-portal\scripts\requirements.build.txt
python client-portal\scripts\build_report.py
cd client-portal
python -m http.server 8080
```

Open http://localhost:8080/

## Source files (drop updates here)

| File | Purpose |
|------|---------|
| `Untitled-report-*.csv` | Meta Ads export (ad set level): spend, impressions, results |
| `Untitled-report-*.xlsx` | Optional duplicate of the CSV; build uses **CSV** only |
| `2025-09-18--2026-04-06_Transactions/*.pdf` | Receipt PDFs (Failed excluded by build) |
| `2025-09-18--2026-04-06_Transactions/2025-09-18--2026-04-06_Invoice_Summary.csv` | Meta invoice / payment lines |

After updating any of these, run **`build_report.py`** again, then open **`reconciliation.html`** locally to confirm invoice ↔ PDF totals still match.

## Clients

**Vaalpenskraal** vs **Miwesu** are detected from campaign/ad set names (same rules as PDF splitting). Rows that mention both or neither are flagged in reconciliation.

## More detail

See `client-portal/README.md`.

## Vercel

1. **Production branch:** `master` (this repo does not use `main`). If Vercel follows `main`, you will keep deploying an old tree: no sidebar, broken PDF paths, stale assets.
2. **Root directory:** set to **`client-portal`** (recommended). Framework **Other**, no Python, no custom build command unless you know you need it.
3. Optional: leave the repo root as the Vercel root and rely on the root **`vercel.json`** `outputDirectory: client-portal` instead (then `/` is rewritten to `dashboard.html`).

After changing branch or root directory, trigger a **new deployment** and hard-refresh the site (or use a private window).
