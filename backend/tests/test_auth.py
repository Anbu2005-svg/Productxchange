def test_register_and_login(client):
    # Register
    reg_res = client.post("/auth/register", json={
        "email": "student1@example.com",
        "password": "secretpassword1",
        "full_name": "Student One",
        "phone": "9998887771",
        "college": "Tech Institute"
    })
    assert reg_res.status_code == 200
    data = reg_res.json()
    assert "access_token" in data
    # Verify cookie was set
    assert "access_token" in reg_res.cookies

    # Duplicate registration should fail (generic message to prevent enumeration)
    dup_res = client.post("/auth/register", json={
        "email": "student1@example.com",
        "password": "secretpassword1",
    })
    assert dup_res.status_code == 400
    assert "registration failed" in dup_res.json()["detail"].lower() or "try a different" in dup_res.json()["detail"].lower()

    # Login
    login_res = client.post("/auth/login", json={
        "email": "student1@example.com",
        "password": "secretpassword1",
    })
    assert login_res.status_code == 200
    assert "access_token" in login_res.json()
    assert "access_token" in login_res.cookies

    # Login with wrong password
    bad_res = client.post("/auth/login", json={
        "email": "student1@example.com",
        "password": "wrongpassword",
    })
    assert bad_res.status_code == 401
    client.cookies.clear()


def test_blocked_user_cannot_login(client, user_a, db):
    user_a.is_blocked_flag = True
    db.commit()

    res = client.post("/auth/login", json={
        "email": user_a.email,
        "password": "password123",
    })
    assert res.status_code == 403
    assert "suspended" in res.json()["detail"].lower()
    client.cookies.clear()


def test_logout(client):
    res = client.post("/auth/logout")
    assert res.status_code == 200
    assert res.json()["message"] == "Logged out successfully"
    client.cookies.clear()



def test_otp_flow(client, user_a, auth_headers_a):
    phone = "9876543210"

    # Request OTP (now requires authentication)
    req_res = client.post(f"/auth/otp/request?phone={phone}", headers=auth_headers_a)
    assert req_res.status_code == 200
    assert req_res.json()["message"] == "OTP sent"

    # Invalid OTP verification
    bad_verify = client.post(
        "/auth/otp/verify",
        json={"phone": phone, "otp": "000000"},
        headers=auth_headers_a
    )
    assert bad_verify.status_code == 400


def test_user_me_and_location_update(client, user_a, auth_headers_a):
    # Fetch current user
    me_res = client.get("/auth/me", headers=auth_headers_a)
    assert me_res.status_code == 200
    assert me_res.json()["email"] == user_a.email

    # Update location
    loc_res = client.patch(
        "/auth/me/location",
        json={"latitude": 13.0827, "longitude": 80.2707, "location_radius_pref_km": 15},
        headers=auth_headers_a
    )
    assert loc_res.status_code == 200
    assert loc_res.json()["latitude"] == 13.0827
    assert loc_res.json()["longitude"] == 80.2707
    assert loc_res.json()["location_radius_pref_km"] == 15


def test_email_otp_verification_before_register(client, monkeypatch):
    from app.core.config import settings

    email = "verified.student@college.edu"
    send_res = client.post("/auth/register/send-otp", json={"email": email})
    assert send_res.status_code == 200
    otp = send_res.json()["dev_otp"]
    assert len(otp) == 6

    # Reject wrong OTP
    bad_res = client.post(
        "/auth/register",
        json={"email": email, "password": "secretpassword1", "email_otp": "000000"},
    )
    assert bad_res.status_code == 400

    # Production mode blocks registration without OTP
    monkeypatch.setattr(settings, "ENV", "production")
    no_otp = client.post(
        "/auth/register",
        json={"email": email, "password": "secretpassword1"},
    )
    assert no_otp.status_code == 400

    # Valid OTP succeeds and marks user verified
    ok_res = client.post(
        "/auth/register",
        json={"email": email, "password": "secretpassword1", "email_otp": otp},
    )
    assert ok_res.status_code == 200
    assert "access_token" in ok_res.json()
    me_res = client.get("/auth/me", headers={"Authorization": f"Bearer {ok_res.json()['access_token']}"})
    assert me_res.status_code == 200
    assert me_res.json()["is_verified"] is True
    client.cookies.clear()


def test_supabase_verification_link_and_google_oauth(client, monkeypatch):
    from types import SimpleNamespace
    from app.core.config import settings
    from app.routers import auth as auth_router

    monkeypatch.setattr(settings, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(settings, "SUPABASE_KEY", "anon-key-example")

    posted_urls = []

    def fake_post(url, **kwargs):
        posted_urls.append(url)
        return SimpleNamespace(status_code=200, json=lambda: {})

    def fake_get(url, **kwargs):
        token = kwargs.get("headers", {}).get("Authorization", "")
        if "google-token" in token:
            return SimpleNamespace(
                status_code=200,
                json=lambda: {
                    "email": "google.student@college.edu",
                    "user_metadata": {"full_name": "Google Student", "avatar_url": "https://example.com/a.png"},
                },
            )
        return SimpleNamespace(
            status_code=200,
            json=lambda: {"email": "link.student@college.edu", "user_metadata": {}},
        )

    monkeypatch.setattr(auth_router.httpx, "post", fake_post)
    monkeypatch.setattr(auth_router.httpx, "get", fake_get)

    # 1. Send verification link via Supabase
    link_res = client.post(
        "/auth/register/send-link",
        json={"email": "link.student@college.edu", "redirect_to": "http://localhost:3000/register"},
    )
    assert link_res.status_code == 200
    assert posted_urls and "redirect_to=http%3A%2F%2Flocalhost%3A3000%2Fregister" in posted_urls[0]

    # 2. Verify token and register
    tok_res = client.post(
        "/auth/supabase/verify-email-token",
        json={"supabase_access_token": "valid-supabase-email-token-123456"},
    )
    assert tok_res.status_code == 200
    assert tok_res.json()["email"] == "link.student@college.edu"

    reg_res = client.post(
        "/auth/register",
        json={
            "email": "link.student@college.edu",
            "password": "secretpassword1",
            "supabase_access_token": "valid-supabase-email-token-123456",
        },
    )
    assert reg_res.status_code == 200
    assert "access_token" in reg_res.json()
    client.cookies.clear()

    # 3. Google OAuth URL + login
    url_res = client.get("/auth/oauth/google/url?redirect_to=http://localhost:3000/login")
    assert url_res.status_code == 200
    assert "provider=google" in url_res.json()["url"]

    oauth_res = client.post(
        "/auth/supabase/oauth-login",
        json={"supabase_access_token": "valid-google-token-1234567890"},
    )
    assert oauth_res.status_code == 200
    assert "access_token" in oauth_res.json()
    client.cookies.clear()
