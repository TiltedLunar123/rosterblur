// Pro license verification. True integration across the wire format:
// keys are minted with the REAL server code (netlify/functions/
// get-key.js mintKey) using an ephemeral P-256 keypair, then verified
// with the REAL extension code (shared.js RB.license.verify) against
// that pair's public JWK. The production public key stays embedded;
// only the test keypair differs.

const nodeCrypto = require("node:crypto");

const RB = require("../shared.js");
const { mintKey } = require("../netlify/functions/get-key.js")._internal;

const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const TEST_PRIV_PEM = privateKey.export({ type: "pkcs8", format: "pem" });
const TEST_PUB_JWK = publicKey.export({ format: "jwk" });

const SESSION_ID = "cs_live_a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuV";

describe("RB.license", () => {
  describe("parse", () => {
    test("rejects garbage and wrong prefixes with readable reasons", () => {
      for (const bad of ["", "not-a-key", "GCC1.x.y", "RB1.onlytwo", "RB1.a.b.c.d"]) {
        const out = RB.license.parse(bad);
        expect(out.ok).toBe(false);
        expect(typeof out.reason).toBe("string");
        expect(out.reason.length).toBeGreaterThan(0);
      }
    });

    test("rejects a payload that is not a v1 pro plan", () => {
      const payload = Buffer.from(JSON.stringify({ v: 1, plan: "mega" })).toString("base64url");
      const out = RB.license.parse(`RB1.${payload}.c2ln`);
      expect(out.ok).toBe(false);
    });

    test("accepts a server-minted key's shape and decodes the payload", () => {
      const key = mintKey(TEST_PRIV_PEM, SESSION_ID, 1752400000);
      const out = RB.license.parse(key);
      expect(out.ok).toBe(true);
      expect(out.payload).toMatchObject({ v: 1, plan: "pro", iat: 1752400000 });
      expect(out.payload.sid).toBe(SESSION_ID.slice(-10));
    });
  });

  describe("verify (server mint -> extension verify)", () => {
    test("accepts a key signed by the matching private key", async () => {
      const key = mintKey(TEST_PRIV_PEM, SESSION_ID, 1752400000);
      const out = await RB.license.verify(key, TEST_PUB_JWK);
      expect(out.valid).toBe(true);
      expect(out.payload.plan).toBe("pro");
    });

    test("rejects a tampered payload", async () => {
      const key = mintKey(TEST_PRIV_PEM, SESSION_ID, 1752400000);
      const [prefix, , sig] = key.split(".");
      const forgedPayload = Buffer.from(
        JSON.stringify({ v: 1, plan: "pro", sid: "FORGED0000", iat: 1 })
      ).toString("base64url");
      const out = await RB.license.verify(`${prefix}.${forgedPayload}.${sig}`, TEST_PUB_JWK);
      expect(out.valid).toBe(false);
    });

    test("rejects a key signed by the wrong private key (default embedded pubkey)", async () => {
      const key = mintKey(TEST_PRIV_PEM, SESSION_ID, 1752400000);
      const out = await RB.license.verify(key);
      expect(out.valid).toBe(false);
    });

    test("rejects malformed keys without throwing", async () => {
      const out = await RB.license.verify("RB1.%%%%.####");
      expect(out.valid).toBe(false);
    });
  });

  describe("getState", () => {
    beforeEach(() => __resetChromeStorage());

    test("inactive when no key is stored", async () => {
      const out = await RB.license.getState();
      expect(out.active).toBe(false);
    });

    test("inactive when the stored key does not verify against the embedded pubkey", async () => {
      await chrome.storage.local.set({ rb_license: mintKey(TEST_PRIV_PEM, SESSION_ID, 1) });
      const out = await RB.license.getState();
      expect(out.active).toBe(false);
    });
  });
});
