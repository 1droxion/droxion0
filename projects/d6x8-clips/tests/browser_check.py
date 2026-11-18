"""Run against a running local studio with python tests/browser_check.py."""
import os
import subprocess
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


def test_layout(browser, base, screenshots):
    for width in (320, 375, 390, 430, 768, 1024, 1440, 1920):
        page = browser.new_page(viewport={"width": width, "height": 950})
        page.goto(base, wait_until="networkidle")
        assert page.evaluate("document.documentElement.scrollWidth") == width
        expect(page.locator(".phone")).to_have_count(3)
        for element in ("#headline", "#generate", "#pricing", "footer"):
            expect(page.locator(element)).to_be_visible()
        assert page.locator(".scrollrow").evaluate("(row) => row.children.length") == 5
        if width <= 660:
            page.get_by_role("button", name="Menu").click()
            page.get_by_role("link", name="Examples").click()
            expect(page.locator("#nav")).to_be_hidden()
            assert page.locator(".scrollrow").evaluate("(row) => row.scrollWidth > row.clientWidth")
        page.evaluate("window.scrollTo({top: 0, behavior: 'instant'})")
        page.screenshot(path=screenshots / f"studio-{width}.png", full_page=True)
        page.close()


def test_render(browser, base, temporary):
    source = temporary / "gameplay.mp4"
    subprocess.run([
        "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=10",
        "-f", "lavfi", "-i", "sine=frequency=440", "-t", "12",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(source),
    ], timeout=30, check=True)
    page = browser.new_page(viewport={"width": 390, "height": 844}, accept_downloads=True)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(base)
    page.get_by_text("Use a video link").click()
    page.locator("#url").fill("https://www.youtube.com/watch?v=sample")
    page.get_by_role("button", name="Create 5 Clips").click()
    expect(page.locator("#message")).to_contain_text("upload the video")
    page.locator("#file").set_input_files(source)
    expect(page.locator("#filename")).to_have_text("gameplay.mp4")
    page.locator(".caption-toggle").click()
    page.get_by_label("Manual caption").fill("LOOK AT THAT PLAY!")
    page.locator("#captionFont").select_option("poppins")
    expect(page.locator("#captionPreview")).to_have_text("LOOK AT THAT PLAY!")
    assert "Poppins" in page.locator("#captionPreview").evaluate("(el) => getComputedStyle(el).fontFamily")
    page.locator(".caption-toggle").click()
    expect(page.locator("#captionSettings")).to_be_hidden()
    page.locator(".caption-toggle").click()
    page.get_by_role("button", name="Create 5 Clips").click()
    expect(page.locator("#message")).to_have_text("Five clips ready", timeout=60_000)
    expect(page.locator("#results video")).to_have_count(5)
    video = page.locator("#results video").first
    video.evaluate("(video) => { video.muted = true; return video.play(); }")
    assert video.evaluate("(video) => [video.videoWidth, video.videoHeight]") == [720, 1280]
    with page.expect_download() as download:
        page.get_by_role("link", name="Download MP4").first.click()
    target = temporary / "download.mp4"
    download.value.save_as(target)
    assert b"ftyp" in target.read_bytes()[:64]
    assert not errors, errors


if __name__ == "__main__":
    base = os.environ.get("DROXION_TEST_URL", "http://127.0.0.1:8769/")
    screenshots = Path(os.environ.get("DROXION_SCREENSHOTS", "browser-screenshots"))
    screenshots.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright, tempfile.TemporaryDirectory() as temporary:
        browser = playwright.chromium.launch(executable_path=os.environ.get("DROXION_BROWSER"))
        try:
            test_layout(browser, base, screenshots)
            test_render(browser, base, Path(temporary))
        finally:
            browser.close()
    print("Eight viewport checks and browser upload, render, playback and download passed.")
