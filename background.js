// RosterBlur service worker. Three jobs, all local:
// - relay keyboard commands to the active tab's content script
// - keep the meeting-mode flag in sync with open meeting tabs
// - verify the stored license key and cache the result so content
//   scripts on plain-http pages (no WebCrypto) still gate correctly
//
// Zero network requests live here or anywhere else in the extension.

importScripts("shared.js");

const MEETING_TABS_KEY = "rb_meeting_tabs";

// =========================
// Commands -> active tab
// =========================

chrome.commands.onCommand.addListener(async (command) => {
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
// License -> rb_pro flag
// =========================

const refreshProFlag = async () => {
  const state = await RB.license.getState();
  await RB.storageSet({ [RB.STORAGE.PRO_FLAG]: state.active });
  return state.active;
};

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[RB.STORAGE.LICENSE]) refreshProFlag();
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
  try {
    await chrome.action.setBadgeText({ text: active ? "ON" : "" });
    if (active) await chrome.action.setBadgeBackgroundColor({ color: "#059669" });
  } catch { /* badge is cosmetic */ }
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return;
  const tabId = sender && sender.tab && sender.tab.id;
  if (msg.type === "rb-meeting-hello" && tabId) {
    getMeetingTabs().then((tabs) => { tabs.add(tabId); return setMeetingTabs(tabs); });
  } else if (msg.type === "rb-meeting-bye" && tabId) {
    getMeetingTabs().then((tabs) => { tabs.delete(tabId); return setMeetingTabs(tabs); });
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
// Lifecycle
// =========================

const resetTransient = async () => {
  await chrome.storage.session.set({ [MEETING_TABS_KEY]: [] });
  await RB.storageSet({ [RB.STORAGE.MEETING]: { active: false } });
  try { await chrome.action.setBadgeText({ text: "" }); } catch { /* cosmetic */ }
  await refreshProFlag();
};

chrome.runtime.onInstalled.addListener(() => { resetTransient(); });
chrome.runtime.onStartup.addListener(() => { resetTransient(); });
