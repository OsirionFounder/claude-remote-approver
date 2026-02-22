import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Returns true if the entry belongs to claude-remote-approver.
 */
function isCraEntry(entry) {
  if (entry.hooks?.some((h) => h.command?.includes("claude-remote-approver"))) return true;
  if (entry.command?.includes("claude-remote-approver")) return true;
  return false;
}

/**
 * Returns the hook command string: `node <absolute_path_to_bin/cli.mjs> hook`
 */
export function getHookCommand() {
  const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "cli.mjs");
  if (!fs.existsSync(cliPath)) {
    throw new Error(`CLI entry point not found: ${cliPath}`);
  }
  return `node "${cliPath}" hook`;
}

/**
 * Registers the PermissionRequest hook in Claude's settings.json.
 * Creates the file if it does not exist. Preserves all existing settings and hooks.
 */
export function registerHook(settingsPath, hookCommand) {
  let settings = {};

  try {
    const raw = fs.readFileSync(settingsPath, "utf-8");
    settings = JSON.parse(raw);
  } catch (err) {
    if (err.code !== "ENOENT") {
      throw err;
    }
  }

  if (!settings.hooks) {
    settings.hooks = {};
  }

  if (!Array.isArray(settings.hooks.PermissionRequest)) {
    settings.hooks.PermissionRequest = [];
  }

  const existingIndex = settings.hooks.PermissionRequest.findIndex(isCraEntry);

  const hookEntry = { hooks: [{ type: "command", command: hookCommand }] };

  if (existingIndex >= 0) {
    settings.hooks.PermissionRequest[existingIndex] = hookEntry;
  } else {
    settings.hooks.PermissionRequest.push(hookEntry);
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

/**
 * Removes the claude-remote-approver hook entry from Claude's settings.json.
 * If the file does not exist, does nothing.
 */
export function unregisterHook(settingsPath) {
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }

  if (!settings.hooks?.PermissionRequest) return;

  const original = settings.hooks.PermissionRequest;
  const filtered = original.filter((entry) => !isCraEntry(entry));

  if (filtered.length === original.length) return;

  if (filtered.length === 0) {
    delete settings.hooks.PermissionRequest;
  } else {
    settings.hooks.PermissionRequest = filtered;
  }

  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

/**
 * Runs the full setup flow:
 * 1. Generate a topic
 * 2. Build and save config
 * 3. Register the hook in settings.json
 * 4. Return { topic, configPath, settingsPath }
 */
export async function runSetup({
  configPath,
  settingsPath,
  generateTopic,
  saveConfig,
  loadConfig,
}) {
  const topic = generateTopic();

  const config = loadConfig(configPath);
  config.topic = topic;
  saveConfig(config, configPath);

  const hookCommand = getHookCommand();
  registerHook(settingsPath, hookCommand);

  return { topic, ntfyServer: config.ntfyServer, configPath, settingsPath };
}
