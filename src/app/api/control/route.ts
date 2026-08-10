import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { NextResponse } from "next/server";
import { creativeServiceToken } from "@/lib/creative-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const CONTROL_DASHBOARD = makeFunctionReference<"action", { serviceToken: string }, unknown>(
  "controlPlaneGateway:listDashboard",
);

const BOOTSTRAP_CONTROL_ORGANIZATION = makeFunctionReference<"action", { serviceToken: string }, unknown>(
  "controlPlaneGateway:bootstrapDefaultOrganization",
);

type DashboardItem = {
  id: string;
  title: string;
  detail?: string;
  status: string;
  organizationId?: string;
  provider?: string;
  risk?: string;
  capabilities?: string[];
  createdAt?: number;
  updatedAt?: number;
  expiresAt?: number;
};

type Dashboard = {
  organizations: DashboardItem[];
  connections: DashboardItem[];
  approvals: DashboardItem[];
  actions: DashboardItem[];
  intakes: DashboardItem[];
  fetchedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function text(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 240);
  }
  return undefined;
}

function nestedText(record: Record<string, unknown>, key: string, keys: string[]): string | undefined {
  const nested = record[key];
  return isRecord(nested) ? text(nested, keys) : undefined;
}

function timestamp(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value > 0 && value < 10_000_000_000 ? Math.round(value * 1_000) : Math.round(value);
    }
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function stringList(record: Record<string, unknown>, keys: string[]): string[] | undefined {
  for (const key of keys) {
    const value = record[key];
    if (!Array.isArray(value)) continue;
    const items = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 6);
    return items.length ? items : undefined;
  }
  return undefined;
}

function list(value: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(value)) return value.every(isRecord) ? value : null;
  if (isRecord(value) && Array.isArray(value.items)) return value.items.every(isRecord) ? value.items : null;
  return null;
}

function collection(root: Record<string, unknown>, key: string): Record<string, unknown>[] | null {
  return list(root[key]);
}

function status(record: Record<string, unknown>, fallback = "unknown"): string {
  return text(record, ["status", "health", "connectionStatus", "state"])?.toLowerCase().slice(0, 80) ?? fallback;
}

function organizationId(record: Record<string, unknown>): string | undefined {
  const organization = record.organization;
  return text(record, ["organizationId", "orgId"])
    ?? (typeof organization === "string" && organization.trim() ? organization.trim() : undefined)
    ?? nestedText(record, "organization", ["_id", "id"]);
}

function id(record: Record<string, unknown>, keys: string[]): string | undefined {
  return text(record, ["_id", "id", ...keys]);
}

function entry(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const nested = record[key];
  // Gateways commonly return a document paired with its organization, e.g.
  // `{ connection, organization }`. Flatten only the safe display fields here;
  // the original nested payload never crosses this API boundary.
  return isRecord(nested) ? { ...record, ...nested } : record;
}

function normalizeOrganizations(rows: Record<string, unknown>[]): DashboardItem[] {
  return rows.flatMap((row) => {
    const organization = entry(row, "organization");
    const itemId = id(organization, ["organizationId"]);
    if (!itemId) return [];
    const kind = text(organization, ["kind", "type"]);
    return [{
      id: itemId,
      title: text(organization, ["name", "label", "slug"]) ?? "Unlabelled organization",
      detail: kind,
      status: status(organization),
      updatedAt: timestamp(organization, ["updatedAt", "lastActivityAt", "createdAt"]),
    }];
  });
}

function normalizeConnections(rows: Record<string, unknown>[]): DashboardItem[] {
  return rows.flatMap((row) => {
    const connection = entry(row, "connection");
    const itemId = id(connection, ["connectionId"]);
    if (!itemId) return [];
    const provider = text(connection, ["provider", "channel", "service"]);
    return [{
      id: itemId,
      title: text(connection, ["displayName", "label", "accountLabel", "accountName", "name"]) ?? provider ?? "Unlabelled connection",
      detail: text(connection, ["accountHandle", "accountType"]),
      status: status(connection),
      organizationId: organizationId(connection),
      provider,
      capabilities: stringList(connection, ["capabilities", "scopes"]),
      updatedAt: timestamp(connection, ["updatedAt", "lastSyncedAt", "createdAt"]),
    }];
  });
}

function normalizeApprovals(rows: Record<string, unknown>[]): DashboardItem[] {
  return rows.flatMap((row) => {
    const approval = entry(row, "approval");
    const itemId = id(approval, ["approvalId"]);
    if (!itemId) return [];
    return [{
      id: itemId,
      title: text(approval, ["title", "actionKind", "actionType", "action", "summary", "kind", "type"]) ?? "Unlabelled approval",
      detail: text(approval, ["reason", "summary", "description"]),
      status: status(approval),
      organizationId: organizationId(approval),
      risk: text(approval, ["risk", "riskLevel", "riskClass"]),
      createdAt: timestamp(approval, ["createdAt", "requestedAt"]),
      expiresAt: timestamp(approval, ["expiresAt"]),
      updatedAt: timestamp(approval, ["updatedAt", "decidedAt"]),
    }];
  });
}

function normalizeActions(rows: Record<string, unknown>[]): DashboardItem[] {
  return rows.flatMap((row) => {
    const action = entry(row, "action");
    const itemId = id(action, ["actionId"]);
    if (!itemId) return [];
    const provider = text(action, ["provider", "channel", "service"]);
    return [{
      id: itemId,
      title: text(action, ["actionKind", "actionType", "title", "action", "kind", "type"]) ?? "Unlabelled action",
      detail: text(action, ["summary", "reason"]) ?? provider,
      status: status(action),
      organizationId: organizationId(action),
      provider,
      risk: text(action, ["risk", "riskLevel", "riskClass"]),
      createdAt: timestamp(action, ["createdAt", "queuedAt"]),
      updatedAt: timestamp(action, ["updatedAt", "startedAt", "completedAt"]),
    }];
  });
}

function normalizeIntakes(rows: Record<string, unknown>[]): DashboardItem[] {
  return rows.flatMap((row) => {
    const intake = entry(row, "intake");
    const itemId = id(intake, ["intakeId", "eventId"]);
    if (!itemId) return [];
    const source = text(intake, ["source", "provider", "channel"]);
    return [{
      id: itemId,
      title: text(intake, ["businessName", "title", "subject", "name", "summary", "eventType", "type"]) ?? "Unlabelled intake",
      detail: text(intake, ["selectedService", "type", "kind", "eventType", "summary"]) ?? source,
      status: status(intake),
      organizationId: organizationId(intake),
      provider: source,
      createdAt: timestamp(intake, ["receivedAt", "createdAt", "occurredAt"]),
      updatedAt: timestamp(intake, ["updatedAt", "reviewedAt"]),
    }];
  });
}

function normalizeDashboard(value: unknown): Dashboard {
  if (!isRecord(value)) throw new Error("Control dashboard returned an invalid response");

  const organizations = collection(value, "organizations");
  const connections = collection(value, "connections");
  const approvals = collection(value, "approvals");
  const actions = collection(value, "actions");
  const intakes = collection(value, "intakes");

  // The UI must not invent an empty control plane when the protected gateway
  // is missing or returns an incompatible response. A 503 is safer and more
  // honest than presenting zeroes as operational truth.
  if (!organizations || !connections || !approvals || !actions || !intakes) {
    throw new Error("Control dashboard response is incomplete");
  }

  const normalizedOrganizations = normalizeOrganizations(organizations);
  const normalizedConnections = normalizeConnections(connections);
  const normalizedApprovals = normalizeApprovals(approvals);
  const normalizedActions = normalizeActions(actions);
  const normalizedIntakes = normalizeIntakes(intakes);

  // A record without a durable identifier cannot be safely represented in the
  // dashboard. Treat an incompatible gateway payload as unavailable instead
  // of silently hiding it and making counts look better than they are.
  if (
    normalizedOrganizations.length !== organizations.length
    || normalizedConnections.length !== connections.length
    || normalizedApprovals.length !== approvals.length
    || normalizedActions.length !== actions.length
    || normalizedIntakes.length !== intakes.length
  ) {
    throw new Error("Control dashboard response contains incomplete records");
  }

  return {
    organizations: normalizedOrganizations,
    connections: normalizedConnections,
    approvals: normalizedApprovals,
    actions: normalizedActions,
    intakes: normalizedIntakes,
    fetchedAt: new Date().toISOString(),
  };
}

function hasNoOrganizations(value: unknown): boolean {
  return isRecord(value) && Array.isArray(value.organizations) && value.organizations.length === 0;
}

function publicItem(item: DashboardItem, collection: "organization" | "connection" | "approval" | "action" | "intake", index: number): DashboardItem {
  const provider = item.provider;
  const base = {
    id: `public-${collection}-${index + 1}`,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    expiresAt: item.expiresAt,
  };

  if (collection === "organization") {
    return { ...base, title: "Operating scope" };
  }
  if (collection === "connection") {
    return {
      ...base,
      title: provider ? `${provider} connection` : "Provider connection",
      provider,
      capabilities: item.capabilities,
    };
  }
  if (collection === "approval") {
    return { ...base, title: "Approval required", risk: item.risk };
  }
  if (collection === "action") {
    return { ...base, title: provider ? `${provider} action` : "Agency action", provider, risk: item.risk };
  }
  return { ...base, title: "New client intake", provider };
}

function publicDashboard(value: unknown): Dashboard {
  const dashboard = normalizeDashboard(value);
  return {
    organizations: dashboard.organizations.map((item, index) => publicItem(item, "organization", index)),
    connections: dashboard.connections.map((item, index) => publicItem(item, "connection", index)),
    approvals: dashboard.approvals.map((item, index) => publicItem(item, "approval", index)),
    actions: dashboard.actions.map((item, index) => publicItem(item, "action", index)),
    intakes: dashboard.intakes.map((item, index) => publicItem(item, "intake", index)),
    fetchedAt: dashboard.fetchedAt,
  };
}

/**
 * Read-only public overview of the governed control plane. The
 * function reference is intentionally string-based until Convex codegen has
 * the new gateway module; this route still fails closed if that gateway is not
 * deployed. The service token never crosses this server boundary.
 */
export async function GET() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!convexUrl) {
    return NextResponse.json({ error: "Control Center is not configured yet." }, { status: 503 });
  }

  try {
    const serviceToken = await creativeServiceToken();
    const convex = new ConvexHttpClient(convexUrl);
    let data = await convex.action(CONTROL_DASHBOARD, { serviceToken });
    // A new cloud deployment has no rows until its first governed workflow
    // arrives. Create the real first-party organization only in this protected
    // operator path, then reread; the Control Center never fabricates it.
    if (hasNoOrganizations(data)) {
      await convex.action(BOOTSTRAP_CONTROL_ORGANIZATION, { serviceToken });
      data = await convex.action(CONTROL_DASHBOARD, { serviceToken });
    }
    return NextResponse.json(publicDashboard(data), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Control Center is unavailable until its server-side gateway is configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
