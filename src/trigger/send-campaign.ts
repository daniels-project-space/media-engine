import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { vaultService } from "../lib/vault";
import { aiEnabled } from "../lib/ai-gate";

const CONVEX_URL = "https://blissful-sardine-231.convex.cloud";
const BATCH = 50;

type Payload = {
  subject: string;
  html: string;
  tag?: string; // limit to contacts tagged with a persona handle
  from?: string;
};

// Sends a campaign to subscribed contacts via Resend batch API.
// NOTE: the default onboarding@resend.dev sender only delivers to the account
// owner's own address — set a verified domain sender in settings.emailFrom for real sends.
export const sendCampaign = task({
  id: "send-campaign",
  maxDuration: 600,
  run: async (payload: Payload) => {
    if (!(await aiEnabled())) throw new AbortTaskRunError("AI generation is paused");
    const convex = new ConvexHttpClient(CONVEX_URL);
    const settings = await convex.query(api.settings.all, {});
    const from = payload.from ?? String(settings.emailFrom ?? "Media Engine <onboarding@resend.dev>");

    const contacts = await convex.query(api.email.contacts, { tag: payload.tag });
    if (contacts.length === 0) throw new AbortTaskRunError("no subscribed contacts match");

    const { RESEND_API_KEY } = await vaultService("resend");
    if (!RESEND_API_KEY) throw new AbortTaskRunError("vault resend/RESEND_API_KEY missing");

    let sent = 0;
    const failures: string[] = [];
    for (let i = 0; i < contacts.length; i += BATCH) {
      const chunk = contacts.slice(i, i + BATCH);
      const r = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify(
          chunk.map((c) => ({
            from,
            to: [c.email],
            subject: payload.subject,
            html: payload.html,
          })),
        ),
      });
      if (!r.ok) {
        failures.push(`batch ${i / BATCH}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
        continue;
      }
      sent += chunk.length;
    }

    logger.log("campaign done", { sent, failures: failures.length });
    if (failures.length) logger.warn(failures.join(" | "));
    return { sent, total: contacts.length, failures };
  },
});
