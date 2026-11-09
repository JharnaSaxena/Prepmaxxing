import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { query } from "./db";

const COOKIE = "prepmaxxing_session";
const SESSION_TTL = 60 * 60 * 24 * 14;

function secret() {
  const value = process.env.AUTH_SECRET;
  if (value && value.length >= 32) return value;
  if (process.env.NODE_ENV !== "production" && process.env.DATABASE_URL) return process.env.DATABASE_URL;
  throw new Error("AUTH_SECRET must be set to a random value of at least 32 characters.");
}

function sign(value) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 2 ** 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password, encoded = "") {
  try {
    const [kind, saltHex, hashHex] = encoded.split("$");
    if (kind !== "scrypt" || !saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, { N: 2 ** 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch { return false; }
}

export function setSession(response, user) {
  const payload = Buffer.from(JSON.stringify({ id: user.id, exp: Math.floor(Date.now() / 1000) + SESSION_TTL })).toString("base64url");
  response.cookies.set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_TTL,
  });
}

export function clearSession(response) {
  response.cookies.set(COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
}

export async function currentUser() {
  const jar = await cookies();
  const value = jar.get(COOKIE)?.value;
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const actual = Buffer.from(signature);
  const expected = Buffer.from(sign(payload));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!decoded.id || decoded.exp < Date.now() / 1000) return null;
    const { rows } = await query("SELECT id, full_name, email, role, track, is_synthetic FROM students WHERE id=$1", [decoded.id]);
    return rows[0] || null;
  } catch { return null; }
}

export function requireUser(user) {
  if (!user) throw Object.assign(new Error("Please sign in to continue."), { status: 401 });
  return user;
}

export function requireStaff(user) {
  requireUser(user);
  if (!["admin", "placement_officer"].includes(user.role)) throw Object.assign(new Error("This area is for placement staff."), { status: 403 });
  return user;
}

export function requireAdmin(user) {
  requireUser(user);
  if (user.role !== "admin") throw Object.assign(new Error("Only an administrator can manage demo data and staff access."), { status: 403 });
  return user;
}
