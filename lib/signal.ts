/**
 * Signal delivery via a LOCAL, unofficial `signal-cli` linked-device bridge.
 *
 * Signal has no official API or Zapier integration; the only programmatic route
 * is signal-cli linked to your phone as a secondary device, running in daemon
 * mode with its JSON-RPC HTTP endpoint. Everything stays on your machine — the
 * app talks to signal-cli over localhost, and signal-cli talks to Signal with
 * your linked account. Caveats (documented in the README): unofficial, may
 * break on Signal updates, and occupies one linked-device slot.
 *
 * Setup (once):
 *   1. Install signal-cli (https://github.com/AsamK/signal-cli)
 *   2. Link it to your phone:  signal-cli link -n "neat-meet"   (scan the QR)
 *   3. Run the daemon:         signal-cli daemon --http 127.0.0.1:8686
 *   4. .env:                   SIGNAL_CLI_URL=http://127.0.0.1:8686/api/v1/rpc
 */

/** Enabled as soon as the daemon's JSON-RPC URL is configured. */
export function signalEnabled(): boolean {
  return Boolean(process.env.SIGNAL_CLI_URL);
}

interface JsonRpcResponse {
  result?: { timestamp?: number };
  error?: { code?: number; message?: string };
}

/**
 * Send a message through the local signal-cli daemon.
 * `destination` is a phone number in E.164 form ("+15551234567") for a direct
 * chat, or a signal-cli group id (base64) for a group.
 */
export async function sendSignal(destination: string, message: string): Promise<string> {
  const url = process.env.SIGNAL_CLI_URL;
  if (!url) throw new Error("Signal is not configured — set SIGNAL_CLI_URL in .env");

  const isNumber = /^\+\d{6,15}$/.test(destination.trim());
  const params: Record<string, unknown> = {
    message,
    ...(isNumber ? { recipient: [destination.trim()] } : { groupId: destination.trim() }),
    // Multi-account daemons need the sender; single-account setups don't.
    ...(process.env.SIGNAL_ACCOUNT ? { account: process.env.SIGNAL_ACCOUNT } : {}),
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: `neat-meet-${Date.now()}`, method: "send", params }),
    });
  } catch (err) {
    throw new Error(
      `Could not reach the signal-cli daemon at ${url} (${(err as Error).message}). ` +
        `Is it running? Start it with: signal-cli daemon --http`,
    );
  }
  if (!res.ok) throw new Error(`signal-cli daemon returned HTTP ${res.status}`);

  const rpc = (await res.json()) as JsonRpcResponse;
  if (rpc.error) throw new Error(`signal-cli: ${rpc.error.message ?? "send failed"}`);
  return `sent via Signal at ${rpc.result?.timestamp ?? Date.now()}`;
}
