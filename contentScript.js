// RosterBlur content script. Runs on every page and frame.
//
// Hard rules this file lives by:
// - Never rewrite or wrap the page's text nodes. Matched names get a
//   CSS class on a small containing element, or a positioned overlay
//   chip; SPA frameworks never notice us.
// - No network. Everything reads from chrome.storage.local.
// - Scanning stays cheap: debounced MutationObserver, subtree-scoped
//   rescans, no per-keystroke full-page work.

(() => {
  "use strict";
  if (window.__rosterBlurLoaded) return;
  window.__rosterBlurLoaded = true;

  const IS_TOP = window === window.top;
  const HOST = location.hostname;

  const MAX_CLASS_BLUR_TEXT = 60; // parent text budget for class blur
  const SCAN_DEBOUNCE_MS = 250;
  const REPOSITION_DEBOUNCE_MS = 120;
  const INPUT_DEBOUNCE_MS = 300;

  const state = {
    settings: { ...RB.DEFAULT_SETTINGS },
    pro: false,
    meetingActive: false,
    matcher: null,
    pseudo: null,
    site: { selectors: [], areas: [], mask: false },
    picking: false,
    drawingArea: false,
    panic: false,
    maskSaved: null // { title, icons: [{el, href}] }
  };

  // Overlay chip registry: one entry per matched occurrence.
  // { node, start, end, kind: "blur"|"label", label, chips: [el] }
  let overlays = [];
  const classMarked = new Set(); // elements carrying rb-name-blur
  const inputMarked = new Set(); // inputs carrying rb-name-blur

  // =========================
  // Styles (CSP-proof)
  // =========================
  // adoptedStyleSheets bypasses page style-src CSP; chip geometry is
  // set through the CSSOM which CSP never blocks.

  const CSS_TEXT = `
    .rb-name-blur, .rb-el-blur {
      filter: blur(var(--rb-blur, 8px)) !important;
    }
    html.rb-picking, html.rb-picking * { cursor: crosshair !important; }
    .rb-hover-target { outline: 2px dashed #6366f1 !important; outline-offset: 1px !important; }
    html.rb-picking [data-rb-area] { pointer-events: auto !important; outline: 1px dashed rgba(99, 102, 241, 0.9); }
    html.rb-picking [data-rb-area]:hover { outline: 2px solid #ef4444 !important; }
  `;

  const installStyles = () => {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS_TEXT);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    } catch {
      try {
        const el = document.createElement("style");
        el.setAttribute("data-rb", "style");
        el.textContent = CSS_TEXT;
        (document.head || document.documentElement).appendChild(el);
      } catch { /* page too locked down; classes just do nothing */ }
    }
  };

  const applyBlurVar = () => {
    try {
      document.documentElement.style.setProperty("--rb-blur", state.settings.blurPx + "px");
    } catch { /* ignore */ }
  };

  // =========================
  // Overlay container
  // =========================
  // Lives on documentElement, outside body, so SPA body swaps cannot
  // wipe it. Chips use page coordinates.

  let overlayRoot = null;

  const getOverlayRoot = () => {
    if (overlayRoot && overlayRoot.isConnected) return overlayRoot;
    overlayRoot = document.createElement("div");
    overlayRoot.setAttribute("data-rb", "overlays");
    const s = overlayRoot.style;
    s.position = "absolute";
    s.left = "0";
    s.top = "0";
    s.width = "0";
    s.height = "0";
    s.zIndex = "2147483644";
    document.documentElement.appendChild(overlayRoot);
    return overlayRoot;
  };

  const insideOurUi = (node) => {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    return !!(el && el.closest && el.closest("[data-rb]"));
  };

  // =========================
  // Chip building
  // =========================

  const pageRect = (rect) => ({
    x: rect.left + window.scrollX,
    y: rect.top + window.scrollY,
    w: rect.width,
    h: rect.height
  });

  const styleBlurChip = (chip, r) => {
    const s = chip.style;
    s.position = "absolute";
    s.left = (r.x - 3) + "px";
    s.top = (r.y - 2) + "px";
    s.width = (r.w + 6) + "px";
    s.height = (r.h + 4) + "px";
    s.pointerEvents = "none";
    s.borderRadius = "3px";
    s.backdropFilter = "blur(var(--rb-blur, 8px))";
    s.webkitBackdropFilter = "blur(var(--rb-blur, 8px))";
    s.background = "rgba(128, 128, 128, 0.08)";
  };

  const bgLuminance = (el) => {
    let node = el;
    while (node && node.nodeType === 1) {
      const bg = getComputedStyle(node).backgroundColor;
      const m = bg && bg.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
      if (m && (m[4] === undefined || parseFloat(m[4]) > 0.4)) {
        return { bg, lum: (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) / 255 };
      }
      node = node.parentElement;
    }
    return { bg: "#ffffff", lum: 1 };
  };

  const styleLabelChip = (chip, r, label, refEl) => {
    const { bg, lum } = bgLuminance(refEl);
    const font = refEl ? getComputedStyle(refEl) : null;
    const s = chip.style;
    s.position = "absolute";
    s.left = (r.x - 1) + "px";
    s.top = (r.y - 1) + "px";
    s.minWidth = (r.w + 2) + "px";
    s.height = (r.h + 2) + "px";
    s.pointerEvents = "none";
    s.display = "flex";
    s.alignItems = "center";
    s.overflow = "hidden";
    s.whiteSpace = "nowrap";
    s.borderRadius = "3px";
    s.background = bg;
    s.color = lum > 0.55 ? "#374151" : "#d1d5db";
    if (font) {
      s.fontFamily = font.fontFamily;
      s.fontSize = font.fontSize;
      s.fontWeight = font.fontWeight;
    }
    chip.textContent = label;
  };

  const buildChips = (entry) => {
    const root = getOverlayRoot();
    const range = document.createRange();
    try {
      range.setStart(entry.node, entry.start);
      range.setEnd(entry.node, entry.end);
    } catch {
      return false;
    }
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    if (!rects.length) return false;
    entry.chips = rects.map((rect) => {
      const chip = document.createElement("div");
      chip.setAttribute("data-rb-chip", entry.kind);
      const r = pageRect(rect);
      if (entry.kind === "label") styleLabelChip(chip, r, entry.label, entry.node.parentElement);
      else styleBlurChip(chip, r);
      root.appendChild(chip);
      return chip;
    });
    return true;
  };

  const dropEntry = (entry) => {
    for (const chip of entry.chips || []) chip.remove();
    entry.chips = [];
  };

  const repositionAll = () => {
    overlays = overlays.filter((entry) => {
      if (!entry.node.isConnected) { dropEntry(entry); return false; }
      dropEntry(entry);
      return buildChips(entry);
    });
  };

  // =========================
  // Scanning
  // =========================

  const rosterOn = () =>
    state.pro && state.matcher && !state.matcher.isEmpty &&
    (state.settings.rosterEnabled || state.meetingActive);

  const patternsOn = () =>
    state.pro && Object.values(state.settings.patterns || {}).some(Boolean);

  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE", "KBD", "SAMP", "TEXTAREA", "TITLE"]);

  const skipNode = (textNode) => {
    let el = textNode.parentElement;
    while (el) {
      if (SKIP_TAGS.has(el.tagName)) return true;
      if (el.hasAttribute && (el.hasAttribute("data-rb") || el.hasAttribute("data-rb-chip") || el.hasAttribute("data-rb-area"))) return true;
      el = el.parentElement;
    }
    return false;
  };

  const alreadyCovered = (node, start, end) =>
    overlays.some((o) => o.node === node && o.start === start && o.end === end);

  const treatMatch = (node, m, useLabel) => {
    const parent = node.parentElement;
    if (!parent) return;
    const matchLen = m.end - m.start;
    const parentTextLen = (parent.textContent || "").trim().length;

    if (!useLabel && parentTextLen <= Math.max(matchLen + 12, MAX_CLASS_BLUR_TEXT) && parentTextLen > 0) {
      parent.classList.add("rb-name-blur");
      classMarked.add(parent);
      return;
    }
    if (alreadyCovered(node, m.start, m.end)) return;
    const entry = {
      node,
      start: m.start,
      end: m.end,
      kind: useLabel ? "label" : "blur",
      label: useLabel ? state.pseudo.labelFor(m.student) : "",
      chips: []
    };
    if (buildChips(entry)) overlays.push(entry);
  };

  const scanTextNode = (node) => {
    const text = node.nodeValue;
    if (!text || text.length < 3) return;
    if (rosterOn()) {
      for (const m of RB.findMatches(state.matcher, text)) {
        treatMatch(node, m, state.settings.pseudonymize);
      }
    }
    if (patternsOn()) {
      for (const m of RB.findPatternMatches(state.settings.patterns, text)) {
        treatMatch(node, m, false);
      }
    }
  };

  const checkInput = (el) => {
    if (!rosterOn() && !patternsOn()) return;
    const value = el.value || "";
    let hit = false;
    if (value.length >= 3) {
      if (rosterOn() && RB.findMatches(state.matcher, value).length) hit = true;
      if (!hit && patternsOn() && RB.findPatternMatches(state.settings.patterns, value).length) hit = true;
    }
    if (hit) {
      el.classList.add("rb-name-blur");
      inputMarked.add(el);
    } else if (inputMarked.has(el)) {
      el.classList.remove("rb-name-blur");
      inputMarked.delete(el);
    }
  };

  const scanRoot = (root) => {
    if (!rosterOn() && !patternsOn()) return;
    if (!root || insideOurUi(root)) return;

    if (root.nodeType === 3) { // bare text node from characterData
      if (!skipNode(root)) scanTextNode(root);
      return;
    }
    if (root.nodeType !== 1 && root.nodeType !== 9) return;

    const doc = root.nodeType === 9 ? root : root.ownerDocument;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.nodeValue && node.nodeValue.length >= 3 && !skipNode(node)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) scanTextNode(node);

    if (root.querySelectorAll) {
      for (const el of root.querySelectorAll("input, textarea")) checkInput(el);
      if (root.matches && root.matches("input, textarea")) checkInput(root);
    }
  };

  const clearNameArtifacts = () => {
    for (const el of classMarked) el.classList && el.classList.remove("rb-name-blur");
    classMarked.clear();
    for (const el of inputMarked) el.classList && el.classList.remove("rb-name-blur");
    inputMarked.clear();
    for (const entry of overlays) dropEntry(entry);
    overlays = [];
  };

  const fullRescan = () => {
    clearNameArtifacts();
    if (document.body) scanRoot(document.body);
  };

  // =========================
  // Mutation handling
  // =========================

  let pendingRoots = new Set();
  let scanTimer = null;

  const queueScan = (root) => {
    pendingRoots.add(root);
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      const roots = pendingRoots;
      pendingRoots = new Set();
      // Purge overlays whose anchors died in this batch.
      overlays = overlays.filter((entry) => {
        if (!entry.node.isConnected) { dropEntry(entry); return false; }
        return true;
      });
      for (const root of roots) {
        if (root === document.body) { fullRescan(); return; }
        scanRoot(root);
      }
      applySiteSelectors();
    }, SCAN_DEBOUNCE_MS);
  };

  const startObserver = () => {
    const observer = new MutationObserver((records) => {
      let any = false;
      for (const rec of records) {
        if (insideOurUi(rec.target)) continue;
        if (rec.type === "characterData") {
          any = true;
          queueScan(rec.target);
        } else if (rec.type === "childList" && rec.addedNodes.length) {
          for (const node of rec.addedNodes) {
            if (insideOurUi(node)) continue;
            if (node.nodeType === 1 || node.nodeType === 3) {
              any = true;
              queueScan(node.nodeType === 1 ? node : (node.parentElement || node));
            }
          }
        }
      }
      if (any && state.site.mask) enforceTitleMask();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  };

  let repositionTimer = null;
  const queueReposition = () => {
    if (!overlays.length || repositionTimer) return;
    repositionTimer = setTimeout(() => {
      repositionTimer = null;
      repositionAll();
    }, REPOSITION_DEBOUNCE_MS);
  };

  const inputTimers = new WeakMap();
  const onInputEvent = (e) => {
    const el = e.target;
    if (!el || (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA")) return;
    clearTimeout(inputTimers.get(el));
    inputTimers.set(el, setTimeout(() => checkInput(el), INPUT_DEBOUNCE_MS));
  };

  // =========================
  // Click-to-blur picker
  // =========================

  let hoverEl = null;
  let pickerToast = null;

  const cssPath = (el) => {
    if (el.id && document.querySelectorAll("#" + CSS.escape(el.id)).length === 1) {
      return "#" + CSS.escape(el.id);
    }
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body && parts.length < 8) {
      let part = node.localName;
      if (node.id) {
        parts.unshift("#" + CSS.escape(node.id));
        return parts.length > 1 ? parts.join(" > ") : parts[0];
      }
      const parent = node.parentElement;
      if (parent) {
        const same = Array.prototype.filter.call(parent.children, (c) => c.localName === node.localName);
        if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      node = parent;
    }
    return (node === document.body ? "body > " : "") + parts.join(" > ");
  };

  const showToast = (text) => {
    hideToast();
    pickerToast = document.createElement("div");
    pickerToast.setAttribute("data-rb", "toast");
    const s = pickerToast.style;
    s.position = "fixed";
    s.top = "12px";
    s.left = "50%";
    s.transform = "translateX(-50%)";
    s.zIndex = "2147483646";
    s.background = "rgba(23, 18, 56, 0.95)";
    s.color = "#e0e7ff";
    s.font = "13px/1.4 system-ui, sans-serif";
    s.padding = "8px 14px";
    s.borderRadius = "8px";
    s.boxShadow = "0 4px 14px rgba(0, 0, 0, 0.35)";
    s.pointerEvents = "none";
    pickerToast.textContent = text;
    document.documentElement.appendChild(pickerToast);
  };

  const hideToast = () => {
    if (pickerToast) { pickerToast.remove(); pickerToast = null; }
  };

  const onPickerMove = (e) => {
    const target = e.target;
    if (hoverEl === target) return;
    if (hoverEl) hoverEl.classList.remove("rb-hover-target");
    hoverEl = null;
    if (!target || target.nodeType !== 1 || insideOurUi(target)) return;
    if (target === document.body || target === document.documentElement) return;
    hoverEl = target;
    hoverEl.classList.add("rb-hover-target");
  };

  const onPickerClick = (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    const target = e.target;
    if (!target || target.nodeType !== 1) return;
    if (target.hasAttribute && target.hasAttribute("data-rb-area")) {
      removeAreaChip(target);
      return;
    }
    if (insideOurUi(target)) return;
    toggleElementBlur(target);
  };

  const onPickerKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      setPicking(false);
    }
  };

  const toggleElementBlur = (el) => {
    if (el.classList.contains("rb-el-blur")) {
      el.classList.remove("rb-el-blur");
      state.site.selectors = state.site.selectors.filter((sel) => {
        try { return !el.matches(sel); } catch { return true; }
      });
    } else {
      el.classList.add("rb-el-blur");
      const sel = cssPath(el);
      if (sel && !state.site.selectors.includes(sel)) state.site.selectors.push(sel);
    }
    RB.setSiteState(HOST, state.site);
  };

  const setPicking = (on) => {
    if (state.picking === on) return;
    state.picking = on;
    const doc = document.documentElement;
    if (on) {
      setDrawingArea(false);
      doc.classList.add("rb-picking");
      document.addEventListener("mousemove", onPickerMove, true);
      document.addEventListener("click", onPickerClick, true);
      document.addEventListener("keydown", onPickerKey, true);
      showToast("Click anything to blur or unblur it. Click a blurred area to remove it. Esc exits.");
    } else {
      doc.classList.remove("rb-picking");
      document.removeEventListener("mousemove", onPickerMove, true);
      document.removeEventListener("click", onPickerClick, true);
      document.removeEventListener("keydown", onPickerKey, true);
      if (hoverEl) { hoverEl.classList.remove("rb-hover-target"); hoverEl = null; }
      hideToast();
    }
  };

  // =========================
  // Area blur
  // =========================

  let areaVeil = null;
  let areaGhost = null;
  let areaStart = null;

  const renderAreaChip = (area) => {
    const chip = document.createElement("div");
    chip.setAttribute("data-rb-area", "1");
    const s = chip.style;
    s.position = "absolute";
    s.left = area.x + "px";
    s.top = area.y + "px";
    s.width = area.w + "px";
    s.height = area.h + "px";
    s.zIndex = "2147483644";
    s.pointerEvents = "none";
    s.borderRadius = "4px";
    s.backdropFilter = "blur(calc(var(--rb-blur, 8px) * 1.5))";
    s.webkitBackdropFilter = "blur(calc(var(--rb-blur, 8px) * 1.5))";
    s.background = "rgba(128, 128, 128, 0.06)";
    chip.__rbArea = area;
    getOverlayRoot().appendChild(chip);
  };

  const renderAllAreas = () => {
    for (const el of getOverlayRoot().querySelectorAll("[data-rb-area]")) el.remove();
    for (const area of state.site.areas) renderAreaChip(area);
  };

  const removeAreaChip = (chipEl) => {
    const area = chipEl.__rbArea;
    state.site.areas = state.site.areas.filter((a) => a !== area);
    chipEl.remove();
    RB.setSiteState(HOST, state.site);
  };

  const setDrawingArea = (on) => {
    if (state.drawingArea === on) return;
    state.drawingArea = on;
    if (on) {
      setPicking(false);
      areaVeil = document.createElement("div");
      areaVeil.setAttribute("data-rb", "veil");
      const s = areaVeil.style;
      s.position = "fixed";
      s.inset = "0";
      s.zIndex = "2147483646";
      s.cursor = "crosshair";
      s.background = "rgba(99, 102, 241, 0.06)";
      areaVeil.addEventListener("mousedown", onAreaDown);
      document.addEventListener("keydown", onAreaKey, true);
      document.documentElement.appendChild(areaVeil);
      showToast("Drag a rectangle to blur that area. Esc cancels.");
    } else {
      if (areaVeil) { areaVeil.remove(); areaVeil = null; }
      if (areaGhost) { areaGhost.remove(); areaGhost = null; }
      document.removeEventListener("keydown", onAreaKey, true);
      areaStart = null;
      hideToast();
    }
  };

  const onAreaKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      setDrawingArea(false);
    }
  };

  const onAreaDown = (e) => {
    e.preventDefault();
    areaStart = { x: e.clientX, y: e.clientY };
    areaGhost = document.createElement("div");
    areaGhost.setAttribute("data-rb", "ghost");
    const s = areaGhost.style;
    s.position = "fixed";
    s.border = "2px dashed #6366f1";
    s.background = "rgba(99, 102, 241, 0.15)";
    s.zIndex = "2147483647";
    s.pointerEvents = "none";
    document.documentElement.appendChild(areaGhost);
    areaVeil.addEventListener("mousemove", onAreaMove);
    areaVeil.addEventListener("mouseup", onAreaUp);
    onAreaMove(e);
  };

  const onAreaMove = (e) => {
    if (!areaStart || !areaGhost) return;
    const x = Math.min(areaStart.x, e.clientX);
    const y = Math.min(areaStart.y, e.clientY);
    const w = Math.abs(e.clientX - areaStart.x);
    const h = Math.abs(e.clientY - areaStart.y);
    const s = areaGhost.style;
    s.left = x + "px";
    s.top = y + "px";
    s.width = w + "px";
    s.height = h + "px";
  };

  const onAreaUp = (e) => {
    if (!areaStart) return;
    const x = Math.min(areaStart.x, e.clientX) + window.scrollX;
    const y = Math.min(areaStart.y, e.clientY) + window.scrollY;
    const w = Math.abs(e.clientX - areaStart.x);
    const h = Math.abs(e.clientY - areaStart.y);
    setDrawingArea(false);
    if (w < 8 || h < 8) return;
    const area = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
    state.site.areas.push(area);
    renderAreaChip(area);
    RB.setSiteState(HOST, state.site);
  };

  // =========================
  // Panic blur
  // =========================

  let panicEl = null;

  const setPanic = (on) => {
    state.panic = on;
    if (on && !panicEl) {
      panicEl = document.createElement("div");
      panicEl.setAttribute("data-rb", "panic");
      const s = panicEl.style;
      s.position = "fixed";
      s.inset = "0";
      s.zIndex = "2147483647";
      s.backdropFilter = "blur(26px) saturate(0.7)";
      s.webkitBackdropFilter = "blur(26px) saturate(0.7)";
      s.background = "rgba(148, 148, 160, 0.28)";
      s.display = "flex";
      s.alignItems = "center";
      s.justifyContent = "center";
      const pill = document.createElement("div");
      const p = pill.style;
      p.background = "rgba(23, 18, 56, 0.92)";
      p.color = "#e0e7ff";
      p.font = "13px/1.4 system-ui, sans-serif";
      p.padding = "10px 18px";
      p.borderRadius = "999px";
      pill.textContent = "Page hidden by RosterBlur. Press Alt+Shift+H to restore.";
      panicEl.appendChild(pill);
      document.documentElement.appendChild(panicEl);
    } else if (!on && panicEl) {
      panicEl.remove();
      panicEl = null;
    }
  };

  // =========================
  // Title and favicon mask
  // =========================

  const NEUTRAL_FAVICON =
    "data:image/svg+xml," +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="6" fill="#9ca3af"/></svg>');

  let settingTitle = false;

  const enforceTitleMask = () => {
    if (!state.site.mask || !IS_TOP) return;
    if (document.title !== "Untitled") {
      if (state.maskSaved) state.maskSaved.title = document.title;
      settingTitle = true;
      document.title = "Untitled";
      settingTitle = false;
    }
  };

  const setMask = (on) => {
    if (!IS_TOP) return;
    state.site.mask = on;
    if (on) {
      state.maskSaved = { title: document.title, icons: [] };
      for (const link of document.querySelectorAll('link[rel~="icon" i], link[rel="shortcut icon" i]')) {
        state.maskSaved.icons.push({ el: link, href: link.getAttribute("href") });
        link.setAttribute("href", NEUTRAL_FAVICON);
      }
      if (!state.maskSaved.icons.length) {
        const link = document.createElement("link");
        link.setAttribute("rel", "icon");
        link.setAttribute("data-rb", "favicon");
        link.setAttribute("href", NEUTRAL_FAVICON);
        (document.head || document.documentElement).appendChild(link);
        state.maskSaved.icons.push({ el: link, href: null, created: true });
      }
      settingTitle = true;
      document.title = "Untitled";
      settingTitle = false;
    } else if (state.maskSaved) {
      settingTitle = true;
      document.title = state.maskSaved.title || document.title;
      settingTitle = false;
      for (const item of state.maskSaved.icons) {
        if (item.created) item.el.remove();
        else if (item.href !== null) item.el.setAttribute("href", item.href);
        else item.el.removeAttribute("href");
      }
      state.maskSaved = null;
    }
  };

  const toggleMaskPersisted = () => {
    setMask(!state.site.mask);
    RB.setSiteState(HOST, state.site);
  };

  // =========================
  // Site persistence (selectors + areas + mask)
  // =========================

  const applySiteSelectors = () => {
    for (const sel of state.site.selectors) {
      try {
        for (const el of document.querySelectorAll(sel)) el.classList.add("rb-el-blur");
      } catch { /* selector no longer valid on this page */ }
    }
  };

  const applySiteState = () => {
    applySiteSelectors();
    if (IS_TOP) {
      renderAllAreas();
      if (state.site.mask) setMask(true);
    }
  };

  const clearSite = async () => {
    for (const el of document.querySelectorAll(".rb-el-blur")) el.classList.remove("rb-el-blur");
    if (state.site.mask) setMask(false);
    state.site = { selectors: [], areas: [], mask: false };
    renderAllAreas();
    await RB.setSiteState(HOST, state.site);
  };

  // =========================
  // Meeting mode indicator
  // =========================

  let indicatorEl = null;

  const updateIndicator = () => {
    const show = IS_TOP && state.meetingActive && state.pro;
    if (show && !indicatorEl) {
      indicatorEl = document.createElement("div");
      indicatorEl.setAttribute("data-rb", "indicator");
      const s = indicatorEl.style;
      s.position = "fixed";
      s.right = "10px";
      s.bottom = "10px";
      s.zIndex = "2147483645";
      s.background = "rgba(23, 18, 56, 0.75)";
      s.color = "#a5b4fc";
      s.font = "11px/1 system-ui, sans-serif";
      s.padding = "5px 9px";
      s.borderRadius = "999px";
      s.pointerEvents = "none";
      s.opacity = "0.75";
      indicatorEl.textContent = "RosterBlur active";
      document.documentElement.appendChild(indicatorEl);
    } else if (!show && indicatorEl) {
      indicatorEl.remove();
      indicatorEl = null;
    }
  };

  // =========================
  // Messages and storage sync
  // =========================

  const counts = () => ({
    names: overlays.length + classMarked.size + inputMarked.size,
    selectors: state.site.selectors.length,
    areas: state.site.areas.length
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "rb-get-state") {
      if (!IS_TOP) return; // only the top frame answers
      sendResponse({
        host: HOST,
        picking: state.picking,
        panic: state.panic,
        mask: state.site.mask,
        meetingActive: state.meetingActive,
        counts: counts()
      });
      return;
    }
    if (!IS_TOP) return;
    if (msg.type === "rb-command") {
      if (msg.command === "toggle-picker") setPicking(!state.picking);
      else if (msg.command === "panic-blur") setPanic(!state.panic);
      else if (msg.command === "draw-area") setDrawingArea(true);
      else if (msg.command === "toggle-mask") toggleMaskPersisted();
      sendResponse({ ok: true, picking: state.picking, panic: state.panic, mask: state.site.mask });
    } else if (msg.type === "rb-clear-site") {
      clearSite().then(() => sendResponse({ ok: true }));
      return true;
    }
  });

  const reloadMatcher = () => {
    RB.getRosters().then((rosters) => {
      const names = RB.enabledNames(rosters);
      state.matcher = RB.buildMatcher(names, { standalone: state.settings.standaloneNames });
      state.pseudo = RB.buildPseudonyms(names);
      fullRescan();
    });
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[RB.STORAGE.SETTINGS]) {
      RB.getSettings().then((s) => {
        state.settings = s;
        applyBlurVar();
        reloadMatcher();
      });
      return;
    }
    if (changes[RB.STORAGE.ROSTERS]) { reloadMatcher(); return; }
    if (changes[RB.STORAGE.PRO_FLAG]) {
      state.pro = !!changes[RB.STORAGE.PRO_FLAG].newValue;
      updateIndicator();
      fullRescan();
      return;
    }
    if (changes[RB.STORAGE.MEETING]) {
      const m = changes[RB.STORAGE.MEETING].newValue || {};
      state.meetingActive = !!m.active;
      updateIndicator();
      fullRescan();
      return;
    }
    if (changes[RB.siteKey(HOST)]) {
      const s = changes[RB.siteKey(HOST)].newValue || { selectors: [], areas: [], mask: false };
      const maskChanged = !!s.mask !== !!state.site.mask;
      state.site = { selectors: s.selectors || [], areas: s.areas || [], mask: !!s.mask };
      if (IS_TOP) {
        renderAllAreas();
        if (maskChanged) setMask(state.site.mask);
      }
      applySiteSelectors();
    }
  });

  // =========================
  // Boot
  // =========================

  const boot = async () => {
    installStyles();

    const [settings, rosters, flags, site] = await Promise.all([
      RB.getSettings(),
      RB.getRosters(),
      RB.storageGet([RB.STORAGE.PRO_FLAG, RB.STORAGE.MEETING]),
      RB.getSiteState(HOST)
    ]);
    state.settings = settings;
    state.pro = !!flags[RB.STORAGE.PRO_FLAG];
    state.meetingActive = !!(flags[RB.STORAGE.MEETING] && flags[RB.STORAGE.MEETING].active);
    state.site = site;

    const names = RB.enabledNames(rosters);
    state.matcher = RB.buildMatcher(names, { standalone: settings.standaloneNames });
    state.pseudo = RB.buildPseudonyms(names);

    applyBlurVar();
    applySiteState();
    updateIndicator();
    if (document.body) scanRoot(document.body);

    startObserver();
    window.addEventListener("scroll", queueReposition, { capture: true, passive: true });
    window.addEventListener("resize", queueReposition, { passive: true });
    document.addEventListener("input", onInputEvent, true);

    if (IS_TOP && RB.isMeetingHost(HOST)) {
      try {
        chrome.runtime.sendMessage({ type: "rb-meeting-hello" });
        window.addEventListener("pagehide", () => {
          try { chrome.runtime.sendMessage({ type: "rb-meeting-bye" }); } catch { /* closing */ }
        });
      } catch { /* extension context gone */ }
    }
  };

  boot();
})();
