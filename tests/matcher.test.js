// Name matcher: the rules that decide what gets blurred. Word-boundary
// anchoring, diacritics folding, "Last, First" grids, and the
// false-positive guards all live here.

const RB = require("../shared.js");

const matchTexts = (names, text, options) =>
  RB.findMatches(RB.buildMatcher(names, options), text).map((m) => m.text);

describe("buildMatcher + findMatches", () => {
  test("matches full names case-insensitively", () => {
    expect(matchTexts(["Jordan Smith"], "grade for JORDAN SMITH today")).toEqual(["JORDAN SMITH"]);
    expect(matchTexts(["Jordan Smith"], "jordan smith, jordan  smith")).toHaveLength(2);
  });

  test("folds diacritics both ways", () => {
    expect(matchTexts(["Jose Martinez"], "report: José Martínez")).toEqual(["José Martínez"]);
    expect(matchTexts(["José Martínez"], "report: Jose Martinez")).toEqual(["Jose Martinez"]);
    expect(matchTexts(["Zoë Brontë"], "Zoe Bronte turned it in")).toEqual(["Zoe Bronte"]);
  });

  test("matches Last, First order", () => {
    expect(matchTexts(["Maria Garcia"], "Garcia, Maria - 94%")).toEqual(["Garcia, Maria"]);
    expect(matchTexts(["Maria Garcia"], "Garcia,Maria")).toEqual(["Garcia,Maria"]);
  });

  test("roster entries in Last, First form normalize and still match both shapes", () => {
    expect(matchTexts(["Garcia, Maria"], "Maria Garcia was present")).toEqual(["Maria Garcia"]);
    expect(matchTexts(["Garcia, Maria"], "Garcia, Maria was present")).toEqual(["Garcia, Maria"]);
  });

  test("word boundaries stop substring hits (the May guard)", () => {
    // "May Chen" must never fire inside "Maybelle Chenoweth".
    expect(matchTexts(["May Chen"], "Maybelle Chenoweth got an A")).toEqual([]);
    expect(matchTexts(["May Chen"], "May Chen got an A")).toEqual(["May Chen"]);
    expect(matchTexts(["Ann Lee"], "Annabelle Leeds and Joanne Lee")).toEqual([]);
  });

  test("standalone parts are off by default and opt-in", () => {
    expect(matchTexts(["Maria Garcia"], "Maria was helpful")).toEqual([]);
    expect(matchTexts(["Maria Garcia"], "Maria was helpful", { standalone: true })).toEqual(["Maria"]);
    // Boundary still applies to standalone parts.
    expect(matchTexts(["Maria Garcia"], "Mariam was helpful", { standalone: true })).toEqual([]);
  });

  test("standalone parts under 3 characters never match", () => {
    expect(matchTexts(["Al Bo"], "Al went home. Bo stayed.", { standalone: true })).toEqual([]);
    // The full name is 5 characters, so the full form still works.
    expect(matchTexts(["Al Bo"], "Al Bo went home", { standalone: true })).toEqual(["Al Bo"]);
  });

  test("first + last matches when a middle name is on the roster", () => {
    expect(matchTexts(["Anna Marie Johnson"], "Anna Johnson and Anna Marie Johnson")).toHaveLength(2);
  });

  test("never matches inside URL-looking tokens", () => {
    expect(matchTexts(["Maria Garcia"], "see https://school.example/maria garcia profile")).toEqual([]);
    expect(matchTexts(["Maria Garcia"], "at www.maria garcia.example")).toEqual([]);
    expect(matchTexts(["Maria Garcia"], "Maria Garcia visited https://example.com")).toEqual(["Maria Garcia"]);
  });

  test("handles apostrophes, hyphens, and curly quotes", () => {
    expect(matchTexts(["Liam O'Brien"], "Liam O’Brien joined")).toEqual(["Liam O’Brien"]);
    expect(matchTexts(["Mary-Jane Watson"], "Mary-Jane Watson left")).toEqual(["Mary-Jane Watson"]);
  });

  test("empty and too-short rosters produce an inert matcher", () => {
    expect(RB.buildMatcher([]).isEmpty).toBe(true);
    expect(RB.buildMatcher(["ab"]).isEmpty).toBe(true);
    expect(RB.findMatches(RB.buildMatcher([]), "anything at all")).toEqual([]);
  });

  test("resolves each match to the right student index", () => {
    const matcher = RB.buildMatcher(["Ana Cruz", "Ben Diaz"]);
    const hits = RB.findMatches(matcher, "Diaz, Ben then Ana Cruz");
    expect(hits.map((h) => h.student)).toEqual([1, 0]);
  });
});

describe("findPatternMatches", () => {
  test("emails are found only when the toggle is on", () => {
    const text = "Contact kid123@school.example or the office.";
    expect(RB.findPatternMatches({ email: true }, text).map((m) => m.text)).toEqual(["kid123@school.example"]);
    expect(RB.findPatternMatches({ email: false }, text)).toEqual([]);
  });

  test("phone numbers in common shapes", () => {
    const hits = RB.findPatternMatches({ phone: true }, "call (586) 555-0134 or 586-555-0199 x2");
    expect(hits.map((m) => m.text)).toEqual(["(586) 555-0134", "586-555-0199"]);
  });

  test("student ids are 5 to 10 digit runs, not years or longer codes", () => {
    const hits = RB.findPatternMatches({ studentId: true }, "id 8675309 year 2026 code 12345678901");
    expect(hits.map((m) => m.text)).toEqual(["8675309"]);
  });

  test("ids inside URLs stay untouched", () => {
    expect(RB.findPatternMatches({ studentId: true }, "https://example.com/12345/report")).toEqual([]);
  });
});
