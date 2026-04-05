# Meta receipt PDFs (deploy these)

`build_report.py` copies every **Paid** receipt from `2025-09-18--2026-04-06_Transactions/*.pdf` into this folder. The client portal links to them as `invoices/<file>.pdf`.

**For Vercel (or any static host):** commit and push the `*.pdf` files here after each build. If this folder is empty on the server, downloads show “file not available”.

Rebuild locally:

```bash
python client-portal/scripts/build_report.py
```

Then add the new or updated PDFs to git from the repo root.
