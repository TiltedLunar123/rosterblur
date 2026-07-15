// RosterBlur shared library. Loaded by the service worker
// (importScripts), the content script, the popup, and the options page.
// Everything lives under the single RB namespace.
//
// Design constraints that shape this file:
// - The extension makes zero network requests. License keys are
//   verified offline against the embedded public key below.
// - Roster names never leave chrome.storage.local.
// - Matching never rewrites page text nodes; callers only read match
//   positions and decorate around them.

const RB = (() => {
  "use strict";

  // =========================
  // Constants and storage keys
  // =========================

  const STORAGE = Object.freeze({
    SETTINGS: "rb_settings",
    ROSTERS: "rb_rosters",
    LICENSE: "rb_license",
    PRO_FLAG: "rb_pro",
    MEETING: "rb_meeting",
    INSTALL: "rb_install",
    SHIELD: "rb_shield",
    STATS: "rb_stats",
    REVIEW: "rb_review",
    SITE_PREFIX: "rb_site_"
  });

  const DEFAULT_SETTINGS = Object.freeze({
    blurPx: 8,
    rosterEnabled: true,
    pseudonymize: false,
    pseudonymStyle: "student", // "student" -> Student 1; "names" -> fictional names
    standaloneNames: false,
    blurAvatars: false,
    blurGrades: false,
    excludeNames: Object.freeze([]),
    patterns: Object.freeze({ email: true, phone: false, studentId: false })
  });

  const PRO = Object.freeze({
    PRICE_LABEL: "$15 lifetime",
    BUY_URL: "https://buy.stripe.com/6oU9AUg6Ld3Q4YU9VNdUY01",
    ACTIVATE_URL: "https://rosterblur-pro.netlify.app/activate",
    SUPPORT_EMAIL: "support@secplusmastery.com",
    STORAGE_KEY: STORAGE.LICENSE
  });

  // Hosts that flip meeting mode on. Subdomain-anchored, never
  // substring matched, so "notzoom.us.evil.com" stays out.
  const MEETING_HOSTS = Object.freeze([
    "meet.google.com",
    "zoom.us",
    "teams.microsoft.com",
    "teams.live.com"
  ]);

  const isMeetingHost = (host) => {
    const h = String(host || "").toLowerCase();
    return MEETING_HOSTS.some((m) => h === m || h.endsWith("." + m));
  };

  // =========================
  // Text folding
  // =========================
  // Matching is case-insensitive and diacritics-insensitive. To keep
  // match indices valid on the ORIGINAL string, folding is done one
  // character at a time and always yields exactly one character:
  // "Jose" finds "José" without any index bookkeeping.

  const QUOTE_FOLD = Object.freeze({ "‘": "'", "’": "'", "ʼ": "'" });

  const foldChar = (ch) => {
    if (QUOTE_FOLD[ch]) return QUOTE_FOLD[ch];
    const de = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return de.length === 1 ? de : ch;
  };

  const foldText = (text) => {
    const s = String(text);
    let out = "";
    for (const ch of s) out += ch.length === 1 ? foldChar(ch) : ch;
    // Surrogate pairs pass through untouched (ch.length === 2), which
    // preserves both indices and emoji.
    return out;
  };

  const collapseSpaces = (s) => String(s).replace(/\s+/g, " ").trim();

  // "Last, First" roster entries normalize to "First Last" once, at
  // parse time, so the matcher only ever reasons about one shape.
  const normalizeRosterName = (raw) => {
    let name = collapseSpaces(raw);
    const m = name.match(/^([^,]+),\s*(.+)$/);
    if (m) name = collapseSpaces(m[2] + " " + m[1]);
    return name;
  };

  // Canonical form used as the identity of a student for pseudonym
  // lookup: folded, lowercased, single-spaced, comma order fixed.
  const canonicalName = (raw) => {
    let s = collapseSpaces(foldText(String(raw)).toLowerCase());
    const m = s.match(/^([^,]+),\s*(.+)$/);
    if (m) s = collapseSpaces(m[2] + " " + m[1]);
    return s;
  };

  // =========================
  // Roster and CSV parsing
  // =========================

  const MAX_ROSTER_NAMES = 1000;

  const parseRoster = (text) => {
    const seen = new Set();
    const names = [];
    for (const rawLine of String(text || "").split(/\r\n|\r|\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const name = normalizeRosterName(line);
      if (name.length < 3) continue;
      const key = canonicalName(name);
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(name);
      if (names.length >= MAX_ROSTER_NAMES) break;
    }
    return names;
  };

  // Minimal CSV field splitter with double-quote support. Handles the
  // simple exports gradebooks produce; anything stranger degrades to
  // whole-line names rather than throwing.
  const splitCsvLine = (line, delim) => {
    const fields = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQuotes = false;
        } else cur += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delim) {
        fields.push(cur); cur = "";
      } else {
        cur += ch;
      }
    }
    fields.push(cur);
    return fields.map((f) => f.trim());
  };

  const detectDelimiter = (line) => {
    const counts = [
      [",", (line.match(/,/g) || []).length],
      [";", (line.match(/;/g) || []).length],
      ["\t", (line.match(/\t/g) || []).length]
    ].sort((a, b) => b[1] - a[1]);
    return counts[0][1] > 0 ? counts[0][0] : ",";
  };

  // Accepts: a first,last pair of columns (with or without a header
  // row), or a single name column. Extra columns are ignored. Returns
  // the same normalized name list parseRoster produces.
  const parseCsv = (text) => {
    const lines = String(text || "").split(/\r\n|\r|\n/).filter((l) => l.trim() !== "");
    if (!lines.length) return [];
    const delim = detectDelimiter(lines[0]);
    const rows = lines.map((l) => splitCsvLine(l, delim));

    const header = rows[0].map((h) => h.toLowerCase().replace(/["']/g, "").trim());
    const firstCol = header.findIndex((h) => /^(first|given)[\s_-]?(name)?$/.test(h));
    const lastCol = header.findIndex((h) => /^(last|sur|family)[\s_-]?(name)?$/.test(h));
    const nameCol = header.findIndex((h) => /^(full[\s_-]?name|name|student|student[\s_-]?name)$/.test(h));

    let dataRows = rows;
    let toName;
    if (firstCol >= 0 && lastCol >= 0) {
      dataRows = rows.slice(1);
      toName = (r) => ((r[firstCol] || "") + " " + (r[lastCol] || "")).trim();
    } else if (nameCol >= 0) {
      dataRows = rows.slice(1);
      toName = (r) => r[nameCol] || "";
    } else if (rows[0].length >= 2) {
      // Headerless two-column export: assume first,last order.
      toName = (r) => ((r[0] || "") + " " + (r[1] || "")).trim();
    } else {
      toName = (r) => r[0] || "";
    }

    return parseRoster(dataRows.map(toName).join("\n"));
  };

  // =========================
  // Roster capture
  // =========================
  // Turns the text lines under a clicked page element into a roster.
  // Deliberately strict: it is easier for a teacher to add a missed
  // name than to prune UI junk out of a sloppy capture.

  const CAPTURE_STOPWORDS = new Set([
    "student", "students", "name", "names", "first", "last", "grade", "grades",
    "email", "score", "scores", "average", "total", "period", "class", "classes",
    "teacher", "teachers", "room", "date", "assignment", "assignments", "due",
    "missing", "late", "absent", "present", "tardy", "days", "view", "edit",
    "add", "remove", "all", "search", "sort", "filter", "actions", "status",
    "points", "percent", "letter", "overall", "section", "group", "roster",
    "invite", "settings", "more", "menu", "select", "export", "import", "none",
    "google", "classroom", "canvas", "powerschool", "schoology", "synergy"
  ]);

  const NAME_WORD_RE = /^\p{Lu}[\p{L}'’.-]*$/u;

  const looksLikeName = (line) => {
    let s = collapseSpaces(line);
    if (s.length < 4 || s.length > 40) return false;
    if (/[\d@]/.test(s)) return false;
    const comma = s.match(/^([^,]+),\s*(.+)$/);
    if (comma) s = collapseSpaces(comma[2] + " " + comma[1]);
    if (/[,;:!?()[\]{}"]/.test(s)) return false;
    const words = s.split(" ");
    if (words.length < 2 || words.length > 4) return false;
    for (const word of words) {
      if (!NAME_WORD_RE.test(word)) return false;
      if (CAPTURE_STOPWORDS.has(word.toLowerCase().replace(/[.'’-]/g, ""))) return false;
    }
    return true;
  };

  const extractNames = (lines) => {
    const seen = new Set();
    const names = [];
    for (const raw of lines || []) {
      const line = String(raw || "").trim();
      if (!line || !looksLikeName(line)) continue;
      const name = normalizeRosterName(line);
      const key = canonicalName(name);
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(name);
      if (names.length >= MAX_ROSTER_NAMES) break;
    }
    return names;
  };

  // Names a teacher never wants blurred (their own, co-teachers).
  const applyExclusions = (names, excludeList) => {
    const excluded = new Set((excludeList || []).map(canonicalName).filter(Boolean));
    if (!excluded.size) return names || [];
    return (names || []).filter((n) => !excluded.has(canonicalName(n)));
  };

  // =========================
  // Name matcher
  // =========================
  // One compiled regex over folded lowercase alternatives, anchored on
  // both sides so "May" never fires inside "Maybelle". Variants per
  // student: "First Last", "First Middle Last", "Last, First", and
  // (opt-in) standalone parts of 3+ characters.

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const variantPattern = (words) =>
    words.map(escapeRe).join("[\\s\\u00a0]+");

  const buildMatcher = (names, options = {}) => {
    const standalone = !!options.standalone;
    const alternatives = [];
    const lookup = new Map(); // canonical variant -> student index
    const students = [];

    for (const raw of names || []) {
      const name = canonicalName(raw);
      if (name.length < 3) continue;
      if (lookup.has(name)) continue;
      const index = students.length;
      students.push(collapseSpaces(String(raw)));
      const parts = name.split(" ");

      const addVariant = (words) => {
        const key = words.join(" ");
        if (key.length < 3) return;
        if (!lookup.has(key)) lookup.set(key, index);
        alternatives.push(variantPattern(words));
      };

      addVariant(parts);
      if (parts.length > 2) {
        addVariant([parts[0], parts[parts.length - 1]]);
      }
      if (parts.length >= 2) {
        // "Last, First" as it appears in gradebook grids.
        const first = parts[0];
        const last = parts[parts.length - 1];
        const key = last + " , " + first;
        if (!lookup.has(key)) lookup.set(key, index);
        alternatives.push(escapeRe(last) + ",[\\s\\u00a0]*" + escapeRe(first));
      }
      if (standalone) {
        for (const part of parts) {
          if (part.length >= 3) addVariant([part]);
        }
      }
    }

    if (!alternatives.length) {
      return { regex: null, students, resolve: () => -1, isEmpty: true };
    }

    // Longest alternatives first so full names win over single parts.
    alternatives.sort((a, b) => b.length - a.length);
    const source =
      "(?<![\\p{L}\\p{N}])(?:" + alternatives.join("|") + ")(?![\\p{L}\\p{N}])";
    const regex = new RegExp(source, "giu");

    // Resolve a matched substring back to its student index.
    const resolve = (matchedText) => {
      let s = collapseSpaces(foldText(String(matchedText)).toLowerCase());
      const m = s.match(/^([^,]+),\s*(.+)$/);
      if (m) {
        const commaKey = m[1].trim() + " , " + m[2].trim();
        if (lookup.has(commaKey)) return lookup.get(commaKey);
        s = collapseSpaces(m[2] + " " + m[1]);
      }
      return lookup.has(s) ? lookup.get(s) : -1;
    };

    return { regex, students, resolve, isEmpty: false };
  };

  // Find matches in one string. Returns [{start, end, text, student}].
  // The URL guard drops matches living inside a whitespace-delimited
  // token that looks like a link, so a name inside
  // "example.com/maria-lopez" stays untouched.
  const findMatches = (matcher, text) => {
    if (!matcher || matcher.isEmpty || !matcher.regex) return [];
    const original = String(text);
    if (original.length < 3) return [];
    const folded = foldText(original);
    const out = [];
    matcher.regex.lastIndex = 0;
    let m;
    while ((m = matcher.regex.exec(folded)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (looksLikeUrlContext(folded, start, end)) continue;
      out.push({
        start,
        end,
        text: original.slice(start, end),
        student: matcher.resolve(m[0])
      });
      if (m.index === matcher.regex.lastIndex) matcher.regex.lastIndex++;
    }
    return out;
  };

  const looksLikeUrlContext = (text, start, end) => {
    let a = start;
    while (a > 0 && !/\s/.test(text[a - 1])) a--;
    let b = end;
    while (b < text.length && !/\s/.test(text[b])) b++;
    const token = text.slice(a, b);
    return /:\/\//.test(token) || /^www\./i.test(token);
  };

  // =========================
  // Pseudonyms
  // =========================
  // Labels are keyed to the student's position across the enabled
  // rosters, so "Student 3" stays "Student 3" on every page and in
  // every tab for as long as the roster order holds. The "names" style
  // swaps in fictional names so recordings look natural; the list is
  // fixed, so the same student keeps the same fictional name too.

  const FAKE_NAMES = Object.freeze([
    "Avery M.", "Riley P.", "Jordan T.", "Casey L.", "Quinn R.", "Rowan S.",
    "Skyler D.", "Emerson K.", "Finley H.", "Harper W.", "Sage B.", "Reese C.",
    "Dakota J.", "Ellis F.", "Marlowe G.", "Nico V.", "Oakley N.", "Peyton A.",
    "Remy E.", "Shiloh O.", "Tatum I.", "Wren U.", "Blair Y.", "Cameron Z.",
    "Devon Q.", "Hollis X.", "Jules M.", "Kai P.", "Lennon T.", "Micah L."
  ]);

  const pseudoLabel = (index, style) => {
    if (style === "names") {
      const base = FAKE_NAMES[index % FAKE_NAMES.length];
      const round = Math.floor(index / FAKE_NAMES.length);
      return round ? base + " " + (round + 1) : base;
    }
    return "Student " + (index + 1);
  };

  const buildPseudonyms = (students, style = "student") => {
    const labels = new Map();
    (students || []).forEach((name, i) => {
      labels.set(canonicalName(name), pseudoLabel(i, style));
    });
    return {
      labelFor: (nameOrIndex) => {
        if (typeof nameOrIndex === "number") {
          return nameOrIndex >= 0 && nameOrIndex < (students || []).length
            ? pseudoLabel(nameOrIndex, style)
            : "Student";
        }
        return labels.get(canonicalName(nameOrIndex)) || "Student";
      }
    };
  };

  // =========================
  // Grade tokens (Pro)
  // =========================
  // Cell-scoped on purpose: only a table cell whose ENTIRE text is a
  // grade-shaped token ("A-", "95%", "18/20") ever blurs, so ordinary
  // prose with percentages in it stays readable.

  const GRADE_TOKEN_RE = /^(?:[A-F][+-]?|\d{1,3}(?:\.\d+)?\s*%|\d{1,3}(?:\.\d+)?\s*\/\s*\d{1,3}(?:\.\d+)?)$/;

  const isGradeToken = (text) => GRADE_TOKEN_RE.test(collapseSpaces(String(text || "")));

  // =========================
  // Auto-detect patterns (Pro)
  // =========================
  // Deliberately conservative: emails, NANP-style phone numbers, and
  // 5-10 digit runs that look like student ID numbers. Each is its own
  // toggle; each match is blurred, never replaced.

  const PATTERNS = Object.freeze({
    email: {
      label: "Email addresses",
      regex: () => /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}(?![\p{L}\p{N}])/giu
    },
    phone: {
      label: "Phone numbers",
      regex: () => /(?<![\d.-])(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?![\d-])/g
    },
    studentId: {
      label: "Long ID numbers (5-10 digits)",
      regex: () => /(?<![\p{L}\p{N}.-])\d{5,10}(?![\p{L}\p{N}.-])/gu
    }
  });

  const findPatternMatches = (enabled, text) => {
    const original = String(text);
    if (original.length < 5) return [];
    const out = [];
    for (const key of Object.keys(PATTERNS)) {
      if (!enabled || !enabled[key]) continue;
      const re = PATTERNS[key].regex();
      let m;
      while ((m = re.exec(original)) !== null) {
        // Emails intentionally skip the URL guard: mailto and plain
        // addresses should blur. Everything else respects it.
        if (key !== "email" && looksLikeUrlContext(original, m.index, m.index + m[0].length)) continue;
        out.push({ start: m.index, end: m.index + m[0].length, text: m[0], kind: key });
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }
    return out;
  };

  // =========================
  // Storage helpers
  // =========================

  const storageGet = (keys) =>
    new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (data) => resolve(data || {}));
      } catch {
        resolve({});
      }
    });

  const storageSet = (obj) =>
    new Promise((resolve) => {
      try {
        chrome.storage.local.set(obj, () => resolve());
      } catch {
        resolve();
      }
    });

  const getSettings = async () => {
    const data = await storageGet([STORAGE.SETTINGS]);
    const s = data[STORAGE.SETTINGS] || {};
    return {
      ...DEFAULT_SETTINGS,
      ...s,
      patterns: { ...DEFAULT_SETTINGS.patterns, ...(s.patterns || {}) }
    };
  };

  const getRosters = async () => {
    const data = await storageGet([STORAGE.ROSTERS]);
    const rosters = Array.isArray(data[STORAGE.ROSTERS]) ? data[STORAGE.ROSTERS] : [];
    return rosters.map((r) => ({
      id: String(r.id || ""),
      name: String(r.name || "Roster"),
      enabled: r.enabled !== false,
      names: Array.isArray(r.names) ? r.names.map(String) : []
    }));
  };

  // The flat, ordered list of names the matcher and pseudonym table
  // are built from. Order defines "Student N" labels.
  const enabledNames = (rosters) => {
    const seen = new Set();
    const out = [];
    for (const roster of rosters || []) {
      if (!roster.enabled) continue;
      for (const name of roster.names || []) {
        const key = canonicalName(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(name);
      }
    }
    return out;
  };

  const siteKey = (host) => STORAGE.SITE_PREFIX + String(host || "").toLowerCase();

  const getSiteState = async (host) => {
    const key = siteKey(host);
    const data = await storageGet([key]);
    const s = data[key] || {};
    return {
      selectors: Array.isArray(s.selectors) ? s.selectors : [],
      areas: Array.isArray(s.areas) ? s.areas : [],
      mask: !!s.mask
    };
  };

  const setSiteState = async (host, state) => storageSet({ [siteKey(host)]: state });

  // =========================
  // Pro license
  // =========================
  // Lifetime Pro keys are minted server-side at purchase and verified
  // HERE, locally, against the embedded public key. The extension
  // never phones home: no activation server calls, no license pings.
  // A key is three dot-separated parts: "RB1.<payload>.<sig>", both
  // base64url, where sig is an ECDSA P-256 / SHA-256 signature (raw
  // r||s) over the payload part as UTF-8 bytes.

  const KEY_PREFIX = "RB1";

  const LICENSE_PUBLIC_JWK = Object.freeze({
    kty: "EC",
    crv: "P-256",
    x: "naUG4NDws7OuUqj8C4jMPf5maTZPbPlg66RaL2c3U5c",
    y: "B1QZUiAhMf9YBPvyBhZdSW58KJLnIwFhYCWqf9QO6EE"
  });

  const b64urlToBytes = (input) => {
    const b64 = String(input).replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  };

  const parseLicenseKey = (rawKey) => {
    const key = String(rawKey || "").trim();
    const parts = key.split(".");
    if (parts.length !== 3 || parts[0] !== KEY_PREFIX) {
      return { ok: false, reason: "That does not look like a RosterBlur key." };
    }
    if (!/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]+$/.test(parts[2])) {
      return { ok: false, reason: "The key contains invalid characters." };
    }
    let payload;
    try {
      payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
    } catch {
      return { ok: false, reason: "The key payload is unreadable." };
    }
    if (!payload || payload.v !== 1 || payload.plan !== "pro") {
      return { ok: false, reason: "The key payload is not a Pro license." };
    }
    return { ok: true, key, payloadPart: parts[1], sigPart: parts[2], payload };
  };

  // Full cryptographic verification. jwkOverride exists so tests can
  // verify against an ephemeral keypair; production passes only key.
  const verifyLicense = async (rawKey, jwkOverride = null) => {
    const parsed = parseLicenseKey(rawKey);
    if (!parsed.ok) return { valid: false, reason: parsed.reason, payload: null };
    try {
      const pubKey = await crypto.subtle.importKey(
        "jwk",
        jwkOverride || LICENSE_PUBLIC_JWK,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"]
      );
      const valid = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        pubKey,
        b64urlToBytes(parsed.sigPart),
        new TextEncoder().encode(parsed.payloadPart)
      );
      return valid
        ? { valid: true, reason: "", payload: parsed.payload }
        : { valid: false, reason: "The key signature is invalid.", payload: null };
    } catch (e) {
      return { valid: false, reason: "Verification failed: " + (e && e.message ? e.message : "unknown error"), payload: null };
    }
  };

  const getLicenseState = async () => {
    try {
      const data = await storageGet([STORAGE.LICENSE]);
      const key = data[STORAGE.LICENSE];
      if (!key) return { active: false, key: "", payload: null };
      const check = await verifyLicense(key);
      return { active: check.valid, key: check.valid ? key : "", payload: check.payload };
    } catch {
      return { active: false, key: "", payload: null };
    }
  };

  const license = Object.freeze({
    PRO,
    KEY_PREFIX,
    PUBLIC_JWK: LICENSE_PUBLIC_JWK,
    parse: parseLicenseKey,
    verify: verifyLicense,
    getState: getLicenseState
  });

  // =========================
  // Trial and access
  // =========================
  // Every install gets the full Pro feature set for 7 days, enforced
  // locally with the install timestamp. Same trust model as the rest
  // of the extension (honest-teacher grade, not DRM): a determined
  // user can reset it, a paying school cannot be locked out by it.
  // A valid license always wins over the trial clock.

  const TRIAL_DAYS = 7;
  const DAY_MS = 24 * 60 * 60 * 1000;

  const trialInfo = (installedAt, now = Date.now()) => {
    const at = Number(installedAt) || 0;
    if (!at) return { active: false, endsAt: 0, daysLeft: 0 };
    const endsAt = at + TRIAL_DAYS * DAY_MS;
    const msLeft = endsAt - now;
    return {
      active: msLeft > 0,
      endsAt,
      daysLeft: Math.max(0, Math.ceil(msLeft / DAY_MS))
    };
  };

  // The one question the UI and the service worker ask: does this
  // browser have Pro right now, and why?
  const getAccess = async () => {
    const [licenseState, data] = await Promise.all([
      getLicenseState(),
      storageGet([STORAGE.INSTALL])
    ]);
    if (licenseState.active) {
      return { pro: true, source: "license", payload: licenseState.payload, trial: trialInfo(0) };
    }
    const install = data[STORAGE.INSTALL] || {};
    const trial = trialInfo(install.at);
    return { pro: trial.active, source: trial.active ? "trial" : null, payload: null, trial };
  };

  return Object.freeze({
    STORAGE,
    DEFAULT_SETTINGS,
    MEETING_HOSTS,
    isMeetingHost,
    foldText,
    collapseSpaces,
    normalizeRosterName,
    canonicalName,
    parseRoster,
    parseCsv,
    extractNames,
    applyExclusions,
    buildMatcher,
    findMatches,
    buildPseudonyms,
    FAKE_NAMES,
    isGradeToken,
    PATTERNS,
    findPatternMatches,
    storageGet,
    storageSet,
    getSettings,
    getRosters,
    enabledNames,
    siteKey,
    getSiteState,
    setSiteState,
    license,
    TRIAL_DAYS,
    trialInfo,
    getAccess
  });
})();

// Node test hook; browsers ignore this.
if (typeof module !== "undefined" && module.exports) {
  module.exports = RB;
}
