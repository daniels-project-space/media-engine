import { NextRequest, NextResponse } from "next/server";
import { type VaultService, vaultService } from "@/lib/vault";
import { requireOperator } from "@/lib/operator-auth";
import { higgsfieldMcpLinked } from "@/lib/higgsfield";

export const maxDuration = 30;

type ServiceCheck =
  | { service: string; label: string; role: string; disabled: true }
  | { service: VaultService; requiredKeys?: string[]; label: string; role: string; disabled?: false };

const CHECKS: ServiceCheck[] = [
  { service: "openai", label: "OpenAI GPT Image 2", role: "Disabled by generation policy", disabled: true },
  { service: "anthropic", label: "Cloud reasoning worker", role: "Not provisioned for this cutover", disabled: true },
  { service: "fal", label: "fal.ai", role: "Disabled by generation policy", disabled: true },
  { service: "elevenlabs", label: "ElevenLabs", role: "Disabled by generation policy", disabled: true },
  { service: "resend", label: "Resend", role: "Disabled — legacy outbound email retired", disabled: true },
  { service: "cloudflare", requiredKeys: ["R2_ACCESS_KEY_ID"], label: "Cloudflare R2", role: "Media storage" },
  { service: "trigger", requiredKeys: ["TRIGGER_SECRET_KEY_MEDIA_ENGINE"], label: "Trigger.dev", role: "Job runner" },
];

// Reports which vault credentials exist (booleans only — values never leave the server).
export async function GET(request: NextRequest) {
  const denied = requireOperator(request);
  if (denied) return denied;

  const [higgsfieldLinked, results] = await Promise.all([
    higgsfieldMcpLinked().catch(() => false),
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
  ]);
  return NextResponse.json({
    services: [
      { service: "image-workflows", label: "Image workflows", role: "Paused — approved source images required", present: false, status: "disabled" as const },
      {
        service: "higgsfield",
        label: "Higgsfield Seedance 2.0",
        role: "Subscription-only client renders",
        present: higgsfieldLinked,
        status: higgsfieldLinked ? "configured" : "missing",
      },
      ...results,
    ],
  });
}
