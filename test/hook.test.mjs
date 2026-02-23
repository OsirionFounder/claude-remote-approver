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
import { processHook, buildActions, sendWithRetry, isAskUserQuestion, buildQuestionActions, buildQuestionMessage, processAskUserQuestion } from "../src/hook.mjs";

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

  it("should return ask when config has no topic set", async () => {
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
        decision: { behavior: "ask" },
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

  it("should return ask when all sendNotification retries fail", async () => {
    const deps = createDeps();
    deps.sendNotification = mock.fn(async () => {
      throw new Error("network error");
    });

    const result = await processHook(sampleInput, deps);

    assert.equal(deps.sendNotification.mock.callCount(), 3, "sendNotification should be called 3 times (retry logic)");
    assert.deepEqual(result, {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "ask" },
      },
    });
  });

  it("should return ask when waitForResponse throws", async () => {
    const deps = createDeps();
    deps.waitForResponse = mock.fn(async () => {
      throw new Error("timeout exceeded");
    });

    const result = await processHook(sampleInput, deps);

    assert.deepEqual(result, {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "ask" },
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

  // ==================== waitForResponse edge cases ====================

  it("should return ask when waitForResponse returns { timeout: true }", async () => {
    const deps = createDeps();
    deps.waitForResponse = mock.fn(async () => ({ timeout: true }));

    const result = await processHook(sampleInput, deps);

    assert.deepEqual(result, {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "ask" },
      },
    });
  });

  it("should return ask when waitForResponse returns { error: Error }", async () => {
    const deps = createDeps();
    deps.waitForResponse = mock.fn(async () => ({ error: new Error("SSE failure") }));

    const result = await processHook(sampleInput, deps);

    assert.deepEqual(result, {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "ask" },
      },
    });
  });

  // ==================== sendWithRetry via processHook ====================

  it("should succeed on second retry when sendNotification fails once then succeeds", async () => {
    const deps = createDeps();
    let callCount = 0;
    deps.sendNotification = mock.fn(async () => {
      callCount++;
      if (callCount === 1) throw new Error("first attempt fails");
      return { ok: true, status: 200 };
    });

    const result = await processHook(sampleInput, deps);

    assert.equal(deps.sendNotification.mock.callCount(), 2, "sendNotification should be called twice");
    assert.deepEqual(result, {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "allow" },
      },
    });
  });

  it("should route AskUserQuestion to processAskUserQuestion", async () => {
    const askInput = {
      tool_name: "AskUserQuestion",
      tool_input: {
        questions: [{
          question: "Which option?",
          header: "Choice",
          options: [{ label: "A", description: "a" }, { label: "B", description: "b" }],
          multiSelect: false,
        }],
      },
    };
    const deps = createDeps();
    deps.waitForResponse = mock.fn(async () => ({ answer: "A" }));

    const result = await processHook(askInput, deps);

    assert.equal(result.hookSpecificOutput.decision.behavior, "allow");
    assert.ok(result.hookSpecificOutput.decision.updatedInput, "Should have updatedInput from processAskUserQuestion");
    assert.deepEqual(result.hookSpecificOutput.decision.updatedInput.answers, { "Which option?": "A" });
  });
});

// ---------------------------------------------------------------------------
// sendWithRetry
// ---------------------------------------------------------------------------

describe("sendWithRetry", () => {
  it("should be a function exported from the module", () => {
    assert.equal(typeof sendWithRetry, "function");
  });

  it("should return the result on first success", async () => {
    const mockSend = mock.fn(async () => ({ ok: true }));
    const result = await sendWithRetry(mockSend, { server: "s", topic: "t" });
    assert.deepEqual(result, { ok: true });
    assert.equal(mockSend.mock.callCount(), 1);
  });

  it("should retry up to 3 times and return null on all failures", async () => {
    const mockSend = mock.fn(async () => { throw new Error("fail"); });
    const result = await sendWithRetry(mockSend, { server: "s", topic: "t" });
    assert.equal(result, null);
    assert.equal(mockSend.mock.callCount(), 3);
  });

  it("should succeed on second attempt after first failure", async () => {
    let count = 0;
    const mockSend = mock.fn(async () => {
      count++;
      if (count === 1) throw new Error("fail");
      return { ok: true };
    });
    const result = await sendWithRetry(mockSend, { server: "s", topic: "t" });
    assert.deepEqual(result, { ok: true });
    assert.equal(mockSend.mock.callCount(), 2);
  });
});

// ---------------------------------------------------------------------------
// isAskUserQuestion
// ---------------------------------------------------------------------------

describe("isAskUserQuestion", () => {
  it("should be a function exported from the module", () => {
    assert.equal(typeof isAskUserQuestion, "function");
  });

  it("should return true for AskUserQuestion with questions array", () => {
    const input = {
      tool_name: "AskUserQuestion",
      tool_input: {
        questions: [{ question: "Which?", header: "Q", options: [{ label: "A", description: "a" }, { label: "B", description: "b" }], multiSelect: false }],
      },
    };
    assert.equal(isAskUserQuestion(input), true);
  });

  it("should return false for non-AskUserQuestion tools", () => {
    assert.equal(isAskUserQuestion({ tool_name: "Bash", tool_input: { command: "ls" } }), false);
  });

  it("should return false when questions is empty array", () => {
    assert.equal(isAskUserQuestion({ tool_name: "AskUserQuestion", tool_input: { questions: [] } }), false);
  });

  it("should return false when questions is not an array", () => {
    assert.equal(isAskUserQuestion({ tool_name: "AskUserQuestion", tool_input: { questions: "not array" } }), false);
  });

  it("should return false for null input", () => {
    assert.equal(isAskUserQuestion(null), false);
  });

  it("should return false for undefined input", () => {
    assert.equal(isAskUserQuestion(undefined), false);
  });
});

// ---------------------------------------------------------------------------
// buildQuestionActions
// ---------------------------------------------------------------------------

describe("buildQuestionActions", () => {
  it("should be a function exported from the module", () => {
    assert.equal(typeof buildQuestionActions, "function");
  });

  it("should return http actions for each option", () => {
    const options = [
      { label: "Option A", description: "desc A" },
      { label: "Option B", description: "desc B" },
    ];
    const actions = buildQuestionActions("https://ntfy.sh", "topic", "req-1", options);

    assert.equal(actions.length, 2);
    assert.equal(actions[0].action, "http");
    assert.equal(actions[0].label, "Option A");
    assert.equal(actions[1].label, "Option B");
  });

  it("should encode answer in the body", () => {
    const options = [{ label: "My Choice", description: "desc" }];
    const actions = buildQuestionActions("https://ntfy.sh", "topic", "req-1", options);

    const body = JSON.parse(actions[0].body);
    assert.equal(body.requestId, "req-1");
    assert.equal(body.answer, "My Choice");
  });

  it("should use {topic}-response URL", () => {
    const options = [{ label: "A", description: "a" }];
    const actions = buildQuestionActions("https://ntfy.sh", "my-topic", "req-1", options);

    assert.equal(actions[0].url, "https://ntfy.sh/my-topic-response");
  });
});

// ---------------------------------------------------------------------------
// buildQuestionMessage
// ---------------------------------------------------------------------------

describe("buildQuestionMessage", () => {
  it("should be a function exported from the module", () => {
    assert.equal(typeof buildQuestionMessage, "function");
  });

  it("should include the question text", () => {
    const msg = buildQuestionMessage("Which color?", [{ label: "Red", description: "warm" }, { label: "Blue", description: "cool" }]);
    assert.ok(msg.includes("Which color?"), `Should include question, got: ${msg}`);
  });

  it("should include option labels and descriptions", () => {
    const msg = buildQuestionMessage("Pick one", [
      { label: "A", description: "first option" },
      { label: "B", description: "second option" },
    ]);
    assert.ok(msg.includes("A"), `Should include label A, got: ${msg}`);
    assert.ok(msg.includes("first option"), `Should include description, got: ${msg}`);
  });

  it("should include multiSelect note when specified", () => {
    const msg = buildQuestionMessage("Pick many", [{ label: "X", description: "x" }], { multiSelect: true });
    assert.ok(msg.includes("multiple") || msg.includes("複数"), `Should mention multiple selection, got: ${msg}`);
  });

  it("should include batch info when provided", () => {
    const msg = buildQuestionMessage("Pick", [{ label: "A", description: "a" }], { batchInfo: "(1/2)" });
    assert.ok(msg.includes("(1/2)"), `Should include batch info, got: ${msg}`);
  });
});

// ---------------------------------------------------------------------------
// processAskUserQuestion
// ---------------------------------------------------------------------------

describe("processAskUserQuestion", () => {
  it("should be a function exported from the module", () => {
    assert.equal(typeof processAskUserQuestion, "function");
  });

  it("should return allow with answers for a single question with answer", async () => {
    const input = {
      tool_name: "AskUserQuestion",
      tool_input: {
        questions: [{
          question: "Which?",
          header: "Q",
          options: [{ label: "A", description: "a" }, { label: "B", description: "b" }],
          multiSelect: false,
        }],
      },
    };
    const deps = {
      loadConfig: mock.fn(() => ({
        topic: "test-topic",
        ntfyServer: "https://ntfy.sh",
        timeout: 120,
      })),
      sendNotification: mock.fn(async () => ({ ok: true })),
      waitForResponse: mock.fn(async () => ({ answer: "A" })),
    };

    const result = await processAskUserQuestion(input, deps);

    assert.equal(result.hookSpecificOutput.decision.behavior, "allow");
    assert.ok(result.hookSpecificOutput.decision.updatedInput);
    assert.deepEqual(result.hookSpecificOutput.decision.updatedInput.answers, { "Which?": "A" });
  });

  it("should return ask when sendNotification fails after retries", async () => {
    const input = {
      tool_name: "AskUserQuestion",
      tool_input: {
        questions: [{
          question: "Which?",
          header: "Q",
          options: [{ label: "A", description: "a" }],
          multiSelect: false,
        }],
      },
    };
    const deps = {
      loadConfig: mock.fn(() => ({
        topic: "test-topic",
        ntfyServer: "https://ntfy.sh",
        timeout: 120,
      })),
      sendNotification: mock.fn(async () => { throw new Error("fail"); }),
      waitForResponse: mock.fn(async () => ({ answer: "A" })),
    };

    const result = await processAskUserQuestion(input, deps);

    assert.equal(result.hookSpecificOutput.decision.behavior, "ask");
  });

  it("should return ask when waitForResponse returns timeout", async () => {
    const input = {
      tool_name: "AskUserQuestion",
      tool_input: {
        questions: [{
          question: "Which?",
          header: "Q",
          options: [{ label: "A", description: "a" }],
          multiSelect: false,
        }],
      },
    };
    const deps = {
      loadConfig: mock.fn(() => ({
        topic: "test-topic",
        ntfyServer: "https://ntfy.sh",
        timeout: 120,
      })),
      sendNotification: mock.fn(async () => ({ ok: true })),
      waitForResponse: mock.fn(async () => ({ timeout: true })),
    };

    const result = await processAskUserQuestion(input, deps);

    assert.equal(result.hookSpecificOutput.decision.behavior, "ask");
  });

  it("should split 4 options into 2 notifications", async () => {
    const input = {
      tool_name: "AskUserQuestion",
      tool_input: {
        questions: [{
          question: "Pick one",
          header: "Q",
          options: [
            { label: "A", description: "a" },
            { label: "B", description: "b" },
            { label: "C", description: "c" },
            { label: "D", description: "d" },
          ],
          multiSelect: false,
        }],
      },
    };
    const deps = {
      loadConfig: mock.fn(() => ({
        topic: "test-topic",
        ntfyServer: "https://ntfy.sh",
        timeout: 120,
      })),
      sendNotification: mock.fn(async () => ({ ok: true })),
      waitForResponse: mock.fn(async () => ({ answer: "C" })),
    };

    const result = await processAskUserQuestion(input, deps);

    assert.equal(deps.sendNotification.mock.callCount(), 2, "Should send 2 notifications for 4 options");
    assert.equal(result.hookSpecificOutput.decision.behavior, "allow");
    assert.deepEqual(result.hookSpecificOutput.decision.updatedInput.answers, { "Pick one": "C" });
  });

  it("should split 5 options into 2 notifications (3+2)", async () => {
    const input = {
      tool_name: "AskUserQuestion",
      tool_input: {
        questions: [{
          question: "Pick one of five",
          header: "Q",
          options: [
            { label: "A", description: "a" },
            { label: "B", description: "b" },
            { label: "C", description: "c" },
            { label: "D", description: "d" },
            { label: "E", description: "e" },
          ],
          multiSelect: false,
        }],
      },
    };
    const deps = {
      loadConfig: mock.fn(() => ({
        topic: "test-topic",
        ntfyServer: "https://ntfy.sh",
        timeout: 120,
      })),
      sendNotification: mock.fn(async () => ({ ok: true })),
      waitForResponse: mock.fn(async () => ({ answer: "D" })),
    };

    const result = await processAskUserQuestion(input, deps);

    assert.equal(deps.sendNotification.mock.callCount(), 2, "Should send 2 notifications for 5 options (3+2)");
    assert.equal(result.hookSpecificOutput.decision.behavior, "allow");
    assert.deepEqual(result.hookSpecificOutput.decision.updatedInput.answers, { "Pick one of five": "D" });
  });

  it("should handle multiple questions", async () => {
    const input = {
      tool_name: "AskUserQuestion",
      tool_input: {
        questions: [
          {
            question: "Q1?",
            header: "H1",
            options: [{ label: "A1", description: "a1" }, { label: "B1", description: "b1" }],
            multiSelect: false,
          },
          {
            question: "Q2?",
            header: "H2",
            options: [{ label: "A2", description: "a2" }, { label: "B2", description: "b2" }],
            multiSelect: false,
          },
        ],
      },
    };
    let waitCallCount = 0;
    const deps = {
      loadConfig: mock.fn(() => ({
        topic: "test-topic",
        ntfyServer: "https://ntfy.sh",
        timeout: 120,
      })),
      sendNotification: mock.fn(async () => ({ ok: true })),
      waitForResponse: mock.fn(async () => {
        waitCallCount++;
        return { answer: waitCallCount === 1 ? "A1" : "B2" };
      }),
    };

    const result = await processAskUserQuestion(input, deps);

    assert.equal(result.hookSpecificOutput.decision.behavior, "allow");
    assert.deepEqual(result.hookSpecificOutput.decision.updatedInput.answers, { "Q1?": "A1", "Q2?": "B2" });
  });
});
