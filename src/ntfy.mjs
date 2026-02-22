// src/ntfy.mjs

/**
 * Send a push notification via ntfy.
 *
 * @param {{ server: string, topic: string, title: string, message: string, actions: unknown[], requestId: string }} params
 * @returns {Promise<Response>}
 */
export async function sendNotification({ server, topic, title, message, actions, requestId }) {
  const baseUrl = server.replace(/\/+$/, '');
  const url = baseUrl;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, title, message, actions }),
  });

  if (!response.ok) {
    throw new Error(`ntfy notification failed: HTTP ${response.status}`);
  }

  return response;
}

/**
 * Subscribe to the response topic via SSE and wait for a matching requestId.
 *
 * @param {{ server: string, topic: string, requestId: string, timeout: number }} params
 * @returns {Promise<{ approved: boolean }>}
 */
export async function waitForResponse({ server, topic, requestId, timeout }) {
  const baseUrl = server.replace(/\/+$/, '');
  const url = `${baseUrl}/${topic}-response/json`;

  const controller = new AbortController();

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;

  try {
    const response = await fetch(url, { signal: controller.signal });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Listen to abort so we can cancel the reader even when the mock stream
    // never closes (the real fetch would propagate the signal, but mocks may not).
    const onAbort = () => reader.cancel();
    controller.signal.addEventListener('abort', onAbort);

    // Start the timeout AFTER fetch resolves so we measure waiting time only.
    timer = setTimeout(() => controller.abort(), timeout);

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            const parsed = JSON.parse(event.message);
            if (parsed.requestId === requestId) {
              clearTimeout(timer);
              controller.signal.removeEventListener('abort', onAbort);
              return { approved: parsed.approved };
            }
          } catch {
            // skip non-JSON lines
          }
        }
      }
    } finally {
      controller.signal.removeEventListener('abort', onAbort);
    }

    clearTimeout(timer);
    return { approved: false };
  } catch (err) {
    if (timer !== undefined) clearTimeout(timer);
    if (err?.name !== "AbortError") {
      console.error("[claude-remote-approver] waitForResponse error:", err);
    }
    return { approved: false };
  }
}

/**
 * Format tool information for display in the notification.
 *
 * @param {{ hook_event_name: string, tool_name: string, tool_input: Record<string, unknown> }} params
 * @returns {{ title: string, message: string }}
 */
export function formatToolInfo({ hook_event_name, tool_name, tool_input }) {
  const title = `Claude Code: ${tool_name}`;
  let message;

  switch (tool_name) {
    case 'Bash':
      message = tool_input?.command ?? JSON.stringify(tool_input);
      break;
    case 'Read':
    case 'Write':
    case 'Edit':
      message = tool_input?.file_path ?? JSON.stringify(tool_input);
      break;
    default:
      message = JSON.stringify(tool_input);
      break;
  }

  return { title, message };
}
