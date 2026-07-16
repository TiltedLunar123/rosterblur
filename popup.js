// Popup logic: reflect the active tab's RosterBlur state and drive it.
// The shield button is global (background owns it); everything else in
// the tool grid talks to the active tab's content script.

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  let tabId = null;
  let tabState = null; // from the content script, null when unreachable
  let access = null; // from RB.getAccess()
  let shieldOn = false;
  let clearTimer = null;

  const sendToTab = (msg) =>
    new Promise((resolve) => {
      if (tabId === null) return resolve(null);
      try {
        chrome.tabs.sendMessage(tabId, msg, (res) => {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(res || null);
        });
      } catch {
        resolve(null);
      }
    });

  const sendToBackground = (msg) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(res || null);
        });
      } catch {
        resolve(null);
      }
    });

  const setToggleButton = (btn, on) => {
    btn.classList.toggle("active", !!on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  };

  const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");

  const pro = () => !!(access && access.pro);

  // =========================
  // Shield
  // =========================

  const refreshShield = () => {
    setToggleButton($("shieldBtn"), shieldOn);
    $("shieldSub").textContent = shieldOn
      ? (pro()
        ? "ON: roster names and tab titles are hidden."
        : "ON: tab titles are hidden. Name blur is a Pro feature.")
      : (pro()
        ? "Off. One click before you share."
        : "Off. Hides tab titles; name blur needs Pro.");
  };

  // =========================
  // Site status
  // =========================

  const siteStatusText = () => {
    const c = (tabState && tabState.counts) || {};
    const parts = [];
    if (pro() && c.names) parts.push(plural(c.names, "name") + " hidden");
    if (c.selectors) parts.push(plural(c.selectors, "element"));
    if (c.areas) parts.push(plural(c.areas, "area"));
    if (tabState && tabState.mask) parts.push("title masked");
    return parts.length ? "On this site: " + parts.join(", ") : "Nothing blurred here yet";
  };

  const resetClearButton = () => {
    clearTimeout(clearTimer);
    const btn = $("clearSiteBtn");
    btn.textContent = "Clear";
    btn.classList.remove("danger");
    btn.dataset.armed = "";
  };

  const refreshButtons = () => {
    const reachable = !!tabState;
    for (const id of ["pickerBtn", "areaBtn", "panicBtn", "maskBtn", "clearSiteBtn", "captureBtn"]) {
      $(id).disabled = !reachable;
    }
    $("siteNote").classList.toggle("hidden", reachable);
    $("siteCard").classList.toggle("hidden", !reachable);
    if (!tabState) return;
    setToggleButton($("pickerBtn"), tabState.picking);
    setToggleButton($("panicBtn"), tabState.panic);
    setToggleButton($("maskBtn"), tabState.mask);
    $("meetingBadge").classList.toggle("hidden", !tabState.meetingActive);
    $("siteStatus").textContent = siteStatusText();
  };

  const command = (name) => async () => {
    const res = await sendToTab({ type: "rb-command", command: name });
    if (res) {
      tabState.picking = res.picking;
      tabState.panic = res.panic;
      tabState.mask = res.mask;
      refreshButtons();
    }
    if (name === "toggle-picker" || name === "draw-area" || name === "capture-names") window.close();
  };

  // =========================
  // Access-dependent UI
  // =========================

  const buyUrl = () => RB.license.PRO.BUY_URL;

  const applyAccessUi = async (settings, rosters) => {
    const names = RB.enabledNames(rosters);
    const trial = access.trial || { active: false, endsAt: 0, daysLeft: 0 };

    $("proBadge").classList.toggle("hidden", access.source !== "license");
    $("trialBadge").classList.toggle("hidden", access.source !== "trial");
    if (access.source === "trial") {
      $("trialBadge").textContent = "TRIAL: " + plural(trial.daysLeft, "day") + " left";
    }

    $("rosterCard").classList.toggle("hidden", !pro());
    $("proCard").classList.toggle("hidden", pro());
    $("captureBtn").classList.toggle("hidden", !pro());

    if (pro()) {
      $("rosterToggle").checked = settings.rosterEnabled;
      $("pseudoToggle").checked = settings.pseudonymize;
      $("rosterInfo").textContent = names.length
        ? plural(names.length, "name")
        : "no names yet";
      renderRosterQuick(rosters);
      const hint = $("trialHint");
      hint.classList.toggle("hidden", access.source !== "trial");
      if (access.source === "trial") {
        $("trialHintText").textContent =
          "Everything is unlocked for " + plural(trial.daysLeft, "more day") + ". ";
      }
    } else if (trial.endsAt) {
      // Trial ran out: name the loss, not the feature list.
      $("upsellTitle").textContent = "Your free trial ended";
      $("upsellText").textContent =
        "Your rosters are still saved on this device. Pro turns auto-blur back on: $15, once, forever.";
    }
  };

  // Quick per-roster toggles so multi-period teachers can switch
  // classes without opening options.
  const renderRosterQuick = (rosters) => {
    const box = $("rosterQuick");
    box.textContent = "";
    box.classList.toggle("hidden", rosters.length < 2);
    if (rosters.length < 2) return;
    for (const roster of rosters) {
      const label = document.createElement("label");
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = roster.enabled;
      check.addEventListener("change", async () => {
        const all = await RB.getRosters();
        const target = all.find((r) => r.id === roster.id);
        if (target) {
          target.enabled = check.checked;
          await RB.storageSet({ [RB.STORAGE.ROSTERS]: all });
        }
      });
      const text = document.createElement("span");
      text.textContent = roster.name + " (" + roster.names.length + ")";
      label.append(check, text);
      box.appendChild(label);
    }
  };

  // =========================
  // Stats and review ask
  // =========================

  const reviewUrl = () =>
    navigator.userAgent.includes("Firefox")
      ? "https://addons.mozilla.org/firefox/addon/rosterblur@rosterblur-pro.netlify.app/reviews/"
      : "https://chromewebstore.google.com/detail/" + chrome.runtime.id + "/reviews";

  const applyStatsUi = (stats, review) => {
    const week = Number(stats.week) || 0;
    const total = Number(stats.total) || 0;
    if (pro() && week > 0) {
      $("statsRow").textContent = "RosterBlur hid " + plural(week, "name") + " this week.";
      $("statsRow").classList.remove("hidden");
    }
    const dismissed = !!(review && review.dismissed);
    if (pro() && total >= 150 && !dismissed) {
      $("reviewRow").classList.remove("hidden");
    }
  };

  // =========================
  // Boot
  // =========================

  const init = async () => {
    const [settings, rosters, extra] = await Promise.all([
      RB.getSettings(),
      RB.getRosters(),
      RB.storageGet([RB.STORAGE.SHIELD, RB.STORAGE.STATS, RB.STORAGE.REVIEW])
    ]);
    access = await RB.getAccess();
    shieldOn = !!(extra[RB.STORAGE.SHIELD] && extra[RB.STORAGE.SHIELD].active);

    $("blurRange").value = settings.blurPx;
    $("blurOut").textContent = settings.blurPx + "px";
    refreshShield();
    await applyAccessUi(settings, rosters);
    applyStatsUi(extra[RB.STORAGE.STATS] || {}, extra[RB.STORAGE.REVIEW]);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab && tab.id ? tab.id : null;
    } catch { tabId = null; }
    tabState = await sendToTab({ type: "rb-get-state" });
    if (!tabState && tabId !== null) {
      // The tab predates the last install or update, so the manifest
      // content script never attached. Inject now; restricted pages
      // (chrome://, the web store) reject and keep the tools off.
      try {
        await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          files: ["shared.js", "contentScript.js"]
        });
        tabState = await sendToTab({ type: "rb-get-state" });
      } catch { /* page does not allow injection */ }
    }
    refreshButtons();
  };

  const saveSettingsPatch = async (patch) => {
    const settings = await RB.getSettings();
    await RB.storageSet({ [RB.STORAGE.SETTINGS]: { ...settings, ...patch } });
  };

  $("shieldBtn").addEventListener("click", async () => {
    const res = await sendToBackground({ type: "rb-toggle-shield" });
    if (res) {
      shieldOn = !!res.shield;
      refreshShield();
      // Free users just armed half a shield; point at the missing half.
      if (shieldOn && !pro()) {
        const card = $("proCard");
        card.classList.remove("nudge");
        void card.offsetWidth; // restart the animation
        card.classList.add("nudge");
      }
      // Give the content script a beat, then refresh the site line.
      setTimeout(async () => {
        tabState = await sendToTab({ type: "rb-get-state" });
        refreshButtons();
      }, 350);
    }
  });

  $("pickerBtn").addEventListener("click", command("toggle-picker"));
  $("areaBtn").addEventListener("click", command("draw-area"));
  $("panicBtn").addEventListener("click", command("panic-blur"));
  $("maskBtn").addEventListener("click", command("toggle-mask"));
  $("captureBtn").addEventListener("click", command("capture-names"));

  $("blurRange").addEventListener("input", () => {
    $("blurOut").textContent = $("blurRange").value + "px";
  });
  $("blurRange").addEventListener("change", () => {
    saveSettingsPatch({ blurPx: Number($("blurRange").value) });
  });

  $("rosterToggle").addEventListener("change", () => {
    saveSettingsPatch({ rosterEnabled: $("rosterToggle").checked });
  });
  $("pseudoToggle").addEventListener("change", () => {
    saveSettingsPatch({ pseudonymize: $("pseudoToggle").checked });
  });

  // Clearing wipes this site's saved blurs, so it asks for a second
  // click; the armed state falls back to normal after a moment.
  $("clearSiteBtn").addEventListener("click", async () => {
    const btn = $("clearSiteBtn");
    if (!btn.dataset.armed) {
      btn.dataset.armed = "1";
      btn.textContent = "Confirm";
      btn.classList.add("danger");
      clearTimer = setTimeout(resetClearButton, 3000);
      return;
    }
    resetClearButton();
    await sendToTab({ type: "rb-clear-site" });
    tabState = await sendToTab({ type: "rb-get-state" });
    refreshButtons();
  });

  const openOptions = (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  };
  $("optionsLink").addEventListener("click", openOptions);
  $("editRostersLink").addEventListener("click", openOptions);

  $("buyBtn").addEventListener("click", () => {
    chrome.tabs.create({ url: buyUrl() });
  });
  $("trialBuyLink").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: buyUrl() });
  });
  $("haveKeyLink").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html#pro") });
  });

  $("reviewLink").addEventListener("click", async (e) => {
    e.preventDefault();
    await RB.storageSet({ [RB.STORAGE.REVIEW]: { dismissed: true } });
    chrome.tabs.create({ url: reviewUrl() });
  });
  $("reviewDismiss").addEventListener("click", async () => {
    await RB.storageSet({ [RB.STORAGE.REVIEW]: { dismissed: true } });
    $("reviewRow").classList.add("hidden");
  });

  init();
})();
