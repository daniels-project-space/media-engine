import { NextResponse } from "next/server";
import { capabilityManifest } from "@/mastra";

export const maxDuration = 20;

// What can this engine do? — the machine-readable capability manifest for the
// interface and for Jarvis to introspect before launching work across the media
// engine (agents, tools, workflows, channels, capabilities).
export async function GET() {
  const manifest = await capabilityManifest();
  return NextResponse.json(manifest);
}
