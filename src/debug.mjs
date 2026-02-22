// src/debug.mjs
import fs from "node:fs";

const LOG_PATH = "/tmp/cra-debug.log";

export function debug(msg) {
  const ts = new Date().toISOString();
  fs.appendFileSync(LOG_PATH, `[${ts}] ${msg}\n`);
}
