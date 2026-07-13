// Popup logic: reflect the active tab's RosterBlur state and drive it.

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  let tabId = null;
  let tabState = null; // from the content script, null when unreachable
  let pro = false;
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

  const setToggleButton = (btn, on) => {
    btn.classList.toggle("active", !!on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  };

  const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");

  const siteStatusText = () => {
    const c = (tabState && tabState.counts) || {};
    const parts = [];
    if (pro && c.names) parts.push(plural(c.names, "name") + " hidden");
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
    for (const id of ["pickerBtn", "areaBtn", "panicBtn", "maskBtn", "clearSiteBtn"]) {
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
    if (name === "toggle-picker" || name === "draw-area") window.close();
  };

  const init = async () => {
    const [settings, flags, rosters] = await Promise.all([
      RB.getSettings(),
      RB.storageGet([RB.STORAGE.PRO_FLAG]),
      RB.getRosters()
    ]);
    pro = !!flags[RB.STORAGE.PRO_FLAG];
    const names = RB.enabledNames(rosters);

    $("blurRange").value = settings.blurPx;
    $("blurOut").textContent = settings.blurPx + "px";
    $("proBadge").classList.toggle("hidden", !pro);
    $("rosterCard").classList.toggle("hidden", !pro);
    $("proCard").classList.toggle("hidden", pro);
    if (pro) {
      $("rosterToggle").checked = settings.rosterEnabled;
      $("pseudoToggle").checked = settings.pseudonymize;
      $("rosterInfo").textContent = names.length
        ? plural(names.length, "name")
        : "no names yet";
    }

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

  $("pickerBtn").addEventListener("click", command("toggle-picker"));
  $("areaBtn").addEventListener("click", command("draw-area"));
  $("panicBtn").addEventListener("click", command("panic-blur"));
  $("maskBtn").addEventListener("click", command("toggle-mask"));

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
    chrome.tabs.create({ url: RB.license.PRO.BUY_URL });
  });
  $("haveKeyLink").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html#pro") });
  });

  init();
})();
