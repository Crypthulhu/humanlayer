import crypto from "crypto";
import { getStore } from "@netlify/blobs";

const TOKEN_TTL_SECONDS = 60 * 60 * 8; // 8 hours

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(input) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function signToken(payload, secret) {
  const data = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", secret).update(data).digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${data}.${signature}`;
}

function verifyToken(token, secret) {
  if (!token || !token.includes(".")) return null;
  const [data, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", secret).update(data).digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const sigOk = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!sigOk) return null;
  const payload = JSON.parse(base64UrlDecode(data));
  if (payload.exp && Date.now() / 1000 > payload.exp) return null;
  return payload;
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function verifyPassword(password, salt, hash) {
  const hashed = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hashed, "hex"), Buffer.from(hash, "hex"));
}

function requireAuth(event) {
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length);
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) return null;
  return verifyToken(token, secret);
}

function buildToken() {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) throw new Error("Missing ADMIN_JWT_SECRET");
  const now = Math.floor(Date.now() / 1000);
  return signToken({ sub: "admin", iat: now, exp: now + TOKEN_TTL_SECONDS }, secret);
}

function getApplicationsStore() {
  return getStore("applications");
}

export {
  jsonResponse,
  verifyPassword,
  requireAuth,
  buildToken,
  getApplicationsStore,
};
