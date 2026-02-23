/**
 * Test suite for src/hook.mjs
 *
 * Coverage:
 * - buildActions: returns correct structure with 2 actions (Approve / Deny)
 * - buildActions: URLs point to the response topic ({topic}-response)
 * - processHook: returns allow decision when waitForResponse returns approved:true
 * - processHook: returns deny decision when waitForResponse returns approved:false
 * - processHook: returns deny with message when config has no topic
 * - processHook: calls sendNotification with correct parameters
 * - processHook: calls waitForResponse with correct topic and timeout
 *
 * TDD Red phase — all tests must FAIL because the implementation is a stub.
 */

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { processHook, buildActions } from "../src/hook.mjs";

// ---------------------------------------------------------------------------
// buildActions
// ---------------------------------------------------------------------------

describe("buildActions", () => {
  it("should be a function exported from the module", () => {
    assert.equal(typeof buildActions, "function");
  });

  it("should return an array with exactly 2 actions", () => {
    const actions = buildActions("https://ntfy.sh", "my-topic", "req-001");

    assert.ok(Array.isArray(actions), "should return an array");
    assert.equal(actions.length, 2, "should have exactly 2 actions");
  });

  it("should have Approve as the first action and Deny as the second", () => {
    const actions = buildActions("https://ntfy.sh", "my-topic", "req-002");

    assert.equal(actions[0].label, "Approve");
    assert.equal(actions[1].label, "Deny");
  });

  it("should set action type to 'http' for both actions", () => {
    const actions = buildActions("https://ntfy.sh", "my-topic", "req-003");

    assert.equal(actions[0].action, "http");
    assert.equal(actions[1].action, "http");
  });

  it("should use response topic URLs ({topic}-response)", () => {
    const actions = buildActions("https://ntfy.sh", "my-topic", "req-004");

    assert.equal(
      actions[0].url,
      "https://ntfy.sh/my-topic-response",
      `Approve URL should use response topic, got: ${actions[0].url}`
    );
    assert.equal(
      actions[1].url,
      "https://ntfy.sh/my-topic-response",
      `Deny URL should use response topic, got: ${actions[1].url}`
    );
  });

  it("should use POST method for both actions", () => {
    const actions = buildActions("https://ntfy.sh", "my-topic", "req-005");

    assert.equal(actions[0].method, "POST");
    assert.equal(actions[1].method, "POST");
  });

  it("should not include Content-Type header to avoid ntfy JSON publishing mode", () => {
    const actions = buildActions("https://ntfy.sh", "my-topic", "req-006");

    assert.equal(actions[0].headers, undefined);
    assert.equal(actions[1].headers, undefined);
  });

  it("should include requestId and approved:true in Approve body", () => {
    const actions = buildActions("https://ntfy.sh", "my-topic", "req-007");

    const body = JSON.parse(actions[0].body);
    assert.equal(body.requestId, "req-007");
    assert.equal(body.approved, true);
  });

  it("should include requestId and approved:false in Deny body", () => {
    const actions = buildActions("https://ntfy.sh", "my-topic", "req-008");

    const body = JSON.parse(actions[1].body);
    assert.equal(body.requestId, "req-008");
    assert.equal(body.approved, false);
  });

  it("should handle custom server URLs correctly", () => {
    const actions = buildActions(
      "https://custom.ntfy.example.com",
      "cra-abc123",
      "req-009"
    );

    assert.equal(
      actions[0].url,
      "https://custom.ntfy.example.com/cra-abc123-response"
    );
    assert.equal(
      actions[1].url,
      "https://custom.ntfy.example.com/cra-abc123-response"
    );
  });
});

// ---------------------------------------------------------------------------
// processHook
// ---------------------------------------------------------------------------

describe("processHook", () => {
  /**
   * Creates a standard set of dependency stubs for processHook.
   * Override individual stubs as needed in each test.
   */
  function createDeps(overrides = {}) {
    const defaultConfig = {
      topic: "test-topic",
      ntfyServer: "https://ntfy.sh",
      timeout: 120,
      planTimeout: 300,
      autoApprove: [],
      autoDeny: [],
    };

    return {
      loadConfig: mock.fn(() => overrides.config ?? defaultConfig),
      sendNotification: mock.fn(async () => ({ ok: true, status: 200 })),
      waitForResponse: mock.fn(
        async () => overrides.waitResult ?? { approved: true }
      ),
      formatToolInfo: mock.fn(() => overrides.toolInfo ?? {
        title: "Claude Code: Bash",
        message: "echo hello",
      }),
      ...overrides,
    };
  }

  /** Standard input mimicking a Claude Code hook payload. */
  const sampleInput = {
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "echo hello" },
  };

  it("should be a function exported from the module", () => {
    assert.equal(typeof processHook, "function");
  });

  // ==================== Happy Path: Approve ====================

  it("should return allow decision when waitForResponse returns approved:true", async () => {
    const deps = createDeps({ waitResult: { approved: true } });

    const result = await processHook(sampleInput, deps);

    assert.deepEqual(result, {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "allow" },
      },
    });
  });

  // ==================== Happy Path: Deny ====================

  it("should return deny decision when waitForResponse returns approved:false", async () => {
    const deps = createDeps({ waitResult: { approved: false } });

    const result = await processHook(sampleInput, deps);

    assert.deepEqual(result, {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "deny" },
      },
    });
  });

  // ==================== No Topic Configured ====================

  it("should return deny when config has no topic set", async () => {
    const noTopicConfig = {
      topic: "",
      ntfyServer: "https://ntfy.sh",
      timeout: 120,
      autoApprove: [],
      autoDeny: [],
    };
    const deps = createDeps({ config: noTopicConfig });

    const result = await processHook(sampleInput, deps);

    assert.deepEqual(result, {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "deny" },
      },
    });
  });

  it("should not call sendNotification when config has no topic", async () => {
    const noTopicConfig = {
      topic: "",
      ntfyServer: "https://ntfy.sh",
      timeout: 120,
      autoApprove: [],
      autoDeny: [],
    };
    const deps = createDeps({ config: noTopicConfig });

    await processHook(sampleInput, deps);

    assert.equal(
      deps.sendNotification.mock.callCount(),
      0,
      "sendNotification should not be called when topic is empty"
    );
  });

  // ==================== sendNotification parameters ====================

  it("should call sendNotification with correct topic from config", async () => {
    const deps = createDeps();

    await processHook(sampleInput, deps);

    assert.equal(deps.sendNotification.mock.callCount(), 1);
    const callArgs = deps.sendNotification.mock.calls[0].arguments[0];
    assert.equal(callArgs.topic, "test-topic");
  });

  it("should call sendNotification with title and message from formatToolInfo", async () => {
    const deps = createDeps({
      toolInfo: { title: "Claude Code: Read", message: "/path/to/file.ts" },
    });

    await processHook(sampleInput, deps);

    const callArgs = deps.sendNotification.mock.calls[0].arguments[0];
    assert.equal(callArgs.title, "Claude Code: Read");
    assert.equal(callArgs.message, "/path/to/file.ts");
  });

  it("should call sendNotification with actions array containing 2 actions", async () => {
    const deps = createDeps();

    await processHook(sampleInput, deps);

    const callArgs = deps.sendNotification.mock.calls[0].arguments[0];
    assert.ok(Array.isArray(callArgs.actions), "actions should be an array");
    assert.equal(callArgs.actions.length, 2);
  });

  it("should call sendNotification with server from config", async () => {
    const deps = createDeps();

    await processHook(sampleInput, deps);

    const callArgs = deps.sendNotification.mock.calls[0].arguments[0];
    assert.equal(callArgs.server, "https://ntfy.sh");
  });

  // ==================== waitForResponse parameters ====================

  it("should call waitForResponse with response topic ({topic}-response)", async () => {
    const deps = createDeps();

    await processHook(sampleInput, deps);

    assert.equal(deps.waitForResponse.mock.callCount(), 1);
    const callArgs = deps.waitForResponse.mock.calls[0].arguments[0];
    assert.equal(
      callArgs.topic,
      "test-topic",
      `waitForResponse should receive the topic, got: ${callArgs.topic}`
    );
  });

  it("should call waitForResponse with timeout from config", async () => {
    const customConfig = {
      topic: "test-topic",
      ntfyServer: "https://ntfy.sh",
      timeout: 300,
      planTimeout: 300,
      autoApprove: [],
      autoDeny: [],
    };
    const deps = createDeps({ config: customConfig });

    await processHook(sampleInput, deps);

    const callArgs = deps.waitForResponse.mock.calls[0].arguments[0];
    assert.equal(
      callArgs.timeout,
      300 * 1000,
      `timeout should be config.timeout * 1000 (300000), got: ${callArgs.timeout}`
    );
  });

  it("should call waitForResponse with server from config", async () => {
    const customConfig = {
      topic: "test-topic",
      ntfyServer: "https://custom.ntfy.example.com",
      timeout: 120,
      planTimeout: 300,
      autoApprove: [],
      autoDeny: [],
    };
    const deps = createDeps({ config: customConfig });

    await processHook(sampleInput, deps);

    const callArgs = deps.waitForResponse.mock.calls[0].arguments[0];
    assert.equal(callArgs.server, "https://custom.ntfy.example.com");
  });

  // ==================== Error handling ====================

  it("should return deny when sendNotification throws", async () => {
    const deps = createDeps();
    deps.sendNotification = mock.fn(async () => {
      throw new Error("network error");
    });

    const result = await processHook(sampleInput, deps);

    assert.deepEqual(result, {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "deny" },
      },
    });
  });

  it("should return deny when waitForResponse throws", async () => {
    const deps = createDeps();
    deps.waitForResponse = mock.fn(async () => {
      throw new Error("timeout exceeded");
    });

    const result = await processHook(sampleInput, deps);

    assert.deepEqual(result, {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "deny" },
      },
    });
  });

  it("should log error to console.error when sendNotification throws", async () => {
    const deps = createDeps();
    deps.sendNotification = mock.fn(async () => {
      throw new Error("network error");
    });
    const errorSpy = mock.method(console, "error", () => {});

    try {
      await processHook(sampleInput, deps);
      assert.equal(errorSpy.mock.callCount(), 1);
      assert.ok(
        errorSpy.mock.calls[0].arguments.some(
          (arg) => typeof arg === "string" && arg.includes("sendNotification")
        ),
        "console.error should mention sendNotification"
      );
    } finally {
      errorSpy.mock.restore();
    }
  });

  it("should log error to console.error when waitForResponse throws", async () => {
    const deps = createDeps();
    deps.waitForResponse = mock.fn(async () => {
      throw new Error("timeout exceeded");
    });
    const errorSpy = mock.method(console, "error", () => {});

    try {
      await processHook(sampleInput, deps);
      assert.equal(errorSpy.mock.callCount(), 1);
      assert.ok(
        errorSpy.mock.calls[0].arguments.some(
          (arg) => typeof arg === "string" && arg.includes("waitForResponse")
        ),
        "console.error should mention waitForResponse"
      );
    } finally {
      errorSpy.mock.restore();
    }
  });

  // ==================== ExitPlanMode timeout ====================

  it("should use planTimeout for ExitPlanMode tool", async () => {
    const customConfig = {
      topic: "test-topic",
      ntfyServer: "https://ntfy.sh",
      timeout: 120,
      planTimeout: 300,
      autoApprove: [],
      autoDeny: [],
    };
    const deps = createDeps({ config: customConfig });
    const exitPlanInput = {
      hook_event_name: "PreToolUse",
      tool_name: "ExitPlanMode",
      tool_input: {},
    };

    await processHook(exitPlanInput, deps);

    const callArgs = deps.waitForResponse.mock.calls[0].arguments[0];
    assert.equal(
      callArgs.timeout,
      300 * 1000,
      `ExitPlanMode timeout should be planTimeout * 1000 (300000), got: ${callArgs.timeout}`
    );
  });

  it("should use regular timeout for non-ExitPlanMode tools", async () => {
    const customConfig = {
      topic: "test-topic",
      ntfyServer: "https://ntfy.sh",
      timeout: 120,
      planTimeout: 300,
      autoApprove: [],
      autoDeny: [],
    };
    const deps = createDeps({ config: customConfig });

    await processHook(sampleInput, deps);

    const callArgs = deps.waitForResponse.mock.calls[0].arguments[0];
    assert.equal(
      callArgs.timeout,
      120 * 1000,
      `Regular tool timeout should be timeout * 1000 (120000), got: ${callArgs.timeout}`
    );
  });

  it("should fall back to 300s when planTimeout is not set in config for ExitPlanMode", async () => {
    const configWithoutPlanTimeout = {
      topic: "test-topic",
      ntfyServer: "https://ntfy.sh",
      timeout: 120,
      autoApprove: [],
      autoDeny: [],
    };
    const deps = createDeps({ config: configWithoutPlanTimeout });
    const exitPlanInput = {
      hook_event_name: "PreToolUse",
      tool_name: "ExitPlanMode",
      tool_input: {},
    };

    await processHook(exitPlanInput, deps);

    const callArgs = deps.waitForResponse.mock.calls[0].arguments[0];
    assert.equal(
      callArgs.timeout,
      300 * 1000,
      `ExitPlanMode should fall back to 300s (300000), got: ${callArgs.timeout}`
    );
  });

  // ==================== formatToolInfo ====================

  it("should call formatToolInfo with the input", async () => {
    const deps = createDeps();

    await processHook(sampleInput, deps);

    assert.equal(deps.formatToolInfo.mock.callCount(), 1);
    const callArgs = deps.formatToolInfo.mock.calls[0].arguments[0];
    assert.equal(callArgs.tool_name, "Bash");
    assert.deepEqual(callArgs.tool_input, { command: "echo hello" });
  });

  // ==================== loadConfig ====================

  it("should call loadConfig exactly once", async () => {
    const deps = createDeps();

    await processHook(sampleInput, deps);

    assert.equal(deps.loadConfig.mock.callCount(), 1);
  });
});
