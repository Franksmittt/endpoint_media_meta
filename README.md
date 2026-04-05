# Agency billing & performance portal

Meta Ads **billing** (PDF receipts + invoice CSV), **performance** (Ads Manager export), and **client-facing dashboards**, with cent-level reconciliation checks.

## Quick start

```powershell
cd C:\Users\User1\OneDrive\Desktop\overlay
python -m pip install -r client-portal\requirements.txt
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
