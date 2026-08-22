import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import { messageStore } from "@/lib/messages/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
  aac: "audio/aac",
  pdf: "application/pdf",
  txt: "text/plain",
};

/**
 * GET /api/messages/media/:id — serve an archived attachment from local disk.
 * Ids are content-hash names; the store rejects anything else, so this can't
 * read outside the media directory.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const path = messageStore().mediaPath(id);
  if (!path) return NextResponse.json({ error: "Unknown media id" }, { status: 404 });
  const ext = id.split(".").pop() ?? "";
  return new Response(new Uint8Array(readFileSync(path)), {
    headers: {
      "content-type": MIME_BY_EXT[ext] ?? "application/octet-stream",
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
