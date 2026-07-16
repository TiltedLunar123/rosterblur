// Options page: roster management, matching settings, license, and the
// roster-blur demo shown to free users.

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  let rosters = [];
  let settings = null;
  let access = null; // from RB.getAccess(); .pro covers license OR trial
  let saveTimer = null;

  const pro = () => !!(access && access.pro);
  const licensed = () => !!(access && access.source === "license");

  const uid = () => "r" + Math.random().toString(36).slice(2, 10);

  const flashSaved = () => {
    const el = $("saveFlash");
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 1200);
  };

  const persistRosters = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await RB.storageSet({ [RB.STORAGE.ROSTERS]: rosters });
      flashSaved();
      renderCounts();
    }, 400);
  };

  const persistSettings = async (patch) => {
    settings = { ...settings, ...patch, patterns: { ...settings.patterns, ...(patch.patterns || {}) } };
    await RB.storageSet({ [RB.STORAGE.SETTINGS]: settings });
    flashSaved();
  };

  const openBuy = () => {
    chrome.tabs.create({ url: RB.license.PRO.BUY_URL });
  };

  // =========================
  // Roster UI
  // =========================

  const renderCounts = () => {
    for (const card of document.querySelectorAll(".roster-card")) {
      const roster = rosters.find((r) => r.id === card.dataset.id);
      if (roster) {
        card.querySelector(".roster-count").textContent =
          roster.names.length + " name" + (roster.names.length === 1 ? "" : "s");
      }
    }
  };

  const rosterCard = (roster) => {
    const card = document.createElement("div");
    card.className = "card roster-card";
    card.dataset.id = roster.id;

    const head = document.createElement("div");
    head.className = "roster-head";

    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = roster.enabled;
    enabled.title = "Blur this roster's names";
    enabled.addEventListener("change", () => {
      roster.enabled = enabled.checked;
      persistRosters();
    });

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = roster.name;
    nameInput.placeholder = "Roster name (e.g. Period 3)";
    nameInput.addEventListener("input", () => {
      roster.name = nameInput.value;
      persistRosters();
    });

    const spacer = document.createElement("div");
    spacer.className = "spacer";

    const count = document.createElement("span");
    count.className = "roster-count";

    const del = document.createElement("button");
    del.textContent = "Delete";
    del.addEventListener("click", () => {
      rosters = rosters.filter((r) => r.id !== roster.id);
      card.remove();
      persistRosters();
    });

    head.append(enabled, nameInput, spacer, count, del);

    const names = document.createElement("textarea");
    names.placeholder = "One student per line:\nJordan Smith\nGarcia, Maria\n...";
    names.value = roster.names.join("\n");
    names.addEventListener("input", () => {
      roster.names = RB.parseRoster(names.value);
      persistRosters();
    });

    card.append(head, names);
    return card;
  };

  const renderRosters = () => {
    const list = $("rosterList");
    list.textContent = "";
    for (const roster of rosters) list.appendChild(rosterCard(roster));
    renderCounts();
  };

  const addRoster = (name, names) => {
    const roster = { id: uid(), name: name || "Roster " + (rosters.length + 1), enabled: true, names: names || [] };
    rosters.push(roster);
    $("rosterList").appendChild(rosterCard(roster));
    renderCounts();
    persistRosters();
  };

  // =========================
  // Roster-blur demo (free users)
  // =========================
  // A sample gradebook rendered right on this page so the value of
  // roster auto-blur is visible before buying. Names are fictional.

  const DEMO_STUDENTS = [
    ["Jordan Smith", "A-"],
    ["Maria Garcia", "B+"],
    ["Jose Martinez", "A"],
    ["May Chen", "B"],
    ["Priya Patel", "A"]
  ];

  let demoMode = "blur";

  const renderDemo = () => {
    const tbody = $("demoBody");
    tbody.textContent = "";
    DEMO_STUDENTS.forEach(([name, grade], i) => {
      const tr = document.createElement("tr");
      const nameCell = document.createElement("td");
      if (demoMode === "pseudo") {
        nameCell.textContent = "Student " + (i + 1);
      } else {
        const span = document.createElement("span");
        span.textContent = name;
        if (demoMode === "blur") span.className = "demo-blur";
        nameCell.appendChild(span);
      }
      const gradeCell = document.createElement("td");
      gradeCell.textContent = grade;
      tr.append(nameCell, gradeCell);
      tbody.appendChild(tr);
    });
    for (const btn of document.querySelectorAll("#demoModes button")) {
      const on = btn.dataset.mode === demoMode;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
  };

  // =========================
  // Pro gating
  // =========================

  const applyProUi = () => {
    const trialOn = access.source === "trial";
    $("proBadge").classList.toggle("hidden", !licensed());
    $("headerCta").classList.toggle("hidden", licensed());
    $("headerCta").textContent = trialOn ? "Keep Pro - $15" : "Get Pro";
    $("rosterLock").classList.toggle("hidden", pro());
    $("rosterEditor").classList.toggle("hidden", !pro());
    $("rosterDemo").classList.toggle("hidden", pro());
    $("proPitch").classList.toggle("hidden", licensed());
    $("buyRow").classList.toggle("hidden", licensed());
    $("trialBanner").classList.toggle("hidden", !trialOn);
    if (trialOn) {
      const d = access.trial.daysLeft;
      $("trialBannerDays").textContent =
        "Pro trial: " + d + " day" + (d === 1 ? "" : "s") + " left. ";
    }
  };

  // =========================
  // License
  // =========================

  const setLicenseStatus = (text, cls) => {
    const el = $("licenseStatus");
    el.textContent = text;
    el.className = cls || "muted";
  };

  const tierLabel = (payload) => {
    if (!payload) return "";
    if (payload.tier === "school") return " School license, up to " + (payload.seats || 30) + " teachers.";
    if (payload.tier === "dept") return " Department license, up to " + (payload.seats || 5) + " teachers.";
    return "";
  };

  const refreshLicenseUi = async () => {
    access = await RB.getAccess();
    if (licensed()) {
      const state = await RB.license.getState();
      const when = state.payload && state.payload.iat
        ? new Date(state.payload.iat * 1000).toLocaleDateString()
        : "";
      setLicenseStatus(
        "Pro is active on this browser" + (when ? " (purchased " + when + ")" : "") + "." + tierLabel(state.payload),
        "ok"
      );
      $("keyInput").value = state.key;
    } else if (access.source === "trial") {
      const d = access.trial.daysLeft;
      setLicenseStatus(
        "Pro trial: " + d + " day" + (d === 1 ? "" : "s") + " left. Buy any time and your key slots in right here.",
        "muted"
      );
    } else if (access.trial.endsAt) {
      setLicenseStatus("Your free trial has ended. Your rosters are still saved; a key turns everything back on.", "muted");
    }
    applyProUi();
  };

  const activate = async () => {
    const key = $("keyInput").value.trim();
    if (!key) return setLicenseStatus("Paste the key from your purchase page first.", "bad");
    setLicenseStatus("Checking key...");
    const result = await RB.license.verify(key);
    if (!result.valid) {
      return setLicenseStatus(result.reason || "That key did not verify.", "bad");
    }
    await RB.storageSet({ [RB.STORAGE.LICENSE]: key });
    // The service worker re-verifies and flips the cached pro flag;
    // nudge it in case it was asleep.
    try { chrome.runtime.sendMessage({ type: "rb-refresh-pro" }); } catch { /* fine */ }
    await refreshLicenseUi();
    setLicenseStatus("Pro is active. Add your rosters above and you are set.", "ok");
  };

  // =========================
  // CSV import
  // =========================

  const importCsv = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      const names = RB.parseCsv(String(reader.result || ""));
      if (!names.length) {
        setLicenseStatus("", "muted");
        alert("No names found in that CSV. Expected first,last columns or a single name column.");
        return;
      }
      const label = file.name.replace(/\.csv$/i, "");
      addRoster(label, names);
    };
    reader.readAsText(file);
  };

  // =========================
  // Deep link (#pro)
  // =========================

  const flashPro = () => {
    const el = $("pro");
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.remove("flash");
    void el.offsetWidth; // restart the animation
    el.classList.add("flash");
  };

  // =========================
  // Boot
  // =========================

  const init = async () => {
    settings = await RB.getSettings();
    rosters = await RB.getRosters();

    $("blurRange").value = settings.blurPx;
    $("blurOut").textContent = settings.blurPx + "px";
    $("standaloneToggle").checked = settings.standaloneNames;
    $("pseudoToggle").checked = settings.pseudonymize;
    $("pseudoStyle").value = settings.pseudonymStyle || "student";
    $("avatarToggle").checked = settings.blurAvatars;
    $("gradeToggle").checked = settings.blurGrades;
    $("excludeNames").value = (settings.excludeNames || []).join("\n");
    $("patEmail").checked = settings.patterns.email;
    $("patPhone").checked = settings.patterns.phone;
    $("patId").checked = settings.patterns.studentId;

    renderRosters();
    renderDemo();
    await refreshLicenseUi();

    $("blurRange").addEventListener("input", () => {
      $("blurOut").textContent = $("blurRange").value + "px";
    });
    $("blurRange").addEventListener("change", () => persistSettings({ blurPx: Number($("blurRange").value) }));
    $("standaloneToggle").addEventListener("change", () => persistSettings({ standaloneNames: $("standaloneToggle").checked }));
    $("pseudoToggle").addEventListener("change", () => persistSettings({ pseudonymize: $("pseudoToggle").checked }));
    $("pseudoStyle").addEventListener("change", () => persistSettings({ pseudonymStyle: $("pseudoStyle").value }));
    $("avatarToggle").addEventListener("change", () => persistSettings({ blurAvatars: $("avatarToggle").checked }));
    $("gradeToggle").addEventListener("change", () => persistSettings({ blurGrades: $("gradeToggle").checked }));
    $("excludeNames").addEventListener("input", () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        persistSettings({ excludeNames: RB.parseRoster($("excludeNames").value) });
      }, 400);
    });
    $("patEmail").addEventListener("change", () => persistSettings({ patterns: { email: $("patEmail").checked } }));
    $("patPhone").addEventListener("change", () => persistSettings({ patterns: { phone: $("patPhone").checked } }));
    $("patId").addEventListener("change", () => persistSettings({ patterns: { studentId: $("patId").checked } }));

    $("addRosterBtn").addEventListener("click", () => addRoster());
    $("importCsvBtn").addEventListener("click", () => $("csvFile").click());
    $("csvFile").addEventListener("change", () => {
      const file = $("csvFile").files[0];
      if (file) importCsv(file);
      $("csvFile").value = "";
    });

    $("demoModes").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-mode]");
      if (!btn) return;
      demoMode = btn.dataset.mode;
      renderDemo();
    });

    $("buyBtn").addEventListener("click", openBuy);
    $("demoBuyBtn").addEventListener("click", openBuy);
    $("trialBannerBuy").addEventListener("click", openBuy);
    $("buyDeptBtn").addEventListener("click", () => {
      chrome.tabs.create({ url: RB.license.PRO.BUY_URL_DEPT });
    });
    $("buySchoolBtn").addEventListener("click", () => {
      chrome.tabs.create({ url: RB.license.PRO.BUY_URL_SCHOOL });
    });
    $("activateBtn").addEventListener("click", activate);
    $("keyInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") activate();
    });

    if (location.hash === "#pro") setTimeout(flashPro, 150);
    window.addEventListener("hashchange", () => {
      if (location.hash === "#pro") flashPro();
    });
  };

  init();
})();
