#!/usr/bin/env node

/**
 * CLI entry point for claude-remote-approver.
 *
 * Subcommands: setup | test | status | hook
 * All I/O goes through the injected `deps` object so the module is fully testable.
 */

import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

export async function main(args, deps) {
  if (args.includes("--help") || args.includes("-h")) {
    deps.stdout.write("Usage: claude-remote-approver <command>\n\nCommands:\n  setup   Set up remote approval\n  test    Send a test notification\n  status  Show current configuration\n  hook    Process a Claude Code hook (internal)\n");
    return;
  }
  if (args.includes("--version") || args.includes("-v")) {
    deps.stdout.write("0.1.0\n");
    return;
  }

  const command = args[0];

  switch (command) {
    case "setup": {
      const result = await deps.runSetup(deps);
      deps.stdout.write(`Setup complete. Topic: ${result.topic}\n`);
      break;
    }

    case "test": {
      const config = deps.loadConfig();
      if (!config.topic) {
        deps.stderr.write("Error: No topic configured. Run 'claude-remote-approver setup' first.\n");
        break;
      }
      try {
        await deps.sendNotification({
          server: config.ntfyServer,
          topic: config.topic,
          title: "Claude Remote Approver",
          message: "Test notification - if you see this, setup is working!",
          actions: [],
          requestId: "test",
        });
        deps.stdout.write("Test notification sent successfully.\n");
      } catch (err) {
        deps.stderr.write(`Error: Failed to send notification: ${err.message}\n`);
      }
      break;
    }

    case "status": {
      const config = deps.loadConfig();
      deps.stdout.write(`Topic:   ${config.topic}\n`);
      deps.stdout.write(`Server:  ${config.ntfyServer}\n`);
      deps.stdout.write(`Timeout: ${config.timeout}s\n`);
      break;
    }

    case "hook": {
      let input;
      try {
        input = JSON.parse(deps.stdin);
      } catch {
        const deny = { hookSpecificOutput: { decision: { behavior: "deny" } } };
        deps.stdout.write(JSON.stringify(deny) + "\n");
        break;
      }

      let result;
      try {
        result = await deps.processHook(input, deps);
      } catch {
        const deny = { hookSpecificOutput: { decision: { behavior: "deny" } } };
        deps.stdout.write(JSON.stringify(deny) + "\n");
        break;
      }

      deps.stdout.write(JSON.stringify(result) + "\n");
      break;
    }

    default: {
      deps.stderr.write(
        "Usage: claude-remote-approver <command>\n\nCommands:\n  setup   Configure topic and register hook\n  test    Send a test notification\n  status  Show current configuration\n  hook    Process a Claude Code hook (reads JSON from stdin)\n",
      );
      deps.exit(1);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Auto-execute when run directly (not imported)
// ---------------------------------------------------------------------------

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (() => {
    try {
      return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
    } catch {
      return false;
    }
  })();

if (isMain) {
  const { loadConfig, saveConfig, generateTopic } = await import(
    "../src/config.mjs"
  );
  const { sendNotification, waitForResponse, formatToolInfo } = await import(
    "../src/ntfy.mjs"
  );
  const { processHook } = await import("../src/hook.mjs");
  const { runSetup } = await import("../src/setup.mjs");

  const args = process.argv.slice(2);

  let stdinData = "";
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    stdinData = Buffer.concat(chunks).toString("utf-8");
  }

  const deps = {
    loadConfig,
    saveConfig,
    generateTopic,
    sendNotification,
    waitForResponse,
    formatToolInfo,
    processHook,
    runSetup,
    stdout: process.stdout,
    stderr: process.stderr,
    stdin: stdinData,
    exit: process.exit,
  };

  await main(args, deps);
}
