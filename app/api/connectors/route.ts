import { NextResponse } from "next/server";
import { connectorForExport, deliverableTargets, enabledConnectors } from "@/lib/connectors";
import { signalEnabled } from "@/lib/signal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the app can currently reach. The client uses this to offer only share
 * targets that will actually deliver, rather than letting the user pick one
 * and discover it isn't configured when the send fails.
 *
 * Deliberately exposes labels and target names only — never URLs or tokens.
 */
export async function GET() {
  const targets = deliverableTargets();
  // Signal is delivered by the local signal-cli bridge, not an MCP connector.
  if (signalEnabled()) targets.push("signal");
  return NextResponse.json({
    connectors: enabledConnectors().map((c) => ({ name: c.name, label: c.label })),
    targets,
    exportTargets: (["notion", "gdrive"] as const).filter((t) => connectorForExport(t) !== null),
  });
}
