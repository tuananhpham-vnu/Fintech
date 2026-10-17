# AIC AI service audit — PDF, OCR, grounding and provider boundary

Date: 2026-10-17, Asia/Saigon. [Handoff index](AIC_AGENT_FIX_HANDOFF.md) · [Backend findings](AIC_BACKEND_AUDIT.md) · [publication checklist](AIC_GITHUB_PUBLISH_CHECKLIST.md).

## Revision and summary

Branch `duc`; base HEAD `8b0b7ed9e983ba4a2ea4d43f79d1816eaad7dbf0` plus the worktree fingerprint captured at 21:52:23 +07:00. Current extractor/grounding/PDF/app changes and additional tests are unpublished. Remote AI files exist but are not generally equal to this audited source; branch names alone cannot identify the audited version.

**Five open findings: P0 0 / P1 2 / P2 3. All five CONFIRMED at the explicitly stated synthetic component scope.** No live model accuracy, actual multilingual OCR or malicious full-file denial-of-service demonstration is claimed. The failed subagent attempt yielded no usable independent AI review; lead execution supplied this evidence.

## Coverage matrix

| Area | Coverage | Evidence / boundaries |
| --- | --- | --- |
| Native text, U+0003, NFC, vector/blank/mixed pages | Verified for selected synthetic cases | Existing PDF/robustness suites ran; synthetic missing-ToUnicode defect independently reproduced |
| Actual vi/en/zh-Hans OCR | Not verified | No verified local engine/language-pack installation used; fake OCR does not establish recognition accuracy |
| Grounding, quotes, source offsets, labels/roles | Partial | Existing role/regression tests pass; probes demonstrate CJK wrap and language-rule gaps. No complete three-language corpus |
| Prompt injection / untrusted JSON | Partial | Prompt masking and schema guards inspected/tested in selected suites; multilingual injection coverage not exhaustive |
| Document type/schema/nullable output/provenance | Verified at selected contract scope | test_contracts/test_app and BE adapter tests; no schema edits |
| Source hash/page/bbox/evidence/human verification | Partial | Guards and projection tests run; native bbox supported, OCR stays page precision + unverified. No DB source re-read |
| Provider retry/429/503/deadline/no mock fallback | Verified with MockTransport | test_providers/test_extraction_robustness; malformed outer HTTP-200 JSON escapes typed mapping (AI-005) |
| Body size/CPU/native parse cancellation | Partial | AI-004 body-reader probe; native parser has bounded dimensions/content but no killable execution demonstrated |
| Financial/party/period attribution | Partial | Source roles and normalization inspected; no foreign identifier semantics/FHI approval inferred |
| External privacy/logging | Partial | No live calls; default Gemini OCR remains an operator configuration boundary. No owner's secrets, dumps or PDF inspected in this audit |
| Actual BE→FastAPI→DB end-to-end | Not verified | Synthetic Node loopback transport and in-process FastAPI separately tested; no Nest/PG integration rerun |

## Executed tests

T-AI-1: eight existing Python suites, environment reduced to OS essentials; `runner.config.load_dotenv` replaced in memory with a no-op, bytecode/cache writing disabled, outbound sockets blocked except loopback. Exact wrapper is in [test recipes](AIC_AGENT_FIX_HANDOFF.md#test-recipes).

```text
services/ai/tests/test_demo_pdf_regressions.py
services/ai/tests/test_extraction_roles.py
services/ai/tests/test_extraction_robustness.py
services/ai/tests/test_demo_zip_security.py
services/ai/tests/test_dossier_zip_security.py
services/ai/tests/test_providers.py
services/ai/tests/test_app.py
services/ai/tests/test_contracts.py
```

Actual final result: **227 passed, 0 failed, 0 skipped**, exit 0, 7.57 seconds pytest duration; one Starlette/AnyIO deprecation warning. Synthetic temporary PDF files belong only to pytest temporary storage, not the worktree or main DB. ZIP parser tests use actual decompression, not source-string assertions.

An earlier wrapper blocked every `socket.connect`, including Windows asyncio's loopback socketpair: **202 passed / 25 failed**, exit 1, 12.73 seconds. Those failures were audit-harness interference (`AUDIT_EXTERNAL_NETWORK_BLOCKED` in socketpair), not product findings. After allowing loopback while retaining the external-network block, all 227 passed. Both executions are disclosed; no source test was changed to obtain green results.

T-AI-2–5: synthetic in-memory probes below, exit 0: a real PyMuPDF font-mapping PDF; deterministic grounding checks; Starlette request body reader; Gemini adapter with httpx.MockTransport. No external call or real dossier. Existing external PDF acceptance suite `test_post_acceptance_grounding.py` deliberately NOT RUN because its default fixture path reads outside the clone. Live subset tests, provider smoke and actual OCR were NOT RUN.

<a id="ai-001"></a>
## AI-001: Detect readable-looking glyph corruption before skipping OCR

- **State/confidence:** CONFIRMED by actual synthetic PDF creation and `pdf.inspect`; no model or OCR. **P1**: apparently normal PDFs can produce zero usable fields, wrong-language glyphs or missing identifiers. High likelihood for malformed/absent font Unicode mappings; applies before field extraction.
- **Affected revision:** base SHA plus dirty `services/ai/extraction/pdf.py`, extractor.py and local regression tests. Current bytes NOT_ON_REMOTE; old remote implementations are not evidence for this exact snapshot.
- **Locations:** [pdf.py](../../services/ai/extraction/pdf.py):31–35 thresholds, 97–105 `_garbled_ratio`, 161–189 `_page_info`; [extractor.py](../../services/ai/extraction/extractor.py):128–163 `read_pages` skips OCR when `needs_ocr=false`.
- **Precise repro:** R-AI-1 snippet in handoff: create a one-page synthetic Type0/Identity-H PDF with an installed permitted font, remove that font's ToUnicode using PyMuPDF in memory, inspect full pages. Actual: expected text no longer matches, `needs_ocr=false`, ratio **0.22448979591836735**, below 0.3. Font used in the executed Windows probe was system Arial; no font copied/published.
- **Expected/actual:** a suspicious corrupted layer should trigger a bounded OCR/quality comparison or explicit review; it is treated as usable native text. This reproduces the class without a proprietary PDF.
- **Cause:** most wrongly mapped glyphs become valid Unicode letters/digits/symbols, so counting Cc/Co/Cn/replacement chars misses semantic corruption. Lack of ToUnicode alone is not sufficient: healthy standard/CJK fonts can also omit it.
- **Fix plan:** AI-PDF owner adds page/font-aware quality signals and bounded fallback, preserving healthy English/Han native text. Combine font use, suspicious controls/script mixture/layout/coverage and, where needed, local OCR probe; do not simply lower one threshold, force all missing-ToUnicode pages to OCR, or accept fields because their count increased. Preserve page/text budgets and source bytes.
- **Tests/acceptance:** add red synthetic damaged-map test; negative controls healthy Helvetica/CJK without ToUnicode remain exact text/no forced OCR, actual blank stays blank, U+0003-only separators retain exact evidence. Run `python -B -m pytest -q -p no:cacheprovider services/ai/tests/test_demo_pdf_regressions.py services/ai/tests/test_extraction_robustness.py`. New real local OCR tests must verify recovered ground-truth text; fake OCR cannot certify accuracy.
- **Owner/dependencies:** AI-PDF package owns pdf.py and its new detector tests; extractor integration belongs to the serial integrator. Benchmark engine/language packs before enabling fallback by default. Estimate 1–3 days including corpus work.
- **Impact/approval:** no migration or FHI changes; no original PDF rewriting, result overwrites or automatic live-provider fallback. REQUIRES_OWNER_APPROVAL for cloud OCR or processing additional real dossiers.
- **Handoff DoD:** fresh clone reproduces corrupted-map misclassification with synthetic bytes and deterministic control cases; fix passes offline OCR verification without owner's documents/profile.

<a id="ai-002"></a>
## AI-002: Match CJK line wrapping without weakening exact evidence binding

- **State/confidence:** CONFIRMED deterministic direct call. **P2**, valid Chinese quotes can be rejected when a word crosses a source line; supported native Han alone is not the problem.
- **Affected revision:** dirty grounding.py, NOT_ON_REMOTE exact bytes; base SHA above.
- **Locations:** [grounding.py](../../services/ai/extraction/grounding.py):125–160 `find_quote`, especially token splitting and whitespace join; [extractor.py](../../services/ai/extraction/extractor.py):296–317 rejects unmatched evidence.
- **Repro:** `find_quote(1, '企业名\n称：示例科技有限公司', '企业名称：示例科技有限公司', [])`. Expected a same-page source span preserving original newline/offsets; actual `None`. Exact unwrapped source matches. Synthetic text only, no model.
- **Cause/evidence:** quote has no spaces inside the Han run, so one regex token cannot match the inserted newline. Current Western-word whitespace normalization does not represent CJK line breaks.
- **Fix plan:** bounded script-aware comparison view with reversible mapping to original source offsets; treat allowed line-wrap boundaries within Han carefully. Do not drop all whitespace/punctuation, perform fuzzy name/number matching, or join two columns. Keep blocked injection spans and page boundary checks.
- **Tests/acceptance:** red wrapped-Han probe; regression NFC/NFD Vietnamese and English whitespace; negatives changed Han character, one changed digit, wrong page, blocked span, cross-column fragments must fail. Proposed focused file `services/ai/tests/test_trilingual_grounding.py` is not yet authored. Validation after patch: `python -B -m pytest -q -p no:cacheprovider services/ai/tests/test_trilingual_grounding.py services/ai/tests/test_demo_pdf_regressions.py`.
- **Owner/dependencies:** AI-GROUND owns grounding.py and multilingual grounding tests, serialized with AI-003; no parallel edits to that file. Coordinate extractor only through integrator. Estimate 0.5–1.5 days.
- **Impact/approval:** comparison logic only; raw source/quote/provenance must remain unchanged. No contract widening or data migration presumed.
- **Handoff DoD:** deterministic portable red/green test proves source span offsets and exact source quote, not merely a boolean fuzzy match.

<a id="ai-003"></a>
## AI-003: Implement the advertised three-language semantic grounding coverage

- **State/confidence:** CONFIRMED direct synthetic probes; English/Chinese read support is incomplete at value/label/role interpretation. **P1** for the requested vi/en/zh-Hans release scope. No claim that all English fields currently fail.
- **Affected revision:** dirty grounding.py/extractor.py, unchanged normalize package at local HEAD, OCR configuration; exact audited tree not published.
- **Locations:** [grounding.py](../../services/ai/extraction/grounding.py):53–82 dates/enums/unit cues, 278–306 date/tax parsing, 403–448 labels/party aliases; [extractor.py](../../services/ai/extraction/extractor.py):42–81 value conventions/roles; [normalize/__init__.py](../../services/ai/normalize/__init__.py):12–34 Vietnamese tax ID constraint. [ocr.py](../../services/ai/extraction/ocr.py):21–26 prompt and 53–78 fixed language/PSM are adjacent OCR coverage gaps, not separately claimed accuracy failures.
- **Repro/actual:** direct `check_value/check_source` using current registry: English `October 17, 2026` and Chinese `2026年10月17日` => VALUE_NOT_IN_QUOTE; `Seller` + synthetic Vietnamese Tax ID => UNVERIFIED_FIELD_ROLE; English `Payment status: completed` => VALUE_NOT_IN_QUOTE; Chinese `付款金额：1250` => UNVERIFIED_FIELD_LABEL; `单位：万元` => UNPARSEABLE_AMOUNT. Expected unambiguous supported-language facts to ground with their exact source and role. R-AI-2 in handoff provides runnable cases.
- **Cause:** language support was added at encoding/model level but deterministic acceptance still uses a mainly Vietnamese rule catalogue. A better OCR/model output will still be rejected by these guards.
- **Fix plan:** language profiles/aliases for labels, roles, states, negation/hypothetical clauses, dates, money/scale and layout; preserve field_key semantics. English language alone must not decide US/UK numeric-date order; ambiguous cases stay uncertain. Chinese units must obey existing financial amount+multiplier contract without double scaling. Do not silently reinterpret Buyer as Borrower or foreign enterprise IDs as Vietnamese tax IDs. Country/identifier DTO changes need a separate product/contract decision.
- **Tests/acceptance:** paired positive/negative tests for each supported language and mixed pages; negate/reverse role/status, change a digit, ambiguous 03/04 date, full-width punctuation, `万/亿` unit scale and missing-versus-zero. Run new multilingual tests plus existing role/correctness/regression suites offline. Real OCR and semantic model accuracy need separate benchmark, not these deterministic probes.
- **Owner/dependencies:** AI-GROUND serializes AI-002 and AI-003 in grounding.py; extractor prompt edits via integrator after profile contract. Existing Vietnamese tax format remains until owner decides foreign IDs. Estimate 2–5 days, conditional on scope/corpus.
- **Impact/approval:** REQUIRES_OWNER_APPROVAL for foreign-identifier semantics, accounting/jurisdiction rules or new DTOs. Language reading support itself does not authorize FHI/rating/method changes or cloud transfer.
- **Handoff DoD:** external agent can reproduce every listed rejection with synthetic strings; supported unambiguous cases pass and adversarial/ambiguous facts remain rejected/uncertain; publish measured coverage per language.

<a id="ai-004"></a>
## AI-004: Bound internal JSON bodies before buffering and parsing

- **State/confidence:** CONFIRMED direct Starlette request-reader probe; not a full memory-exhaustion attack. **P2**. A caller with internal-key access can force unbounded buffering before schema rejection; endpoint exposure/key compromise increases impact.
- **Affected revision:** dirty runner/app.py plus existing service routes; exact worktree NOT_ON_REMOTE.
- **Locations:** [app.py](../../services/ai/runner/app.py):107–132 authorization, `_read_json`, validation/dispatch. `_read_json` calls `await request.body()` then `json.loads` with no byte cap.
- **Repro:** build a Starlette Request with one synthetic JSON padding field of 2 MiB, call `_read_json` directly. Actual **2,097,166 bytes accepted into parsed JSON**, one receive call, no network. Expected an enforced documented cap before allocation of the entire body; 2 MiB is a probe size, not an approved universal limit. Later schema rejection does not undo initial allocation.
- **Cause:** PDF/model output budgets exist, but HTTP input JSON has no streamed delivered-byte budget. Nest input limits do not protect a direct internal-service call.
- **Fix plan:** AI-HTTP adds operation-appropriate max bytes with streamed counting, including chunked or incorrect/missing Content-Length; sanitized Error envelope/status. Size for evaluate must account for bounded legitimate multi-document input. Coordinate error-code allowlist/status mapping with BE integrator before adding a code. Do not log oversized body/details.
- **Tests/acceptance:** red over-cap request; at-limit valid request passes; one-byte-over/chunked/misdeclared length rejected before full read, backend not called; unauthorized request remains 403 before reading; no value echoed. Proposed unit file `services/ai/tests/test_request_limits.py`; validate with test_app/test_contracts and Node transport error mapping.
- **Owner/dependencies:** AI-HTTP owns runner/app.py/new limit tests; BE contract integrator owns transport mappings only if wire error changes. Parallel-safe versus grounding/PDF. Estimate 0.5–1.5 days.
- **Impact/approval:** no DB/migration; body cap and any new error code require contract review, not arbitrary schema edits. Production ingress configuration remains an operator task.
- **Handoff DoD:** portable in-process ASGI tests prove rejection occurs before buffering beyond budget; existing canonical envelopes and legitimate evaluate fixtures still validate.

<a id="ai-005"></a>
## AI-005: Translate malformed provider response JSON into the typed repair/error path

- **State/confidence:** CONFIRMED httpx.MockTransport probe. **P2**. Upstream HTTP-200 malformed JSON bypasses model-output repair and becomes an unexpected server error; transient proxy/provider corruption affects retry classification and observability.
- **Affected revision:** [providers/gemini.py](../../services/ai/providers/gemini.py) present at HEAD; audited source file matches its local HEAD (remote full equality must be checked by pinned blob); call_json path uses current AI package.
- **Locations:** gemini.py:73–98 `_request` returns `response.json()` outside typed parse wrapping; 138–145 `generate_json` calls `_request` before its inner content parse try. [llm.py](../../services/ai/extraction/llm.py):94–114 catches ProviderUnavailable/ProviderError only; [app.py](../../services/ai/runner/app.py):73–76 unexpected fallback.
- **Repro:** GeminiProvider with synthetic key/model, max_retries=0, injected MockTransport returning HTTP 200 `<html>bad upstream</html>`; call `call_json(..., Deadline(2), 'audit')`. Actual raw **JSONDecodeError**, not `MalformedOutput` or ServiceError. No network. R-AI-3 is provided in handoff.
- **Expected:** bounded typed outcome under the documented repair/unavailability policy with sanitized public envelope, without an unhandled decoder exception. A provider gateway failure need not be semantically equated with malformed candidate JSON; classify that distinction explicitly.
- **Cause:** code guards parsing of candidate text but not the outer HTTP JSON document. Failure occurs before the existing exception translation.
- **Fix plan:** AI-PROVIDER wraps outer response decoding and validates expected envelope types; maps to typed ProviderError/ProviderUnavailable per reviewed policy. Preserve original cause internally without body/key/prompt exposure; finite retry/repair budget, no mock fallback.
- **Tests/acceptance:** red MockTransport malformed outer JSON; negatives JSON array/null/incorrect candidate shape, malformed inner candidate, permanent 4xx and exhausted 429; regression valid 200 and bounded Retry-After/deadline. `python -B -m pytest -q -p no:cacheprovider services/ai/tests/test_providers.py services/ai/tests/test_extraction_robustness.py`, add outer-envelope tests before patch. Verify service Error schema and worker retry classification separately.
- **Owner/dependencies:** AI-PROVIDER owns providers/gemini.py and provider test module. llm.py changes only if classification design needs it; coordinate integrator. Estimate 0.5–1 day.
- **Impact/approval:** no DB/DTO change if existing error catalogue suffices. No real provider calls authorized; MockTransport only. Any changed retry cost policy needs operator review before live use.
- **Handoff DoD:** no raw JSONDecodeError escapes for tested response shapes; errors stay content-free and repeated failures terminate within existing budget.

## Mitigations and hypotheses kept separate

- U+0003 comparison normalization and NFC source-offset mapping already exist and have actual regressions. Do not reopen these as absent fixes.
- >10-page extraction rejection happens before reading every page. Vector content, image-region and garbled-character OCR paths exist; AI-001 addresses a false negative within that detector.
- Model/OCR concurrency queues and HTTP/provider budgets are finite; no silent live→mock fallback. OCR-derived values remain uncertain/unverified. Existing evidence source binding is retained.
- H-AI-1 / STRONGLY_SUPPORTED resource limitation: native MuPDF operations execute under a process-global lock in a threadpool and are not independently killable by Deadline/HTTP cancellation. Existing size guards mitigate many inputs but do not prove a wall-clock bound for every native operation. No adversarial native hang was executed; propose isolated process/time-limit benchmarking before opening an exploit-confirmed ticket.
- H-AI-2 / NEEDS_ENVIRONMENT: actual local OCR vi/en/zh-Hans recognition, mixed-language ordering, 200-DPI versus adaptive higher-resolution quality, fixed PSM6 and table extraction need real-engine synthetic benchmarks. No engine was installed or model downloaded in this audit.
- H-AI-3 / NOT VERIFIED: complete multilingual prompt-injection coverage, real financial table structure, handwriting/seal overlays and live provider quality. A literal keyword mask is not a proof against all multilingual injection.
- Foreign ID validation/accounting rules are product scope gates, not permission to widen Vietnamese tax_id or activate financial scoring.
