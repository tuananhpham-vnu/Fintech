import sys
import time

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

from playwright.sync_api import sync_playwright

def run_demo():
    print("🚀 Đang khởi động Google Chrome...")
    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel="chrome",
            headless=False,
            slow_mo=800,
            args=["--start-maximized"]
        )
        context = browser.new_context(no_viewport=True)
        page = context.new_page()

        def set_banner(msg):
            page.evaluate("""(text) => {
                let banner = document.getElementById('anti-demo-banner');
                if (!banner) {
                    banner = document.createElement('div');
                    banner.id = 'anti-demo-banner';
                    banner.style.position = 'fixed';
                    banner.style.top = '16px';
                    banner.style.right = '24px';
                    banner.style.zIndex = '999999';
                    banner.style.background = 'linear-gradient(135deg, #1e3a8a, #3b82f6)';
                    banner.style.color = '#ffffff';
                    banner.style.padding = '12px 20px';
                    banner.style.borderRadius = '12px';
                    banner.style.boxShadow = '0 8px 24px rgba(0,0,0,0.25)';
                    banner.style.fontFamily = 'system-ui, -apple-system, sans-serif';
                    banner.style.fontSize = '14px';
                    banner.style.fontWeight = '600';
                    banner.style.border = '2px solid rgba(255,255,255,0.4)';
                    banner.style.transition = 'all 0.3s ease';
                    document.body.appendChild(banner);
                }
                banner.innerText = '🤖 Anti: ' + text;
            }""", msg)

        def highlight(locator):
            try:
                locator.evaluate("""(el) => {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.style.outline = '3px solid #22c55e';
                    el.style.boxShadow = '0 0 15px rgba(34, 197, 94, 0.8)';
                    el.style.transition = 'all 0.3s ease';
                }""")
            except Exception:
                pass

        print("🌐 Đang truy cập http://127.0.0.1:3000/...")
        page.goto("http://127.0.0.1:3000", wait_until="domcontentloaded")
        page.wait_for_timeout(1500)

        set_banner("Chào bạn! Đang kết nối tới AIC Rating...")
        page.wait_for_timeout(1500)

        # 1. Cuộn trang
        set_banner("1. Đang cuộn trang quan sát các tính năng...")
        page.evaluate("window.scrollTo({top: 400, behavior: 'smooth'})")
        page.wait_for_timeout(1200)
        page.evaluate("window.scrollTo({top: 800, behavior: 'smooth'})")
        page.wait_for_timeout(1200)
        page.evaluate("window.scrollTo({top: 0, behavior: 'smooth'})")
        page.wait_for_timeout(1200)

        # 2. Thử chuyển ngôn ngữ
        set_banner("2. Thao tác chọn ngôn ngữ...")
        vn_btn = page.locator("button:has-text('Tiếng Việt'), a:has-text('Tiếng Việt')").first
        if vn_btn.count() > 0:
            highlight(vn_btn)
            page.wait_for_timeout(1000)
            vn_btn.click()
            page.wait_for_timeout(1000)

        # 3. Tìm các ô nhập liệu username / password
        set_banner("3. Thao tác tự động nhập Form đăng nhập...")

        # Nhập username
        user_input = page.locator("input[type='text'], input[name='username'], input[id*='user'], input").first
        if user_input.count() > 0:
            highlight(user_input)
            user_input.fill("")
            user_input.type("admin_demo", delay=120)
            page.wait_for_timeout(800)

        # Nhập password
        pass_input = page.locator("input[type='password']").first
        if pass_input.count() > 0:
            highlight(pass_input)
            pass_input.fill("")
            pass_input.type("password123", delay=120)
            page.wait_for_timeout(800)

        # 4. Highlight nút đăng nhập
        set_banner("4. Trỏ vào nút đăng nhập...")
        submit_btn = page.locator("button[type='submit'], button:has-text('Sign in'), button:has-text('Đăng nhập')").first
        if submit_btn.count() > 0:
            highlight(submit_btn)
            page.wait_for_timeout(1500)

        set_banner("✅ Demo hoàn tất! Giữ màn hình 15s để bạn quan sát.")
        print("✅ Hoàn tất thao tác kịch bản. Trình duyệt sẽ mở trong 15 giây...")
        page.wait_for_timeout(15000)

        browser.close()
        print("🏁 Đã đóng trình duyệt.")

if __name__ == "__main__":
    run_demo()
