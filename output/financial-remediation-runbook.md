# Local remediation and approved read-only diagnostic

No live environment, database, policy or model changes have been made.
Keep AI_PROVIDER=deepseek, PD=null and experimental NOT VALIDATED.

## 1. Run the policy diagnostic without deploying

The script uses the loaders already installed in the live Docker image. It does
not need the column fix deployed. Run it on the **backend** service, not the web UI.

1. In local Windows PowerShell, from the repository root, run:

   ```powershell
   Set-Location 'D:\Data\Code\Python\Fintech'
   $auditPath = (Resolve-Path '.\output\render-fhi-audit.cjs').Path
   $auditBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($auditPath))
   Set-Clipboard ("umask 077`nprintf '%s' '" + $auditBase64 + "' | base64 -d > /tmp/render-fhi-audit.cjs")
   Get-FileHash -Algorithm SHA256 -LiteralPath $auditPath
   ```

   The clipboard contains a shell command that transfers only the diagnostic
   script. It does not copy your environment, credentials or customer documents.

2. In Render Dashboard, open the live Docker backend service and its **Shell**.
   Paste the clipboard command and press Enter. It writes a private temporary
   script under `/tmp`; it does not change application files or policies.

3. In Render Shell, run:

   ```bash
   sha256sum /tmp/render-fhi-audit.cjs
   node --check /tmp/render-fhi-audit.cjs
   ```

   Compare the hash with PowerShell's hash (letter case does not matter).
   `node --check` succeeds silently. Stop if the hashes differ or syntax fails.

4. Find the affected case UUID in the browser URL or the existing Network request
   `GET /api/v2/cases/<UUID>/readiness`. Copy just the UUID, not request headers,
   cookies or a connection string.

5. Replace `YOUR_CASE_UUID` below and run:

   ```bash
   node /tmp/render-fhi-audit.cjs YOUR_CASE_UUID
   ```

   This opens one runtime DB connection with the existing TLS configuration,
   starts a READ ONLY transaction, selects only organization/purpose/country and
   database time for that case, and rolls back/closes. No financial tables are read.
   It loads the two policy files using the deployed loaders. Values from policies,
   organization IDs, credentials, file paths and exception messages are not printed.

6. Share only the resulting diagnostic JSON. Do not run `env`, `printenv`, dump
   policy contents or paste connection settings.

Interpretation:

| Field/code | Meaning / next authorized decision |
| --- | --- |
| `loaded_valid: true` | A fresh invocation of the deployed loader accepted the configured file now. |
| `POLICY_PATH_UNSET` | The corresponding path variable is absent/empty. Secret Files do not set it automatically. |
| `POLICY_FILE_NOT_FOUND` / `POLICY_FILE_NOT_READABLE` | Configured path is missing or unreadable. Relative paths resolve from `/app/apps/api`, matching the API. |
| `METHOD_*_MISMATCH` / `PROFILE_METHOD_HASH_MISMATCH` | Artifact does not match deployed method. Obtain the compatible genuinely approved artifact; do not rewrite its hash to silence the check. |
| `APPROVAL_*` / `EFFECTIVE_*` | Required approval metadata or effective interval is invalid. |
| `CASE_ORGANIZATION_NOT_AUTHORIZED` | Actual case organization is outside the artifact. Do not add it without genuine authorization. |
| `APPROVAL_IN_FUTURE` / `POLICY_NOT_YET_EFFECTIVE` / `POLICY_EXPIRED` | Valid artifact is not active at DB time. Do not backdate approval. |
| `COUNTRY_PROFILE_NOT_AUTHORIZED` | No authorized international profile matches the counterparty country. |
| `case_policy.eligible_now: true` | Selected policy passes this fresh eligibility check. Does not imply verified facts or score eligibility. |
| `DEPLOYED_LOADER_REJECTED` | Deployed loader rejected an artifact beyond the supplemental explanations; investigate that deployed code without printing the artifact. |
| `AUDIT_EXECUTION_FAILED` | Connection/import/runtime failure, intentionally redacted. No successful audit can be inferred. |

The diagnostic cannot inspect the API's in-memory startup configuration or prove
that named approvers genuinely approved the policy. If it passes but readiness
remains unconfigured, compare deployed revision and running-service configuration
with this shell environment before proposing a separately approved restart.

## 2. Existing extraction results after an approved deployment

The fix only affects subsequent extraction/reasoning validation. There is no DB
migration, automatic replay or automatic invalidation of saved assessments.

Review previous multi-year/multi-statement intakes, especially results with
SOURCE_COLUMN_MISMATCH/NOT_AVAILABLE and derived calculations depending on those
rows. The old bug could both reject a correct amount and accept a wrong comparative
amount. Do not review rejected rows alone.

For HKVINA, review FY2023/2024/2025 source headers, selected columns, units and
derived inputs before confirming the 34 currently unverified facts. Do not claim
they were affected until their source context is checked.

After deployment approval, use **Thử lại / Retry** only where offered (failed or
needs_review, fewer than three attempts, no pending period choices). This may
invoke the configured paid provider; no retries are authorized or performed by
this runbook itself. Otherwise use sourced corrections through existing review
controls. Do not reset attempt counts or mutate stored receipts with SQL.

Cached raw model observations are revalidated by the corrected guard on reuse.
The regression tests cover both fresh and cached observations. Stored receipts,
applied calculations and human confirmations are separate persisted artifacts;
they still need explicit review/correction and a fresh confirmation if changed.

## 3. UI steps, after source review and authorization for production changes

In the case's **Tài liệu BCTC / Financial statements** workspace:

1. **Mở tài liệu / Open document**: inspect the original statement, table heading,
   year columns, entity, standalone/consolidated basis, currency and unit.
2. For a same-period overlap, choose **Đối chiếu từng kỳ / Compare each period**.
   In **Đối chiếu nguồn cùng kỳ**, compare current and incoming values. Choose
   **Giữ số liệu từ nguồn đang dùng cho {period}** or
   **Dùng số liệu từ nguồn mới cho {period}** only after inspecting both sources.
   Resolve each pending period, not just the selected FY2025.
3. Choose **Rà soát kỳ / bổ sung số liệu / Review periods / add facts**.
   Select **Kỳ cần rà soát**; use **Bổ sung kỳ từ tài liệu gốc** only for an actually
   evidenced missing period. Supply dates, reporting basis, accounting regime,
   currency, unit multiplier, **Trang ghi kỳ / đơn vị** and a genuine scope quote.
   Inspect **Số liệu đầu vào cho 7 chỉ tiêu**. Correct/add only directly sourced
   amounts with their page and exact quotation. Supply **Lý do / kết quả đối chiếu**,
   then **Lưu kỳ và số liệu đã rà soát**.
4. In **AI đề xuất số liệu tính toán**, inspect source rows, formula and conditions.
   Only unblocked proposals with a computed value can be selected and applied.
   Applying a proposal is not human verification. Calculated fields cannot be
   silently relabelled as direct observations in the period editor.
5. Once no unresolved period/source choices or active jobs remain, click
   **Xác nhận rà soát tất cả / Confirm all reviews**. Confirm source comparison only
   after doing it. Check the separate quick-assets/D&A assertion only if supported.
   Choose the reporting basis if prompted. Click **Lưu xác nhận chung**.
   Missing numerical facts may remain N/A; confirmation does not invent them.
6. Reload `readiness`. `assessment_allowed` and `numeric_assessment_allowed` are
   different gates. A complete score requires an active authorized policy, all
   seven metrics with valid contributions under existing rules, and current review.
   The financial registry's score/band are intentionally null; use the published
   assessment result after an explicitly authorized assessment action.

| Blocker | Existing review can resolve when... | More evidence / separate action needed when... |
| --- | --- | --- |
| Unresolved period / source choice | Correct dates and column/source association are present in the original. | Required heading, period, basis or source is absent/illegible. |
| UNVERIFIED_FACT / FINANCIAL_REVIEW_ALL_REQUIRED | Human has checked all current sourced facts and calculations. | Underlying fact is missing, wrong or unsupported. |
| SOURCE_COLUMN_AMBIGUOUS | Human can establish the mapping from the original table/continuation. | Source mapping itself is unclear; get the missing heading/page or better scan. |
| UNALLOCATED_RECEIVABLES_PROVISION | Original includes a supported net trade-receivables figure or explicit allocation. | Obtain the receivables/provision note; never allocate a broad provision by assumption. |
| UNDERDETERMINED depreciation | Original directly reports period D&A, or supports a complete unique reconciliation. | Obtain the cash-flow/fixed/intangible-assets note or missing reconciliation inputs. No invented zero or simple unexplained accumulated-balance difference. |
| FHI_METHOD_UNCONFIGURED | Not a fact-review action. | Resolve the precise diagnostic finding with authorized policy/configuration changes. |

No direct SQL update, scope expansion, approval fabrication or automatic readable/
verified promotion is part of this remediation.
