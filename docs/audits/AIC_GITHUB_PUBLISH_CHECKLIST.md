# AIC GitHub publication checklist

Date: 2026-10-17, Asia/Saigon. [Entry point](AIC_AGENT_FIX_HANDOFF.md) · [BE audit](AIC_BACKEND_AUDIT.md) · [AI audit](AIC_AI_SERVICE_AUDIT.md).

## Latest owner-approved source publication

The owner subsequently explicitly requested **all latest code/folders**, including the launcher, on `duc`. Source snapshot **`b528225c7e39ee2476f5c117ce6113b037352fdd`** contains **454 changed paths / 86,327 insertions / 64 deletions**: 146 Backend, 193 Frontend, 12 AI, 13 contracts, 19 scripts, 57 docs and 14 other root/synthetic paths. This closes the source-availability blocker described in the historical checklist below. A later documentation commit records the immutable source SHA; it does not change application behavior.

Before staging, all 558 nonignored candidate paths were reviewed by source/private-path/secret-pattern checks: no private/runtime candidate paths, symlinks or files >=1 MiB; after launcher sanitization, no token/private-key/credential-URL findings outside recognized placeholders/synthetic test literals. All six new ZIPs were inspected for private/credential member paths (zero); the five synthetic test archives and existing brand asset archive are included byte-exact. This scan is not an assertion that every possible secret or license issue can be detected automatically. `.env`, credentials, DPAPI/dumps, caches, dependency installations and real uploaded dossiers were not included.

Only source edit during publication: remove the launcher's embedded DB-password and internal-key defaults, require explicit env configuration before any process spawn. Four synthetic VM cases passed (missing both, missing key, missing DB, explicit config), zero real processes/`.env` reads; `node --check` and API TypeScript `--noEmit --incremental false` passed. Hardcoded live modes/shared role and missing intake remain audit issues, not silently fixed.

Whitespace verification was disclosed rather than overstated: plain cached `git diff --check` exited 2 because of existing CRLF/trailing whitespace; with CRLF recognized, seven diagnostics remained in three pre-existing frontend/evidence report files. They were preserved as requested; no formatting rewrite or test-log cleanup was performed. These are publication-format observations, not functional test failures. Historical 232 Node / 227 Python passes remain audit evidence; no new full DB/browser/provider acceptance is claimed.

The sections below retain the original docs-only publication plan and audit-time remote inventory as historical provenance. Source/fixture publication approval is now satisfied by the later user request; remaining approval gates concern live data/providers, DB/grants/migrations, methodology/scoring and process/deployment changes.

## Publication authorized now

The original audit prompt prohibited commit/push until owner confirmation. The owner subsequently requested creation/use of branch **`duc` and push to that branch only**. Local `duc` already exists, so it must be preserved rather than recreated/reset. The authorized concrete publication in this audit is limited to the four reports below; all other staged/unstaged/untracked code remains as found. The auditor disclosed this docs-only scope before publication.

```text
docs/audits/AIC_BACKEND_AUDIT.md
docs/audits/AIC_AI_SERVICE_AUDIT.md
docs/audits/AIC_AGENT_FIX_HANDOFF.md
docs/audits/AIC_GITHUB_PUBLISH_CHECKLIST.md
```

Use explicit file paths and a docs-only commit. Preserve all pre-existing index entries; verify the commit diff contains exactly these four paths. Push with the explicit non-force refspec `HEAD:refs/heads/duc`, never an implicit default or another branch. If remote `duc` appears concurrently or differs, stop rather than force/rebase the dirty tree. No PR, source upload, branch reset or service/DB action is part of this docs publication.

The implementation handoff remains **BLOCKED FOR REMOTE AGENTS** until a separately reviewed complete source revision exists. Publishing these docs must not be reported as publishing the audited Backend/AI source.

## Actual local-versus-remote evidence

Base HEAD `8b0b7ed9e983ba4a2ea4d43f79d1816eaad7dbf0`, branch `duc`; initial upstream absent. Live `git ls-remote --heads origin` and non-truncated recursive GitHub trees showed:

| Branch | Tip | Source gap |
| --- | --- | --- |
| main | f65c22ff49142da9cf930b3f52bafe5f191ac4cd | No apps/api, dossier, root pnpm implementation |
| nguyen | f73d58a3ac218974ea80b8ff26ca2ff25eaa498d | No apps/api/dossier; AI differs from audited worktree |
| tanh | e41105266673d55e97c6084a75e06227ee82d37d | No apps/api/dossier; AI differs |
| duc | Absent before this publication | Local branch must be pushed explicitly; docs-only publication does not close source gap |

The remote URL is `https://github.com/tuananhpham-vnu/Fintech.git` (no credential URL). Local remote-tracking refs were older, so counts use live trees, not cached refs. No fetch, checkout or remote source mutation occurred during parity checks.

Snapshot: 554 expanded nonignored paths, 314 staged-change paths, 93 unstaged-change paths, 136 untracked paths. Counts overlap. Selected 258-file source digest: `70fb2791385133eae089a7adbcecadf075463a0b2a2f08f1efb46d4227104915`. See index for normalization and scope. Unknown prior ownership of individual dirty changes cannot be reconstructed reliably from Git alone; Antigravity's frontend scope was preserved.

## Files needing review before source publication

Do **not** run `git add .`, `git add -A`, an existing staging script, reset, stash, clean or commit the current index wholesale. The 314 staged entries predate this audit and include frontend and unrelated work.

| Group | Current state / exact examples | Publication requirement |
| --- | --- | --- |
| Backend application | All 144 selected apps/api text files absent remote, staged additions plus local edits/untracked modules | Review complete src/package/tsconfig/migrations 0001–0018; publish coherent build, not selected findings alone |
| New BE modules | src/documents/dossier.repository.ts, dossier-worker.ts, dossiers.controller.ts, run-dossier-worker.ts, extraction-summary.ts, document-archive.ts, document-archives.controller.ts, document-retry.service.ts; src/financial/**; capability/counterparty services/controllers | Exact dependency closure, source provenance, one owner per module |
| Backend tests/harness | test/dossier-http.integration.cjs, dossier-repository.cjs, dossier-fixtures.py, demo-zip-runtime.py, run-dossier-tests.cjs; acceptance-security/harness.cjs and run-security-tests.cjs | Verify synthetic-only and disposable-resource guards; no acceptance artifacts/live oracles auto-included |
| AI dirty tracked | extraction/extractor.py, grounding.py, pdf.py; runner/app.py; tests/test_extraction.py | Publish reviewed exact audited versions or update audit to new pinned version |
| AI untracked | runner/provider_diagnostics.py; scripts/demo_zip_reader.py; tests/test_demo_pdf_regressions.py, test_demo_zip_security.py, test_dossier_zip_security.py, test_post_acceptance_grounding.py, test_provider_diagnostics.py | Include runtime helpers; retain external-PDF tests only with clear optional fixture gating. No owner path dependency in required baseline |
| Contracts | aic-foundation schemas/openapi/VERSION/SHA256SUMS/README/examples; aic-demo-48h/schemas.json; aic-dossier/schemas.json | Hash all bundles; verify root internal 1.0.2 remains canonical; merged definitions compile |
| Synthetic ZIPs | aic-demo-48h/fixtures/synthetic-4pdf.zip, synthetic-4pdf-plus-rejections.zip; aic-dossier/fixtures/synthetic-thirty.zip, synthetic-sixty.zip, synthetic-mixed.zip | All exist but untracked; validate synthetic provenance/hash, exact binary bytes, licensing before inclusion |
| Bootstrap dependencies | package.json, pnpm-lock.yaml, pnpm-workspace.yaml; .gitattributes, .gitignore; scripts/test-local-postgres.cjs, sandbox-runtime-grants.sql | Freeze versions/line endings; preserve explicit migration and role/grant gates |
| Launcher | scripts/dev-all.cjs, start-dev.ps1 | **BLOCKED**: source scanner flags credential-bearing URL in dev-all; BE-001/002 fix plan. Do not publish raw credential text or execute it |
| Publication helpers | scripts/prepare-source-checkpoint.cjs, create-review-snapshot.cjs, tests/source-checkpoint.test.cjs | BE-004 scope omissions must be addressed or bypassed only with a separate reviewed per-file manifest |
| Integration authority | docs/implementation/AIC-ONE-ZIP-DOSSIER-API-CONTRACT.md, AIC-DEMO-48H-API-CONTRACT.md, MVP-OWNER-DECISIONS.md; selected API/runtime technical docs | Review/sanitize and publish only necessary technical material. Existing DB/backup reports can contain owner-machine metadata and are not automatically selected |
| Frontend/proxy | apps/web/** staged/untracked changes | Antigravity review/publication ownership. Needed browser/proxy integration is a separate gate; this audit does not stage these files |
| Existing generated evidence | services/ai/evidence/**, acceptance result files, private/runtime logs | Excluded from automatic source handoff; owner review required even if already tracked |

The root legacy fixture bundle exists remotely and is used by canonical tests. Newly referenced ZIP/helper/additive contracts do not. Therefore cherry-picking the four reports or using base HEAD alone cannot reproduce the current dossier runtime.

## Critical normalized source hashes

SHA-256 after CRLF→LF normalization, at the audit snapshot. These are source fingerprints, not secret/data hashes. Recheck raw binary fixtures independently.

| Path | SHA-256 |
| --- | --- |
| apps/api/src/database/database.service.ts | 6c154d65217038225e30fba606c5cb6289e0496034b2377fd37ef6eee400c77c |
| apps/api/src/documents/dossier.repository.ts | ade3f254a151c454229ba9eb185efb61f25584afa97ada68c6553bdb8ac1bb6e |
| apps/api/src/documents/dossier-worker.ts | bbe80e4fe3a2d12c7eb7a75669c1cf8edc7c7993db3ea971359e16b7f975a3d8 |
| packages/contracts/aic-dossier/schemas.json | 8b6b866a570c95f8ab1eaf9c190f0ee9d9ea719a87d4a0b36bec086c2fa45a35 |
| services/ai/extraction/pdf.py | c29b4d8bd41e814bc7b3b7fc30f7fa6f0803d06b4814d2ecd431b6a3916b614a |
| services/ai/extraction/grounding.py | fe7e83f2131527a3b70a440a8d44e9c888200ae8cc8e34053ca26dd64437a96e |
| services/ai/runner/app.py | bf033aef9fb6b38b0b8c19c630def6867e974d74196d73bb7eac451a23f0cff2 |
| services/ai/providers/gemini.py | ce44da7e3943a1dc909cea7d0588930cce5aa08180601436d193cda89ca9d1ef |
| scripts/prepare-source-checkpoint.cjs | 081e81c43709569dc59a9f34fab5a5dfe9f6ff6a69aa3c636e4c01585423d42f |

## Safety scan evidence and limitations

- Read 243 selected source/test/contract text files, excluding `.env`, private paths and evidence. Provider-token/private-key pattern files: **0**. Credential-like URL rule: **1 file, scripts/dev-all.cjs**. Matching values were not printed. A pattern scan is not proof of no secrets/PII.
- Existing `.gitignore` excludes env except .env.example, private keys, runtime storage/uploads/data, logs, real/holdout fixtures, node_modules/dist/cache. Ignoring a path does not remove already tracked data.
- Synthetic checks showed arbitrary root `*.dpapi` filenames are **not covered by a dedicated ignore rule**. No actual DPAPI file was read/copied/scanned. Keep them outside repo; recommend a narrow ignore rule in a later approved source PR, not a change in this docs-only audit.
- No nonignored candidate file >=1 MiB appeared in the initial path inventory. This excludes ignored runtime files and does not certify historical Git objects or licenses. Five ZIP fixtures still require explicit review even though small.
- .gitattributes covers canonical contract LF and specified synthetic PDFs; verify new ZIPs remain exact binary bytes and no migration checksum is rewritten by EOL handling.
- Existing docs contain links and owner-environment references outside this four-file publication. They are not automatically safe just because Markdown/JSON. Proprietary PDFs/fonts, gold/holdout data and old evidence need provenance/license review.
- No GitHub collaborator permission/CI protection settings were verified. No `.github` workflow directory exists in the inspected local worktree; automated clean-clone validation is not established. GitHub source visibility to a different account cannot be assumed from access by this account.

## Minimal checklist for this docs-only push

- [ ] Verify current branch exactly `duc` and HEAD still derives from recorded base; no checkout/reset.
- [ ] Read/check all four docs; pattern-scan them without leaking matching values; no real PDF text, credentials, DPAPI location/key, owner DB data or absolute owner-workspace dependency in recipes.
- [ ] Validate all issue anchors and local relative paths; label code links unavailable remotely as source-publication blockers.
- [ ] `git diff --check` for selected paths; because new files are untracked, also check their actual bytes/trailing whitespace before staging.
- [ ] Record index entries for all non-report files before staging, then compare after commit; preserve them exactly.
- [ ] Add only four exact paths; commit only those paths; verify `git diff-tree --no-commit-id --name-only -r HEAD` contains exactly four reports, no source/test/schema/fixture/env changes.
- [ ] Check remote `duc` again; absent/fast-forward only. Run `git push origin HEAD:refs/heads/duc` with no force and no alternate branch.
- [ ] Verify remote branch SHA equals local docs commit; report actual SHA and GitHub links. Do not update the audited source SHA to this docs-only commit as if it contained the worktree.

Unchecked boxes are operator verification instructions; completion evidence is the final audit response/actual Git commit and remote ref. They do not assert actions were already performed before this document's own commit.

## Owner-reviewed source publication still required

1. Choose a coherent publication manifest from the groups above, with module owners. No blanket staged-tree approval assumed from publishing reports.
2. Resolve the launcher's credential/mode/topology issues and inventory omissions through separately authorized source work; current task explicitly did not fix source.
3. Validate selected secrets/PII/proprietary/license risks and exact synthetic fixture hashes. Do not export or send a DB dump/DPAPI envelope to GitHub.
4. Reconcile upstream source changes since the live remote tips without resetting the dirty owner checkout. A clean external integration worktree/clone is preferable after the source manifest is approved.
5. Publish a source commit to an explicitly selected branch, pin its SHA, update audit pointers and run clean-clone install/typecheck/offline unit plus disposable PG/HTTP tests. Then hand nonconflicting task cards to agents.
6. Independent PRs by package/issue ID; review before merge. A proposed new implementation handoff branch is `codex/aic-be-ai-audit-2026-10-17` if the owner wants one later. This audit publishes reports to owner-requested `duc` only and does not create that proposed branch.

Separate approval gates remain for foreign identifier/country accounting semantics, live provider and real-document transfer, DB migration/grants/data changes, process replacement/deployment, and FHI/rating/PD. None is implied by an audit or docs push.
