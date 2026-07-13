// Roster text and CSV import parsing.

const RB = require("../shared.js");

describe("parseRoster", () => {
  test("one name per line, trimmed, comments and blanks dropped", () => {
    const names = RB.parseRoster("  Jordan Smith \n\n# period 3\nMaria Garcia\n");
    expect(names).toEqual(["Jordan Smith", "Maria Garcia"]);
  });

  test("Last, First lines normalize to First Last", () => {
    expect(RB.parseRoster("Garcia, Maria")).toEqual(["Maria Garcia"]);
  });

  test("dedupes case- and accent-insensitively", () => {
    const names = RB.parseRoster("Jose Martinez\nJOSÉ MARTÍNEZ\nMartinez, Jose");
    expect(names).toEqual(["Jose Martinez"]);
  });

  test("drops entries shorter than 3 characters", () => {
    expect(RB.parseRoster("Al\nBo\nCy Young")).toEqual(["Cy Young"]);
  });

  test("collapses internal whitespace", () => {
    expect(RB.parseRoster("Jordan    Smith")).toEqual(["Jordan Smith"]);
  });
});

describe("parseCsv", () => {
  test("first,last header export", () => {
    const csv = "First,Last\nJordan,Smith\nMaria,Garcia";
    expect(RB.parseCsv(csv)).toEqual(["Jordan Smith", "Maria Garcia"]);
  });

  test("header variants like First Name / Last Name", () => {
    const csv = "First Name,Last Name,Grade\nJordan,Smith,A\nMaria,Garcia,B";
    expect(RB.parseCsv(csv)).toEqual(["Jordan Smith", "Maria Garcia"]);
  });

  test("single name column with header", () => {
    const csv = "Student Name\nJordan Smith\n\"Garcia, Maria\"";
    expect(RB.parseCsv(csv)).toEqual(["Jordan Smith", "Maria Garcia"]);
  });

  test("headerless two-column data is treated as first,last", () => {
    const csv = "Jordan,Smith\nMaria,Garcia";
    expect(RB.parseCsv(csv)).toEqual(["Jordan Smith", "Maria Garcia"]);
  });

  test("headerless single column", () => {
    expect(RB.parseCsv("Jordan Smith\nMaria Garcia")).toEqual(["Jordan Smith", "Maria Garcia"]);
  });

  test("quoted fields, semicolon delimiters, and stray blank lines", () => {
    const csv = 'First;Last\n"Jordan";"Smith"\n\nMaria;Garcia\n';
    expect(RB.parseCsv(csv)).toEqual(["Jordan Smith", "Maria Garcia"]);
  });

  test("garbage input degrades to empty, never throws", () => {
    expect(RB.parseCsv("")).toEqual([]);
    expect(RB.parseCsv(",,,\n,,,")).toEqual([]);
    expect(RB.parseCsv('"unclosed quote')).toEqual(["unclosed quote"]);
  });
});
