// RosterBlur background. All local, zero network requests:
// - relay keyboard commands to the active tab's content script
// - flip presentation shield on Alt+Shift+S and keep the badge honest
// - keep the meeting-mode flag in sync with open meeting tabs
// - resolve Pro access (license OR active trial) into the cached
//   rb_pro flag so content scripts on plain-http pages (no WebCrypto)
//   still gate correctly
// - accumulate the names-hidden counters content scripts report
//
// Chrome runs this as a service worker and pulls shared.js in via
// importScripts. Firefox has no extension service workers; its
// manifest loads shared.js ahead of this file as an event-page
// script, where importScripts does not exist.

if (typeof importScripts === "function") importScripts("shared.js");

const MEETING_TABS_KEY = "rb_meeting_tabs";
const TRIAL_ALARM = "rb-trial-end";

// =========================
// Commands
// =========================
// Picker and panic act on the active tab. The shield is global state,
// so the background flips it directly and every tab reacts through
// storage.onChanged.

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-shield") {
    await toggleShield();
    return;
  }
  if (command !== "toggle-picker" && command !== "panic-blur") return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;
    await chrome.tabs.sendMessage(tab.id, { type: "rb-command", command });
  } catch {
    // No content script on this page (chrome://, store, etc). Nothing to do.
  }
});

// =========================
// Presentation shield
// =========================

const getShield = async () => {
  const data = await RB.storageGet([RB.STORAGE.SHIELD]);
  return !!(data[RB.STORAGE.SHIELD] && data[RB.STORAGE.SHIELD].active);
};

const setShield = async (active) => {
  await RB.storageSet({ [RB.STORAGE.SHIELD]: { active: !!active } });
  await updateBadge();
};

const toggleShield = async () => {
  const active = await getShield();
  await setShield(!active);
  return !active;
};

// =========================
// Access (license or trial) -> rb_pro flag
// =========================

const refreshProFlag = async () => {
  const access = await RB.getAccess();
  await RB.storageSet({ [RB.STORAGE.PRO_FLAG]: access.pro });
  // Wake up exactly when the trial lapses so the flag flips without
  // waiting for the next browser restart.
  try {
    if (access.source === "trial" && access.trial.endsAt) {
      chrome.alarms.create(TRIAL_ALARM, { when: access.trial.endsAt + 1000 });
    } else {
      chrome.alarms.clear(TRIAL_ALARM);
    }
  } catch { /* alarms are best-effort */ }
  return access.pro;
};

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === TRIAL_ALARM) refreshProFlag();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[RB.STORAGE.LICENSE] || changes[RB.STORAGE.INSTALL]) refreshProFlag();
  if (changes[RB.STORAGE.SHIELD]) updateBadge();
});

// =========================
// Meeting mode
// =========================
// Content scripts on meet/zoom/teams pages say hello; the set of live
// meeting tab ids decides rb_meeting.active. The set survives worker
// restarts in session storage and resets with the browser.

const getMeetingTabs = async () => {
  const data = await chrome.storage.session.get([MEETING_TABS_KEY]);
  return new Set(Array.isArray(data[MEETING_TABS_KEY]) ? data[MEETING_TABS_KEY] : []);
};

const setMeetingTabs = async (tabs) => {
  await chrome.storage.session.set({ [MEETING_TABS_KEY]: [...tabs] });
  const active = tabs.size > 0;
  const current = await RB.storageGet([RB.STORAGE.MEETING]);
  if (!!(current[RB.STORAGE.MEETING] && current[RB.STORAGE.MEETING].active) !== active) {
    await RB.storageSet({ [RB.STORAGE.MEETING]: { active } });
  }
  await updateBadge();
};

// One badge for both "armed" states: shield wins the label, meeting
// mode shows the same ON so a glance says "blurring is active".
const updateBadge = async () => {
  try {
    const [shield, data] = await Promise.all([
      getShield(),
      RB.storageGet([RB.STORAGE.MEETING])
    ]);
    const meeting = !!(data[RB.STORAGE.MEETING] && data[RB.STORAGE.MEETING].active);
    const on = shield || meeting;
    await chrome.action.setBadgeText({ text: on ? "ON" : "" });
    if (on) await chrome.action.setBadgeBackgroundColor({ color: "#059669" });
  } catch { /* badge is cosmetic */ }
};

// =========================
// Stats
// =========================
// Content scripts report how many new things they hid; the background
// is the single writer for the rolling counters the popup shows.
// Cosmetic data, local only, never leaves the machine.

const recordStats = async (names) => {
  const n = Math.max(0, Math.min(10000, Number(names) || 0));
  if (!n) return;
  const data = await RB.storageGet([RB.STORAGE.STATS]);
  const stats = data[RB.STORAGE.STATS] || {};
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const weekStart = Number(stats.weekStart) || 0;
  const rolled = !weekStart || now - weekStart > weekMs;
  await RB.storageSet({
    [RB.STORAGE.STATS]: {
      weekStart: rolled ? now : weekStart,
      week: (rolled ? 0 : Number(stats.week) || 0) + n,
      total: (Number(stats.total) || 0) + n
    }
  });
};

// =========================
// Messages
// =========================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return;
  const tabId = sender && sender.tab && sender.tab.id;
  if (msg.type === "rb-meeting-hello" && tabId) {
    getMeetingTabs().then((tabs) => { tabs.add(tabId); return setMeetingTabs(tabs); });
  } else if (msg.type === "rb-meeting-bye" && tabId) {
    getMeetingTabs().then((tabs) => { tabs.delete(tabId); return setMeetingTabs(tabs); });
  } else if (msg.type === "rb-stats-delta") {
    recordStats(msg.names);
  } else if (msg.type === "rb-toggle-shield") {
    toggleShield().then((active) => sendResponse({ shield: active }));
    return true;
  } else if (msg.type === "rb-refresh-pro") {
    refreshProFlag().then((active) => sendResponse({ pro: active }));
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  getMeetingTabs().then((tabs) => {
    if (tabs.delete(tabId)) return setMeetingTabs(tabs);
  });
});

// =========================
// Content script (re)injection
// =========================
// Manifest content scripts only attach to pages loaded after the
// extension starts. Without this, every tab that was open during an
// install or update has no content script until it is refreshed, and
// the popup tools sit disabled there. Inject into all open tabs;
// restricted pages (chrome://, the web store) just reject.

const injectIntoOpenTabs = async () => {
  let tabs = [];
  try { tabs = await chrome.tabs.query({}); } catch { return; }
  await Promise.allSettled(tabs.map((tab) => {
    if (!tab.id) return Promise.resolve();
    return chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ["shared.js", "contentScript.js"]
    }).catch(() => { /* page does not allow injection */ });
  }));
};

// =========================
// Lifecycle
// =========================

// The install timestamp anchors the 7-day trial. Set once and kept
// forever; updates never restart a running clock, but a browser that
// has never had one (anyone upgrading from 1.x) starts theirs now.
const ensureInstallRecord = async () => {
  const data = await RB.storageGet([RB.STORAGE.INSTALL]);
  const existing = data[RB.STORAGE.INSTALL];
  if (existing && Number(existing.at)) return;
  await RB.storageSet({ [RB.STORAGE.INSTALL]: { at: Date.now() } });
};

const resetTransient = async () => {
  await chrome.storage.session.set({ [MEETING_TABS_KEY]: [] });
  await RB.storageSet({
    [RB.STORAGE.MEETING]: { active: false },
    // Shield never survives a restart: nobody should discover hours
    // later that everything was still being blurred (or worse, assume
    // it was on when it was not).
    [RB.STORAGE.SHIELD]: { active: false }
  });
  await ensureInstallRecord();
  await refreshProFlag();
  await updateBadge();
};

chrome.runtime.onInstalled.addListener((details) => {
  resetTransient();
  injectIntoOpenTabs();
  // First install only: open the options page once so setup is obvious.
  if (details && details.reason === "install") {
    try { chrome.runtime.openOptionsPage(); } catch { /* no UI available */ }
  }
});
chrome.runtime.onStartup.addListener(() => { resetTransient(); });
