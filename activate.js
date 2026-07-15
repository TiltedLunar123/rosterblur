// One-click activation on the RosterBlur purchase confirmation page.
// Runs ONLY on rosterblur-pro.netlify.app/activate (see manifest) and
// stays self-contained: no shared.js, nothing injected into the page's
// scripts. It reads the key the page already displays, saves it to
// local extension storage, and asks the background to verify it
// offline, so buying-to-blurring is one click instead of a copy,
// a tab switch, and a paste. Still zero network requests.

(() => {
  "use strict";
  if (window.__rosterBlurActivate) return;
  window.__rosterBlurActivate = true;

  const KEY_RE = /^RB1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
  const LICENSE_KEY = "rb_license";

  const findKey = () => {
    const box = document.getElementById("keybox");
    const text = box ? (box.textContent || "").trim() : "";
    return KEY_RE.test(text) ? text : "";
  };

  const markDone = (btn, text) => {
    btn.disabled = true;
    btn.textContent = text;
    btn.style.background = "rgba(110, 231, 183, 0.2)";
    btn.style.borderColor = "#6ee7b7";
    btn.style.color = "#6ee7b7";
  };

  const markFailed = (btn) => {
    btn.disabled = false;
    btn.textContent = "Activation failed, paste the key in Options instead";
  };

  const activate = (key, btn) => {
    btn.disabled = true;
    btn.textContent = "Activating...";
    try {
      chrome.storage.local.set({ [LICENSE_KEY]: key }, () => {
        try {
          chrome.runtime.sendMessage({ type: "rb-refresh-pro" }, (res) => {
            if (!chrome.runtime.lastError && res && res.pro) {
              markDone(btn, "Pro is active in this browser");
            } else {
              markFailed(btn);
            }
          });
        } catch {
          markFailed(btn);
        }
      });
    } catch {
      markFailed(btn);
    }
  };

  const injectButton = (key) => {
    if (document.getElementById("rb-ext-activate")) return;
    const keybox = document.getElementById("keybox");
    const row = document.getElementById("copyRow") || (keybox && keybox.parentElement);
    if (!row) return;
    const btn = document.createElement("button");
    btn.id = "rb-ext-activate";
    btn.type = "button";
    btn.textContent = "Activate in RosterBlur";
    btn.style.background = "#818cf8";
    btn.style.borderColor = "#818cf8";
    btn.style.color = "#0e0c22";
    btn.addEventListener("click", () => activate(key, btn));
    row.appendChild(btn);
    // Already activated with this exact key? Say so instead of
    // offering a no-op.
    try {
      chrome.storage.local.get([LICENSE_KEY], (data) => {
        if (!chrome.runtime.lastError && data && data[LICENSE_KEY] === key) {
          markDone(btn, "Pro is active in this browser");
        }
      });
    } catch { /* storage unavailable; the click path still works */ }
  };

  const tryInject = () => {
    const key = findKey();
    if (key) injectButton(key);
    return !!key;
  };

  // The page fetches the key after load, so watch for it to appear.
  if (!tryInject()) {
    const observer = new MutationObserver(() => {
      if (tryInject()) observer.disconnect();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
    setTimeout(() => observer.disconnect(), 60000);
  }
})();
