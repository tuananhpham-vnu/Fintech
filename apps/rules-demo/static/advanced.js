"use strict";

const state = {
  rules: [], scenarios: [], scenarioId: null,
  input: null, output: null, title: "", highlights: [],
  tab: "desk", ruleFilter: null, selected: null,
};

function showBanner(message, kind = "error") {
  const banner = $("banner");
  banner.textContent = message;
  banner.className = kind === "info" ? "banner info" : "banner";
  banner.hidden = !message;
}

function ruleTitle(ruleId) {
  const rule = state.rules.find((r) => r.rule_id === ruleId);
  return rule ? rule.title : ruleId;
}

function docLabel(versionId) {
  const doc = (state.input.snapshot.documents || []).find((d) => d.id === versionId);
  if (!doc) return versionId;
  return `${DOC_TYPES[doc.doc_type] || "Chưa phân loại"} · ${doc.document_id}`;
}

// ---------- tải dữ liệu ----------

async function init() {
  document.querySelectorAll(".tabs button").forEach((btn) =>
    btn.addEventListener("click", () => { state.tab = btn.dataset.tab; render(); }));
  $("open-json").addEventListener("click", openJsonDialog);
  $("json-dialog").addEventListener("close", onJsonDialogClose);
  try {
    [state.rules, state.scenarios] = await Promise.all([api("/api/v1/rules"), api("/api/v1/demo/examples")]);
    renderScenarios();
    if (state.scenarios.length) await runScenario(state.scenarios[0].id);
  } catch (err) {
    showBanner(`Không tải được dữ liệu demo: ${err.message}`);
  }
}

async function runScenario(id) {
  state.scenarioId = id;
  renderScenarios();
  showBanner("Đang chạy đối chiếu…", "info");
  try {
    const run = await api(`/api/v1/demo/examples/${encodeURIComponent(id)}/run`, { method: "POST" });
    showBanner("");
    setRun(run.input, run.output, run.example.title, [run.example.expect]);
  } catch (err) {
    showBanner(err.message);
  }
}

function setRun(input, output, title, highlights) {
  Object.assign(state, { input, output, title, highlights, ruleFilter: null, selected: null });
  const first = sortedFindings()[0];
  if (first) state.selected = first.index;
  render();
}

// ---------- JSON tùy chỉnh ----------

function openJsonDialog() {
  $("json-input").value = state.input ? JSON.stringify(state.input, null, 2) : "";
  $("json-dialog").returnValue = "";
  $("json-dialog").showModal();
}

async function onJsonDialogClose() {
  if ($("json-dialog").returnValue !== "run") return;
  let input;
  try {
    input = JSON.parse($("json-input").value);
  } catch (err) {
    showBanner(`JSON không hợp lệ: ${err.message}`);
    return;
  }
  try {
    const output = await api("/api/v1/analyze", { method: "POST", body: JSON.stringify(input) });
    state.scenarioId = null;
    renderScenarios();
    showBanner("");
    setRun(input, output, "JSON tùy chỉnh", []);
  } catch (err) {
    showBanner(err.message);
  }
}

// ---------- render ----------

function render() {
  renderSummary();
  renderCoverage();
  document.querySelectorAll(".tabs button").forEach((btn) =>
    btn.setAttribute("aria-selected", String(btn.dataset.tab === state.tab)));
  $("tab-panel").replaceChildren(...renderTab().filter(Boolean));
  $("detail").replaceChildren(...renderDetail().filter(Boolean));
}

function renderScenarios() {
  $("scenario-list").replaceChildren(...state.scenarios.map((s) =>
    h("li", null, h("button", {
      class: "scenario", type: "button", "aria-current": String(s.id === state.scenarioId),
      onclick: () => runScenario(s.id),
    }, h("strong", null, s.title), h("span", null, s.description)))));
}

function counts() {
  const result = { issue: 0, unknown: 0, pass: 0, not_applicable: 0 };
  for (const r of state.output.rule_results) result[r.status] += 1;
  return result;
}

function renderSummary() {
  const out = state.output;
  if (!out) return;
  const c = counts();
  const runChip = out.status === "partial" ? chip("unknown", "Run partial") : chip("run", "Run completed");
  $("summary").replaceChildren(
    h("div", null,
      h("h2", null, state.title),
      h("div", { class: "meta" }, `${state.input.snapshot.case.case_id} · ${out.run_id} · ${out.snapshot_hash} · rules v${out.rule_set_version}`),
      state.highlights.length ? h("ul", { class: "highlights" }, state.highlights.map((x) => h("li", null, x))) : null),
    h("div", { class: "counts" }, runChip, STATUS_ORDER.map((s) => chip(s, `${c[s]} ${STATUS[s]}`))));
  if (out.input_issues.length) {
    showBanner(`${out.input_issues.length} fact bị loại vì nguồn không hợp lệ: ` +
      out.input_issues.map((i) => `${i.object_id} (${i.code})`).join(", "));
  }
}

function worstStatus(statusCounts) {
  return STATUS_ORDER.find((s) => statusCounts[s] > 0) || "not_applicable";
}

function renderCoverage() {
  if (!state.output) return;
  const tiles = Object.entries(state.output.coverage).map(([ruleId, statusCounts]) => {
    const worst = worstStatus(statusCounts);
    return h("button", {
      class: `rule-tile ${worst}`, type: "button", title: `${ruleId} · ${ruleTitle(ruleId)}`,
      "aria-pressed": String(state.ruleFilter === ruleId),
      onclick: () => {
        state.ruleFilter = state.ruleFilter === ruleId ? null : ruleId;
        state.tab = "results";
        render();
      },
    }, h("b", null, ruleId), h("small", null, STATUS[worst]));
  });
  $("coverage").replaceChildren(...tiles);
}

function renderTab() {
  if (!state.output) return [h("p", { class: "muted" }, "Chưa có kết quả.")];
  switch (state.tab) {
    case "results": return renderResultsTab();
    case "inputs": return renderInputsTab();
    case "json": return [h("pre", { class: "json" }, JSON.stringify(state.output, null, 2))];
    default: return renderDeskTab();
  }
}

function sortedFindings() {
  return state.output.rule_results
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => result.finding)
    .sort((a, b) => PRIORITY_RANK[a.result.finding.priority] - PRIORITY_RANK[b.result.finding.priority]
      || a.result.rule_id.localeCompare(b.result.rule_id));
}

function select(index) {
  state.selected = index;
  render();
}

function renderDeskTab() {
  const findings = sortedFindings();
  const list = findings.length
    ? h("ul", { class: "item-list" }, findings.map(({ result, index }) => h("li", null,
      h("button", { class: "item", type: "button", "aria-current": String(state.selected === index), onclick: () => select(index) },
        h("div", { class: "item-head" }, chip(result.finding.priority, PRIORITY[result.finding.priority]),
          h("span", { class: "rule-id" }, result.rule_id), h("span", { class: "item-title" }, result.finding.title)),
        h("div", { class: "item-sub" }, result.message)))))
    : h("div", { class: "empty" }, "Không có phát hiện cần xử lý trong lần chạy này.");

  const resolutions = state.output.rule_results
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => result.resolution);

  return [
    h("h3", null, `Phát hiện (${findings.length})`), list,
    h("h3", null, `Yêu cầu bổ sung đề xuất (${state.output.suggested_requests.length})`),
    state.output.suggested_requests.length
      ? h("ul", { class: "item-list" }, state.output.suggested_requests.map((req) => h("li", { class: "item" },
        h("div", { class: "item-head" }, h("span", { class: "item-title" }, DOC_TYPES[req.document_type] || req.document_type),
          req.contract_ref ? h("span", { class: "rule-id" }, req.contract_ref) : null),
        h("div", { class: "item-sub" }, req.purposes.join(" · ")),
        h("div", { class: "item-sub" }, `Cho: ${req.finding_issue_keys.join(", ")}`))))
      : h("div", { class: "empty" }, "Không có yêu cầu bổ sung."),
    resolutions.length ? h("h3", null, "Đề xuất xử lý hồ sơ bổ sung (R10)") : null,
    resolutions.length ? h("ul", { class: "item-list" }, resolutions.map(({ result, index }) => h("li", null,
      h("button", { class: "item", type: "button", "aria-current": String(state.selected === index), onclick: () => select(index) },
        h("div", { class: "item-head" },
          chip(result.resolution.proposal === "candidate_resolved" ? "pass" : "issue", PROPOSAL[result.resolution.proposal]),
          h("span", { class: "rule-id" }, result.resolution.request_item_id)),
        h("div", { class: "item-sub" }, result.message))))) : null,
  ];
}

function renderResultsTab() {
  const rows = state.output.rule_results
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => !state.ruleFilter || result.rule_id === state.ruleFilter);
  return [
    h("h3", null, state.ruleFilter ? `${state.ruleFilter} · ${ruleTitle(state.ruleFilter)}` : "Tất cả kết quả rule"),
    state.ruleFilter ? h("button", { class: "btn", type: "button", onclick: () => { state.ruleFilter = null; render(); } }, "Bỏ lọc") : null,
    h("div", { class: "table-wrap" }, h("table", null,
      h("thead", null, h("tr", null, h("th", null, "Rule"), h("th", null, "Kết quả"), h("th", null, "Đối tượng"), h("th", null, "Lý do"))),
      h("tbody", null, rows.map(({ result, index }) => h("tr", {
        class: "clickable", tabindex: "0", "aria-current": String(state.selected === index),
        onclick: () => select(index), onkeydown: (e) => { if (e.key === "Enter") select(index); },
      }, h("td", { class: "rule-id" }, result.rule_id), h("td", null, chip(result.status, STATUS[result.status])),
        h("td", { class: "rule-id" }, result.subject), h("td", null, result.message)))))),
  ];
}

function renderInputsTab() {
  const documents = state.input.snapshot.documents || [];
  const items = state.input.snapshot.request_items || [];
  const factCount = (id) => (state.input.facts || []).filter((f) => f.document_version_id === id).length;
  return [
    h("h3", null, `Tài liệu trong snapshot (${documents.length})`),
    h("div", { class: "table-wrap" }, h("table", null,
      h("thead", null, h("tr", null, h("th", null, "Tài liệu"), h("th", null, "Loại"), h("th", null, "Trạng thái"),
        h("th", null, "Fact"), h("th", null, "Theo yêu cầu"))),
      h("tbody", null, documents.map((d) => h("tr", null,
        h("td", { class: "rule-id" }, d.document_id), h("td", null, DOC_TYPES[d.doc_type] || "Chưa phân loại"),
        h("td", null, d.processing_status), h("td", null, factCount(d.id)), h("td", { class: "rule-id" }, d.request_item_id || "—")))))),
    h("h3", null, `Yêu cầu đã duyệt (${items.length})`),
    items.length
      ? h("ul", { class: "item-list" }, items.map((it) => h("li", { class: "item" },
        h("div", { class: "item-head" }, h("span", { class: "rule-id" }, it.id),
          h("span", { class: "item-title" }, DOC_TYPES[it.document_type] || it.document_type), it.contract_ref || ""),
        h("div", { class: "item-sub" }, it.purpose))))
      : h("div", { class: "empty" }, "Chưa có yêu cầu bổ sung đã duyệt."),
  ];
}

// ---------- chi tiết và nguồn ----------

function renderDetail() {
  if (!state.output || state.selected == null) {
    return [h("p", { class: "muted" }, "Chọn một phát hiện hoặc kết quả rule để xem căn cứ và nguồn.")];
  }
  const result = state.output.rule_results[state.selected];
  const finding = result.finding;
  const head = h("div", { class: "item-head" },
    chip(result.status, STATUS[result.status]),
    finding ? chip(finding.priority, `Ưu tiên ${PRIORITY[finding.priority].toLowerCase()}`) : null,
    h("span", { class: "rule-id" }, `${result.rule_id} v${result.rule_version}`));

  const nodes = [
    head,
    h("h3", { style: { marginTop: "10px" } }, finding ? finding.title : ruleTitle(result.rule_id)),
    h("p", null, result.message),
    h("dl", { class: "kv" },
      h("dt", null, "Mã lý do"), h("dd", null, result.reason_code),
      h("dt", null, "Đối tượng"), h("dd", null, result.subject),
      finding ? [h("dt", null, "issue_key"), h("dd", null, finding.issue_key)] : null),
  ];

  if (finding || result.resolution) {
    nodes.push(h("p", { class: "review-note" },
      "Hệ thống đề xuất · chờ chuyên viên xác nhận, bác hoặc đóng. Không phải kết luận tín dụng."));
  }
  if (finding && finding.suggested_request) {
    const req = finding.suggested_request;
    nodes.push(h("h3", null, "Yêu cầu bổ sung đề xuất"),
      h("dl", { class: "kv" }, h("dt", null, "Giấy tờ"), h("dd", null, DOC_TYPES[req.type] || req.type),
        h("dt", null, "Mục đích"), h("dd", null, req.purpose)));
  }
  if (result.resolution) {
    nodes.push(h("h3", null, "Đề xuất cho yêu cầu bổ sung"),
      h("dl", { class: "kv" },
        h("dt", null, "Đề xuất"), h("dd", null, PROPOSAL[result.resolution.proposal]),
        h("dt", null, "Phát hiện liên quan"), h("dd", null, result.resolution.related_issue_keys.join(", ") || "—")));
  }

  const operands = Object.entries(result.operands || {});
  if (operands.length) {
    nodes.push(h("h3", null, "Số hạng và căn cứ tính"),
      h("dl", { class: "kv" }, operands.map(([k, v]) => [h("dt", null, k), h("dd", { style: { whiteSpace: "pre-wrap" } }, formatValue(k, v))])));
  }

  nodes.push(h("h3", null, `Nguồn (${result.evidence_ids.length})`));
  if (result.evidence_ids.length) {
    nodes.push(...result.evidence_ids.map(renderEvidence));
  } else if (finding && finding.absence_basis) {
    const basis = finding.absence_basis;
    nodes.push(h("p", { class: "muted" }, "Phát hiện về thiếu tài liệu: căn cứ là mục checklist và danh sách file đã kiểm tra."),
      h("dl", { class: "kv" },
        h("dt", null, "Checklist"), h("dd", null, basis.checklist_version),
        h("dt", null, "Snapshot"), h("dd", null, basis.inventory_snapshot),
        h("dt", null, "File đã kiểm tra"), h("dd", null, basis.checked_document_version_ids.map(docLabel).join("\n"))));
  } else {
    nodes.push(h("p", { class: "muted" }, "Kết quả này không gắn nguồn cụ thể."));
  }
  return nodes;
}

function renderEvidence(evidenceId) {
  const ev = (state.input.snapshot.evidence || []).find((e) => e.id === evidenceId);
  if (!ev) return h("div", { class: "evidence" }, h("div"), h("div", { class: "muted" }, `${evidenceId} (không có trong snapshot)`));
  const page = h("div", { class: ev.bbox ? "page" : "page whole", "aria-hidden": "true" });
  if (ev.bbox) {
    const [x0, y0, x1, y1] = ev.bbox;
    page.append(h("div", { class: "hl", style: {
      left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${(x1 - x0) * 100}%`, height: `${Math.max((y1 - y0) * 100, 2)}%`,
    } }));
  }
  return h("div", { class: "evidence" }, page, h("div", null,
    h("div", { class: "evidence-doc" }, docLabel(ev.document_version_id)),
    h("div", { class: "item-sub" }, `Trang ${ev.page} · ${ev.bbox ? "vùng chữ" : "cả trang"} · ${ev.id}`),
    h("blockquote", null, ev.quote || "—")));
}

init();
