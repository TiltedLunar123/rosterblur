// Pseudonym labels: stable, roster-order based, resilient to the
// different shapes a name appears in on a page.

const RB = require("../shared.js");

describe("buildPseudonyms", () => {
  const names = ["Jordan Smith", "Maria Garcia", "Jose Martinez"];

  test("labels follow roster order", () => {
    const p = RB.buildPseudonyms(names);
    expect(p.labelFor("Jordan Smith")).toBe("Student 1");
    expect(p.labelFor("Maria Garcia")).toBe("Student 2");
    expect(p.labelFor("Jose Martinez")).toBe("Student 3");
  });

  test("same label regardless of case, accents, or comma order", () => {
    const p = RB.buildPseudonyms(names);
    expect(p.labelFor("MARIA GARCIA")).toBe("Student 2");
    expect(p.labelFor("García, María")).toBe("Student 2");
  });

  test("index lookup mirrors name lookup", () => {
    const p = RB.buildPseudonyms(names);
    expect(p.labelFor(0)).toBe("Student 1");
    expect(p.labelFor(2)).toBe("Student 3");
  });

  test("unknown names and indexes fall back to a generic label", () => {
    const p = RB.buildPseudonyms(names);
    expect(p.labelFor("Nobody Here")).toBe("Student");
    expect(p.labelFor(-1)).toBe("Student");
    expect(p.labelFor(99)).toBe("Student");
  });

  test("stability: rebuilding from the same roster gives the same labels", () => {
    const a = RB.buildPseudonyms(names);
    const b = RB.buildPseudonyms([...names]);
    for (const n of names) expect(a.labelFor(n)).toBe(b.labelFor(n));
  });

  test("matcher student indexes line up with pseudonym labels", () => {
    const matcher = RB.buildMatcher(names);
    const p = RB.buildPseudonyms(names);
    const hits = RB.findMatches(matcher, "Martinez, Jose and Jordan Smith");
    expect(hits.map((h) => p.labelFor(h.student))).toEqual(["Student 3", "Student 1"]);
  });
});

describe("enabledNames", () => {
  test("flattens enabled rosters in order and dedupes across them", () => {
    const rosters = [
      { id: "a", name: "P1", enabled: true, names: ["Ana Cruz", "Ben Diaz"] },
      { id: "b", name: "P2", enabled: false, names: ["Carl Ely"] },
      { id: "c", name: "P3", enabled: true, names: ["ana cruz", "Dee Fox"] }
    ];
    expect(RB.enabledNames(rosters)).toEqual(["Ana Cruz", "Ben Diaz", "Dee Fox"]);
  });
});
