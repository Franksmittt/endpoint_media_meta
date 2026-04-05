# Client portal: billing + performance

Static site for **Meta Ads**: paid receipt PDFs, **invoice CSV** cross-checks, and **Ads Manager export** performance, split **Vaalpenskraal** vs **Miwesu** using the same naming rules as the PDF splitter.

## Accuracy

1. **Money in cents** in JSON (`*Cents` fields) so totals are exact; ZAR strings are for display.
2. **`build_report.py`** recomputes:
   - Sum of invoice CSV lines = Meta footer total (must match).
   - Sum of paid PDF totals = invoice sum when every charge has a matching PDF (your dataset: **0.00** delta).
   - Each **transaction ID**: invoice amount = sum of allocated PDF lines.
3. **`data/reconciliation.json`**: machine-readable audit trail; **`reconciliation.html`** explains it in plain language.
4. **Ads “Amount spent”** (8685.30 ZAR in your export) vs **PDF subtotals ex VAT** (8069.66 ZAR) will differ (VAT and Meta’s delivery vs billing timing). That gap is **not** a cent error in invoice↔PDF matching (see reconciliation page).

## Source files (paths relative to `overlay/`)

| File | Role |
|------|------|
| `Untitled-report-Mar-5-2023-to-Apr-5-2026.csv` | Performance (ad set rows). The `.xlsx` is optional; the build uses the **CSV**. |
| `2025-09-18--2026-04-06_Transactions/*.pdf` | Receipts (Failed skipped). |
| `2025-09-18--2026-04-06_Transactions/2025-09-18--2026-04-06_Invoice_Summary.csv` | Payment lines + footer total. |

## Build

```bash
pip install -r client-portal/scripts/requirements.build.txt
python client-portal/scripts/build_report.py
```

(`build_manifest.py` calls the same pipeline.)

## Preview

```bash
cd client-portal
python -m http.server 8080
```

- **Home**: client cards + link to cross-checks  
- **dashboard.html**: tabs (billing, fees, performance, April creative)  
- **reconciliation.html**: invoice, PDF, and ads export cross-checks  

## GitHub Pages

Use a **private** repo if needed. Publish the **`client-portal`** folder. See parent `README.md`.
