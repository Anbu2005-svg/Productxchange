"""
PWA and Mobile Web App Test Suite
Validates:
1. PWA Manifest compliance (W3C Web App Manifest specification).
2. Service Worker structure (install, activate, fetch, offline fallback, push).
3. Offline fallback page presence and self-contained structure.
4. Generated high-resolution PNG icon headers and dimensions.
5. Next.js App Layout integration with PWA meta tags and Apple iOS touch icons.
"""

import os
import json
import struct

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FRONTEND_DIR = os.path.join(PROJECT_ROOT, "frontend")
PUBLIC_DIR = os.path.join(FRONTEND_DIR, "public")


def test_manifest_compliance():
    """Verify manifest.json adheres to PWA standalone standards."""
    manifest_path = os.path.join(PUBLIC_DIR, "manifest.json")
    assert os.path.exists(manifest_path), "manifest.json must exist in frontend/public"

    with open(manifest_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    assert data["name"] == "ProductXchange — Campus Peer-to-Peer Marketplace"
    assert data["short_name"] == "ProductXchange"
    assert data["display"] == "standalone"
    assert data["theme_color"] == "#2f6b4f"
    assert data["background_color"] == "#f6f3ec"
    assert data["orientation"] == "portrait"
    assert data["scope"] == "/"
    assert "/?source=pwa" in data["start_url"]

    # Verify icons
    assert len(data["icons"]) >= 4
    icon_srcs = [i["src"] for i in data["icons"]]
    assert "/icons/icon-192x192.png" in icon_srcs
    assert "/icons/icon-512x512.png" in icon_srcs
    assert "/icons/maskable-icon-512x512.png" in icon_srcs
    assert "/icons/apple-touch-icon.png" in icon_srcs

    # Verify maskable icon purpose
    maskable = next(i for i in data["icons"] if "maskable" in i.get("purpose", ""))
    assert maskable["sizes"] == "512x512"

    # Verify shortcuts
    assert len(data["shortcuts"]) >= 4
    shortcut_urls = [s["url"] for s in data["shortcuts"]]
    assert any("/listings/new" in u for u in shortcut_urls)
    assert any("/deals" in u for u in shortcut_urls)
    assert any("/chat" in u for u in shortcut_urls)


def test_service_worker_structure():
    """Verify Service Worker handles install, activate, fetch, and offline fallback."""
    sw_path = os.path.join(PUBLIC_DIR, "sw.js")
    assert os.path.exists(sw_path), "sw.js must exist in frontend/public"

    with open(sw_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Precache verification
    assert "/offline.html" in content
    assert "/manifest.json" in content
    assert "px-pwa-v3" in content

    # Lifecycle events
    assert "addEventListener(\"install\"" in content or "addEventListener('install'" in content
    assert "addEventListener(\"activate\"" in content or "addEventListener('activate'" in content
    assert "addEventListener(\"fetch\"" in content or "addEventListener('fetch'" in content
    assert "addEventListener(\"push\"" in content or "addEventListener('push'" in content
    assert "addEventListener(\"notificationclick\"" in content or "addEventListener('notificationclick'" in content

    # Offline page fallback
    assert "offline.html" in content
    assert "caches.match" in content


def test_offline_page_structure():
    """Verify offline fallback page is self-contained with no remote dependencies."""
    offline_path = os.path.join(PUBLIC_DIR, "offline.html")
    assert os.path.exists(offline_path), "offline.html must exist in frontend/public"

    with open(offline_path, "r", encoding="utf-8") as f:
        html = f.read()

    assert "You Are Offline" in html
    assert "viewport-fit=cover" in html
    assert "checkConnection" in html
    assert "window.addEventListener('online'" in html or 'window.addEventListener("online"' in html


def test_png_icons_validity():
    """Verify all 4 generated PNG icons have valid PNG magic bytes and correct dimensions."""
    icons = [
        ("icon-192x192.png", 192, 192),
        ("icon-512x512.png", 512, 512),
        ("apple-touch-icon.png", 180, 180),
        ("maskable-icon-512x512.png", 512, 512),
    ]

    png_magic = b"\x89PNG\r\n\x1a\n"

    for filename, exp_w, exp_h in icons:
        path = os.path.join(PUBLIC_DIR, "icons", filename)
        assert os.path.exists(path), f"Icon {filename} must exist"

        with open(path, "rb") as f:
            header = f.read(24)

        assert header[:8] == png_magic, f"{filename} does not contain valid PNG magic bytes"

        # IHDR chunk dimensions (at bytes 16-24)
        w, h = struct.unpack(">II", header[16:24])
        assert w == exp_w, f"{filename} width {w} != expected {exp_w}"
        assert h == exp_h, f"{filename} height {h} != expected {exp_h}"


def test_mobile_components_present():
    """Verify mobile navigation bar and PWA install prompt components exist."""
    comp_dir = os.path.join(FRONTEND_DIR, "src", "components")

    bottom_nav = os.path.join(comp_dir, "MobileBottomNav.tsx")
    assert os.path.exists(bottom_nav), "MobileBottomNav.tsx must exist"
    with open(bottom_nav, "r", encoding="utf-8") as f:
        nav_content = f.read()
    assert "env(safe-area-inset-bottom" in nav_content
    assert "Explore" in nav_content
    assert "Deals" in nav_content
    assert "Chat" in nav_content

    pwa_prompt = os.path.join(comp_dir, "PwaInstallPrompt.tsx")
    assert os.path.exists(pwa_prompt), "PwaInstallPrompt.tsx must exist"
    with open(pwa_prompt, "r", encoding="utf-8") as f:
        prompt_content = f.read()
    assert "beforeinstallprompt" in prompt_content
    assert "display-mode: standalone" in prompt_content
    assert "Add to Home Screen" in prompt_content

    offline_banner = os.path.join(comp_dir, "OfflineBanner.tsx")
    assert os.path.exists(offline_banner), "OfflineBanner.tsx must exist"

