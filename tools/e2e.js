#!/usr/bin/env node
// Live browser verification. Launches Chromium with the unpacked
// extension, seeds a roster, and checks the promises the listing
// makes: click-to-blur, roster auto-blur (including SPA re-renders),
// pseudonymize, panic, persistence, and zero network traffic.
//
//   node tools/e2e.js
//
// Optional: set RB_E2E_LICENSE to a real key to exercise the full
// license verification path; without it the cached pro flag is set
// directly (the crypto path is covered by unit tests either way).
// Screenshots land in docs/.

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { pathToFileURL } = require("url");
const { chromium } = require("playwright-core");

const REPO = path.join(__dirname, "..");
// RB_EXT_DIR lets the suite run against a built artifact (e.g. the
// unzipped store package) instead of the repo checkout.
const EXT_DIR = process.env.RB_EXT_DIR ? path.resolve(process.env.RB_EXT_DIR) : REPO;
const DOCS = path.join(REPO, "docs");
const FIXTURES = path.join(REPO, "tests", "fixtures");

const ROSTER = [
  "Jordan Smith",
  "Maria Garcia",
  "Jose Martinez",
  "Zoe Bronte",
  "May Chen",
  "Liam O'Brien",
  "DeShawn Williams",
  "Priya Patel"
];

let failures = 0;
const check = (ok, label) => {
  console.log((ok ? "PASS" : "FAIL") + "  " + label);
  if (!ok) failures++;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  // Google-branded Chrome stable ignores --load-extension since 137,
  // so Edge (Chromium without that restriction) comes first.
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  ];
  for (const exe of candidates) {
    if (exe && fs.existsSync(exe)) return exe;
  }
  throw new Error("No Chromium-based browser found; set CHROME_PATH");
}

async function main() {
  fs.mkdirSync(DOCS, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "rb-e2e-"));
  const executablePath = findBrowser();
  console.log("browser: " + executablePath);

  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    executablePath,
    viewport: { width: 1280, height: 900 },
    args: [
      "--disable-extensions-except=" + EXT_DIR,
      "--load-extension=" + EXT_DIR,
      "--no-first-run",
      "--no-default-browser-check"
    ]
  });

  // Track every page-context network request; the extension must add none.
  const netRequests = [];
  context.on("request", (req) => {
    const url = req.url();
    if (/^https?:/i.test(url)) netRequests.push(url);
  });

  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
    const extensionId = new URL(sw.url()).host;
    console.log("extension id: " + extensionId);
    await sleep(800); // let onInstalled bookkeeping finish

    // Seed settings + roster; activate pro via a real key when provided.
    await sw.evaluate(async ({ roster, license }) => {
      await chrome.storage.local.set({
        rb_settings: {
          blurPx: 8,
          rosterEnabled: true,
          pseudonymize: false,
          standaloneNames: false,
          patterns: { email: true, phone: true, studentId: true }
        },
        rb_rosters: [{ id: "p3", name: "Period 3", enabled: true, names: roster }]
      });
      if (license) {
        await chrome.storage.local.set({ rb_license: license });
        const state = await RB.license.getState();
        await chrome.storage.local.set({ rb_pro: state.active });
      } else {
        await chrome.storage.local.set({ rb_pro: true });
      }
    }, { roster: ROSTER, license: process.env.RB_E2E_LICENSE || "" });

    if (process.env.RB_E2E_LICENSE) {
      const proFlag = await sw.evaluate(async () => (await chrome.storage.local.get(["rb_pro"])).rb_pro);
      check(proFlag === true, "real license key verified by the extension (rb_pro flag set)");
    }

    // ================= Gradebook: roster auto-blur =================
    const page = await context.newPage();
    // 1.1.0 opens the options page on first install; close it so it
    // does not sit in front of the fixture tabs. This happens after
    // newPage so the persistent context always keeps one page alive.
    for (const p of context.pages()) {
      if (p !== page && p.url().includes("options.html")) await p.close();
    }
    await page.goto(pathToFileURL(path.join(FIXTURES, "gradebook.html")).href);
    await sleep(1200);

    const gb = await page.evaluate(() => {
      const blurred = (el) => {
        if (!el) return false;
        if (getComputedStyle(el).filter.includes("blur")) return true;
        const r = el.getBoundingClientRect();
        return [...document.querySelectorAll("[data-rb-chip]")].some((c) => {
          const cr = c.getBoundingClientRect();
          return cr.left < r.right && cr.right > r.left && cr.top < r.bottom && cr.bottom > r.top;
        });
      };
      const cellWith = (text) =>
        [...document.querySelectorAll("td")].find((td) => td.textContent.trim() === text);
      const nameCells = ["Jordan Smith", "Garcia, Maria", "José Martínez", "Zoë Brontë", "May Chen", "Liam O'Brien", "Priya Patel"];
      const emailCell = [...document.querySelectorAll("td")].find((td) => td.textContent.includes("jsmith24@"));
      const idCell = [...document.querySelectorAll("td")].find((td) => td.textContent.trim() === "4471023");
      const phoneCell = [...document.querySelectorAll("td")].find((td) => td.textContent.includes("(586) 555-0134"));
      const linkName = [...document.querySelectorAll("td a")].find((a) => a.textContent.includes("DeShawn"));
      const maybelle = [...document.querySelectorAll("p")].find((p) => p.textContent.includes("Maybelle"));
      const codeEl = document.querySelector("code");
      const urlSpan = [...document.querySelectorAll("span")].find((s) => s.textContent.includes("https://school.example"));
      return {
        namesBlurred: nameCells.map((t) => blurred(cellWith(t))),
        emailBlurred: blurred(emailCell),
        idBlurred: blurred(idCell),
        phoneBlurred: blurred(phoneCell),
        linkNameBlurred: blurred(linkName),
        maybelleBlurred: blurred(maybelle),
        codeBlurred: blurred(codeEl),
        urlBlurred: blurred(urlSpan)
      };
    });
    check(gb.namesBlurred.every(Boolean), "every roster name blurred (incl. diacritics + Last, First)");
    check(gb.linkNameBlurred, "name inside a link is blurred");
    check(gb.emailBlurred, "email pattern blurred");
    check(gb.idBlurred, "student id pattern blurred");
    check(gb.phoneBlurred, "phone pattern blurred");
    check(!gb.maybelleBlurred, "non-roster 'Maybelle Chenoweth' untouched");
    check(!gb.codeBlurred, "code block untouched");
    check(!gb.urlBlurred, "name inside URL text untouched");

    // Input value matching
    await page.fill("#searchBox", "Maria Garcia");
    await sleep(700);
    const inputBlurred = await page.evaluate(() =>
      getComputedStyle(document.getElementById("searchBox")).filter.includes("blur"));
    check(inputBlurred, "input value containing a roster name blurred");
    await page.screenshot({ path: path.join(DOCS, "e2e-gradebook-roster-blur.png") });

    // ================= Click-to-blur + persistence =================
    const tabId = await sw.evaluate(async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return tabs[0] && tabs[0].id;
    });
    await sw.evaluate(async (id) => {
      await chrome.tabs.sendMessage(id, { type: "rb-command", command: "toggle-picker" });
    }, tabId);
    await sleep(300);
    const caption = page.locator("caption");
    await caption.click();
    await page.keyboard.press("Escape");
    await sleep(500);
    const captionBlurred = await page.evaluate(() =>
      document.querySelector("caption").classList.contains("rb-el-blur"));
    check(captionBlurred, "click-to-blur blurs the clicked element");

    await page.reload();
    await sleep(1500);
    const captionStillBlurred = await page.evaluate(() =>
      document.querySelector("caption").classList.contains("rb-el-blur"));
    check(captionStillBlurred, "click-to-blur persists across reload");
    await page.screenshot({ path: path.join(DOCS, "e2e-gradebook-click-blur.png") });

    // ================= Panic =================
    await sw.evaluate(async (id) => {
      await chrome.tabs.sendMessage(id, { type: "rb-command", command: "panic-blur" });
    }, tabId);
    await sleep(400);
    const panicOn = await page.evaluate(() => !!document.querySelector('[data-rb="panic"]'));
    check(panicOn, "panic overlay covers the page");
    await page.screenshot({ path: path.join(DOCS, "e2e-panic.png") });
    await sw.evaluate(async (id) => {
      await chrome.tabs.sendMessage(id, { type: "rb-command", command: "panic-blur" });
    }, tabId);

    // ================= Pseudonymize =================
    await sw.evaluate(async () => {
      const data = await chrome.storage.local.get(["rb_settings"]);
      await chrome.storage.local.set({ rb_settings: { ...data.rb_settings, pseudonymize: true } });
    });
    await sleep(1200);
    const pseudo = await page.evaluate(() => {
      const labels = [...document.querySelectorAll('[data-rb-chip="label"]')].map((c) => c.textContent);
      return { count: labels.length, labels: [...new Set(labels)].sort() };
    });
    check(pseudo.count >= 7, "pseudonymize covers the roster names (" + pseudo.count + " chips)");
    check(pseudo.labels.every((l) => /^Student \d+$/.test(l)), "labels look like 'Student N'");
    await page.screenshot({ path: path.join(DOCS, "e2e-gradebook-pseudonymize.png") });
    await sw.evaluate(async () => {
      const data = await chrome.storage.local.get(["rb_settings"]);
      await chrome.storage.local.set({ rb_settings: { ...data.rb_settings, pseudonymize: false } });
    });

    // ================= SPA re-renders =================
    const spa = await context.newPage();
    await spa.goto(pathToFileURL(path.join(FIXTURES, "spa.html")).href);
    await sleep(6500); // all 7 students arrive through repeated re-renders

    let spaAllBlurred = false;
    for (let attempt = 0; attempt < 14 && !spaAllBlurred; attempt++) {
      spaAllBlurred = await spa.evaluate(() => {
        const names = [...document.querySelectorAll(".name")];
        if (names.length < 7) return false;
        return names.every((el) => getComputedStyle(el).filter.includes("blur"));
      });
      if (!spaAllBlurred) await sleep(300);
    }
    check(spaAllBlurred, "SPA: all 7 dynamically re-rendered names blurred");
    const spaAlive = await spa.evaluate(() => {
      const before = document.querySelectorAll(".card").length;
      return new Promise((resolve) =>
        setTimeout(() => resolve(document.querySelectorAll(".card").length >= before), 1500));
    });
    check(spaAlive, "SPA keeps re-rendering (page not crashed)");
    await spa.screenshot({ path: path.join(DOCS, "e2e-spa-dynamic-blur.png") });

    // ================= v2: trial access =================
    // A fresh profile gets an install stamp on onInstalled; with no
    // license stored, access resolves to the 7-day trial.
    const trial = await sw.evaluate(async () => {
      const data = await chrome.storage.local.get(["rb_install"]);
      const access = await RB.getAccess();
      return {
        stamped: !!(data.rb_install && data.rb_install.at),
        source: access.source,
        daysLeft: access.trial.daysLeft
      };
    });
    check(trial.stamped, "install record stamped for the trial clock");
    if (process.env.RB_E2E_LICENSE) {
      check(trial.source === "license", "getAccess resolves license access");
    } else {
      check(trial.source === "trial" && trial.daysLeft === 7,
        "getAccess resolves a fresh 7-day trial (" + trial.daysLeft + " days left)");
    }

    // ================= v2: presentation shield =================
    await page.bringToFront();
    await sw.evaluate(async () => {
      await chrome.storage.local.set({ rb_shield: { active: true } });
    });
    await sleep(900);
    const shieldMasked = await page.evaluate(() => document.title === "Untitled");
    check(shieldMasked, "shield masks the tab title without a per-site mask");

    // Roster blur must stay on under the shield even with the setting off.
    await sw.evaluate(async () => {
      const data = await chrome.storage.local.get(["rb_settings"]);
      await chrome.storage.local.set({ rb_settings: { ...data.rb_settings, rosterEnabled: false } });
    });
    await sleep(1200);
    const shieldRoster = await page.evaluate(() => {
      const td = [...document.querySelectorAll("td")].find((el) => el.textContent.trim() === "Jordan Smith");
      return !!td && getComputedStyle(td).filter.includes("blur");
    });
    check(shieldRoster, "shield keeps roster blur on with the setting off");

    await sw.evaluate(async () => {
      const data = await chrome.storage.local.get(["rb_settings"]);
      await chrome.storage.local.set({
        rb_shield: { active: false },
        rb_settings: { ...data.rb_settings, rosterEnabled: true }
      });
    });
    await sleep(900);
    const titleRestored = await page.evaluate(() => document.title !== "Untitled");
    check(titleRestored, "disarming the shield restores the tab title");

    // ================= v2: capture roster from page =================
    await sw.evaluate(async (id) => {
      await chrome.tabs.sendMessage(id, { type: "rb-command", command: "capture-names" });
    }, tabId);
    await sleep(400);
    await page.click("table tbody tr td");
    await sleep(600);
    const panelText = await page.evaluate(() => {
      const el = document.querySelector('[data-rb="capture"]');
      return el ? el.textContent : "";
    });
    check(/Found \d+ student names/.test(panelText),
      "capture preview panel found names");
    await page.evaluate(() => {
      const el = document.querySelector('[data-rb="capture"]');
      const btn = [...el.querySelectorAll("button")].find((b) => b.textContent === "Save roster");
      btn.click();
    });
    await sleep(700);
    const rosterCount = await sw.evaluate(async () =>
      (await chrome.storage.local.get(["rb_rosters"])).rb_rosters.length);
    check(rosterCount === 2, "captured roster saved as a second roster");

    // ================= v2: hidden-name stats =================
    const stats = await sw.evaluate(async () =>
      (await chrome.storage.local.get(["rb_stats"])).rb_stats || {});
    check((stats.total || 0) > 0, "hidden-name counters accumulated (" + (stats.total || 0) + " total)");

    // ================= Popup + options for the record =================
    const popup = await context.newPage();
    await popup.goto("chrome-extension://" + extensionId + "/popup.html");
    await sleep(600);
    await popup.screenshot({ path: path.join(DOCS, "popup.png") });
    await popup.close();

    const options = await context.newPage();
    await options.goto("chrome-extension://" + extensionId + "/options.html");
    await sleep(800);
    await options.screenshot({ path: path.join(DOCS, "options.png"), fullPage: true });
    await options.close();

    // ================= Zero network =================
    check(netRequests.length === 0,
      "zero http(s) requests from extension or fixture pages" +
      (netRequests.length ? " (saw: " + netRequests.slice(0, 5).join(", ") + ")" : ""));

    console.log(failures === 0 ? "\nE2E: all checks passed" : "\nE2E: " + failures + " check(s) FAILED");
  } finally {
    await context.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* profile lock */ }
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("E2E crashed:", e);
  process.exit(1);
});
