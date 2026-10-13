"use strict";

// Dùng chung cho trang đơn giản (index) và trang chuyên sâu (advanced).

// Nhãn hiển thị. Màu luôn đi kèm chữ, không chỉ dựa vào màu.
const STATUS = { issue: "Vấn đề", unknown: "Chưa rõ", pass: "Đạt", not_applicable: "Không áp dụng" };
const STATUS_ORDER = ["issue", "unknown", "pass", "not_applicable"];
const PRIORITY = { high: "Cao", medium: "Trung bình", low: "Thấp" };
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const PROPOSAL = { candidate_resolved: "Đề xuất đủ căn cứ", still_open: "Vẫn mở" };
const DOC_TYPES = {
  registration: "Giấy ĐKDN", loan_request: "Đề nghị vay", financial_statement: "BCTC",
  contract: "Hợp đồng", invoice: "Hóa đơn", acceptance_record: "Biên bản nghiệm thu",
  payment_record: "Chứng từ thanh toán", other: "Khác",
};

const $ = (id) => document.getElementById(id);

// Tạo DOM bằng textContent để dữ liệu JSON tùy chỉnh không thể chèn HTML.
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "style") Object.assign(el.style, value);
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

const chip = (kind, label) => h("span", { class: `chip ${kind}` }, label);

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((body && body.error && body.error.message) || `Lỗi HTTP ${res.status}`);
    err.details = (body && body.error && body.error.details) || {};
    throw err;
  }
  return body;
}

// ---------- định dạng ----------

function formatVnd(value) {
  const [whole, frac] = String(value).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${grouped}${frac ? "," + frac : ""} VND`;
}

function formatValue(key, value) {
  if (value == null) return "—";
  if (typeof value === "string" && key.endsWith("_vnd") && /^-?\d+(\.\d+)?$/.test(value)) return formatVnd(value);
  if (typeof value === "object") {
    if (key.endsWith("_vnd") && !Array.isArray(value)) {
      return Object.entries(value).map(([k, v]) => `${k}: ${formatVnd(v)}`).join("\n");
    }
    return JSON.stringify(value, null, 1);
  }
  return String(value);
}
