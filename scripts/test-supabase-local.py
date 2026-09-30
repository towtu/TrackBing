#!/usr/bin/env python3
"""Exercise real local Supabase Auth, RLS, RPCs and the Bee Edge handler.

Requires TRACKBING_LOCAL_WORKDIR (an isolated `supabase init` workdir) and a
locally running Bee handler at TRACKBING_LOCAL_BEE_URL. Never targets a hosted
project or prints the local test credentials.
"""

import json
import os
import subprocess
import urllib.error
import urllib.request
import uuid
from datetime import datetime, time, timezone, timedelta
from zoneinfo import ZoneInfo


workdir = os.environ.get("TRACKBING_LOCAL_WORKDIR", "")
bee_url = os.environ.get("TRACKBING_LOCAL_BEE_URL", "http://127.0.0.1:8000/")
if not workdir or not os.path.isdir(os.path.join(workdir, "supabase")):
    raise SystemExit("Set TRACKBING_LOCAL_WORKDIR to an isolated Supabase workdir")
if not bee_url.startswith("http://127.0.0.1:"):
    raise SystemExit("Bee handler must be bound to localhost")

status = json.loads(subprocess.run(
    ["supabase", "status", "--workdir", workdir, "--output", "json"],
    check=True, capture_output=True, text=True,
).stdout)
api_url = status["API_URL"]
if not api_url.startswith("http://127.0.0.1:"):
    raise SystemExit("Supabase API must be bound to localhost")
anon_key = status["ANON_KEY"]
service_key = status["SERVICE_ROLE_KEY"]


def request(url, method="GET", body=None, headers=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b"null")


def db(path, method="GET", body=None, token=None, admin=False, representation=False):
    key = service_key if admin else anon_key
    headers = {
        "apikey": key,
        "Authorization": "Bearer " + (key if admin else token or key),
        "Content-Type": "application/json",
    }
    if representation:
        headers["Prefer"] = "return=representation"
    return request(api_url + path, method, body, headers)


def bee(token, command):
    return request(bee_url, "POST", {
        "requestId": str(uuid.uuid4()),
        "timeZone": "Asia/Manila",
        "command": command,
    }, {"Authorization": "Bearer " + token, "Content-Type": "application/json"})


def signup():
    address = "bee-" + uuid.uuid4().hex[:12] + "@example.test"
    code, result = db("/auth/v1/signup", "POST", {
        "email": address,
        "password": "FixtureOnly-" + uuid.uuid4().hex[:16],
    })
    assert code in (200, 201) and result.get("access_token"), "local signup failed"
    return result["user"]["id"], result["access_token"]


owner_a, token_a = signup()
owner_b, token_b = signup()
for owner, token in ((owner_a, token_a), (owner_b, token_b)):
    code, _ = db("/rest/v1/user_goals", "POST", {
        "user_id": owner, "calorie_target": 2000, "current_weight": 72.4,
        "height": 170, "age": 30, "gender": "male", "activity_level": "1.375",
    }, token, representation=True)
    assert code == 201, "owned goal creation failed"
print("Local Auth: two real JWT sessions and owned profiles created.")

code, food = db("/rest/v1/food_logs", "POST", {
    "user_id": owner_a, "name": "LOCAL TEST DATA serving", "calories": 100,
    "protein": 1, "carbs": 2, "fat": 3, "serving_size": "1", "serving_unit": "g",
}, token_a, representation=True)
assert code == 201 and len(food) == 1, "owned food insert failed"
code, rows = db("/rest/v1/food_logs?select=id&user_id=eq." + owner_a, token=token_b)
assert code == 200 and rows == [], "cross-owner food read permitted"
code, _ = db("/rest/v1/food_logs", "POST", {
    "user_id": owner_a, "name": "FOREIGN TEST DATA", "calories": 1,
    "protein": 1, "carbs": 1, "fat": 1, "serving_size": "1", "serving_unit": "g",
}, token_b)
assert code >= 400, "cross-owner food insert permitted"
code, _ = db("/rest/v1/food_logs?id=eq." + food[0]["id"], "PATCH", {
    "bee_provenance": {},
}, token_a)
assert code >= 400, "client forged Bee provenance"
print("Local RLS: cross-owner food reads/writes and forged Bee provenance denied.")

thread_id = str(uuid.uuid4())
code, _ = db("/rest/v1/bee_threads", "POST", {
    "id": thread_id, "user_id": owner_a,
}, admin=True, representation=True)
assert code == 201, "thread fixture creation failed"
code, rows = db("/rest/v1/bee_threads?select=id&id=eq." + thread_id, token=token_a)
assert code == 200 and len(rows) == 1, "owner thread read failed"
code, rows = db("/rest/v1/bee_threads?select=id&id=eq." + thread_id, token=token_b)
assert code == 200 and rows == [], "cross-owner thread read permitted"
code, _ = db("/rest/v1/rpc/bee_begin_turn", "POST", {}, token_a)
assert code >= 400, "privileged turn RPC directly callable"
print("Local RLS: chat is owner-only; privileged turn RPC is inaccessible.")

now = datetime.now(timezone.utc).isoformat()
weight_args = {
    "p_request": str(uuid.uuid4()), "p_amount": 72.4, "p_unit": "kg",
    "p_measured_at": now, "p_timezone": "Asia/Manila", "p_id": None,
    "p_delete": False,
}
code, first = db("/rest/v1/rpc/save_weight_checkin", "POST", weight_args, token_a)
assert code == 200 and first.get("ok") and first.get("id"), "weight save failed"
code, replay = db("/rest/v1/rpc/save_weight_checkin", "POST", weight_args, token_a)
assert code == 200 and replay == first, "weight retry duplicated or changed result"
code, rows = db("/rest/v1/weight_logs?select=id&user_id=eq." + owner_a, token=token_b)
assert code == 200 and rows == [], "cross-owner weight read permitted"
print("Local RPC: weight retry recovers the first result; other account denied.")

zone = ZoneInfo("Asia/Manila")
day = datetime.now(zone).date()
start = datetime.combine(day, time.min, zone).astimezone(timezone.utc).isoformat()
end = datetime.combine(day + timedelta(days=1), time.min, zone).astimezone(timezone.utc).isoformat()
for token, expected_count in ((token_a, 1), (token_b, 0)):
    code, stats = db("/rest/v1/rpc/get_weekly_stats", "POST", {
        "p_today_start": start, "p_today_end": end,
    }, token)
    assert code == 200 and stats["today"]["count"] == expected_count, "local-day totals wrong"
print("Local Stats: Manila day boundaries and signed-in account respected.")

code, first = bee(token_a, {"kind": "load"})
assert code == 200 and first.get("ok"), "Bee owner load failed"
code, foreign = bee(token_b, {
    "kind": "load", "threadId": first["snapshot"]["thread"]["id"],
})
assert code >= 400 or not foreign.get("ok"), "Bee cross-account thread read permitted"
code, invalid = bee("not-a-jwt", {"kind": "load"})
assert code == 401 and invalid.get("error") == "unauthorized", "Bee invalid JWT accepted"
print("Local Bee handler: valid JWT succeeds; cross-user and invalid JWT denied.")
