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
 * Poll the response topic and wait for a matching requestId.
 *
 * @param {{ server: string, topic: string, requestId: string, timeout: number, pollInterval?: number }} params
 * @returns {Promise<{ approved: boolean }>}
 */
export async function waitForResponse({ server, topic, requestId, timeout, pollInterval = 2000 }) {
  const baseUrl = server.replace(/\/+$/, '');
  const sinceTimestamp = Math.floor(Date.now() / 1000);
  const pollUrl = `${baseUrl}/${topic}-response/json?poll=1&since=${sinceTimestamp}`;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(pollUrl);
      if (!response.ok) continue;
      const text = await response.text();
      const lines = text.trim().split('\n');

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          const parsed = JSON.parse(event.message);
          if (parsed.requestId === requestId) {
            return { approved: parsed.approved === true };
          }
        } catch {
          // skip non-JSON lines
        }
      }
    } catch (err) {
      console.error("[claude-remote-approver] poll error:", err);
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  return { approved: false };
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
