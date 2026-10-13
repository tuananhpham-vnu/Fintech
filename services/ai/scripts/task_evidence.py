"""Chạy test module và ghi evidence theo DoD: actual result + commit SHA + fixture hash + log.

Chạy: cd services/ai && ../../.venv/bin/python scripts/task_evidence.py T13b
Ghi:  evidence/<task>-report.json và evidence/<task>-junit.xml
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
FIXTURES = REPO / "packages" / "contracts" / "fixtures"
TEST_ID = re.compile(r"(?:^|_)(t\d{2}|a\d{2}|g0\d)(?=_|$)", re.IGNORECASE)


def git(*args: str) -> str:
    result = subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else "unknown"


def main() -> int:
    task = sys.argv[1] if len(sys.argv) > 1 else "module"
    out_dir = ROOT / "evidence"
    out_dir.mkdir(exist_ok=True)
    junit = out_dir / f"{task}-junit.xml"
    proc = subprocess.run([sys.executable, "-m", "pytest", "-q", f"--junitxml={junit}"], cwd=ROOT,
                          capture_output=True, text=True)
    cases = []
    for case in ET.parse(junit).getroot().iter("testcase"):
        outcome = "failed" if case.find("failure") is not None or case.find("error") is not None else \
            "skipped" if case.find("skipped") is not None else "passed"
        name = case.get("name", "")
        cases.append({"test": f"{case.get('classname')}::{name}", "outcome": outcome,
                      "spec_ids": sorted({m.upper() for m in TEST_ID.findall(name)})})
    totals = {k: sum(c["outcome"] == k for c in cases) for k in ("passed", "failed", "skipped")}
    report = {
        "task": task,
        "ran_at": datetime.now(timezone(timedelta(hours=7))).isoformat(timespec="seconds"),
        "command": f"cd services/ai && python scripts/task_evidence.py {task}",
        "commit_sha": git("rev-parse", "HEAD"),
        "working_tree_dirty": bool(git("status", "--porcelain")),
        "contract_version": (REPO / "packages" / "contracts" / "VERSION").read_text().strip(),
        "fixture_hashes": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(FIXTURES.glob("*.json"))},
        "totals": totals,
        "result": "PASS" if proc.returncode == 0 and totals["failed"] == 0 else "FAIL",
        "covered_spec_ids": sorted({i for c in cases if c["outcome"] == "passed" for i in c["spec_ids"]}),
        "cases": cases,
        "pytest_tail": proc.stdout.strip().splitlines()[-1:],
    }
    path = out_dir / f"{task}-report.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print(f"{report['result']} {totals} covered={report['covered_spec_ids']}\nreport: {path.relative_to(REPO)}")
    return 0 if report["result"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
