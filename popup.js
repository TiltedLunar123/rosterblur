// Popup logic: reflect the active tab's RosterBlur state and drive it.

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  let tabId = null;
  let tabState = null; // from the content script, null when unreachable

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

  const setToggleButton = (btn, on) => btn.classList.toggle("active", !!on);

  const refreshButtons = () => {
    const reachable = !!tabState;
    for (const id of ["pickerBtn", "areaBtn", "panicBtn", "maskBtn", "clearSiteBtn"]) {
      $(id).disabled = !reachable;
    }
    $("siteNote").classList.toggle("hidden", reachable);
    if (!tabState) return;
    setToggleButton($("pickerBtn"), tabState.picking);
    setToggleButton($("panicBtn"), tabState.panic);
    setToggleButton($("maskBtn"), tabState.mask);
    $("meetingBadge").classList.toggle("hidden", !tabState.meetingActive);
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
    const pro = !!flags[RB.STORAGE.PRO_FLAG];
    const names = RB.enabledNames(rosters);

    $("blurRange").value = settings.blurPx;
    $("blurOut").textContent = settings.blurPx + "px";
    $("proBadge").classList.toggle("hidden", !pro);
    $("rosterCard").classList.toggle("hidden", !pro);
    $("proHint").classList.toggle("hidden", pro);
    if (pro) {
      $("rosterToggle").checked = settings.rosterEnabled;
      $("pseudoToggle").checked = settings.pseudonymize;
      $("rosterInfo").textContent = names.length
        ? names.length + " name" + (names.length === 1 ? "" : "s")
        : "no names yet";
    }

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab && tab.id ? tab.id : null;
    } catch { tabId = null; }
    tabState = await sendToTab({ type: "rb-get-state" });
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

  $("clearSiteBtn").addEventListener("click", async () => {
    await sendToTab({ type: "rb-clear-site" });
    tabState = await sendToTab({ type: "rb-get-state" });
    refreshButtons();
  });

  const openOptions = (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  };
  $("optionsLink").addEventListener("click", openOptions);
  $("proHintLink").addEventListener("click", openOptions);

  init();
})();
