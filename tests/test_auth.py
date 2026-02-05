import pytest
from fastapi.testclient import TestClient
from sqlmodel import select, Session

from tests.conftest import test_engine
from app.main import app
from app.models.user import User

client = TestClient(app)


def test_register():
    r = client.post("/auth/register", json={"email": "test@example.com", "password": "secret123"})
    assert r.status_code == 201
    assert r.json()["email"] == "test@example.com"


def test_register_duplicate():
    client.post("/auth/register", json={"email": "dup@example.com", "password": "secret123"})
    r = client.post("/auth/register", json={"email": "dup@example.com", "password": "secret123"})
    assert r.status_code == 400


def test_login():
    client.post("/auth/register", json={"email": "login@example.com", "password": "secret123"})
    r = client.post("/auth/login", json={"email": "login@example.com", "password": "secret123"})
    assert r.status_code == 200
    assert "access_token" in r.json()
    assert "refresh_token" in r.json()


def test_login_invalid():
    r = client.post("/auth/login", json={"email": "nope@example.com", "password": "wrong"})
    assert r.status_code == 401


def test_me():
    client.post("/auth/register", json={"email": "me@example.com", "password": "secret123"})
    tokens = client.post("/auth/login", json={"email": "me@example.com", "password": "secret123"}).json()
    r = client.get("/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert r.status_code == 200
    assert r.json()["email"] == "me@example.com"


def test_refresh():
    client.post("/auth/register", json={"email": "refresh@example.com", "password": "secret123"})
    tokens = client.post("/auth/login", json={"email": "refresh@example.com", "password": "secret123"}).json()
    r = client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r.status_code == 200
    assert "access_token" in r.json()


def test_forgot():
    r = client.post("/auth/forgot", json={"email": "any@example.com"})
    assert r.status_code == 200


def test_reset():
    client.post("/auth/register", json={"email": "reset@example.com", "password": "old123"})
    client.post("/auth/forgot", json={"email": "reset@example.com"})
    with Session(test_engine) as session:
        user = session.exec(select(User).where(User.email == "reset@example.com")).first()
        token = user.reset_token
    r = client.post("/auth/reset", json={"token": token, "new_password": "new123"})
    assert r.status_code == 200
    r = client.post("/auth/login", json={"email": "reset@example.com", "password": "new123"})
    assert r.status_code == 200
