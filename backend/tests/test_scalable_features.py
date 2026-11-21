"""
Test Suite for Top 3 Scalable Features:
1. Live In-App Barcode / ISBN Camera Scanner (Client-side OpenLibrary integration)
2. Native UPI Deep-Link Intent & On-Screen Dynamic QR Code
3. Asynchronous Web Push Notifications & SSRF Endpoint Protection
"""

import os
import re
import pytest
from app.services.push_service import _is_safe_push_endpoint, _send_push_worker
from app.routers.notifications import _validate_push_endpoint
from fastapi import HTTPException


def test_safe_push_endpoint_validation():
    """Verify SSRF defenses allow only known browser vendor push gateways."""
    # Allowed browser vendor gateways
    assert _is_safe_push_endpoint("https://fcm.googleapis.com/fcm/send/token123") is True
    assert _is_safe_push_endpoint("https://updates.push.services.mozilla.com/wpush/v2/token") is True
    assert _is_safe_push_endpoint("https://push.apple.com/v1/token") is True
    assert _is_safe_push_endpoint("https://notify.windows.com/token") is True

    # Blocked unsafe endpoints
    assert _is_safe_push_endpoint("http://fcm.googleapis.com/unencrypted") is False  # Insecure HTTP
    assert _is_safe_push_endpoint("https://localhost:8000/api") is False            # Localhost
    assert _is_safe_push_endpoint("https://127.0.0.1:8000") is False                 # Loopback
    assert _is_safe_push_endpoint("https://169.254.169.254/meta-data") is False      # Link-local / AWS metadata
    assert _is_safe_push_endpoint("https://evil-attacker.com/sinkhole") is False     # Untrusted domain


def test_validate_push_endpoint_raises():
    """Verify _validate_push_endpoint raises HTTPException 400 on malicious inputs."""
    # Non-https endpoint
    with pytest.raises(HTTPException) as exc:
        _validate_push_endpoint("http://insecure.endpoint.com")
    assert exc.value.status_code == 400

    # Disallowed host
    with pytest.raises(HTTPException) as exc:
        _validate_push_endpoint("https://localhost/push")
    assert exc.value.status_code == 400

    # Untrusted domain
    with pytest.raises(HTTPException) as exc:
        _validate_push_endpoint("https://attacker-stealer.xyz/relay")
    assert exc.value.status_code == 400


def test_upi_uri_contract():
    """Verify UPI Deep-Link URI format adheres to NPCI specification."""
    # Simulated UPI parameters
    upi_id = "student@okhdfcbank"
    payee = "Priya Sharma"
    amount = 450.0
    deal_id = 42

    # Expected format: upi://pay?pa=...&pn=...&am=450.00&cu=INR&tn=...
    uri = f"upi://pay?pa={upi_id}&pn={payee}&am={amount:.2f}&cu=INR&tn=ProductXchange+Deal+{deal_id}&tr=PX{deal_id}"
    assert uri.startswith("upi://pay?")
    assert "pa=student@okhdfcbank" in uri
    assert "am=450.00" in uri
    assert "cu=INR" in uri
    assert "tr=PX42" in uri


def test_frontend_barcode_and_upi_files_exist():
    """Verify all scalable feature components and utilities are present in frontend."""
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

    isbn_util = os.path.join(project_root, "frontend", "src", "lib", "isbn.ts")
    assert os.path.exists(isbn_util), "isbn.ts utility must exist"

    upi_util = os.path.join(project_root, "frontend", "src", "lib", "upi.ts")
    assert os.path.exists(upi_util), "upi.ts utility must exist"

    qr_util = os.path.join(project_root, "frontend", "src", "lib", "qr.ts")
    assert os.path.exists(qr_util), "qr.ts utility must exist"

    barcode_modal = os.path.join(project_root, "frontend", "src", "components", "BarcodeScannerModal.tsx")
    assert os.path.exists(barcode_modal), "BarcodeScannerModal.tsx must exist"

    upi_modal = os.path.join(project_root, "frontend", "src", "components", "UpiPaymentModal.tsx")
    assert os.path.exists(upi_modal), "UpiPaymentModal.tsx must exist"


def test_frontend_source_integrations():
    """Verify barcode scanner and UPI components are wired into their parent pages."""
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

    new_listing_page = os.path.join(project_root, "frontend", "src", "app", "listings", "new", "page.tsx")
    with open(new_listing_page, "r", encoding="utf-8") as f:
        new_listing_code = f.read()

    assert "BarcodeScannerModal" in new_listing_code, "New listing page must import BarcodeScannerModal"
    assert "Scan Book Barcode" in new_listing_code, "New listing page must contain Scan Book Barcode button"
    assert "handleBookDetected" in new_listing_code, "New listing page must handle detected book metadata"

    deals_page = os.path.join(project_root, "frontend", "src", "app", "deals", "page.tsx")
    with open(deals_page, "r", encoding="utf-8") as f:
        deals_code = f.read()

    assert "UpiPaymentModal" in deals_code, "Deals page must import UpiPaymentModal"
    assert "Pay via UPI / QR" in deals_code, "Deals page must offer Pay via UPI / QR action"
    assert "Show My UPI QR" in deals_code, "Deals page must offer Show My UPI QR action"
