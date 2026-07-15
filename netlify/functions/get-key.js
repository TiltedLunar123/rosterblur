// get-key: turns a paid Stripe Checkout session into a signed RosterBlur
// Pro license key. Called by activate.html right after checkout (Stripe
// redirects there with the session id) and again any time the buyer
// revisits their receipt link, so it doubles as key recovery.
//
// Proof of purchase is the session id itself plus a live check against
// the Stripe API: the session must be paid AND belong to this app's
// payment link (the Stripe account also sells unrelated products).
// With no STRIPE_SECRET_KEY configured the endpoint fails closed.
//
// Keys are ECDSA P-256 signatures over a small JSON payload; the
// extension verifies them offline with the embedded public key. See
// shared.js (RB.license) in the repo root for the verify side.

"use strict";

const crypto = require("node:crypto");

const SESSION_ID_PATTERN = /^cs_(live|test)_[A-Za-z0-9]{10,240}$/;

const JSON_HEADERS = Object.freeze({
  "content-type": "application/json",
  "cache-control": "no-store"
});

function respond(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

// Payload deliberately tiny: version, plan, a session-id tail (enough
// to correlate with Stripe without embedding the full unguessable id),
// and the purchase timestamp. Site licenses add tier and seats; the
// extension ignores fields it does not know, so old and new keys both
// verify everywhere. Signature is raw r||s (ieee-p1363) over the
// base64url payload STRING, matching WebCrypto's verify input in the
// extension.
function mintKey(privateKeyPem, sessionId, purchasedAt, tier = null) {
  const payload = {
    v: 1,
    plan: "pro",
    sid: String(sessionId).slice(-10),
    iat: Number(purchasedAt) || 0
  };
  if (tier && tier.name) {
    payload.tier = tier.name;
    payload.seats = tier.seats;
  }
  const payloadPart = b64url(JSON.stringify(payload));
  const signature = crypto.sign("sha256", Buffer.from(payloadPart, "utf8"), {
    key: privateKeyPem,
    dsaEncoding: "ieee-p1363"
  });
  return `RB1.${payloadPart}.${b64url(signature)}`;
}

// Which payment link produced this session decides the license tier.
// Individual keys keep the exact 1.x payload shape.
function resolveTier(paymentLink, env) {
  if (paymentLink && paymentLink === env.STRIPE_PAYMENT_LINK_ID) return { match: true, tier: null };
  if (paymentLink && paymentLink === env.STRIPE_PAYMENT_LINK_ID_DEPT) {
    return { match: true, tier: { name: "dept", seats: 5 } };
  }
  if (paymentLink && paymentLink === env.STRIPE_PAYMENT_LINK_ID_SCHOOL) {
    return { match: true, tier: { name: "school", seats: 30 } };
  }
  return { match: false, tier: null };
}

async function fetchCheckoutSession(sessionId, apiKey, fetchImpl) {
  const res = await fetchImpl(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    { headers: { authorization: `Bearer ${apiKey}` } }
  );
  const data = await res.json();
  return { status: res.status, data };
}

async function handler(event) {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return respond(405, { error: "method not allowed" });
  }

  const sessionId = event.queryStringParameters?.session_id || "";
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    return respond(400, { error: "missing or malformed session_id" });
  }

  const apiKey = process.env.STRIPE_SECRET_KEY || "";
  const privateKeyPem = process.env.LICENSE_PRIVATE_KEY || "";
  const paymentLinkId = process.env.STRIPE_PAYMENT_LINK_ID || "";
  if (!apiKey || !privateKeyPem || !paymentLinkId) {
    // Fail closed: never mint on trust when config is incomplete.
    return respond(503, { error: "activation is not configured yet; your payment is safe, contact support with your receipt" });
  }

  let session;
  try {
    session = await fetchCheckoutSession(sessionId, apiKey, globalThis.fetch);
  } catch {
    return respond(502, { error: "could not reach Stripe, try again shortly" });
  }

  if (session.status === 404) {
    return respond(404, { error: "no such checkout session" });
  }
  if (session.status !== 200 || !session.data) {
    return respond(502, { error: "unexpected Stripe response, try again shortly" });
  }

  const paid = session.data.payment_status === "paid";
  const resolved = resolveTier(session.data.payment_link, process.env);
  if (!paid || !resolved.match) {
    return respond(402, { error: "this session is not a completed Pro purchase" });
  }

  try {
    const key = mintKey(privateKeyPem, sessionId, session.data.created, resolved.tier);
    return respond(200, { key });
  } catch {
    return respond(500, { error: "key minting failed, contact support with your receipt" });
  }
}

exports.handler = handler;
// Exposed for unit tests only.
exports._internal = { mintKey, resolveTier, SESSION_ID_PATTERN };
