# One-shot setup app for RosterBlur site-license payment links.
#
#   python tools/setup-site-licenses.py           -> opens the window
#   python tools/setup-site-licenses.py --verify-only -> checks current config
#
# Paste a Stripe secret key WITH WRITE ACCESS (sk_live_... or an
# rk_live_... restricted key that can write Products, Prices, and
# Payment Links) and click the button. The app:
#   1. creates two one-time products on the live Stripe account, both
#      tagged metadata app=rosterblur so shared-account reporting stays
#      separable:
#        RosterBlur Pro: Department (5 teachers)  $49
#        RosterBlur Pro: School (30 teachers)     $129
#   2. creates a payment link for each that redirects to the activate
#      page with the checkout session id, exactly like the individual
#      link does,
#   3. stores the link ids as STRIPE_PAYMENT_LINK_ID_DEPT and
#      STRIPE_PAYMENT_LINK_ID_SCHOOL on the rosterblur-pro Netlify site
#      (all contexts) via the Netlify API,
#   4. redeploys the site so get-key starts minting tiered keys,
#   5. prints the two shareable payment link URLs.
#
# The key exists only in this process's memory. The window shows only
# its prefix and length. Refuses to run twice: if the env vars already
# exist it stops instead of creating duplicate Stripe products.

import json
import os
import subprocess
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request

SITE_ID = "c4638cfa-3e51-4fb6-ab12-0d604c09d232"
ACCOUNT = "tiltedlunar123"
SITE_URL = "https://rosterblur-pro.netlify.app"
ACTIVATE_REDIRECT = SITE_URL + "/activate?session_id={CHECKOUT_SESSION_ID}"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTEXTS = ["production", "deploy-preview", "branch-deploy", "dev"]
PROBE_SESSION = "cs_live_setupProbeMadeUpSession0001"

TIERS = [
    {
        "env": "STRIPE_PAYMENT_LINK_ID_DEPT",
        "product": "RosterBlur Pro: Department (5 teachers)",
        "amount": 4900,
    },
    {
        "env": "STRIPE_PAYMENT_LINK_ID_SCHOOL",
        "product": "RosterBlur Pro: School (30 teachers)",
        "amount": 12900,
    },
]


def http(method, url, token=None, body=None, form=None, timeout=30):
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
    elif body is not None:
        data = json.dumps(body).encode()
    else:
        data = None
    req = urllib.request.Request(url, data=data, method=method)
    if token:
        req.add_header("authorization", "Bearer " + token)
    if body is not None:
        req.add_header("content-type", "application/json")
    if form is not None:
        req.add_header("content-type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, json.loads(res.read().decode() or "null")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "null")
        except Exception:
            return e.code, None


def netlify_token():
    path = os.path.join(os.environ.get("APPDATA", ""), "netlify", "Config", "config.json")
    with open(path, encoding="utf-8") as f:
        cfg = json.load(f)
    for user in (cfg.get("users") or {}).values():
        token = (user.get("auth") or {}).get("token")
        if token:
            return token
    raise RuntimeError("No Netlify CLI login found. Run: netlify login")


def env_var_exists(name):
    token = netlify_token()
    url = "https://api.netlify.com/api/v1/accounts/%s/env/%s?site_id=%s" % (ACCOUNT, name, SITE_ID)
    status, _ = http("GET", url, token=token)
    return status == 200


def set_env_var(name, value, log):
    token = netlify_token()
    url = "https://api.netlify.com/api/v1/accounts/%s/env/%s?site_id=%s" % (ACCOUNT, name, SITE_ID)
    body = {
        "key": name,
        "scopes": ["functions"],
        "is_secret": False,
        "values": [{"context": c, "value": value} for c in CONTEXTS]
    }
    status, _ = http("PUT", url, token=token, body=body)
    if status == 404:
        create_url = "https://api.netlify.com/api/v1/accounts/%s/env?site_id=%s" % (ACCOUNT, SITE_ID)
        status, _ = http("POST", create_url, token=token, body=[body])
    if status not in (200, 201):
        raise RuntimeError("Netlify env update for %s failed with HTTP %s" % (name, status))
    log("%s stored for: %s" % (name, ", ".join(CONTEXTS)))


def stripe_post(path, form, key):
    status, data = http("POST", "https://api.stripe.com/v1/" + path, token=key, form=form)
    if status != 200:
        msg = ""
        if isinstance(data, dict):
            msg = ((data.get("error") or {}).get("message") or "")[:200]
        raise RuntimeError("Stripe %s failed (%s): %s" % (path, status, msg or "no detail"))
    return data


def create_tier(tier, key, log):
    log("Creating product: " + tier["product"])
    product = stripe_post("products", {
        "name": tier["product"],
        "metadata[app]": "rosterblur",
    }, key)
    price = stripe_post("prices", {
        "unit_amount": str(tier["amount"]),
        "currency": "usd",
        "product": product["id"],
    }, key)
    link = stripe_post("payment_links", {
        "line_items[0][price]": price["id"],
        "line_items[0][quantity]": "1",
        "metadata[app]": "rosterblur",
        "after_completion[type]": "redirect",
        "after_completion[redirect][url]": ACTIVATE_REDIRECT,
    }, key)
    log("  product %s / price %s / link %s" % (product["id"], price["id"], link["id"]))
    return link


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
        return True, "endpoint reaches Stripe and rejects unknown sessions (404)."
    if status == 503:
        return False, "endpoint says not configured (503); run setup-stripe-key.py first"
    return False, "unexpected response %s: %s" % (status, data)


def run_setup(key, log):
    key = key.strip()
    if not key:
        log("Paste a key first.")
        return False
    shown = "%s... (%d chars)" % (key[:8], len(key))
    if not (key.startswith("sk_live_") or key.startswith("rk_live_")):
        if key.startswith(("sk_test_", "rk_test_")):
            log("That is a TEST key. These links must be live mode; grab a live key.")
            return False
        log("That does not look like a Stripe secret key (sk_live_/rk_live_).")
        return False

    existing = [t["env"] for t in TIERS if env_var_exists(t["env"])]
    if existing:
        log("Already configured: " + ", ".join(existing))
        log("Delete those Netlify env vars first if you truly want to recreate.")
        return False

    log("Using %s to create live products, prices, and payment links..." % shown)
    urls = []
    for tier in TIERS:
        link = create_tier(tier, key, log)
        set_env_var(tier["env"], link["id"], log)
        urls.append((tier["product"], link["url"]))

    redeploy(log)
    ok, msg = probe(log)
    log(("OK: " if ok else "Problem: ") + msg)
    log("")
    log("Share these links (they redirect to the activate page and mint")
    log("tiered keys automatically):")
    for name, url in urls:
        log("  %s\n    %s" % (name, url))
    return ok


def gui():
    import tkinter as tk

    root = tk.Tk()
    root.title("RosterBlur setup: site licenses")
    root.geometry("620x440")
    root.configure(bg="#12102a")

    tk.Label(root, text="Paste a Stripe secret key with WRITE access (sk_live_... or rk_live_...)",
             fg="#e5e7ff", bg="#12102a").pack(anchor="w", padx=14, pady=(14, 4))

    entry = tk.Entry(root, show="*", width=64, bg="#1c1940", fg="#e5e7ff",
                     insertbackground="#e5e7ff", relief="flat")
    entry.pack(fill="x", padx=14, ipady=5)
    entry.focus_set()

    logbox = tk.Text(root, height=14, bg="#0d0b1e", fg="#a5b4fc",
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
            root.after(0, lambda: button.configure(state="normal", text="Create site licenses"))

    def go():
        button.configure(state="disabled", text="Working...")
        threading.Thread(target=work, daemon=True).start()

    button = tk.Button(root, text="Create site licenses", command=go,
                       bg="#818cf8", fg="#0e0c22", relief="flat", padx=14, pady=6)
    button.pack(pady=(0, 14))

    root.mainloop()


if __name__ == "__main__":
    if "--verify-only" in sys.argv:
        ok, msg = probe(print)
        for tier in TIERS:
            print("%s: %s" % (tier["env"], "SET" if env_var_exists(tier["env"]) else "missing"))
        print(("OK: " if ok else "Not ready: ") + msg)
        sys.exit(0 if ok else 1)
    gui()
