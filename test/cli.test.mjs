/**
 * Test suite for bin/cli.mjs
 *
 * Coverage:
 * - main(['setup'], deps) — calls runSetup with correct params
 * - main(['test'], deps) — loads config, sends test notification
 * - main(['test'], deps) — reports error when no topic configured
 * - main(['status'], deps) — loads config, writes settings to stdout
 * - main(['hook'], deps) — reads JSON from stdin, calls processHook, writes result to stdout
 * - main([], deps) / unknown command — writes help/usage to stderr
 * - main(['hook'], deps) — outputs valid JSON for allow decision
 * - main(['hook'], deps) — outputs valid JSON for deny decision
 *
 * TDD Red phase — all tests must FAIL because main is undefined (stub).
 */

import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { main } from "../bin/cli.mjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a mock stdout/stderr object that collects written strings.
 */
function createMockWriter() {
  const chunks = [];
  return {
    write(str) {
      chunks.push(str);
    },
    /** Returns all written output concatenated. */
    output() {
      return chunks.join("");
    },
    chunks,
  };
}

/**
 * Creates a full set of injected dependencies with sensible defaults.
 * Override individual entries as needed per test.
 */
function createDeps(overrides = {}) {
  const defaultConfig = {
    topic: "test-topic-abc",
    ntfyServer: "https://ntfy.sh",
    timeout: 120,
    autoApprove: [],
    autoDeny: [],
  };

  return {
    loadConfig: mock.fn(() => overrides.config ?? defaultConfig),
    saveConfig: mock.fn(() => {}),
    generateTopic: mock.fn(() => "cra-generated123"),
    sendNotification: mock.fn(async () => ({ ok: true, status: 200 })),
    waitForResponse: mock.fn(
      async () => overrides.waitResult ?? { approved: true },
    ),
    formatToolInfo: mock.fn(
      () =>
        overrides.toolInfo ?? {
          title: "Claude Code: Bash",
          message: "echo hello",
        },
    ),
    processHook: mock.fn(
      async () =>
        overrides.hookResult ?? {
          hookSpecificOutput: { decision: { behavior: "allow" } },
        },
    ),
    runSetup: mock.fn(
      async () =>
        overrides.setupResult ?? {
          topic: "cra-generated123",
          configPath: "/home/user/.claude-remote-approver.json",
          settingsPath: "/home/user/.claude/settings.json",
        },
    ),
    stdout: overrides.stdout ?? createMockWriter(),
    stderr: overrides.stderr ?? createMockWriter(),
    stdin: overrides.stdin ?? "",
    exit: mock.fn(() => {}),
    ...overrides,
  };
}

// ===========================================================================
// main — type check
// ===========================================================================

describe("main", () => {
  it("should be a function exported from the module", () => {
    assert.equal(typeof main, "function");
  });

  // =========================================================================
  // setup subcommand
  // =========================================================================

  describe("setup subcommand", () => {
    it("should call runSetup when args is ['setup']", async () => {
      const deps = createDeps();

      await main(["setup"], deps);

      assert.equal(
        deps.runSetup.mock.callCount(),
        1,
        "runSetup should be called exactly once",
      );
    });

    it("should write the generated topic to stdout after setup", async () => {
      const stdout = createMockWriter();
      const deps = createDeps({ stdout });

      await main(["setup"], deps);

      const output = stdout.output();
      assert.ok(
        output.includes("cra-generated123"),
        `stdout should contain the topic, got: ${output}`,
      );
    });
  });

  // =========================================================================
  // test subcommand
  // =========================================================================

  describe("test subcommand", () => {
    it("should load config and call sendNotification with a test message", async () => {
      const deps = createDeps();

      await main(["test"], deps);

      assert.equal(
        deps.loadConfig.mock.callCount(),
        1,
        "loadConfig should be called once",
      );
      assert.equal(
        deps.sendNotification.mock.callCount(),
        1,
        "sendNotification should be called once",
      );

      const callArgs = deps.sendNotification.mock.calls[0].arguments[0];
      assert.equal(callArgs.topic, "test-topic-abc");
      assert.equal(callArgs.server, "https://ntfy.sh");
    });

    it("should write error to stderr when sendNotification throws", async () => {
      const stdout = createMockWriter();
      const stderr = createMockWriter();
      const deps = createDeps({
        stdout,
        stderr,
        sendNotification: mock.fn(async () => {
          throw new Error("network timeout");
        }),
      });

      await main(["test"], deps);

      const errOutput = stderr.output();
      assert.ok(
        errOutput.includes("Failed to send notification"),
        `stderr should contain failure message, got: ${errOutput}`,
      );
      assert.ok(
        errOutput.includes("network timeout"),
        `stderr should contain the error message, got: ${errOutput}`,
      );
      assert.equal(
        stdout.output().includes("sent successfully"),
        false,
        "stdout should NOT contain success message when notification fails",
      );
    });

    it("should report error to stderr when config has no topic", async () => {
      const stderr = createMockWriter();
      const noTopicConfig = {
        topic: "",
        ntfyServer: "https://ntfy.sh",
        timeout: 120,
        autoApprove: [],
        autoDeny: [],
      };
      const deps = createDeps({ config: noTopicConfig, stderr });

      await main(["test"], deps);

      const output = stderr.output();
      assert.ok(
        output.length > 0,
        "stderr should contain an error message when topic is empty",
      );
      assert.equal(
        deps.sendNotification.mock.callCount(),
        0,
        "sendNotification should NOT be called when topic is empty",
      );
    });
  });

  // =========================================================================
  // status subcommand
  // =========================================================================

  describe("status subcommand", () => {
    it("should load config and write settings to stdout", async () => {
      const stdout = createMockWriter();
      const deps = createDeps({ stdout });

      await main(["status"], deps);

      assert.equal(
        deps.loadConfig.mock.callCount(),
        1,
        "loadConfig should be called once",
      );

      const output = stdout.output();
      assert.ok(
        output.includes("test-topic-abc"),
        `stdout should contain the topic, got: ${output}`,
      );
      assert.ok(
        output.includes("https://ntfy.sh"),
        `stdout should contain the server URL, got: ${output}`,
      );
    });
  });

  // =========================================================================
  // hook subcommand
  // =========================================================================

  describe("hook subcommand", () => {
    it("should read JSON from stdin, call processHook, and write result to stdout", async () => {
      const hookInput = {
        hookName: "PreToolUse",
        toolName: "Bash",
        toolInput: { command: "ls -la" },
      };
      const stdout = createMockWriter();
      const deps = createDeps({
        stdin: JSON.stringify(hookInput),
        stdout,
      });

      await main(["hook"], deps);

      assert.equal(
        deps.processHook.mock.callCount(),
        1,
        "processHook should be called exactly once",
      );

      // Verify the input passed to processHook
      const callArgs = deps.processHook.mock.calls[0].arguments[0];
      assert.equal(callArgs.toolName, "Bash");
      assert.deepEqual(callArgs.toolInput, { command: "ls -la" });
    });

    it("should output valid JSON for allow decision", async () => {
      const stdout = createMockWriter();
      const deps = createDeps({
        stdin: JSON.stringify({
          hookName: "PreToolUse",
          toolName: "Bash",
          toolInput: { command: "echo allowed" },
        }),
        stdout,
        hookResult: {
          hookSpecificOutput: { decision: { behavior: "allow" } },
        },
      });

      await main(["hook"], deps);

      const output = stdout.output();
      assert.ok(output.endsWith("\n"), "hook output should end with a newline");
      const parsed = JSON.parse(output);
      assert.equal(parsed.hookSpecificOutput.decision.behavior, "allow");
    });

    it("should output valid JSON for deny decision", async () => {
      const stdout = createMockWriter();
      const deps = createDeps({
        stdin: JSON.stringify({
          hookName: "PreToolUse",
          toolName: "Bash",
          toolInput: { command: "rm -rf /" },
        }),
        stdout,
        hookResult: {
          hookSpecificOutput: { decision: { behavior: "deny" } },
        },
      });

      await main(["hook"], deps);

      const output = stdout.output();
      assert.ok(output.endsWith("\n"), "hook output should end with a newline");
      const parsed = JSON.parse(output);
      assert.equal(parsed.hookSpecificOutput.decision.behavior, "deny");
    });

    it("should output deny JSON when stdin contains malformed JSON", async () => {
      const stdout = createMockWriter();
      const deps = createDeps({
        stdin: "this is not valid json{{{",
        stdout,
      });

      await main(["hook"], deps);

      const output = stdout.output();
      assert.ok(output.endsWith("\n"), "hook output should end with a newline");
      const parsed = JSON.parse(output);
      assert.equal(parsed.hookSpecificOutput.decision.behavior, "deny");
      assert.equal(
        deps.processHook.mock.callCount(),
        0,
        "processHook should NOT be called when JSON parsing fails",
      );
    });

    it("should output deny JSON when processHook throws an error", async () => {
      const stdout = createMockWriter();
      const deps = createDeps({
        stdin: JSON.stringify({
          hookName: "PreToolUse",
          toolName: "Bash",
          toolInput: { command: "ls" },
        }),
        stdout,
        processHook: mock.fn(async () => {
          throw new Error("processHook failed");
        }),
      });

      await main(["hook"], deps);

      const output = stdout.output();
      assert.ok(output.endsWith("\n"), "hook output should end with a newline");
      const parsed = JSON.parse(output);
      assert.equal(parsed.hookSpecificOutput.decision.behavior, "deny");
    });
  });

  // =========================================================================
  // --help and --version flags
  // =========================================================================

  describe("--help and --version flags", () => {
    it("should output usage to stdout when --help is passed", async () => {
      const stdout = createMockWriter();
      const deps = createDeps({ stdout });

      await main(["--help"], deps);

      const output = stdout.output();
      assert.ok(
        output.includes("Usage:"),
        `stdout should contain usage text, got: ${output}`,
      );
      assert.ok(
        output.includes("setup"),
        `stdout should mention setup command, got: ${output}`,
      );
      assert.equal(
        deps.exit.mock.callCount(),
        0,
        "exit should NOT be called for --help",
      );
    });

    it("should output usage to stdout when -h is passed", async () => {
      const stdout = createMockWriter();
      const deps = createDeps({ stdout });

      await main(["-h"], deps);

      const output = stdout.output();
      assert.ok(
        output.includes("Usage:"),
        `stdout should contain usage text for -h, got: ${output}`,
      );
    });

    it("should output version to stdout when --version is passed", async () => {
      const stdout = createMockWriter();
      const deps = createDeps({ stdout });

      await main(["--version"], deps);

      const output = stdout.output();
      assert.ok(
        output.includes("0.1.0"),
        `stdout should contain version, got: ${output}`,
      );
    });

    it("should output version to stdout when -v is passed", async () => {
      const stdout = createMockWriter();
      const deps = createDeps({ stdout });

      await main(["-v"], deps);

      const output = stdout.output();
      assert.ok(
        output.includes("0.1.0"),
        `stdout should contain version for -v, got: ${output}`,
      );
    });
  });

  // =========================================================================
  // no args / unknown command
  // =========================================================================

  describe("no args or unknown command", () => {
    it("should write usage/help to stderr when called with no args", async () => {
      const stderr = createMockWriter();
      const deps = createDeps({ stderr });

      await main([], deps);

      const output = stderr.output();
      assert.ok(
        output.length > 0,
        "stderr should contain usage information when no args given",
      );
    });

    it("should write usage/help to stderr when called with unknown command", async () => {
      const stderr = createMockWriter();
      const deps = createDeps({ stderr });

      await main(["foobar"], deps);

      const output = stderr.output();
      assert.ok(
        output.length > 0,
        "stderr should contain usage information for unknown command",
      );
    });

    it("should call exit with non-zero code for unknown command", async () => {
      const deps = createDeps();

      await main(["unknown-cmd"], deps);

      assert.equal(
        deps.exit.mock.callCount(),
        1,
        "exit should be called once for unknown command",
      );
      assert.equal(
        deps.exit.mock.calls[0].arguments[0],
        1,
        "exit code should be 1",
      );
    });
  });
});
