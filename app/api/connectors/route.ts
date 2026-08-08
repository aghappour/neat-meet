import { NextResponse } from "next/server";
import { deliverableTargets, enabledConnectors } from "@/lib/connectors";

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
  return NextResponse.json({
    connectors: enabledConnectors().map((c) => ({ name: c.name, label: c.label })),
    targets: deliverableTargets(),
  });
}
