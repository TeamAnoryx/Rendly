// Creates fake test users for manual testing of password login.
// Usage (from services/auth-service): npx ts-node scripts/seed-test-users.ts
// Idempotent: existing users with the same email are updated, not duplicated.
import path from "path";
import { randomBytes } from "crypto";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const url = process.env.SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!url || !key) {
  console.error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in backend/.env");
  process.exit(1);
}
const supabase = createClient(url, key);

// Passwords are never stored in source. Set TEST_USER1_PASSWORD / TEST_USER2_PASSWORD
// in the environment to choose them; otherwise a random one is generated and printed once.
const TEST_USERS = [
  {
    username: "testuser1",
    email: "testuser1@rendly.test",
    passwordEnvVar: "TEST_USER1_PASSWORD",
    profession: "Software Engineer",
    bio: "Fake test account #1",
  },
  {
    username: "testuser2",
    email: "testuser2@rendly.test",
    passwordEnvVar: "TEST_USER2_PASSWORD",
    profession: "Product Designer",
    bio: "Fake test account #2",
  },
];

function resolvePassword(envVar: string): { password: string; generated: boolean } {
  const fromEnv = process.env[envVar];
  if (fromEnv) return { password: fromEnv, generated: false };
  return { password: randomBytes(12).toString("base64url"), generated: true };
}

async function main() {
  for (const u of TEST_USERS) {
    const { password, generated } = resolvePassword(u.passwordEnvVar);
    if (generated) console.log(`generated password for ${u.username}: ${password}`);
    const password_hash = await bcrypt.hash(password, 10);
    const row = {
      email: u.email,
      username: u.username,
      password_hash,
      profession: u.profession,
      bio: u.bio,
      avatar_url: null,
      github_id: null,
      github_url: null,
      linkedin_id: null,
      linkedin_url: null,
      user_ip: null,
    };
    const { data: existing, error: findErr } = await supabase
      .from("users")
      .select("id")
      .eq("email", u.email)
      .maybeSingle();
    if (findErr) throw new Error(`lookup ${u.email} failed: ${findErr.message}`);

    if (existing?.id) {
      const { error } = await supabase.from("users").update(row).eq("id", existing.id);
      if (error) throw new Error(`update ${u.email} failed: ${error.message}`);
      console.log(`updated ${u.username} (${u.email})`);
    } else {
      const { error } = await supabase.from("users").insert(row);
      if (error) throw new Error(`insert ${u.email} failed: ${error.message}`);
      console.log(`created ${u.username} (${u.email})`);
    }
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
