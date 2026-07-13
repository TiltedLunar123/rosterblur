module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.js"],
  setupFiles: ["./tests/setup.js"],
  collectCoverageFrom: ["shared.js", "netlify/functions/get-key.js"],
  coverageDirectory: "coverage"
};
