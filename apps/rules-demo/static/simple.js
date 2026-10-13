"use strict";

// Trang đơn giản: chọn ví dụ hoặc tự điền form -> kết quả bằng lời thường.

const FIELD_LABELS = {
  company_name: "Tên công ty", tax_id: "Mã số thuế", total_assets: "Tổng tài sản",
  total_liabilities: "Nợ phải trả", equity: "Vốn chủ sở hữu", claim_amount: "Số tiền khoản thu",
  contract_amount: "Giá trị hợp đồng", payment_amount: "Chứng từ ngân hàng",
  invoice_amount: "Số tiền hóa đơn", invoice_seller_tax_id: "MST người bán trên hóa đơn",
};
const OPTIONAL_FIELDS = new Set(["payment_amount", "invoice_amount", "invoice_seller_tax_id"]);
const DEFAULT_EXAMPLE = "sao-mai-1";

const page = { examples: [], rules: [], activeId: null };

function exampleById(id) {
  return page.examples.find((e) => e.id === id);
}

function ruleTitle(ruleId) {
  const rule = page.rules.find((r) => r.rule_id === ruleId);
  return rule ? rule.title : ruleId;
}

// ---------- form ----------

function fillForm(values) {
  for (const el of $("case-form").elements) {
    if (!el.name || !(el.name in values)) continue;
    const value = values[el.name];
    if (el.type === "checkbox") el.checked = Boolean(value);
    else if (el.type === "radio") el.checked = el.value === value;
    else el.value = value == null ? "" : String(value);
  }
}

function readForm() {
  const data = {};
  for (const el of $("case-form").elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") data[el.name] = el.checked;
    else if (el.type === "radio") { if (el.checked) data[el.name] = el.value; }
    else if (el.name === "fs_year") data[el.name] = Number(el.value);
    else if (el.name === "company_name") data[el.name] = el.value.trim();
    else {
      // Cho phép gõ "1 000" hoặc "398,5"
      const value = el.value.trim().replace(/\s+/g, "").replace(",", ".");
      data[el.name] = value === "" && OPTIONAL_FIELDS.has(el.name) ? null : value;
    }
  }
  return data;
}

// ---------- chạy ----------

async function runExample(id) {
  const example = exampleById(id);
  page.activeId = id;
  fillForm(example.form);
  renderExamples();
  showLoading();
  try {
    const run = await api(`/api/v1/demo/examples/${encodeURIComponent(id)}/run`, { method: "POST" });
    renderResult(run, example);
  } catch (err) {
    renderError(err);
  }
}

async function checkForm(event) {
  event.preventDefault();
  page.activeId = null;
  renderExamples();
  showLoading();
  try {
    const run = await api("/api/v1/demo/check", { method: "POST", body: JSON.stringify(readForm()) });
    renderResult(run, null);
  } catch (err) {
    renderError(err);
  }
}

function showLoading() {
  $("result").replaceChildren(h("p", { class: "muted" }, "Đang kiểm tra hồ sơ…"));
}

function renderError(err) {
  const field = err.details && err.details.field;
  const message = field && FIELD_LABELS[field]
    ? `Ô “${FIELD_LABELS[field]}” chưa đúng định dạng. Số tiền chỉ gồm chữ số, ví dụ 500 hoặc 398,5; mã số thuế gồm 10 chữ số.`
    : err.message;
  $("result").replaceChildren(h("div", { class: "banner" }, message));
}

// ---------- ví dụ ----------

function exampleCard(example, index) {
  return h("button", {
    type: "button", class: "example-card", "aria-current": String(page.activeId === example.id),
    onclick: () => runExample(example.id),
  },
  index != null ? h("span", { class: "step-no" }, index + 1) : null,
  h("strong", null, example.title),
  h("span", null, example.description));
}

function renderExamples() {
  const story = page.examples.filter((e) => e.group === "story");
  const quick = page.examples.filter((e) => e.group !== "story");
  $("story").replaceChildren(...story.map((e, i) => exampleCard(e, i)));
  $("quick").replaceChildren(...quick.map((e) => exampleCard(e, null)));
}

// ---------- kết quả ----------

function docLabelIn(input, versionId) {
  const doc = (input.snapshot.documents || []).find((d) => d.id === versionId);
  return doc ? DOC_TYPES[doc.doc_type] || "Tài liệu" : "Tài liệu";
}

function evidenceList(input, evidenceIds) {
  const index = new Map((input.snapshot.evidence || []).map((e) => [e.id, e]));
  return h("ul", { class: "sources" }, evidenceIds.map((id) => {
    const ev = index.get(id);
    if (!ev) return null;
    return h("li", null,
      h("div", { class: "source-doc" }, `${docLabelIn(input, ev.document_version_id)} · trang ${ev.page}`),
      h("blockquote", null, ev.quote));
  }));
}

function todoFor(result) {
  const req = result.finding.suggested_request;
  if (req) return `Gửi yêu cầu bổ sung “${DOC_TYPES[req.type]}” — ${req.purpose}.`;
  if (result.rule_id === "R10") return "Liên hệ doanh nghiệp gửi lại đúng tài liệu; yêu cầu bổ sung vẫn giữ mở.";
  return "Mở nguồn bên dưới để xác minh, sau đó xác nhận hoặc bác phát hiện này.";
}

function findingCard(run, result) {
  const f = result.finding;
  const sources = f.evidence_ids.length
    ? evidenceList(run.input, f.evidence_ids)
    : h("p", { class: "muted small" }, "Căn cứ: đã đối chiếu danh mục giấy tờ bắt buộc với toàn bộ file trong hồ sơ, không có file loại này.");
  return h("article", { class: `finding-card ${f.priority}` },
    h("div", { class: "item-head" }, chip(f.priority, `Ưu tiên ${PRIORITY[f.priority].toLowerCase()}`),
      h("span", { class: "rule-id" }, `${result.rule_id} · ${ruleTitle(result.rule_id)}`)),
    h("h3", null, f.title),
    h("p", null, f.description),
    h("div", { class: "todo" }, h("strong", null, "Việc nên làm: "), todoFor(result)),
    h("details", null, h("summary", null, `Xem căn cứ (${f.evidence_ids.length || "danh mục"} nguồn)`), sources));
}

function resolutionCard(run, result) {
  const ok = result.resolution.proposal === "candidate_resolved";
  return h("article", { class: `resolution-card ${ok ? "ok" : "open"}` },
    h("h3", null, ok ? "✓ Tài liệu bổ sung đã khớp yêu cầu" : "✗ Tài liệu bổ sung chưa khớp yêu cầu"),
    h("p", null, result.message),
    h("p", { class: "muted small" }, ok
      ? "Hệ thống chỉ đề xuất. Chuyên viên bấm xác nhận thì yêu cầu mới được đóng."
      : "Yêu cầu bổ sung vẫn mở cho đến khi nhận đúng tài liệu."),
    result.evidence_ids.length
      ? h("details", null, h("summary", null, "Xem căn cứ"), evidenceList(run.input, result.evidence_ids))
      : null);
}

function renderResult(run, example) {
  const results = run.output.rule_results;
  const findings = results.filter((r) => r.finding && r.rule_id !== "R10")
    .sort((a, b) => PRIORITY_RANK[a.finding.priority] - PRIORITY_RANK[b.finding.priority]);
  const resolutions = results.filter((r) => r.resolution);
  const unknowns = results.filter((r) => r.status === "unknown");
  const passed = results.filter((r) => r.status === "pass");
  const notApplicable = results.filter((r) => r.status === "not_applicable");
  const problemCount = findings.length + resolutions.filter((r) => r.resolution.proposal === "still_open").length;

  const verdict = problemCount === 0 && unknowns.length === 0
    ? h("div", { class: "verdict ok" }, h("span", { class: "verdict-icon", "aria-hidden": "true" }, "✓"),
      h("div", null, h("strong", null, "Không phát hiện vấn đề"),
        h("span", null, "Hồ sơ đã qua 10 quy tắc kiểm tra. Chuyên viên vẫn là người quyết định cuối cùng.")))
    : h("div", { class: "verdict warn" }, h("span", { class: "verdict-icon", "aria-hidden": "true" }, "!"),
      h("div", null, h("strong", null, `Cần xem ${problemCount} vấn đề`
        + (unknowns.length ? ` và ${unknowns.length} điểm cần kiểm tra thêm` : "")),
        h("span", null, "Đây là gợi ý của hệ thống, không phải kết luận cho vay.")));

  const next = example && example.next_id ? exampleById(example.next_id) : null;
  $("result").replaceChildren(...[
    example ? h("div", { class: "result-head" },
      h("span", { class: "muted small" }, "Ví dụ"), h("h2", null, example.title),
      h("p", { class: "muted small" }, `Kỳ vọng: ${example.expect}`)) : h("div", { class: "result-head" }, h("h2", null, "Hồ sơ bạn vừa điền")),
    verdict,
    ...resolutions.map((r) => resolutionCard(run, r)),
    ...findings.map((r) => findingCard(run, r)),
    unknowns.length ? h("section", { class: "unknowns" }, h("h3", null, "Cần chuyên viên kiểm tra thêm"),
      h("ul", null, unknowns.map((r) => h("li", null, h("strong", null, `${ruleTitle(r.rule_id)}: `), r.message)))) : null,
    h("details", { class: "passed" },
      h("summary", null, `Đã kiểm tra 10 quy tắc: ${passed.length} kết quả đạt, ${notApplicable.length} không áp dụng`),
      h("ul", null, [...passed, ...notApplicable].map((r) =>
        h("li", null, chip(r.status, STATUS[r.status]), " ", h("strong", null, ruleTitle(r.rule_id)), ` · ${r.message}`)))),
    next ? h("button", { type: "button", class: "btn btn-primary btn-lg next-step", onclick: () => runExample(next.id) },
      `Tiếp tục: ${next.title} →`) : null,
  ].filter(Boolean));
}

// ---------- khởi động ----------

async function init() {
  $("case-form").addEventListener("submit", checkForm);
  $("reset-form").addEventListener("click", () => runExample(DEFAULT_EXAMPLE));
  try {
    [page.rules, page.examples] = await Promise.all([api("/api/v1/rules"), api("/api/v1/demo/examples")]);
    renderExamples();
    await runExample(DEFAULT_EXAMPLE);
  } catch (err) {
    renderError(err);
  }
}

init();
