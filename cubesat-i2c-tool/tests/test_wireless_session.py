"""Wireless bridge authentication tests that do not require the PySide6 GUI."""
import io
import json
import urllib.error

from cubesat_i2c.wireless_session import WirelessSession


class Response:
    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self):
        return json.dumps(self.body).encode()


def unauthorized(url):
    return urllib.error.HTTPError(url, 401, "expired", {}, io.BytesIO(b'{"error":"expired"}'))


def test_expired_session_renews_once_in_memory_and_retries_with_both_auth_layers():
    calls = []
    expired = True

    def opener(request, timeout):
        nonlocal expired
        headers = dict(request.header_items())
        calls.append((request.full_url, headers))
        if request.full_url.endswith("/auth/login"):
            return Response({"csrf": "new-csrf", "user": {"username": "operator", "role": "operator"}})
        if request.full_url.endswith("/runs") and expired:
            expired = False
            raise unauthorized(request.full_url)
        return Response({"recording": {"active_run_id": None}, "runs": []})

    session = WirelessSession("https://bridge.example/telemetry", token="command-secret", opener=opener)
    session.auth_enabled = True
    session.user = {"username": "operator", "role": "operator"}
    session.csrf = "expired-csrf"
    session._username, session._password = "operator", "memory-only-password"

    assert session.recording_status()["runs"] == []
    assert [url.rsplit("/", 1)[-1] for url, _ in calls] == ["runs", "login", "runs"]
    assert calls[-1][1]["X-command-token"] == "command-secret"
    assert session.csrf == "new-csrf"

    session._clear_auth()
    assert session.user is None and session.csrf == "" and session._username == "" and session._password == ""


def test_health_retries_only_once_when_the_renewed_session_is_rejected():
    calls = []

    def opener(request, timeout):
        calls.append(request.full_url)
        if request.full_url.endswith("/auth/login"):
            return Response({"csrf": "new-csrf", "user": {"username": "operator", "role": "operator"}})
        raise unauthorized(request.full_url)

    session = WirelessSession("https://bridge.example/telemetry", opener=opener)
    session.auth_enabled = True
    session.user = {"username": "operator", "role": "operator"}
    session.csrf = "expired-csrf"
    session._username, session._password = "operator", "memory-only-password"

    try:
        session.health()
        raise AssertionError("health should reject a second 401")
    except IOError as error:
        assert "HTTP 401" in str(error)
    assert [url.rsplit("/", 1)[-1] for url in calls] == ["health", "login", "health"]
