"""Copy Miwesu_Wood_Creatives/April → client-portal/april/ and write data/april-creative.json."""
from __future__ import annotations

import json
import shutil
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

PORTAL = Path(__file__).resolve().parents[1]
OVERLAY = Path(__file__).resolve().parents[2]
SRC = OVERLAY / "Miwesu_Wood_Creatives" / "April"
DEST = PORTAL / "april"
OUT = PORTAL / "data" / "april-creative.json"

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
VIDEO_EXT = {".mp4", ".webm", ".mov", ".m4v"}


def mwf_april_2026() -> list[date]:
    out: list[date] = []
    d = date(2026, 4, 1)
    while d.month == 4:
        if d.weekday() in (0, 2, 4):
            out.append(d)
        d += timedelta(days=1)
    return out


def main() -> None:
    if not SRC.is_dir():
        print(f"Missing: {SRC}")
        return

    if DEST.exists():
        shutil.rmtree(DEST)
    DEST.mkdir(parents=True, exist_ok=True)

    files = [
        f
        for f in SRC.iterdir()
        if f.is_file() and f.suffix.lower() in IMAGE_EXT | VIDEO_EXT
    ]
    files.sort(key=lambda p: (p.stat().st_mtime, p.name.lower()))

    for f in files:
        shutil.copy2(f, DEST / f.name)

    slots = mwf_april_2026()
    names = [f.name for f in files]
    scheduled = []
    for i, d in enumerate(slots):
        if i >= len(names):
            break
        fn = names[i]
        scheduled.append(
            {
                "date": d.isoformat(),
                "label": d.strftime("%a %d %b %Y"),
                "file": fn,
                "url": "april/" + fn.replace("\\", "/"),
                "kind": "video" if Path(fn).suffix.lower() in VIDEO_EXT else "image",
            }
        )

    used = {x["file"] for x in scheduled}
    extra = []
    for fn in names:
        if fn not in used:
            ext = Path(fn).suffix.lower()
            extra.append(
                {
                    "file": fn,
                    "url": "april/" + fn.replace("\\", "/"),
                    "kind": "video" if ext in VIDEO_EXT else "image",
                }
            )

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "intro": (
            "Facebook posts for April 2026, scheduled for every Monday, Wednesday, and Friday. "
            "Preview and download each asset below."
        ),
        "scheduled": scheduled,
        "additional": extra,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote {len(names)} files to {DEST} and {OUT}")


if __name__ == "__main__":
    main()
