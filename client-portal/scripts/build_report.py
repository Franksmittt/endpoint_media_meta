"""
Full agency build: PDF receipts + Meta invoice CSV + Meta performance export.
All money stored as integer cents in JSON for exact arithmetic; display strings are derived.

Outputs:
  data/clients-index.json  (public portal lists PORTAL_INDEX_CLIENT_IDS only; all clients still written below)
  data/clients/<id>.json   (schemaVersion 2: billing + performance)
  data/reconciliation.json
  invoices/*.pdf

Run: python client-portal/scripts/build_report.py
"""
from __future__ import annotations

import csv
import hashlib
import importlib.util
import io
import json
import re
import shutil
import sys
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

OVERLAY_ROOT = Path(__file__).resolve().parents[2]
PORTAL_ROOT = Path(__file__).resolve().parents[1]
TRANSACTIONS_DIR = OVERLAY_ROOT / "2025-09-18--2026-04-06_Transactions"
INVOICES_OUT = PORTAL_ROOT / "invoices"
DATA_CLIENTS = PORTAL_ROOT / "data" / "clients"

# Public portal index lists only these clients; other brands still get JSON + reconciliation internally.
PORTAL_INDEX_CLIENT_IDS = frozenset({"miwesu"})

META_CSV = OVERLAY_ROOT / "Untitled-report-Mar-5-2023-to-Apr-5-2026.csv"
INVOICE_CSV = TRANSACTIONS_DIR / "2025-09-18--2026-04-06_Invoice_Summary.csv"


def zar_str_to_cents(s: str) -> int:
    s = (s or "").strip().strip('"').replace(",", "")
    if not s:
        return 0
    d = Decimal(s).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return int(d * 100)


def cents_to_zar_str(c: int) -> str:
    neg = c < 0
    c = abs(c)
    s = f"{c // 100}.{c % 100:02d}"
    return ("-" if neg else "") + s


def d2s(d: Decimal) -> str:
    return format(d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP), "f")


def _load_processor():
    proc_path = TRANSACTIONS_DIR / "process_meta_receipts.py"
    if not proc_path.is_file():
        raise FileNotFoundError(f"Missing {proc_path}")
    name = "process_meta_receipts"
    spec = importlib.util.spec_from_file_location(name, proc_path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def tx_id_from_name(name: str) -> str | None:
    m = re.search(r"Transaction #([\d-]+)", name)
    return m.group(1) if m else None


def payment_date_from_text(text: str) -> str | None:
    m = re.search(
        r"Invoice/Payment Date\s*\n\s*([A-Za-z]{3,9}\s+\d{1,2},\s*\d{4})",
        text,
        re.I,
    )
    if not m:
        return None
    for fmt in ("%b %d, %Y", "%B %d, %Y"):
        try:
            return datetime.strptime(m.group(1).strip(), fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def classify_brand(campaign: str, adset: str) -> str:
    s = f"{campaign} {adset}".lower()
    v = "vaalpenskraal" in s
    m = "miwesu" in s
    if v and m:
        return "mixed"
    if v:
        return "vaalpenskraal"
    if m:
        return "miwesu"
    return "unknown"


def parse_invoice_csv(path: Path) -> tuple[list[dict], int | None, int | None]:
    """
    Return (rows, computed_sum_cents, meta_total_cents_from_footer).
    Each row: date, transactionId, amountCents
    """
    if not path.is_file():
        return [], None, None
    raw = path.read_text(encoding="utf-8-sig", errors="replace")
    lines = raw.splitlines()
    hdr_i = None
    for i, line in enumerate(lines):
        if line.strip().startswith("Date,Transaction ID"):
            hdr_i = i
            break
    if hdr_i is None:
        return [], None, None

    reader = csv.DictReader(io.StringIO("\n".join(lines[hdr_i:])))
    rows: list[dict] = []
    sum_cents = 0
    meta_total = None

    for row in reader:
        date = (row.get("Date") or "").strip()
        tid = (row.get("Transaction ID") or "").strip()
        amt_raw = (row.get("Amount") or "").strip()

        if "Total" in date or "Total" in tid or "Total Amount" in amt_raw:
            # Total row: often Date empty, Amount quoted
            m = re.search(r"([\d,]+\.?\d*)", amt_raw.replace('"', ""))
            if m:
                meta_total = zar_str_to_cents(m.group(1))
            continue
        if not date or not tid or not amt_raw:
            continue
        if not re.match(r"^\d", date):
            continue

        cents = zar_str_to_cents(amt_raw)
        sum_cents += cents
        rows.append({"date": date, "transactionId": tid, "amountCents": cents})

    return rows, sum_cents, meta_total


def parse_meta_performance_csv(path: Path) -> tuple[list[dict], dict]:
    """
    Ad-set rows only + account-level summary from first data row if present.
    Returns (rows, account_summary) where account_summary may have spendCents, impressions, reach.
    """
    if not path.is_file():
        return [], {}
    raw = path.read_text(encoding="utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(raw))
    rows_out: list[dict] = []
    account_summary: dict = {}

    for i, row in enumerate(reader):
        lvl = (row.get("Delivery level") or "").strip().lower()
        camp = row.get("Campaign name") or ""
        adset = row.get("Ad set name") or ""
        spend_s = row.get("Amount spent (ZAR)") or ""
        imp_s = row.get("Impressions") or ""
        reach_s = row.get("Reach") or ""
        res_s = row.get("Results") or ""
        rtype = row.get("Result type") or ""
        status = row.get("Delivery status") or ""
        r_start = row.get("Reporting starts") or ""
        r_end = row.get("Reporting ends") or ""

        if i == 0 and not camp.strip() and not adset.strip() and spend_s:
            try:
                account_summary = {
                    "spendCents": zar_str_to_cents(spend_s),
                    "impressions": int(float(imp_s or 0)),
                    "reach": int(float(reach_s or 0)),
                    "reportingStarts": r_start,
                    "reportingEnds": r_end,
                }
            except (ValueError, TypeError):
                pass
            continue

        if lvl != "adset":
            continue
        if not spend_s:
            continue

        spend_cents = zar_str_to_cents(spend_s)
        try:
            impressions = int(float(imp_s or 0))
        except (ValueError, TypeError):
            impressions = 0
        try:
            reach = int(float(reach_s or 0))
        except (ValueError, TypeError):
            reach = 0
        try:
            results = int(float(res_s or 0))
        except (ValueError, TypeError):
            results = 0

        brand = classify_brand(camp, adset)
        rows_out.append(
            {
                "campaignName": camp.strip(),
                "adSetName": adset.strip(),
                "deliveryStatus": status,
                "spendCents": spend_cents,
                "impressions": impressions,
                "reach": reach,
                "resultType": rtype,
                "results": results,
                "brand": brand,
                "reportingStarts": r_start,
                "reportingEnds": r_end,
            }
        )

    sum_spend = sum(r["spendCents"] for r in rows_out)
    sum_imp = sum(r["impressions"] for r in rows_out)
    sum_reach = sum(r["reach"] for r in rows_out)
    account_summary["sumAdsetSpendCents"] = sum_spend
    account_summary["sumAdsetImpressions"] = sum_imp
    account_summary["sumAdsetReach"] = sum_reach
    account_summary["adsetRowCount"] = len(rows_out)
    if account_summary.get("spendCents") is not None:
        account_summary["accountSpendMatchesSumAdsets"] = (
            account_summary["spendCents"] == sum_spend
        )

    return rows_out, account_summary


def aggregate_performance_by_brand(
    prows: list[dict],
) -> dict[str, dict]:
    out: dict[str, dict] = defaultdict(
        lambda: {
            "spendCents": 0,
            "impressions": 0,
            "reach": 0,
            "results": 0,
            "campaigns": [],
        }
    )
    for r in prows:
        b = r["brand"]
        if b == "mixed":
            key = "mixed"
        elif b == "unknown":
            key = "unknown"
        elif b == "vaalpenskraal":
            key = "vaalpenskraal"
        else:
            key = "miwesu"
        o = out[key]
        o["spendCents"] += r["spendCents"]
        o["impressions"] += r["impressions"]
        o["reach"] += r["reach"]
        o["results"] += r["results"]
        o["campaigns"].append(
            {
                "campaignName": r["campaignName"],
                "adSetName": r["adSetName"],
                "spendCents": r["spendCents"],
                "impressions": r["impressions"],
                "reach": r["reach"],
                "resultType": r["resultType"],
                "results": r["results"],
                "deliveryStatus": r["deliveryStatus"],
            }
        )
    return dict(out)


def main() -> None:
    if not TRANSACTIONS_DIR.is_dir():
        print(f"Missing {TRANSACTIONS_DIR}", file=sys.stderr)
        sys.exit(1)

    pr = _load_processor()
    pdfs = sorted(TRANSACTIONS_DIR.glob("*.pdf"))
    INVOICES_OUT.mkdir(parents=True, exist_ok=True)
    DATA_CLIENTS.mkdir(parents=True, exist_ok=True)

    by_client: dict[str, list[dict]] = defaultdict(list)

    for path in pdfs:
        if path.name.startswith("."):
            continue
        try:
            text = pr.read_pdf_text(path)
        except Exception as e:
            print(f"Skip (read error) {path.name}: {e}", file=sys.stderr)
            continue
        if re.search(r"\bFailed\b", text):
            print(f"Skip (Failed) {path.name}", file=sys.stderr)
            continue
        has_paid = bool(re.search(r"\bPaid\b", text))
        sub, vat, total = pr.extract_receipt_totals(text)
        if not has_paid or sub is None or total is None:
            print(f"Skip (not Paid) {path.name}", file=sys.stderr)
            continue

        simple = pr.classify_simple(text)
        alloc = pr.allocate_by_campaigns(text, sub, vat, total, simple)
        tx = tx_id_from_name(path.name) or tx_id_from_name(text) or ""
        pay_date = payment_date_from_text(text) or ""
        receipt_for = pr.receipt_for_name(text)
        file_hash = sha256_file(path)

        def row(s: Decimal, va: Decimal, tot: Decimal, method: str, note: str) -> dict:
            sc = int((s * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
            vc = int((va * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
            tc = int((tot * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
            return {
                "file": path.name,
                "pdfPath": f"invoices/{path.name}",
                "sha256": file_hash,
                "transactionId": tx,
                "paymentDate": pay_date,
                "receiptFor": receipt_for,
                "subtotal": d2s(s),
                "vat": d2s(va),
                "total": d2s(tot),
                "subtotalCents": sc,
                "vatCents": vc,
                "totalCents": tc,
                "allocationMethod": method,
                "splitNote": note,
            }

        if alloc:
            for cust, (s, va, tot) in alloc.items():
                if cust == "Unallocated":
                    cid = "unallocated"
                elif cust == "Vaalpenskraal":
                    cid = "vaalpenskraal"
                elif cust == "Miwesu":
                    cid = "miwesu"
                else:
                    continue
                by_client[cid].append(row(s, va, tot, "campaign_lines", ""))
        else:
            if simple == "Vaalpenskraal":
                cid = "vaalpenskraal"
            elif simple == "Miwesu":
                cid = "miwesu"
            else:
                cid = "unallocated"
            note = (
                "Could not split by campaign lines; manual review"
                if cid == "unallocated"
                else ""
            )
            vat_d = vat or Decimal("0")
            by_client[cid].append(row(sub, vat_d, total, "whole_receipt", note))

        shutil.copy2(path, INVOICES_OUT / path.name)

    display = {
        "vaalpenskraal": "Vaalpenskraal",
        "miwesu": "Miwesu Fire Wood",
        "unallocated": "Unallocated (review)",
    }

    inv_rows, inv_sum, inv_meta_total = parse_invoice_csv(INVOICE_CSV)
    inv_by_tx = {r["transactionId"]: r["amountCents"] for r in inv_rows}

    prows, account_perf = parse_meta_performance_csv(META_CSV)
    perf_by_brand = aggregate_performance_by_brand(prows)

    # PDF totals + tx allocation check
    pdf_tx_to_allocated_sum: dict[str, int] = defaultdict(int)
    for lst in by_client.values():
        for inv in lst:
            tid = inv.get("transactionId") or ""
            if not tid:
                continue
            pdf_tx_to_allocated_sum[tid] += inv["totalCents"]

    tx_match_issues: list[dict] = []
    for tid, alloc_sum in pdf_tx_to_allocated_sum.items():
        inv_amt = inv_by_tx.get(tid)
        if inv_amt is None:
            tx_match_issues.append(
                {
                    "transactionId": tid,
                    "issue": "no_invoice_row",
                    "allocatedCents": alloc_sum,
                }
            )
        elif inv_amt != alloc_sum:
            tx_match_issues.append(
                {
                    "transactionId": tid,
                    "issue": "amount_mismatch",
                    "invoiceCents": inv_amt,
                    "allocatedCents": alloc_sum,
                }
            )

    pdf_tid_set = set(pdf_tx_to_allocated_sum.keys())
    inv_tid_set = set(inv_by_tx.keys())
    invoice_missing_pdf = sorted(inv_tid_set - pdf_tid_set)
    pdf_missing_invoice = sorted(pdf_tid_set - inv_tid_set)

    billing_methodology = (
        "Billing rows come from Meta PDF receipts. Failed receipts are excluded. "
        "Only Paid receipts with parsable amounts are included. Mixed-brand charges "
        "are split using Campaigns line items (ex-VAT) with VAT in proportion."
    )

    perf_source = META_CSV.name if META_CSV.is_file() else None

    index_clients = []
    for cid, name in display.items():
        if cid not in by_client or not by_client[cid]:
            continue
        if cid not in PORTAL_INDEX_CLIENT_IDS:
            continue
        index_clients.append({"id": cid, "displayName": name})

    all_clients_payload: dict[str, dict] = {}

    for cid, rows in by_client.items():
        if not rows:
            continue
        sub = sum(Decimal(r["subtotal"]) for r in rows)
        vat = sum(Decimal(r["vat"]) for r in rows)
        tot = sum(Decimal(r["total"]) for r in rows)
        sub_c = sum(r["subtotalCents"] for r in rows)
        vat_c = sum(r["vatCents"] for r in rows)
        tot_c = sum(r["totalCents"] for r in rows)

        perf = perf_by_brand.get(cid, {})
        perf_campaigns = perf.get("campaigns") or []
        perf_block = {
            "sourceCsv": perf_source,
            "reporting": {
                "starts": account_perf.get("reportingStarts", ""),
                "ends": account_perf.get("reportingEnds", ""),
            },
            "totals": {
                "spendCents": perf.get("spendCents", 0),
                "spendZar": cents_to_zar_str(perf.get("spendCents", 0)),
                "impressions": perf.get("impressions", 0),
                "reach": perf.get("reach", 0),
                "results": perf.get("results", 0),
            },
            "campaigns": sorted(
                perf_campaigns, key=lambda x: -x["spendCents"]
            ),
        }

        payload = {
            "schemaVersion": 2,
            "clientId": cid,
            "displayName": display.get(cid, cid),
            "currency": "ZAR",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "billing": {
                "methodology": billing_methodology,
                "totals": {
                    "subtotal": d2s(sub),
                    "vat": d2s(vat),
                    "total": d2s(tot),
                    "subtotalCents": sub_c,
                    "vatCents": vat_c,
                    "totalCents": tot_c,
                },
                "invoices": sorted(
                    rows,
                    key=lambda r: (r.get("paymentDate") or "", r.get("file") or ""),
                ),
            },
            "performance": perf_block,
            "integrity": {
                "billingLinesMatchTotals": (
                    sub_c == sum(r["subtotalCents"] for r in rows)
                    and vat_c == sum(r["vatCents"] for r in rows)
                    and tot_c == sum(r["totalCents"] for r in rows)
                ),
            },
        }
        all_clients_payload[cid] = payload
        with open(DATA_CLIENTS / f"{cid}.json", "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)

    # Grand PDF totals (vaal + miwesu + unallocated)
    grand_tot_c = sum(
        all_clients_payload[c]["billing"]["totals"]["totalCents"]
        for c in all_clients_payload
    )
    grand_sub_c = sum(
        all_clients_payload[c]["billing"]["totals"]["subtotalCents"]
        for c in all_clients_payload
    )

    invoice_sum_ok = inv_meta_total is not None and inv_sum == inv_meta_total
    cross_tx_clean = (
        not tx_match_issues
        and not invoice_missing_pdf
        and not pdf_missing_invoice
    )

    reconciliation = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "invoiceCsv": str(INVOICE_CSV.relative_to(OVERLAY_ROOT))
        if INVOICE_CSV.is_file()
        else None,
        "performanceCsv": str(META_CSV.relative_to(OVERLAY_ROOT))
        if META_CSV.is_file()
        else None,
        "invoice": {
            "lineCount": len(inv_rows),
            "computedSumCents": inv_sum,
            "computedSumZar": cents_to_zar_str(inv_sum) if inv_sum else None,
            "metaReportedTotalCents": inv_meta_total,
            "metaReportedTotalZar": cents_to_zar_str(inv_meta_total)
            if inv_meta_total
            else None,
            "computedMatchesMetaFooter": invoice_sum_ok,
        },
        "pdfBilling": {
            "paidReceiptLinesTotalCents": grand_tot_c,
            "paidReceiptLinesTotalZar": cents_to_zar_str(grand_tot_c),
            "paidReceiptSubtotalExVatCents": grand_sub_c,
            "paidReceiptSubtotalExVatZar": cents_to_zar_str(grand_sub_c),
        },
        "crossCheck": {
            "invoiceVsPdfTotalCentsDelta": (inv_sum or 0) - grand_tot_c,
            "invoiceVsPdfTotalZar": cents_to_zar_str((inv_sum or 0) - grand_tot_c),
            "note": (
                "Invoice CSV includes every Meta charge in the billing export. "
                "PDF total includes only Paid receipts present in the folder (Failed excluded). "
                "A non-zero delta usually means failed/cancelled card lines still on the invoice, "
                "or PDFs not yet downloaded for some charges."
            ),
            "transactionIdIssues": tx_match_issues,
            "invoiceTransactionIdsWithoutPdf": invoice_missing_pdf,
            "pdfTransactionIdsMissingFromInvoice": pdf_missing_invoice,
            "allTransactionsMatchAmounts": cross_tx_clean and not tx_match_issues,
        },
        "performance": {
            "accountRow": account_perf,
            "metaAdsIsPreTaxNote": (
                "Meta 'Amount spent' in Ads Manager exports is typically ad spend before SA VAT. "
                "Compare spend to PDF subtotals (ex VAT), not card totals inc VAT."
            ),
            "pdfSubtotalExVatCents": grand_sub_c,
            "sumAdsetSpendCents": account_perf.get("sumAdsetSpendCents"),
            "deltaAdsetSpendVsPdfSubtotalCents": (
                (account_perf.get("sumAdsetSpendCents") or 0) - grand_sub_c
            ),
        },
    }

    with open(PORTAL_ROOT / "data" / "reconciliation.json", "w", encoding="utf-8") as f:
        json.dump(reconciliation, f, indent=2)

    with open(PORTAL_ROOT / "data" / "clients-index.json", "w", encoding="utf-8") as f:
        json.dump(
            {
                "schemaVersion": 2,
                "generatedAt": datetime.now(timezone.utc).isoformat(),
                "clients": sorted(index_clients, key=lambda x: x["displayName"]),
            },
            f,
            indent=2,
        )

    print("Build OK.")
    print(f"  Clients: {', '.join(sorted(all_clients_payload.keys()))}")
    print(
        f"  Invoice sum: {cents_to_zar_str(inv_sum)} ZAR | Meta footer: {cents_to_zar_str(inv_meta_total) if inv_meta_total else 'n/a'} | Match: {invoice_sum_ok}"
    )
    print(
        f"  PDF paid total (all clients): {cents_to_zar_str(grand_tot_c)} ZAR | Delta vs invoice: {cents_to_zar_str((inv_sum or 0) - grand_tot_c)} ZAR"
    )
    print(
        f"  Meta ad set spend sum: {cents_to_zar_str(account_perf.get('sumAdsetSpendCents') or 0)} ZAR"
    )
    print(f"  Wrote {PORTAL_ROOT / 'data' / 'reconciliation.json'}")
    n_pdf = len(list(INVOICES_OUT.glob("*.pdf")))
    print(
        f"  PDFs copied to client-portal/invoices/: {n_pdf}. Commit and push this folder so live downloads work on Vercel."
    )


if __name__ == "__main__":
    main()
