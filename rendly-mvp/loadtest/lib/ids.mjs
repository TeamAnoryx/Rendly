// Deterministic test identities. Every id the load test uses comes from here, so the mock
// database and the virtual users agree without any seeding step. None of these ids exist in
// any real Rendly database.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..", "..");
export const BACKEND = path.join(ROOT, "backend");
export const FRONTEND = path.join(ROOT, "frontend");

/** Load packages the repo already has installed (no new dependencies). */
export const backendRequire = createRequire(path.join(BACKEND, "package.json"));
export const frontendRequire = createRequire(path.join(FRONTEND, "package.json"));

/** Test-only signing secret. Services are started with it; it is not the real JWT_SECRET. */
export const LT_JWT_SECRET = "rendly-loadtest-only-secret";
export const HUDDLE_SIZE = 6;

const hex12 = (n) => n.toString(16).padStart(12, "0");
const indexOf = (prefix, id) => {
  if (typeof id !== "string" || !id.startsWith(prefix)) return -1;
  const n = parseInt(id.slice(prefix.length), 16);
  return Number.isFinite(n) ? n : -1;
};

const USER = "00000000-0000-4000-8000-";
const HUDDLE = "00000000-0000-4000-9000-";
const MATCH = "00000000-0000-4000-a000-";

export const userId = (i) => USER + hex12(i);
export const userIndex = (id) => indexOf(USER, id);
export const huddleId = (g) => HUDDLE + hex12(g);
export const huddleIndex = (id) => indexOf(HUDDLE, id);
export const matchRowId = (i) => MATCH + hex12(i);
/** Spark and whisper partners: users 2k and 2k+1. */
export const partnerOf = (i) => i ^ 1;

let jwt;
export function tokenFor(i) {
  jwt ??= backendRequire("jsonwebtoken");
  return jwt.sign({ sub: userId(i), provider: "password" }, LT_JWT_SECRET, { expiresIn: "6h" });
}
