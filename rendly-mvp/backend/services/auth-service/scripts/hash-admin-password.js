#!/usr/bin/env node
/**
 * Prints a bcrypt hash for the admin console password. Put the output in ADMIN_PASSWORD_HASH
 * (backend .env or your host's secret settings); never store the password itself.
 *
 *   npm run admin:hash-password
 *
 * The password is read from the terminal without echoing it and is never written to disk or to
 * shell history.
 */
const readline = require("readline");
const bcrypt = require("bcrypt");

const MIN_LENGTH = 12;

function ask(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes(prompt)) rl.output.write(prompt);
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  const password = await ask("Admin password: ");
  if (password.length < MIN_LENGTH) {
    console.error(`Use at least ${MIN_LENGTH} characters.`);
    process.exit(1);
  }
  const again = await ask("Repeat it: ");
  if (again !== password) {
    console.error("The passwords do not match.");
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 12);
  console.log("\nADMIN_PASSWORD_HASH=" + hash);
}

main().catch((err) => {
  console.error("Could not hash the password:", err.message);
  process.exit(1);
});
