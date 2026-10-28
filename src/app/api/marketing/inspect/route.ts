import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOperator } from "@/lib/operator-auth";
import { boundedJson, publicFailure } from "@/lib/marketing/service";
import { inspectMarketingWebsite } from "@/lib/marketing/website";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function POST(request: NextRequest) {
  const denied = requireOperator(request);
  if (denied) return denied;
  try {
    const input = z
      .object({ url: z.string().url().max(2_000) })
      .strict()
      .parse(await boundedJson(request, 4_096));
    return NextResponse.json(await inspectMarketingWebsite(input.url), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: publicFailure(error) }, { status: 400 });
  }
}
