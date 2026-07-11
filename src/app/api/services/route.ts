import { NextResponse } from "next/server";
import { vaultService } from "@/lib/vault";

export const maxDuration = 30;

const CHECKS: { service: string; key?: string; label: string; role: string }[] = [
  { service: "openai", key: "OPENAI_API_KEY", label: "OpenAI GPT Image 2", role: "Image generation" },
  { service: "anthropic", key: "ANTHROPIC_AUTH_TOKEN", label: "Claude subscription (CLI)", role: "Planning, captions & QC" },
  { service: "fal", label: "fal.ai", role: "Video + persona LoRAs" },
  { service: "elevenlabs", label: "ElevenLabs", role: "Voiceover (shorts)" },
  { service: "resend", label: "Resend", role: "Email sending" },
  { service: "higgsfield", key: "HIGGSFIELD_API_KEY", label: "Higgsfield", role: "Alt image/video gen" },
  { service: "cloudflare", key: "R2_ACCESS_KEY_ID", label: "Cloudflare R2", role: "Media storage" },
  { service: "trigger", key: "TRIGGER_SECRET_KEY_MEDIA_ENGINE", label: "Trigger.dev", role: "Job runner" },
];

// Reports which vault credentials exist (booleans only — values never leave the server).
export async function GET() {
  const results = await Promise.all(
    CHECKS.map(async (c) => {
      try {
        const keys = await vaultService(c.service);
        const present = c.key ? Boolean(keys[c.key]) : Object.keys(keys).length > 0;
        return { ...c, present };
      } catch {
        return { ...c, present: false };
      }
    }),
  );
  return NextResponse.json({ services: results });
}
