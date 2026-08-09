import { NextRequest, NextResponse } from "next/server";
import { vaultService } from "@/lib/vault";
import { requireOperator } from "@/lib/operator-auth";

export const maxDuration = 30;

const CHECKS: { service: string; requiredKeys?: string[]; label: string; role: string; disabled?: true }[] = [
  { service: "openai", label: "OpenAI GPT Image 2", role: "Disabled by generation policy", disabled: true },
  { service: "anthropic", requiredKeys: ["ANTHROPIC_AUTH_TOKEN"], label: "Claude subscription (CLI)", role: "Planning, captions & QC" },
  { service: "fal", label: "fal.ai", role: "Disabled by generation policy", disabled: true },
  { service: "elevenlabs", label: "ElevenLabs", role: "Disabled by generation policy", disabled: true },
  { service: "resend", label: "Resend", role: "Email sending" },
  {
    service: "higgsfield",
    requiredKeys: ["HIGGSFIELD_ACCESS_TOKEN", "HIGGSFIELD_REFRESH_TOKEN"],
    label: "Higgsfield Seedance 2.0",
    role: "Subscription-only client renders",
  },
  { service: "cloudflare", requiredKeys: ["R2_ACCESS_KEY_ID"], label: "Cloudflare R2", role: "Media storage" },
  { service: "trigger", requiredKeys: ["TRIGGER_SECRET_KEY_MEDIA_ENGINE"], label: "Trigger.dev", role: "Job runner" },
];

// Reports which vault credentials exist (booleans only — values never leave the server).
export async function GET(request: NextRequest) {
  const denied = requireOperator(request);
  if (denied) return denied;

  const results = await Promise.all(
    CHECKS.map(async (c) => {
      if (c.disabled) {
        return { service: c.service, label: c.label, role: c.role, present: false, status: "disabled" as const };
      }
      try {
        const keys = await vaultService(c.service);
        const present = c.requiredKeys
          ? c.requiredKeys.every((key) => Boolean(keys[key]?.trim()))
          : Object.keys(keys).length > 0;
        return { service: c.service, label: c.label, role: c.role, present, status: present ? "configured" : "missing" };
      } catch {
        return { service: c.service, label: c.label, role: c.role, present: false, status: "missing" };
      }
    }),
  );
  return NextResponse.json({
    services: [
      { service: "image-workflows", label: "Image workflows", role: "Paused — approved source images required", present: false, state: "paused" },
      ...results,
    ],
  });
}
