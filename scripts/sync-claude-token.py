#!/usr/bin/env python3
"""Sync the local Claude Code subscription OAuth token into the project-hub vault
so the cloud-deployed media-engine (Vercel + Trigger) can drive Sonnet on the
subscription. Piggybacks on Claude Code's own token refresh — read the fresh
accessToken from the local creds file and upsert it into the vault.

Run on the VPS on a schedule (the token is short-lived). Suggested cron — add it
yourself; do NOT let any tool rewrite the whole crontab:

    */20 * * * * /usr/bin/python3 /home/ubuntu/media-engine/scripts/sync-claude-token.py >> /tmp/me-token-sync.log 2>&1

Vault target: service "anthropic", key "ANTHROPIC_AUTH_TOKEN".
"""
import json
import sys
import time
import urllib.request

VAULT = "https://fantastic-roadrunner-485.convex.cloud"
CREDS = "/root/.claude/.credentials.json"
SERVICE = "anthropic"
KEY = "ANTHROPIC_AUTH_TOKEN"


def _post(path, args):
    req = urllib.request.Request(
        f"{VAULT}/api/{'mutation' if path.split(':')[1] in ('deleteOne', 'bulkInsert') else 'query'}",
        data=json.dumps({"path": path, "args": args, "format": "json"}).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read()).get("value")


def main():
    with open(CREDS) as f:
        oauth = json.load(f).get("claudeAiOauth", {})
    token = oauth.get("accessToken")
    exp = oauth.get("expiresAt", 0)
    if not token:
        print("no accessToken in creds", file=sys.stderr)
        return 1
    if exp and time.time() * 1000 > exp:
        print("WARNING: token already expired; syncing anyway", file=sys.stderr)

    rows = _post("secrets:listByService", {"service": SERVICE}) or []
    for row in rows:
        if row.get("keyName") == KEY:
            _post("secrets:deleteOne", {"id": row["_id"]})
    _post(
        "secrets:bulkInsert",
        {"items": [{"service": SERVICE, "keyName": KEY, "value": token,
                    "scopes": ["media-engine"], "aliases": [], "sourceFiles": []}]},
    )
    mins = int((exp - time.time() * 1000) / 60000) if exp else -1
    print(f"synced {SERVICE}/{KEY} (expires in ~{mins}min)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
