# Meta receipt PDFs (deploy these)

`build_report.py` copies **only Paid** Meta receipts that include a **Miwesu** allocation (split or whole receipt). Files are **byte-identical** to the originals in `2025-09-18--2026-04-06_Transactions/` (not regenerated invoices). Failed / unpaid PDFs are skipped.

The portal links to them as `/invoices/<file>.pdf`.

**Vercel:** commit and push this folder after each build. Empty folder on the host means downloads fail.

```bash
python client-portal/scripts/build_report.py
git add client-portal/invoices/*.pdf
```
