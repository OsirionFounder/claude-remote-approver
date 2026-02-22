/**
 * Test suite for src/ntfy.mjs
 *
 * Coverage:
 * - sendNotification: URL construction, HTTP method, headers, body, actions
 * - waitForResponse: polling-based response retrieval, requestId filtering, timeout handling
 * - formatToolInfo: formatting for Bash, Read, and Write tools
 *
 * TDD Red phase — all tests must FAIL because the implementation does not exist yet.
 */

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { sendNotification, waitForResponse, formatToolInfo } from "../src/ntfy.mjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a mock fetch that captures the request and returns a canned response.
 */
function createMockFetch(responseBody = {}, status = 200) {
  const calls = [];
  const fn = mock.fn(async (url, options) => {
    calls.push({ url, options });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => responseBody,
      text: async () => JSON.stringify(responseBody),
    };
  });
  fn.calls = calls;
  return fn;
}

// ---------------------------------------------------------------------------
// sendNotification
// ---------------------------------------------------------------------------

describe("sendNotification", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should be a function exported from the module", () => {
    assert.equal(typeof sendNotification, "function");
  });

  it("should POST to the base server URL for JSON publishing", async () => {
    const mockFetch = createMockFetch();
    globalThis.fetch = mockFetch;

    await sendNotification({
      server: "https://ntfy.sh",
      topic: "my-topic",
      title: "Test",
      message: "Hello",
      actions: [],
      requestId: "req-001",
    });

    assert.equal(mockFetch.calls.length, 1);
    assert.equal(mockFetch.calls[0].url, "https://ntfy.sh");
  });

  it("should use HTTP POST method", async () => {
    const mockFetch = createMockFetch();
    globalThis.fetch = mockFetch;

    await sendNotification({
      server: "https://ntfy.sh",
      topic: "test-topic",
      title: "Title",
      message: "Body",
      actions: [],
      requestId: "req-002",
    });

    assert.equal(mockFetch.calls[0].options.method, "POST");
  });

  it("should send Content-Type: application/json header", async () => {
    const mockFetch = createMockFetch();
    globalThis.fetch = mockFetch;

    await sendNotification({
      server: "https://ntfy.sh",
      topic: "test-topic",
      title: "Title",
      message: "Body",
      actions: [],
      requestId: "req-003",
    });

    const headers = mockFetch.calls[0].options.headers;
    // Headers may be a plain object or Headers instance
    const contentType =
      headers instanceof Headers
        ? headers.get("Content-Type")
        : headers["Content-Type"];
    assert.equal(contentType, "application/json");
  });

  it("should include title and message in the JSON body", async () => {
    const mockFetch = createMockFetch();
    globalThis.fetch = mockFetch;

    await sendNotification({
      server: "https://ntfy.sh",
      topic: "test-topic",
      title: "Approval Needed",
      message: "Run bash command?",
      actions: [],
      requestId: "req-004",
    });

    const body = JSON.parse(mockFetch.calls[0].options.body);
    assert.equal(body.title, "Approval Needed");
    assert.equal(body.message, "Run bash command?");
  });

  it("should include actions in the JSON body", async () => {
    const mockFetch = createMockFetch();
    globalThis.fetch = mockFetch;

    const actions = [
      {
        action: "http",
        label: "Approve",
        url: "https://ntfy.sh/my-response",
        method: "POST",
        body: JSON.stringify({ requestId: "req-005", approved: true }),
      },
      {
        action: "http",
        label: "Deny",
        url: "https://ntfy.sh/my-response",
        method: "POST",
        body: JSON.stringify({ requestId: "req-005", approved: false }),
      },
    ];

    await sendNotification({
      server: "https://ntfy.sh",
      topic: "test-topic",
      title: "Title",
      message: "Body",
      actions,
      requestId: "req-005",
    });

    const body = JSON.parse(mockFetch.calls[0].options.body);
    assert.ok(Array.isArray(body.actions), "body.actions should be an array");
    assert.equal(body.actions.length, 2);
    assert.equal(body.actions[0].label, "Approve");
    assert.equal(body.actions[1].label, "Deny");
  });

  it("should include the topic in the JSON body", async () => {
    const mockFetch = createMockFetch();
    globalThis.fetch = mockFetch;

    await sendNotification({
      server: "https://ntfy.sh",
      topic: "my-topic",
      title: "T",
      message: "M",
      actions: [],
      requestId: "req-006",
    });

    const body = JSON.parse(mockFetch.calls[0].options.body);
    assert.equal(body.topic, "my-topic");
  });

  it("should return the fetch response", async () => {
    const mockFetch = createMockFetch({ id: "abc123" }, 200);
    globalThis.fetch = mockFetch;

    const result = await sendNotification({
      server: "https://ntfy.sh",
      topic: "test-topic",
      title: "T",
      message: "M",
      actions: [],
      requestId: "req-007",
    });

    assert.ok(result, "should return a response object");
    assert.equal(result.status, 200);
  });

  it("should throw when fetch returns non-ok status", async () => {
    const mockFetch = createMockFetch({}, 500);
    globalThis.fetch = mockFetch;

    await assert.rejects(
      () =>
        sendNotification({
          server: "https://ntfy.sh",
          topic: "test-topic",
          title: "T",
          message: "M",
          actions: [],
          requestId: "req-err",
        }),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes("HTTP 500"),
          `Error message should include status code, got: "${err.message}"`
        );
        return true;
      }
    );
  });

  it("should handle server URLs with trailing slash", async () => {
    const mockFetch = createMockFetch();
    globalThis.fetch = mockFetch;

    await sendNotification({
      server: "https://ntfy.sh/",
      topic: "my-topic",
      title: "T",
      message: "M",
      actions: [],
      requestId: "req-008",
    });

    // Should strip trailing slash and POST to base URL only
    assert.equal(mockFetch.calls[0].url, "https://ntfy.sh");
  });
});

// ---------------------------------------------------------------------------
// waitForResponse
// ---------------------------------------------------------------------------

describe("waitForResponse", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should be a function exported from the module", () => {
    assert.equal(typeof waitForResponse, "function");
  });

  it("should poll the response topic with poll=1 and since parameter", async () => {
    const responseText =
      '{"event":"message","message":"{\\"requestId\\":\\"req-100\\",\\"approved\\":true}"}\n';
    const mockFetch = mock.fn(async (url, options) => ({
      ok: true,
      status: 200,
      text: async () => responseText,
    }));
    globalThis.fetch = mockFetch;

    await waitForResponse({
      server: "https://ntfy.sh",
      topic: "my-topic",
      requestId: "req-100",
      timeout: 5000,
      pollInterval: 10,
    });

    assert.ok(mockFetch.mock.callCount() >= 1, "fetch should be called at least once");
    const url = mockFetch.mock.calls[0].arguments[0];
    assert.ok(
      url.includes("poll=1"),
      `URL should include poll=1, got: ${url}`
    );
    assert.ok(
      /since=\d+/.test(url),
      `URL should include since= followed by a numeric Unix timestamp, got: ${url}`
    );
  });

  it("should return { approved: true } when matching requestId with approved:true", async () => {
    const responseText =
      '{"event":"message","message":"{\\"requestId\\":\\"req-200\\",\\"approved\\":true}"}\n';
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => responseText,
    }));

    const result = await waitForResponse({
      server: "https://ntfy.sh",
      topic: "my-topic",
      requestId: "req-200",
      timeout: 5000,
      pollInterval: 10,
    });

    assert.deepEqual(result, { approved: true });
  });

  it("should return { approved: false } when matching requestId with approved:false", async () => {
    const responseText =
      '{"event":"message","message":"{\\"requestId\\":\\"req-201\\",\\"approved\\":false}"}\n';
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => responseText,
    }));

    const result = await waitForResponse({
      server: "https://ntfy.sh",
      topic: "my-topic",
      requestId: "req-201",
      timeout: 5000,
      pollInterval: 10,
    });

    assert.deepEqual(result, { approved: false });
  });

  it("should filter by requestId and ignore non-matching messages", async () => {
    const responseText = [
      '{"event":"message","message":"{\\"requestId\\":\\"other-id\\",\\"approved\\":true}"}',
      '{"event":"message","message":"{\\"requestId\\":\\"req-300\\",\\"approved\\":false}"}',
    ].join("\n") + "\n";
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => responseText,
    }));

    const result = await waitForResponse({
      server: "https://ntfy.sh",
      topic: "my-topic",
      requestId: "req-300",
      timeout: 5000,
      pollInterval: 10,
    });

    // Should skip the first message (wrong requestId) and return the second
    assert.deepEqual(result, { approved: false });
  });

  it("should return { approved: false } on timeout", async () => {
    // Mock fetch always returns empty text (no messages)
    const mockFetch = mock.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "",
    }));
    globalThis.fetch = mockFetch;

    const result = await waitForResponse({
      server: "https://ntfy.sh",
      topic: "my-topic",
      requestId: "req-timeout",
      timeout: 200, // Very short timeout for fast test
      pollInterval: 10,
    });

    assert.deepEqual(result, { approved: false });
    // With a 200ms timeout and 10ms polling interval, fetch should be called at least once
    assert.ok(
      mockFetch.mock.callCount() >= 1,
      `fetch should be called at least once, was called ${mockFetch.mock.callCount()} times`
    );
  });

  it("should connect to {server}/{topic}-response/json endpoint", async () => {
    const responseText =
      '{"event":"message","message":"{\\"requestId\\":\\"req-400\\",\\"approved\\":true}"}\n';
    const mockFetch = mock.fn(async (url) => ({
      ok: true,
      status: 200,
      text: async () => responseText,
    }));
    globalThis.fetch = mockFetch;

    await waitForResponse({
      server: "https://ntfy.sh",
      topic: "my-topic",
      requestId: "req-400",
      timeout: 5000,
      pollInterval: 10,
    });

    const url = mockFetch.mock.calls[0].arguments[0];
    assert.ok(
      url.startsWith("https://ntfy.sh/my-topic-response/json"),
      `Expected polling endpoint URL to start with https://ntfy.sh/my-topic-response/json, got: ${url}`
    );
  });

  it("should poll multiple times if first poll has no match", async () => {
    let callCount = 0;
    const matchingText =
      '{"event":"message","message":"{\\"requestId\\":\\"req-500\\",\\"approved\\":true}"}\n';
    const mockFetch = mock.fn(async () => {
      callCount++;
      return {
        ok: true,
        status: 200,
        text: async () => (callCount <= 1 ? "" : matchingText),
      };
    });
    globalThis.fetch = mockFetch;

    const result = await waitForResponse({
      server: "https://ntfy.sh",
      topic: "my-topic",
      requestId: "req-500",
      timeout: 10000,
      pollInterval: 10,
    });

    assert.deepEqual(result, { approved: true });
    assert.ok(
      mockFetch.mock.callCount() >= 2,
      `fetch should be called at least twice, was called ${mockFetch.mock.callCount()} times`
    );
  });

  it("should handle fetch network errors gracefully", async () => {
    let callCount = 0;
    globalThis.fetch = mock.fn(async (url) => {
      callCount++;
      if (callCount === 1) {
        throw new Error("Network error");
      }
      // Second call returns a match
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ event: "message", message: JSON.stringify({ requestId: "req-net", approved: true }) }),
      };
    });

    const result = await waitForResponse({
      server: "https://ntfy.sh",
      topic: "my-topic",
      requestId: "req-net",
      timeout: 5000,
      pollInterval: 10,
    });

    assert.deepEqual(result, { approved: true });
    assert.ok(callCount >= 2, "should have retried after network error");
  });

  it("should return { approved: true } only for boolean true, not truthy values", async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ event: "message", message: JSON.stringify({ requestId: "req-truthy", approved: "yes" }) }),
    }));

    const result = await waitForResponse({
      server: "https://ntfy.sh",
      topic: "my-topic",
      requestId: "req-truthy",
      timeout: 5000,
      pollInterval: 10,
    });

    // "yes" is truthy but not boolean true — should be treated as false
    assert.deepEqual(result, { approved: false });
  });

  it("should skip non-ok HTTP responses and continue polling", async () => {
    let callCount = 0;
    globalThis.fetch = mock.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 429, text: async () => "Rate limited" };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ event: "message", message: JSON.stringify({ requestId: "req-retry", approved: true }) }),
      };
    });

    const result = await waitForResponse({
      server: "https://ntfy.sh",
      topic: "my-topic",
      requestId: "req-retry",
      timeout: 5000,
      pollInterval: 10,
    });

    assert.deepEqual(result, { approved: true });
    assert.ok(callCount >= 2, "should have polled again after HTTP error");
  });
});

// ---------------------------------------------------------------------------
// formatToolInfo
// ---------------------------------------------------------------------------

describe("formatToolInfo", () => {
  it("should be a function exported from the module", () => {
    assert.equal(typeof formatToolInfo, "function");
  });

  it("should return an object with title and message properties", () => {
    const result = formatToolInfo({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "ls -la" },
    });

    assert.ok(
      typeof result === "object" && result !== null,
      "should return an object"
    );
    assert.ok("title" in result, "result should have a title property");
    assert.ok("message" in result, "result should have a message property");
  });

  it("should include the tool name in the title", () => {
    const result = formatToolInfo({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "echo hello" },
    });

    assert.ok(
      result.title.includes("Bash"),
      `Title should include tool name "Bash", got: "${result.title}"`
    );
  });

  it("should format Bash tool input showing the command", () => {
    const result = formatToolInfo({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "npm install express" },
    });

    assert.ok(
      result.message.includes("npm install express"),
      `Message should include the command, got: "${result.message}"`
    );
  });

  it("should format Read tool input showing the file path", () => {
    const result = formatToolInfo({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: "/home/user/project/src/index.ts" },
    });

    assert.ok(
      result.message.includes("/home/user/project/src/index.ts"),
      `Message should include the file path, got: "${result.message}"`
    );
  });

  it("should format Write tool input showing the file path", () => {
    const result = formatToolInfo({
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: {
        file_path: "/home/user/project/config.json",
        content: '{ "key": "value" }',
      },
    });

    assert.ok(
      result.message.includes("/home/user/project/config.json"),
      `Message should include the file path, got: "${result.message}"`
    );
  });

  it("should return string values for both title and message", () => {
    const result = formatToolInfo({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "pwd" },
    });

    assert.equal(typeof result.title, "string", "title should be a string");
    assert.equal(typeof result.message, "string", "message should be a string");
  });

  it("should handle Bash tool input with missing command property", () => {
    const result = formatToolInfo({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { description: "no command here" },
    });

    assert.equal(typeof result.message, "string");
    // Should fall back to JSON.stringify since command is undefined
    assert.ok(
      result.message.includes("no command here"),
      `Message should contain the stringified toolInput, got: "${result.message}"`
    );
  });

  it("should handle Read tool input with missing file_path property", () => {
    const result = formatToolInfo({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { content: "some content" },
    });

    assert.equal(typeof result.message, "string");
    // Should fall back to JSON.stringify since file_path is undefined
    assert.ok(
      result.message.includes("some content"),
      `Message should contain the stringified toolInput, got: "${result.message}"`
    );
  });

  it("should handle Edit tool input with missing file_path property", () => {
    const result = formatToolInfo({
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_input: { old_string: "foo", new_string: "bar" },
    });

    assert.equal(typeof result.message, "string");
    // Should fall back to JSON.stringify since file_path is undefined
    assert.ok(
      result.message.includes("foo"),
      `Message should contain the stringified toolInput, got: "${result.message}"`
    );
  });

  it("should handle unknown tool names gracefully", () => {
    const result = formatToolInfo({
      hook_event_name: "PreToolUse",
      tool_name: "UnknownTool",
      tool_input: { some: "data" },
    });

    assert.ok(
      typeof result === "object" && result !== null,
      "should still return an object"
    );
    assert.equal(typeof result.title, "string");
    assert.equal(typeof result.message, "string");
  });
});
