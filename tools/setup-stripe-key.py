# One-shot setup app for the RosterBlur activation service.
#
#   python tools/setup-stripe-key.py            -> opens the window
#   python tools/setup-stripe-key.py --verify-only  -> just checks the live endpoint
#
# Paste a Stripe secret key (a restricted key with Checkout Sessions
# read access is enough) and click the button. The app:
#   1. checks the key against the Stripe API (read-only call),
#   2. stores it as STRIPE_SECRET_KEY on the rosterblur-pro Netlify
#      site for all four contexts, marked secret, via the Netlify API
#      (never on a command line, never written to disk),
#   3. redeploys the site so functions pick it up,
#   4. probes the live get-key endpoint until it answers 404 for a
#      made-up session, which proves activation is fully configured.
#
# The key exists only in this process's memory. The window shows only
# its prefix and length.

import json
import os
import subprocess
import sys
import threading
import urllib.request
import urllib.error

SITE_ID = "c4638cfa-3e51-4fb6-ab12-0d604c09d232"
ACCOUNT = "tiltedlunar123"
SITE_URL = "https://rosterblur-pro.netlify.app"
PAY_LINK = "https://buy.stripe.com/6oU9AUg6Ld3Q4YU9VNdUY01"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTEXTS = ["production", "deploy-preview", "branch-deploy", "dev"]
PROBE_SESSION = "cs_live_setupProbeMadeUpSession0001"


def http(method, url, token=None, body=None, headers=None, timeout=30):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if token:
        req.add_header("authorization", "Bearer " + token)
    if body is not None:
        req.add_header("content-type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, json.loads(res.read().decode() or "null")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "null")
        except Exception:
            return e.code, None
    # network errors propagate to the caller


def netlify_token():
    path = os.path.join(os.environ.get("APPDATA", ""), "netlify", "Config", "config.json")
    with open(path, encoding="utf-8") as f:
        cfg = json.load(f)
    for user in (cfg.get("users") or {}).values():
        token = (user.get("auth") or {}).get("token")
        if token:
            return token
    raise RuntimeError("No Netlify CLI login found. Run: netlify login")


def check_stripe_key(key):
    status, data = http(
        "GET", "https://api.stripe.com/v1/checkout/sessions?limit=1",
        headers={"authorization": "Bearer " + key}
    )
    if status == 200:
        return True, "key works and can read Checkout Sessions"
    msg = ""
    if isinstance(data, dict):
        msg = ((data.get("error") or {}).get("message") or "")[:140]
    return False, "Stripe said %s: %s" % (status, msg or "key rejected")


def set_env_var(key, log):
    token = netlify_token()
    url = "https://api.netlify.com/api/v1/accounts/%s/env/STRIPE_SECRET_KEY?site_id=%s" % (ACCOUNT, SITE_ID)
    body = {
        "key": "STRIPE_SECRET_KEY",
        "scopes": ["functions"],
        "is_secret": True,
        "values": [{"context": c, "value": key} for c in CONTEXTS]
    }
    status, _ = http("PUT", url, token=token, body=body)
    if status == 404:
        # Var does not exist yet on this site: create instead of update.
        create_url = "https://api.netlify.com/api/v1/accounts/%s/env?site_id=%s" % (ACCOUNT, SITE_ID)
        status, _ = http("POST", create_url, token=token, body=[body])
    if status not in (200, 201):
        raise RuntimeError("Netlify env update failed with HTTP %s" % status)
    log("STRIPE_SECRET_KEY stored (secret) for: " + ", ".join(CONTEXTS))


def redeploy(log):
    log("Redeploying the site (this takes about a minute)...")
    proc = subprocess.run(
        "netlify deploy --prod --site " + SITE_ID,
        cwd=REPO, shell=True, capture_output=True, text=True, timeout=600
    )
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "").strip().splitlines()[-3:]
        raise RuntimeError("Deploy failed:\n" + "\n".join(tail))
    log("Deploy is live.")


def probe(log):
    url = "%s/.netlify/functions/get-key?session_id=%s" % (SITE_URL, PROBE_SESSION)
    status, data = http("GET", url)
    if status == 404:
        return True, "endpoint reaches Stripe and rejects unknown sessions (404). Activation is LIVE."
    if status == 503:
        return False, "endpoint still says not configured (503)"
    if status == 401 or status == 402:
        return False, "unexpected %s; the key may lack Checkout Sessions read access" % status
    return False, "unexpected response %s: %s" % (status, data)


def run_setup(key, log):
    key = key.strip()
    if not key:
        log("Paste a key first.")
        return False
    shown = "%s... (%d chars)" % (key[:8], len(key))
    if not (key.startswith("sk_live_") or key.startswith("rk_live_")):
        if key.startswith(("sk_test_", "rk_test_")):
            log("That is a TEST key. The payment link is live mode; grab a live key.")
            return False
        log("That does not look like a Stripe secret key (sk_live_/rk_live_).")
        return False
    log("Checking %s against Stripe..." % shown)
    ok, msg = check_stripe_key(key)
    log(("OK: " if ok else "Problem: ") + msg)
    if not ok:
        return False
    log("Storing on Netlify (direct API, no shell, no files)...")
    set_env_var(key, log)
    redeploy(log)
    log("Probing the live endpoint...")
    ok, msg = probe(log)
    log(("OK: " if ok else "Problem: ") + msg)
    if ok:
        log("")
        log("Done. Smoke-test the purchase now:")
        log("  " + PAY_LINK)
        log("Then refund yourself in the Stripe dashboard.")
    return ok


def gui():
    import tkinter as tk

    root = tk.Tk()
    root.title("RosterBlur setup: Stripe key")
    root.geometry("560x380")
    root.configure(bg="#12102a")

    tk.Label(root, text="Paste your Stripe secret key (rk_live_... or sk_live_...)",
             fg="#e5e7ff", bg="#12102a").pack(anchor="w", padx=14, pady=(14, 4))

    entry = tk.Entry(root, show="*", width=64, bg="#1c1940", fg="#e5e7ff",
                     insertbackground="#e5e7ff", relief="flat")
    entry.pack(fill="x", padx=14, ipady=5)
    entry.focus_set()

    logbox = tk.Text(root, height=12, bg="#0d0b1e", fg="#a5b4fc",
                     relief="flat", state="disabled", wrap="word")
    logbox.pack(fill="both", expand=True, padx=14, pady=10)

    def log(line):
        def append():
            logbox.configure(state="normal")
            logbox.insert("end", line + "\n")
            logbox.see("end")
            logbox.configure(state="disabled")
        root.after(0, append)

    def work():
        try:
            done = run_setup(entry.get(), log)
            if done:
                root.after(0, lambda: entry.delete(0, "end"))
        except Exception as e:
            log("Error: " + str(e))
        finally:
            root.after(0, lambda: button.configure(state="normal", text="Set key and deploy"))

    def go():
        button.configure(state="disabled", text="Working...")
        threading.Thread(target=work, daemon=True).start()

    button = tk.Button(root, text="Set key and deploy", command=go,
                       bg="#818cf8", fg="#0e0c22", relief="flat", padx=14, pady=6)
    button.pack(pady=(0, 14))

    root.mainloop()


if __name__ == "__main__":
    if "--verify-only" in sys.argv:
        ok, msg = probe(print)
        print(("OK: " if ok else "Not ready: ") + msg)
        sys.exit(0 if ok else 1)
    gui()
