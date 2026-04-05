"""
Scan Meta PDF receipts: delete any whose text contains the word Failed (whole word).
Summarize Paid receipts: split spend by Vaalpenskraal vs Miwesu using Campaigns line items.

Run: python process_meta_receipts.py
"""
from __future__ import annotations

import csv
import re
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent


def read_pdf_text(path: Path) -> str:
    r = PdfReader(str(path))
    return "\n".join(page.extract_text() or "" for page in r.pages)


def parse_money(s: str) -> Decimal:
    return Decimal(s.strip().replace(",", ""))


def extract_receipt_totals(text: str) -> tuple[Decimal | None, Decimal | None, Decimal | None]:
    sub = vat = total = None
    m = re.search(r"Subtotal:\s*([\d,]+\.?\d*)\s*ZAR", text, re.I)
    if m:
        sub = parse_money(m.group(1))
    m = re.search(r"VAT:\s*ZAR\s*([\d,]+\.?\d*)", text, re.I)
    if m:
        vat = parse_money(m.group(1))
    m = re.search(r"\bPaid\b\s*ZAR\s*([\d,]+\.?\d*)", text, re.I)
    if not m:
        m = re.search(r"\bPaid\b[\s\S]{0,120}?ZAR\s*([\d,]+\.?\d*)", text, re.I)
    if not m:
        m = re.search(r"Meta ads\s*Paid\s*ZAR\s*([\d,]+\.?\d*)", text, re.I | re.S)
    if m:
        total = parse_money(m.group(1))
    if total is None and sub is not None and vat is not None:
        total = sub + vat
    elif sub is None and total is not None and vat is not None:
        sub = total - vat
    elif vat is None and total is not None and sub is not None:
        vat = total - sub
    return sub, vat, total


def parse_campaign_blocks(text: str) -> dict[str, Decimal] | None:
    """
    Return {'Vaalpenskraal': sub_ex_vat, 'Miwesu': sub_ex_vat, 'Unallocated': ...}
    from Campaigns section, or None if section missing / unparsed.
    """
    if "Campaigns" not in text:
        return None
    try:
        camp_sec = text.split("Campaigns", 1)[1].split("Meta Platforms", 1)[0]
    except IndexError:
        return None
    # Title, "From ...", ZAR line, optional detail line (often "Brand_Ad Set ... ZAR...")
    pat = re.compile(
        r"([^\n]+)\nFrom [^\n]+\nZAR\s*([\d,]+\.?\d*)(?:\n([^\n]+))?",
        re.I,
    )
    matches = pat.findall(camp_sec)
    if not matches:
        return None

    out: dict[str, Decimal] = {
        "Vaalpenskraal": Decimal("0"),
        "Miwesu": Decimal("0"),
        "Unallocated": Decimal("0"),
    }
    for title, amt_s, detail in matches:
        amt = parse_money(amt_s)
        tl = (title + " " + (detail or "")).lower()
        v = "vaalpenskraal" in tl
        m = "miwesu" in tl
        if v and not m:
            out["Vaalpenskraal"] += amt
        elif m and not v:
            out["Miwesu"] += amt
        elif v and m:
            out["Unallocated"] += amt
        else:
            out["Unallocated"] += amt
    return out


def merge_unallocated(
    blocks: dict[str, Decimal], keyword_class: str
) -> None:
    """Move Unallocated into Vaal/Miwesu when receipt is clearly single-brand."""
    ual = blocks["Unallocated"]
    if ual <= 0:
        return
    va, mi = blocks["Vaalpenskraal"], blocks["Miwesu"]
    if va > 0 and mi == 0:
        blocks["Vaalpenskraal"] += ual
    elif mi > 0 and va == 0:
        blocks["Miwesu"] += ual
    elif keyword_class == "Vaalpenskraal":
        blocks["Vaalpenskraal"] += ual
    elif keyword_class == "Miwesu":
        blocks["Miwesu"] += ual
    else:
        return
    blocks["Unallocated"] = Decimal("0")


def allocate_by_campaigns(
    text: str,
    sub: Decimal | None,
    vat: Decimal | None,
    total: Decimal | None,
    keyword_class: str,
) -> dict[str, tuple[Decimal, Decimal, Decimal]] | None:
    """
    Per customer: (sub_ex_vat, vat, total_inc_vat).
    VAT split proportionally to subtotals when receipt mixes brands.
    """
    blocks = parse_campaign_blocks(text)
    if not blocks or sub is None:
        return None
    merge_unallocated(blocks, keyword_class)
    vaal_s = blocks["Vaalpenskraal"]
    miw_s = blocks["Miwesu"]
    unal = blocks["Unallocated"]
    camp_sum = vaal_s + miw_s + unal
    if camp_sum <= 0 or abs(camp_sum - sub) > Decimal("0.05"):
        # Allow 5c float noise; otherwise line items don't match receipt subtotal
        return None
    vat = vat or Decimal("0")
    total = total or (sub + vat)

    def share(part: Decimal) -> tuple[Decimal, Decimal, Decimal]:
        if sub == 0:
            return Decimal("0"), Decimal("0"), Decimal("0")
        ratio = part / sub
        s = (sub * ratio).quantize(Decimal("0.01"))
        v = (vat * ratio).quantize(Decimal("0.01"))
        t = (total * ratio).quantize(Decimal("0.01"))
        return s, v, t

    out: dict[str, tuple[Decimal, Decimal, Decimal]] = {}
    if vaal_s > 0:
        out["Vaalpenskraal"] = share(vaal_s)
    if miw_s > 0:
        out["Miwesu"] = share(miw_s)
    if unal > 0:
        out["Unallocated"] = share(unal)
    return out if out else None


def classify_simple(text: str) -> str:
    tl = text.lower()
    v = "vaalpenskraal" in tl
    m = "miwesu" in tl
    if v and not m:
        return "Vaalpenskraal"
    if m and not v:
        return "Miwesu"
    if v and m:
        return "Both_keywords"
    return "Unknown"


def receipt_for_name(text: str) -> str:
    m = re.search(r"Receipt for\s+(.+?)(?:\n|Account)", text, re.I | re.S)
    if m:
        return " ".join(m.group(1).split())
    return ""


@dataclass
class Totals:
    subtotal: Decimal = Decimal("0")
    vat: Decimal = Decimal("0")
    total: Decimal = Decimal("0")
    receipts: int = 0


def main() -> None:
    pdfs = sorted(ROOT.glob("*.pdf"))
    pdfs = [p for p in pdfs if p.suffix.lower() == ".pdf"]

    failed_deleted: list[str] = []
    delete_errors: list[tuple[str, str]] = []
    rows: list[dict] = []

    totals: dict[str, Totals] = {
        "Vaalpenskraal": Totals(),
        "Miwesu": Totals(),
        "Unallocated": Totals(),
    }
    paid_issues: list[str] = []

    for path in pdfs:
        try:
            text = read_pdf_text(path)
        except Exception as e:
            rows.append({"file": path.name, "status": "read_error", "error": str(e)})
            continue

        if re.search(r"\bFailed\b", text):
            try:
                path.unlink()
                failed_deleted.append(path.name)
            except OSError as e:
                delete_errors.append((path.name, str(e)))
                rows.append(
                    {
                        "file": path.name,
                        "status": "delete_failed",
                        "error": str(e),
                    }
                )
            continue

        has_paid = bool(re.search(r"\bPaid\b", text))
        sub, vat, total = extract_receipt_totals(text)
        simple = classify_simple(text)
        alloc = allocate_by_campaigns(text, sub, vat, total, simple)
        note = ""

        row_base = {
            "file": path.name,
            "status": "kept",
            "has_paid": has_paid,
            "receipt_for": receipt_for_name(text),
            "keyword_class": simple,
            "subtotal_zar": str(sub) if sub is not None else "",
            "vat_zar": str(vat) if vat is not None else "",
            "total_zar": str(total) if total is not None else "",
            "allocation": "",
        }

        if not has_paid or sub is None or total is None:
            if has_paid:
                paid_issues.append(f"{path.name} (missing amounts)")
            row_base["allocation"] = "excluded_no_paid_or_amounts"
            rows.append(row_base)
            continue

        if alloc:
            row_base["allocation"] = "campaign_lines"
            parts = []
            for cust, (s, va, t) in sorted(alloc.items()):
                parts.append(f"{cust}: sub {s} VAT {va} total {t}")
                ct = totals[cust]
                ct.subtotal += s
                ct.vat += va
                ct.total += t
                ct.receipts += 1
            row_base["split_detail"] = "; ".join(parts)
        else:
            # Whole receipt to one bucket by keyword (no reliable campaign split)
            if simple == "Vaalpenskraal":
                cust = "Vaalpenskraal"
            elif simple == "Miwesu":
                cust = "Miwesu"
            elif simple == "Both_keywords":
                cust = "Unallocated"
                note = "both brands in text but campaign lines did not match subtotal"
            else:
                cust = "Unallocated"
                note = "unknown brand"
            row_base["allocation"] = "whole_receipt_" + cust + (f" ({note})" if note else "")
            t = totals[cust]
            t.subtotal += sub
            t.vat += vat or Decimal("0")
            t.total += total
            t.receipts += 1

        rows.append(row_base)

    report_csv = ROOT / "receipt_processing_report.csv"
    keys: set[str] = set()
    for r in rows:
        keys.update(r.keys())
    ordered = [
        "file",
        "status",
        "error",
        "has_paid",
        "receipt_for",
        "keyword_class",
        "allocation",
        "split_detail",
        "subtotal_zar",
        "vat_zar",
        "total_zar",
    ]
    rest = sorted(keys - set(ordered))
    fieldnames = [k for k in ordered if k in keys] + rest
    with open(report_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)

    lines = [
        "Meta receipt processing (Paid only, Failed PDFs removed)",
        "===========================================================",
        f"PDFs deleted (contained whole word 'Failed'): {len(failed_deleted)}",
    ]
    for name in sorted(failed_deleted):
        lines.append(f"  deleted: {name}")
    if delete_errors:
        lines.append("")
        lines.append("Could not delete (close the file and re-run):")
        for n, err in delete_errors:
            lines.append(f"  {n}: {err}")
    lines.extend(
        [
            "",
            "Spend by customer (ZAR, only receipts with 'Paid')",
            "-----------------------------------------------------",
            "Includes proportional VAT split when one charge mixes both brands (campaign line items).",
            "",
        ]
    )
    for label in ("Vaalpenskraal", "Miwesu", "Unallocated"):
        t = totals[label]
        if t.receipts == 0:
            continue
        lines.append(f"{label}:")
        lines.append(f"  Receipt lines counted: {t.receipts}")
        lines.append(f"  Subtotal (ex VAT):     {t.subtotal:.2f}")
        lines.append(f"  VAT:                     {t.vat:.2f}")
        lines.append(f"  Total (inc VAT):       {t.total:.2f}")
        lines.append("")
    if paid_issues:
        lines.append("Excluded from totals:")
        for x in paid_issues:
            lines.append(f"  - {x}")

    summary_path = ROOT / "customer_spend_summary.txt"
    summary_text = "\n".join(lines)
    with open(summary_path, "w", encoding="utf-8") as f:
        f.write(summary_text)

    print(summary_text)
    print(f"\nWrote: {report_csv}")
    print(f"Wrote: {summary_path}")


if __name__ == "__main__":
    main()
