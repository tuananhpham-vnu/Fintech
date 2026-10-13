"use strict";

// Hướng dẫn tương tác: tự chạy câu chuyện Sao Mai, làm sáng từng vùng và giải thích bằng lời thường.
// Tự mở ở lần đầu truy cập (hoặc ?tour=1); mở lại bằng nút "Hướng dẫn" trên thanh đầu trang.

const TOUR_SEEN_KEY = "sme-demo-tour-seen-v1";

function ensureExample(id) {
  const loaded = page.activeId === id && document.querySelector("#result .verdict");
  return loaded ? Promise.resolve() : runExample(id);
}

function openFirstSources() {
  const details = document.querySelector("#result .finding-card details");
  if (details) details.open = true;
}

const TOUR_STEPS = [
  {
    title: "Chào bạn 👋",
    text: "Công cụ này giúp chuyên viên tín dụng tìm giấy tờ còn thiếu và số liệu chưa khớp trong hồ sơ vay "
      + "của doanh nghiệp nhỏ. Mỗi phát hiện đều chỉ rõ nguồn, và chuyên viên là người quyết định.\n\n"
      + "Hướng dẫn 1 phút này dùng hồ sơ mẫu của Công ty Sao Mai (dữ liệu giả lập).",
    primary: "Xem hướng dẫn",
    secondary: "Bỏ qua, dùng ngay",
  },
  {
    target: "#story",
    title: "1. Chọn một ví dụ",
    text: "Mỗi thẻ là một hồ sơ mẫu, bấm vào là chạy ngay. Câu chuyện Sao Mai có 3 bước: "
      + "hồ sơ ban đầu → nộp nhầm giấy tờ → nộp đúng.",
    before: () => ensureExample("sao-mai-1"),
  },
  {
    target: "#case-form",
    title: "2. Hồ sơ được điền sẵn ở đây",
    text: "Bạn có thể tick hoặc bỏ tick giấy tờ đã nộp và sửa các con số. Số tiền tính bằng triệu đồng. "
      + "Ví dụ Sao Mai: dự kiến thu 500 triệu từ hợp đồng HĐ01, tiền về sau khi nghiệm thu 30 ngày.",
  },
  {
    target: "#case-form button[type=submit]",
    title: "3. Bấm “Kiểm tra hồ sơ”",
    text: "Sau khi sửa form, bấm nút này. Hệ thống chạy 10 quy tắc đối chiếu trong khoảng một giây.",
  },
  {
    target: "#result .verdict",
    title: "4. Đọc dòng tổng kết",
    text: "Dòng này cho biết có bao nhiêu vấn đề cần xem. Đây chỉ là gợi ý, không phải kết luận cho vay.",
    before: () => ensureExample("sao-mai-1"),
  },
  {
    target: "#result .finding-card",
    title: "5. Mỗi vấn đề có “Việc nên làm”",
    text: "Hồ sơ Sao Mai chưa có biên bản nghiệm thu, nên hệ thống chưa thể xác minh điều kiện để tiền về. "
      + "Ô xanh gợi ý việc tiếp theo: yêu cầu doanh nghiệp bổ sung biên bản.",
    before: () => ensureExample("sao-mai-1"),
  },
  {
    target: "#result .finding-card .sources",
    title: "6. Luôn xem được căn cứ",
    text: "Bấm “Xem căn cứ” để thấy câu trích nguyên văn, ở tài liệu nào và trang nào. "
      + "Nhờ vậy bạn kiểm tra được hệ thống dựa vào đâu, thay vì phải tin một con số.",
    before: async () => { await ensureExample("sao-mai-1"); openFirstSources(); },
  },
  {
    target: "#result .resolution-card",
    title: "7. Doanh nghiệp nộp nhầm giấy tờ",
    text: "Doanh nghiệp gửi biên bản của hợp đồng HĐ02 thay vì HĐ01. Hệ thống không tự đóng yêu cầu "
      + "mà báo rõ giấy tờ chưa khớp.",
    before: () => ensureExample("sao-mai-2"),
  },
  {
    target: "#result .resolution-card",
    title: "8. Nộp đúng: hệ thống chỉ đề xuất",
    text: "Khi nhận đúng biên bản HĐ01, hệ thống đề xuất là đã đủ căn cứ. Chuyên viên bấm xác nhận thì yêu cầu "
      + "mới được đóng. Hệ thống cũng không tự ghi là doanh nghiệp đã nhận tiền.",
    before: () => ensureExample("sao-mai-3"),
  },
  {
    target: "#quick",
    title: "Bạn đã sẵn sàng!",
    text: "Thử các ví dụ nhanh (thiếu BCTC, sai mã số thuế, hóa đơn trùng…) hoặc tự sửa form để xem hệ thống phản ứng. "
      + "Muốn xem lại hướng dẫn, bấm “Hướng dẫn” ở góc trên.",
    primary: "Bắt đầu dùng",
  },
];

const tour = {
  index: 0,
  busy: false,
  els: null,

  start() {
    if (!this.els) this.build();
    this.els.root.hidden = false;
    document.addEventListener("keydown", this.onKey);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("scroll", this.onScroll, true);
    this.go(0);
  },

  finish() {
    if (!this.els) return;
    this.els.root.hidden = true;
    document.removeEventListener("keydown", this.onKey);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("scroll", this.onScroll, true);
    markTourSeen();
    $("start-tour").focus();
  },

  build() {
    const spot = h("div", { class: "tour-spot", "aria-hidden": "true" });
    const progress = h("span", { class: "tour-progress" });
    const title = h("h2", { id: "tour-title" });
    const text = h("p", { class: "tour-text" });
    const back = h("button", { type: "button", class: "btn", onclick: () => this.go(this.index - 1) }, "← Lại");
    const next = h("button", { type: "button", class: "btn btn-primary", onclick: () => this.next() });
    const skip = h("button", { type: "button", class: "tour-skip", onclick: () => this.finish() }, "Bỏ qua");
    const card = h("div", { class: "tour-card", role: "dialog", "aria-modal": "true", "aria-labelledby": "tour-title" },
      h("div", { class: "tour-top" }, progress, skip), title, text,
      h("div", { class: "tour-actions" }, back, next));
    const root = h("div", { class: "tour", hidden: true },
      h("div", { class: "tour-blocker", onclick: (e) => e.stopPropagation() }), spot, card);
    document.body.append(root);
    this.els = { root, spot, card, progress, title, text, back, next, skip };
    this.onKey = (e) => {
      if (e.key === "Escape") this.finish();
      else if (e.key === "ArrowRight") this.next();
      else if (e.key === "ArrowLeft" && this.index > 0) this.go(this.index - 1);
    };
    this.onResize = () => this.place(false);
    this.onScroll = () => { if (!this.busy) this.place(false); };
  },

  next() {
    if (this.index === 0 || this.index < TOUR_STEPS.length - 1) this.go(this.index + 1);
    else this.finish();
  },

  async go(index) {
    if (this.busy || index < 0 || index >= TOUR_STEPS.length) return;
    this.busy = true;
    this.index = index;
    const step = TOUR_STEPS[index];
    const { els } = this;
    els.next.disabled = true;
    try {
      if (step.before) await step.before();
    } catch (err) {
      // Bước minh họa lỗi mạng: vẫn cho người dùng đi tiếp
    }
    const isIntro = index === 0;
    els.progress.textContent = isIntro ? "Hướng dẫn 1 phút" : `Bước ${index}/${TOUR_STEPS.length - 1}`;
    els.title.textContent = step.title;
    els.text.textContent = step.text;
    els.back.hidden = index <= 1;
    els.skip.textContent = step.secondary || "Bỏ qua";
    els.skip.hidden = index === TOUR_STEPS.length - 1;
    els.next.textContent = step.primary || "Tiếp →";
    els.next.disabled = false;
    els.card.classList.toggle("intro", isIntro);
    this.busy = false;
    this.place();
    els.next.focus();
  },

  place(scrollToTarget = true) {
    const { els } = this;
    const step = TOUR_STEPS[this.index];
    const target = step.target ? document.querySelector(step.target) : null;
    if (!target) {
      els.spot.classList.add("full");
      els.spot.removeAttribute("style");
      Object.assign(els.card.style, { top: "50%", left: "50%", transform: "translate(-50%, -50%)" });
      return;
    }
    if (scrollToTarget) target.scrollIntoView({ block: "center", behavior: "auto" });
    const pad = 6;
    const r = target.getBoundingClientRect();
    els.spot.classList.remove("full");
    Object.assign(els.spot.style, {
      top: `${r.top - pad}px`, left: `${r.left - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`,
    });
    const card = els.card.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight, gap = 14, margin = 12;
    let top;
    if (r.bottom + gap + card.height <= vh - margin) top = r.bottom + gap;
    else if (r.top - gap - card.height >= margin) top = r.top - gap - card.height;
    else top = vh - card.height - margin; // vùng quá cao: đặt thẻ ở đáy màn hình
    const left = Math.min(Math.max(r.left, margin), vw - card.width - margin);
    Object.assign(els.card.style, { top: `${Math.max(top, margin)}px`, left: `${Math.max(left, margin)}px`, transform: "none" });
  },
};

function tourSeen() {
  try { return localStorage.getItem(TOUR_SEEN_KEY) === "1"; } catch (err) { return false; }
}

function markTourSeen() {
  try { localStorage.setItem(TOUR_SEEN_KEY, "1"); } catch (err) { /* trình duyệt chặn lưu trữ: bỏ qua */ }
}

$("start-tour").addEventListener("click", () => tour.start());
page.ready.then(() => {
  const forced = new URLSearchParams(window.location.search).get("tour") === "1";
  if (forced || !tourSeen()) tour.start();
});
