// src/hook.mjs

import crypto from "node:crypto";
import { DEFAULT_CONFIG } from "./config.mjs";

/**
 * Build ntfy action buttons for Approve / Deny.
 *
 * @param {string} server - ntfy server URL
 * @param {string} topic - ntfy topic
 * @param {string} requestId - Unique request identifier
 * @returns {Array<object>} Array of 2 action objects
 */
export function buildActions(server, topic, requestId) {
  const url = `${server}/${topic}-response`;
  return [
    {
      action: "http",
      label: "Approve",
      url,
      body: JSON.stringify({ requestId, approved: true }),
      method: "POST",
    },
    {
      action: "http",
      label: "Deny",
      url,
      body: JSON.stringify({ requestId, approved: false }),
      method: "POST",
    },
  ];
}

/**
 * Process a Claude Code hook request.
 *
 * @param {object} input - The hook input payload
 * @param {object} deps - Injected dependencies
 * @param {Function} deps.loadConfig
 * @param {Function} deps.sendNotification
 * @param {Function} deps.waitForResponse
 * @param {Function} deps.formatToolInfo
 * @returns {Promise<object>} Decision JSON
 */
export async function processHook(input, { loadConfig, sendNotification, waitForResponse, formatToolInfo }) {
  const config = loadConfig();

  if (!config.topic) {
    return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny" } } };
  }

  const requestId = crypto.randomUUID();
  const { title, message } = formatToolInfo(input);
  const actions = buildActions(config.ntfyServer, config.topic, requestId);

  try {
    await sendNotification({
      server: config.ntfyServer,
      topic: config.topic,
      title,
      message,
      actions,
      requestId,
    });
  } catch (err) {
    console.error("sendNotification failed:", err);
    return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny" } } };
  }

  let response;
  try {
    const isPlanReview = input.tool_name === "ExitPlanMode";
    const timeout = (isPlanReview ? (config.planTimeout ?? DEFAULT_CONFIG.planTimeout) : config.timeout) * 1000;
    response = await waitForResponse({
      server: config.ntfyServer,
      topic: config.topic,
      requestId,
      timeout,
    });
  } catch (err) {
    console.error("waitForResponse failed:", err);
    return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny" } } };
  }

  const behavior = response.approved ? "allow" : "deny";
  return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior } } };
}
