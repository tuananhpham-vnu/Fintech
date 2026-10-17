# REC-AI post-acceptance grounding — 2026-10-17

Status: **bounded offline recovery PASS; REC04 role-policy follow-up BLOCKED**.
Authority: `C:/Users/52duc/Downloads/AIC-CODEX-POST-ACCEPTANCE-RECOVERY.md`, P1-B,
and the narrower REC-AI ownership instruction. Read root README, services/ai README,
and `docs/implementation/acceptance-ai-review.md` before implementation. Existing
staged/unstaged/untracked work was inspected and preserved. No stage/commit/push.

## Changes and scope

Only these files were written by REC-AI:

- `services/ai/extraction/grounding.py`: recognize U+2010 separators in the existing
  ISO date pattern; split U+FD3E/U+FD3F in the party-heading comparison; support an
  explicitly printed UNC token after a standalone `Số chứng từ:` label.
- `services/ai/tests/test_post_acceptance_grounding.py`: new offline regressions
  and original-byte extraction tests.
- `docs/implementation/post-acceptance-grounding.md`: this handoff.

The new document-number path requires the sole scoped token to start with `UNC`
followed by a digit or ASCII/U+2010 hyphen. Generic invoice/numeric document
numbers, alternate tokens, extra prose and negated inline labels stay rejected.
Other document-number layouts are unsupported pending reviewed source evidence.
This extracts a reference, never settlement or identity verification. It adds no
role aliases, role equivalences, classification policy or financial rules.

No provider/network calls, `.env` discovery/reads, DB, service processes, fixture
generation, oracle edits, or wrapper edits. All pytest runs used the existing
offline wrapper, which removes inherited Gemini/internal keys, bypasses dotenv,
blocks direct `.env` reads and application socket connections, disables bytecode,
cache and plugin autoload. Its exact stdlib Windows socketpair exception remains
unchanged. Proposals are explicitly fake/offline and are not provider evidence.

## Original source reproduction

Original directory:
`C:/Users/52duc/Desktop/AIC-MVP-Audit-v0.4.0-20261017/agent-03/ai-acceptance-preparation/documents/`.
Read these six PDFs only; checked actual byte size and SHA-256 against both pinned
test constants and the original adjacent `ground-truth/manifest.json`. PyMuPDF
read each original native page directly. No PDF was copied, rewritten or repaired.
The curated review scripts/oracles were read, not executed or modified.

| Original filename | Bytes | SHA-256 |
| --- | ---: | --- |
| DOC_REC_02_Acceptance_Matching.pdf | 1003216 | `dc06ab8c243b915c47b9082c3dd722d0b7b420584923c25d542edfe4f2aa0419` |
| DOC_REC_03_Acceptance_Mismatch.pdf | 1003149 | `f0ce014e7a5f067da1986e8320ce1bd0ed4fe269a11d530454103a0e98cbdd10` |
| DOC_REC_04_Contract_Role_Inversion.pdf | 1002656 | `a760d1272e0eb1d7890190d756f1ac05bb9f8e1471a612f4fddbefdfba008a17` |
| DOC_PRE_01_Contract_Prepayment.pdf | 1003359 | `6fb67ef4d583becf4a0ab403a59217dfcbac511fecb26add52f0050b5d831f42` |
| DOC_PRE_02_Payment_Record_Valid.pdf | 1003177 | `1000cc4ff14fe7dbcd735e2fce36a8045ab979021d03ee885d6ca15c89d80301` |
| DOC_PRE_03_Payment_Record_Ambiguous.pdf | 1003079 | `7a8f71e81a886834c028e9d5a57f7cbedb9892307c09fddb92a17f5d16014d8d` |

| Probe | Before | After |
| --- | --- | --- |
| REC02/REC03 acceptance dates; PRE02/PRE03 payment dates | All 4 rejected, `VALUE_NOT_IN_QUOTE` | All 4 source dates grounded; ISO values unchanged |
| PRE01 seller/buyer; PRE02 payer/payee IDs in U+FD3E/U+FD3F headings | All 4 rejected, `UNVERIFIED_FIELD_ROLE`; ASCII equivalents pass | All 4 grounded; opposite-role proposals rejected |
| REC04 seller/payee and buyer/payer headings | Both role IDs rejected with Unicode **and ASCII** parentheses | Both remain rejected; `null/uncertain/ambiguous` |
| PRE02/PRE03 `Số chứng từ:` followed by printed UNC code | Both rejected, `UNVERIFIED_FIELD_LABEL` | Both exact source reference meanings grounded |
| Conflicting ASCII + U+2010 dates in one date field | ASCII date could be accepted while the other date was ignored | Both participate in existing `AMBIGUOUS_DATE` rejection |

The PRE03 UNC reference is a directly verified native-text regression beyond the
curated six-document scoring subset. It does not make that ambiguous payment a
successful or verified payment. In the extraction-path test, a false `completed`
proposal and an invented corporate payee both remain null/uncertain/ambiguous.

## Exact test commands and counts

Commands run from `C:/Users/52duc/Desktop/Fintech`. No full suite was run in this
task, to leave serial integration scheduling with the lead.

Before editing service code, the initial 55-case regression file reproduced the
failure with:

```powershell
.\.venv\Scripts\python.exe -B apps/api/test/acceptance-ai-fixtures/run_unit_suite.py tests/test_post_acceptance_grounding.py --tb=short
```

Result: **19 failed, 36 passed, 1 warning; exit 1** (0.87s pytest). Failures:
four original dates, four original role IDs, two original UNC references, five
affected extraction-path documents, two mixed-date ambiguity checks, and two
U+2010/mixed-separator positive controls. REC04's two explicit blocked probes
and its extraction-path null assertions already passed before the change.

After implementation and four additional UNC negatives (extra token, alternate
reference, `UNCERTAIN` prefix, negated inline label), the **same command** gave
**59 passed, 1 warning; exit 0** (0.65s pytest). Test expectations for the original
55 cases were unchanged; no failure was converted into a new null oracle.

Relevant existing regressions were then run serially in one wrapper process:

```powershell
.\.venv\Scripts\python.exe -B apps/api/test/acceptance-ai-fixtures/run_unit_suite.py tests/test_post_acceptance_grounding.py tests/test_extraction_roles.py tests/test_extraction_correctness.py tests/test_extraction_correctness_r2.py tests/test_extraction.py --tb=short
```

Result: **291 passed, 4 skipped, 1 warning; exit 0** (5.25s pytest). Skips:
Windows symlink privilege, missing canonical `07_contract_scan.pdf` and
`08_correct_record_scan.pdf`, unavailable Tesseract. The warning is the existing
Starlette/AnyIO `BlockingPortal` deprecation. External PDFs did not skip here.

```powershell
git diff --check -- services/ai/extraction/grounding.py
```

Result: exit 0, no whitespace errors. Owned files remain unstaged.

The tests accept `AIC_RECOVERY_PDF_DIR` pointing to another original documents
directory with its adjacent original manifest. A missing explicitly configured
directory fails; an absent default external bundle skips the external cases
explicitly while portable negatives still run. This portability behavior is not
used to exclude any source in the observed counts above.

## Negative coverage and evidence invariants

- Wrong, swapped, impossible and incomplete dates reject; mixed ASCII/U+2010
  distinct dates reject as ambiguous. Unicode minus and day-first U+2010 are
  deliberately outside the new ISO-only support; existing day-first ASCII
  parsing remains covered.
- Neutral A/B labels, consultant sections, prose mentions, conflicting roles,
  and REC04 dual-role headings do not assign roles. The guard does not inherit
  a seller role across unknown/neutral sections. Source roles cannot be swapped
  merely because the tax ID is present.
- Invoice/numeric document numbers, mismatched/suffix-truncated UNC values,
  contract numbers from adjacent fields, alternate codes, and invalid UNC
  prefixes do not gain payment-reference support.
- Pending, failed, denied and hypothetical payment statements cannot become
  `completed` from a UNC reference. PRE03's personal-recipient layout cannot
  borrow the payer's corporate tax ID for a payee.
- ASCII rewrites of U+2010 dates/references or U+FD3E/U+FD3F evidence fail quote
  authenticity. Exact originals retain page/start/end/quote; blocked injection
  spans and wrong-page text cannot supply evidence.
- All six original PDFs run through actual storage/hash/native extraction with
  narrowly scoped fake proposals. Output schema/semantic guards pass; returned
  page text and raw values equal the originals, evidence quotes/page/document
  bindings remain exact, and field/evidence IDs remain deterministic on repeat.
  Source bytes are rehashed after extraction. Unproposed fields are test
  placeholders, not a whole-document absence oracle or accuracy denominator.
- Accounting parentheses, negative amount signs and compound monetary scale
  retain existing semantics. No global source normalization was added.

Frozen legacy 1.0.2 integrity is checked by the existing `Contracts` fixture;
output and provenance still declare `1.0.2`. No contracts/fixtures/oracles were
written. File fingerprints (SHA-256):

- Grounding before: `25a9d9f43dca66d0f90197ae2116dc554411d71f48c61cb03dc319c30681fddb`.
- Grounding after: `bd511c6842bbe4319a4fd664ebb03644ab63cf49e6e85aa970bccc664096647c`.
- New regression file: `3588323bafdcf11fce5e2797a45b1f23f562e841f928f5ed0bd61ac986d679ed`.
- `packages/contracts/SHA256SUMS`, before/after unchanged:
  `480a302b06912c3545a25d0a6c28745de480c7f4d3caa782ee1202e687069e4b`.
- Existing `run_unit_suite.py`, before/after unchanged:
  `e892ca4d2689462966483fff5586339c8a8c38ef53ea51bf6ab2c89e05844f3b`.

## Bounded unresolved gate and lead request

**BLOCKED: REC04's two role fields.** Its `Bên mua ﴾bên trả tiền﴿` and
`Bên bán ﴾bên nhận tiền﴿` headings each name two roles recognized by the current
guard. Replacing only parentheses with ASCII still yields two roles and
`UNVERIFIED_FIELD_ROLE`. Accepting either requires changing existing role
equivalence/ambiguity policy, beyond this typography-only authorization. Keep
the current null/uncertain output and original source facts. Proposed separate
follow-up: approve an explicit policy for multiple named roles, then test all
role combinations, conflicting and cross-section headings, and the downstream
case-role mismatch guard before implementing it. No new policy was inferred here.

Lead: please schedule the **full AI suite serially** after integrating concurrent
provider/wiring work, using the unchanged command below, and record its actual
outcome separately. This request is a handoff; that integration run is NOT RUN
by REC-AI.

```powershell
.\.venv\Scripts\python.exe -B apps/api/test/acceptance-ai-fixtures/run_unit_suite.py
```

Provider recovery, correct-job retry, current PREPAYMENT browser behavior and
application/demo gates remain lead-owned and unverified here. These offline
results confer no live, settlement, whole-benchmark, demo or production GO.
