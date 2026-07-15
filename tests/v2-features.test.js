// v2 feature logic: the 7-day trial clock and access resolution,
// roster capture's name heuristic, the never-blur exclusion list,
// fictional-name pseudonyms, grade-cell tokens, and tiered
// (site-license) key minting.

const nodeCrypto = require("node:crypto");

const RB = require("../shared.js");
const { mintKey, resolveTier } = require("../netlify/functions/get-key.js")._internal;

const DAY = 24 * 60 * 60 * 1000;

describe("trialInfo", () => {
  const t0 = 1752500000000;

  test("active with correct days left inside the window", () => {
    expect(RB.trialInfo(t0, t0)).toEqual({ active: true, endsAt: t0 + 7 * DAY, daysLeft: 7 });
    expect(RB.trialInfo(t0, t0 + 6 * DAY + 1).daysLeft).toBe(1);
    expect(RB.trialInfo(t0, t0 + 6 * DAY + 1).active).toBe(true);
  });

  test("inactive at and after the boundary", () => {
    expect(RB.trialInfo(t0, t0 + 7 * DAY).active).toBe(false);
    expect(RB.trialInfo(t0, t0 + 30 * DAY)).toMatchObject({ active: false, daysLeft: 0 });
  });

  test("no install record means no trial", () => {
    expect(RB.trialInfo(0)).toEqual({ active: false, endsAt: 0, daysLeft: 0 });
    expect(RB.trialInfo(undefined)).toMatchObject({ active: false });
  });
});

describe("getAccess", () => {
  beforeEach(() => __resetChromeStorage());

  test("fresh install without a license gets trial access", async () => {
    await RB.storageSet({ [RB.STORAGE.INSTALL]: { at: Date.now() - 2 * DAY } });
    const access = await RB.getAccess();
    expect(access.pro).toBe(true);
    expect(access.source).toBe("trial");
    expect(access.trial.daysLeft).toBe(5);
  });

  test("expired trial without a license is free", async () => {
    await RB.storageSet({ [RB.STORAGE.INSTALL]: { at: Date.now() - 30 * DAY } });
    const access = await RB.getAccess();
    expect(access).toMatchObject({ pro: false, source: null });
    expect(access.trial.endsAt).toBeGreaterThan(0);
  });

  test("an invalid stored key falls back to the trial clock, not Pro", async () => {
    await RB.storageSet({
      [RB.STORAGE.LICENSE]: "RB1.not.real",
      [RB.STORAGE.INSTALL]: { at: Date.now() - 30 * DAY }
    });
    const access = await RB.getAccess();
    expect(access.pro).toBe(false);
  });
});

describe("extractNames (roster capture)", () => {
  test("keeps name-shaped lines and drops UI junk", () => {
    const lines = [
      "Students", "Name", "Grade", "Sort by", "Add student",
      "Jordan Smith", "Maria Garcia", "Jose Martinez",
      "95%", "A-", "18/20", "View all", "jordan.smith@school.org",
      "Due Friday", "Priya Patel"
    ];
    expect(RB.extractNames(lines)).toEqual([
      "Jordan Smith", "Maria Garcia", "Jose Martinez", "Priya Patel"
    ]);
  });

  test("normalizes Last, First and dedupes against First Last", () => {
    expect(RB.extractNames(["Garcia, Maria", "Maria Garcia", "Chen, May"]))
      .toEqual(["Maria Garcia", "May Chen"]);
  });

  test("rejects lines with digits, emails, single words, and long prose", () => {
    expect(RB.extractNames([
      "Maria", // single word
      "Room 204",
      "maria@x.com",
      "The quick brown fox jumps over everything today", // too long
      "lowercase name"
    ])).toEqual([]);
  });

  test("accepts hyphens, apostrophes, and diacritics", () => {
    expect(RB.extractNames(["Mary-Jane O'Neil", "José Muñoz"]))
      .toEqual(["Mary-Jane O'Neil", "José Muñoz"]);
  });
});

describe("applyExclusions", () => {
  test("removes excluded names canonically (case, accents, comma order)", () => {
    const names = ["Jordan Smith", "José Muñoz", "Maria Garcia"];
    expect(RB.applyExclusions(names, ["jose munoz", "Smith, Jordan"]))
      .toEqual(["Maria Garcia"]);
  });

  test("empty exclusion list is a no-op", () => {
    const names = ["Jordan Smith"];
    expect(RB.applyExclusions(names, [])).toEqual(names);
    expect(RB.applyExclusions(names, undefined)).toEqual(names);
  });
});

describe("buildPseudonyms with styles", () => {
  const roster = ["Jordan Smith", "Maria Garcia"];

  test("default style is Student N", () => {
    const p = RB.buildPseudonyms(roster);
    expect(p.labelFor("Jordan Smith")).toBe("Student 1");
  });

  test("names style gives stable fictional names from the fixed list", () => {
    const p = RB.buildPseudonyms(roster, "names");
    expect(p.labelFor("Jordan Smith")).toBe(RB.FAKE_NAMES[0]);
    expect(p.labelFor("garcia, maria")).toBe(RB.FAKE_NAMES[1]);
    expect(p.labelFor(1)).toBe(RB.FAKE_NAMES[1]);
    const rebuilt = RB.buildPseudonyms(roster, "names");
    expect(rebuilt.labelFor("Jordan Smith")).toBe(p.labelFor("Jordan Smith"));
  });

  test("names style wraps with a numeric suffix past the list length", () => {
    const big = Array.from({ length: RB.FAKE_NAMES.length + 1 }, (_, i) => "Test Student" + i);
    // Names with digits never parse from rosters, but buildPseudonyms
    // only cares about order; synthesize enough entries to wrap.
    const p = RB.buildPseudonyms(big, "names");
    expect(p.labelFor(RB.FAKE_NAMES.length)).toBe(RB.FAKE_NAMES[0] + " 2");
  });
});

describe("isGradeToken", () => {
  test("letter grades, percentages, and fractions match", () => {
    for (const good of ["A", "A-", "B+", "F", "95%", "87.5 %", "18/20", "100 / 100"]) {
      expect(RB.isGradeToken(good)).toBe(true);
    }
  });

  test("prose, names, and out-of-shape numbers do not", () => {
    for (const bad of ["Grade", "A very good job", "G+", "1234%", "95%%", "18/20/22", "Jordan"]) {
      expect(RB.isGradeToken(bad)).toBe(false);
    }
  });
});

describe("tiered key minting (site licenses)", () => {
  const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const PRIV = privateKey.export({ type: "pkcs8", format: "pem" });
  const JWK = publicKey.export({ format: "jwk" });
  const SID = "cs_live_a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuV";

  const payloadOf = (key) => JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString());

  test("individual keys keep the exact 1.x payload shape", () => {
    const payload = payloadOf(mintKey(PRIV, SID, 1752400000, null));
    expect(payload).toEqual({ v: 1, plan: "pro", sid: SID.slice(-10), iat: 1752400000 });
  });

  test("dept and school keys carry tier and seats and still verify in the extension", async () => {
    const key = mintKey(PRIV, SID, 1752400000, { name: "school", seats: 30 });
    expect(payloadOf(key)).toMatchObject({ v: 1, plan: "pro", tier: "school", seats: 30 });
    const check = await RB.license.verify(key, JWK);
    expect(check.valid).toBe(true);
    expect(check.payload.tier).toBe("school");
  });

  test("resolveTier maps each configured link and refuses strangers", () => {
    const env = {
      STRIPE_PAYMENT_LINK_ID: "plink_solo",
      STRIPE_PAYMENT_LINK_ID_DEPT: "plink_dept",
      STRIPE_PAYMENT_LINK_ID_SCHOOL: "plink_school"
    };
    expect(resolveTier("plink_solo", env)).toEqual({ match: true, tier: null });
    expect(resolveTier("plink_dept", env).tier).toEqual({ name: "dept", seats: 5 });
    expect(resolveTier("plink_school", env).tier).toEqual({ name: "school", seats: 30 });
    expect(resolveTier("plink_other", env).match).toBe(false);
    expect(resolveTier(undefined, env).match).toBe(false);
    // Unset tier envs never match an undefined payment_link.
    expect(resolveTier(undefined, { STRIPE_PAYMENT_LINK_ID: "plink_solo" }).match).toBe(false);
  });
});
