import { isLive, vaultTry, simulated, blocked, live, type GateResult } from "./gate";

// Email adapter. Two lanes:
//   - transactional (Resend): confirmations, funnel receipts, lead replies
//   - cold outreach (Smartlead): prospecting sequences with deliverability
// Both are outward side-effects → DRY-RUN unless isLive() AND the key exists.

export type TxEmail = { to: string | string[]; subject: string; html: string; from?: string };
export type ColdLead = { email: string; firstName?: string; company?: string; custom?: Record<string, string> };
export type ColdSequence = { name: string; leads: ColdLead[]; fromName?: string };

export async function sendTransactional(msg: TxEmail): Promise<GateResult<{ id?: string }>> {
  const doing = `email "${msg.subject}" → ${Array.isArray(msg.to) ? msg.to.join(",") : msg.to}`;
  if (!(await isLive())) return simulated(doing);
  const { RESEND_API_KEY, RESEND_FROM } = await vaultTry("resend");
  if (!RESEND_API_KEY) return blocked("no Resend key in vault (RESEND_API_KEY)");
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: msg.from ?? RESEND_FROM ?? "onboarding@resend.dev",
        to: Array.isArray(msg.to) ? msg.to : [msg.to],
        subject: msg.subject,
        html: msg.html,
      }),
    });
    const j = (await r.json()) as { id?: string; message?: string };
    if (!r.ok) return blocked(`resend: ${j.message ?? JSON.stringify(j).slice(0, 160)}`);
    return live(`sent ${doing}`, { id: j.id });
  } catch (e) {
    return blocked(`resend error: ${e instanceof Error ? e.message : e}`);
  }
}

/** Create a cold-outreach campaign in Smartlead and load leads. Sequence steps
 *  (copy) are attached separately in Smartlead or via a follow-up call; here we
 *  stand up the campaign + import the list, which is the code-heavy part. */
export async function coldSequence(seq: ColdSequence): Promise<GateResult<{ campaignId?: number; imported?: number }>> {
  const doing = `cold sequence "${seq.name}" to ${seq.leads.length} leads`;
  if (!(await isLive())) return simulated(doing, { imported: seq.leads.length });
  const { SMARTLEAD_API_KEY } = await vaultTry("smartlead");
  if (!SMARTLEAD_API_KEY) return blocked("no Smartlead key in vault (SMARTLEAD_API_KEY)");
  const base = "https://server.smartlead.ai/api/v1";
  try {
    const cr = await fetch(`${base}/campaigns/create?api_key=${SMARTLEAD_API_KEY}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: seq.name }),
    });
    const cj = (await cr.json()) as { id?: number; message?: string };
    if (!cr.ok || !cj.id) return blocked(`smartlead create: ${cj.message ?? JSON.stringify(cj).slice(0, 160)}`);
    const lr = await fetch(`${base}/campaigns/${cj.id}/leads?api_key=${SMARTLEAD_API_KEY}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lead_list: seq.leads.map((l) => ({
          email: l.email,
          first_name: l.firstName,
          company_name: l.company,
          custom_fields: l.custom,
        })),
      }),
    });
    const lj = (await lr.json()) as { upload_count?: number };
    return live(`created ${doing}`, { campaignId: cj.id, imported: lj.upload_count ?? seq.leads.length });
  } catch (e) {
    return blocked(`smartlead error: ${e instanceof Error ? e.message : e}`);
  }
}
