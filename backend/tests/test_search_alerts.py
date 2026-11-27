import pytest

from app.models.notification import Notification
from app.models.report import Block
from app.routers.notifications import create_notification


LISTING = dict(title="Scientific calculator", category="Electronics", description="CASIO with case",
               price=800, condition="Like New", transaction_type="BUY", latitude=12.97,
               longitude=77.59, has_3d=True)


def test_saved_search_matches_once_and_respects_filters(client, db, user_a, user_b,
                                                        auth_headers_a, auth_headers_b, monkeypatch):
    pushes = []
    monkeypatch.setattr("app.services.push_service.dispatch_push_async", lambda uid, data: pushes.append((uid, data)))
    filters = dict(q="casio", max_price=800, min_price=750, category="Electronics", condition="new",
                   transaction_type="BUY", college="science", has_3d=True, radius_km=2, lat=12.97, lng=77.59)
    save = client.post("/saved-searches", headers=auth_headers_a, json=filters)
    assert save.status_code == 200, save.text
    sid = save.json()["id"]
    assert client.post("/saved-searches", headers=auth_headers_a, json={**filters, "q": "CASIO"}).json()["id"] == sid
    assert client.get("/saved-searches", headers=auth_headers_b).json() == []
    assert client.delete(f"/saved-searches/{sid}", headers=auth_headers_b).status_code == 404
    for different in ({"price": 801}, {"price": None}, {"latitude": 13.97}, {"condition": "Fair"},
                      {"transaction_type": "RENT"}, {"description": "other"}, {"category": "Books"}, {"has_3d": False}):
        r = client.post("/products", headers=auth_headers_b, json={**LISTING, **different})
        assert r.status_code == 200, r.text
    assert not pushes
    for headers in (auth_headers_a, auth_headers_b):
        assert client.post("/saved-searches", headers=headers, json={"q": "calculator"}).status_code == 200
    match = client.post("/products", headers=auth_headers_b, json=LISTING)
    assert match.status_code == 200, match.text
    assert len(pushes) == 1
    assert pushes[0][0] == user_a.id
    assert pushes[0][1]["url"] == f"/listings/{match.json()['id']}"
    assert db.query(Notification).filter_by(type="SAVED_SEARCH_MATCH").count() == 1
    assert client.delete(f"/saved-searches/{sid}", headers=auth_headers_a).status_code == 200
    assert len(client.get("/saved-searches", headers=auth_headers_a).json()) == 1


def test_search_alert_privacy_and_preferences(client, db, user_a, user_b, auth_headers_a, auth_headers_b):
    path = "/notifications/preferences/saved_searches"
    client.post("/saved-searches", headers=auth_headers_a, json={"q": "casio"})
    for blocker, blocked in ((user_a, user_b), (user_b, user_a)):
        block = Block(blocker_id=blocker.id, blocked_id=blocked.id)
        db.add(block)
        db.commit()
        assert client.post("/products", headers=auth_headers_b, json=LISTING).status_code == 200
        db.delete(block)
        db.commit()
    for _ in range(2):
        assert client.put(path, headers=auth_headers_a, json={"enabled": False}).json()["saved_searches"] is False
    assert client.get("/notifications/preferences", headers=auth_headers_b).json()["saved_searches"] is True
    assert client.post("/products", headers=auth_headers_b, json=LISTING).status_code == 200
    assert not client.get("/notifications", headers=auth_headers_a).json()
    assert client.put(path, headers=auth_headers_a, json={"enabled": True}).json()["saved_searches"]
    assert client.post("/products", headers=auth_headers_b, json=LISTING).status_code == 200
    assert len(client.get("/notifications", headers=auth_headers_a).json()) == 1


@pytest.mark.parametrize("category,event", [("offers", "COUNTER_OFFER"), ("rentals", "RENTAL_DUE"),
                                           ("listing_expiry", "LISTING_EXPIRY"), ("messages", "NEW_MESSAGE")])
def test_muting_suppresses_bell_and_push_only_for_category(client, db, user_a, auth_headers_a,
                                                           monkeypatch, category, event):
    pushes, live = [], []
    monkeypatch.setattr("app.services.push_service.dispatch_push_async", lambda uid, data: pushes.append(data))
    monkeypatch.setattr("app.routers.notifications.manager.schedule_user_notification", lambda uid, data: live.append(data))
    assert client.put(f"/notifications/preferences/{category}", headers=auth_headers_a,
                      json={"enabled": False}).status_code == 200
    create_notification(db, user_a.id, event, "Muted", link="/deals")
    create_notification(db, user_a.id, "PUSH_TEST", "Test")
    db.commit()
    assert [p["type"] for p in pushes] == ["PUSH_TEST"]
    assert [p for p in live if p.get("title")][0]["id"] == db.query(Notification).one().id
    assert {"deal_update": True} in live
    assert client.get("/notifications/unread-count", headers=auth_headers_a).json()["count"] == 1


def test_saved_search_validation(client, auth_headers_a):
    assert client.get("/saved-searches").status_code == 401
    assert client.get("/notifications/preferences").status_code == 401
    for invalid in ({}, {"q": " "}, {"q": "x", "user_id": 7}, {"lat": 2}, {"min_price": 100, "max_price": 10}):
        assert client.post("/saved-searches", headers=auth_headers_a, json=invalid).status_code == 422
