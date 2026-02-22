import fs from "node:fs";
import path from "node:path";

/**
 * Returns the hook command string: `node <absolute_path_to_src/hook.mjs>`
 */
export function getHookCommand() {
  const hookPath = path.resolve(import.meta.dirname, "hook.mjs");
  return `node "${hookPath}"`;
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

  const existingIndex = settings.hooks.PermissionRequest.findIndex(
    (h) => h.command && h.command.includes("claude-remote-approver")
  );

  const hookEntry = { type: "command", command: hookCommand };

  if (existingIndex >= 0) {
    settings.hooks.PermissionRequest[existingIndex] = hookEntry;
  } else {
    settings.hooks.PermissionRequest.push(hookEntry);
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

  return { topic, configPath, settingsPath };
}
