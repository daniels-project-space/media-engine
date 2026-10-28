import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { boundedJson, marketingCall } from "@/lib/marketing/service";
import { snapshotHash } from "../../../../../convex/marketingPolicy";

export const runtime = "nodejs";
export const maxDuration = 15;
const conversion = z
  .object({
    projectId: z.string().regex(/^[a-z0-9]{20,64}$/),
    eventId: z.string().min(1).max(160),
    event: z.enum(["signup", "lead", "purchase"]),
    itemId: z
      .string()
      .regex(/^[a-z0-9]{20,64}$/)
      .optional(),
    valueMinor: z.number().int().min(0).max(100_000_000),
    currency: z.enum(["USD", "GBP", "EUR", "CHF"]),
    occurredAt: z.number().int().positive(),
  })
  .strict();

// Server-to-server only. A browser-installed public token cannot certify a real
// sale or signup. Deliberately accept no email, IP, name or personal profile.
export async function POST(request: NextRequest) {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token)
    return NextResponse.json(
      { error: "Project conversion authentication required" },
      { status: 401 },
    );
  try {
    const payload = conversion.parse(await boundedJson(request, 4_096));
    const result = await marketingCall("ingestConversion", {
      ...payload,
      tokenHash: snapshotHash(token),
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "Conversion rejected; check the project credential, event identity and project goal",
      },
      { status: 400 },
    );
  }
}
