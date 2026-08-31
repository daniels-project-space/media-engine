/**
 * Fanvue OAuth readiness profiles.
 *
 * This is intentionally credential-free and safe to render in a browser. It
 * describes the exact scopes an operator must configure in Fanvue's Builder
 * area before beginning a server-owned OAuth consent flow. It does not create
 * an OAuth URL, store a token, or call Fanvue.
 *
 * Source of truth: https://api.fanvue.com/docs/authentication/scopes
 * and https://api.fanvue.com/docs/authentication/implementation-guide
 */

export const FANVUE_SYSTEM_OAUTH_SCOPES = [
  "openid",
  "offline_access",
  "offline",
] as const;

export const FANVUE_OAUTH_SCOPES = [
  ...FANVUE_SYSTEM_OAUTH_SCOPES,
  "read:self",
  "read:insights",
  "read:chat",
  "write:post",
  "write:chat",
  "write:tracking_links",
] as const;

export type FanvueOAuthScope = (typeof FANVUE_OAUTH_SCOPES)[number];

/**
 * These are Media Engine capability labels, not OAuth scope names. Keeping
 * them separate prevents a local intent record from being mistaken for a
 * provider-granted scope.
 */
export const FANVUE_READINESS_CAPABILITIES = [
  "read_profile",
  "read_insights",
  "read_inbox",
  "schedule_content",
  "publish_subscription_post",
  "send_subscription_chat_reply",
  "manage_tracking_links",
] as const;

export type FanvueReadinessCapability = (typeof FANVUE_READINESS_CAPABILITIES)[number];

export type FanvueReadinessProfileId =
  | "read_only"
  | "inbox_drafts"
  | "content_review"
  | "reviewed_inbound_replies"
  | "tracking_links";

export type FanvueReadinessProfile = Readonly<{
  id: FanvueReadinessProfileId;
  label: string;
  description: string;
  requestedCapabilities: readonly FanvueReadinessCapability[];
  requestedScopes: readonly FanvueOAuthScope[];
  boundary: string;
}>;

/**
 * Start with a read-only profile. Write-capability profiles never authorize an
 * action by themselves: every provider request still needs a real OAuth grant,
 * an account capability grant, an immutable approval, and a server-only
 * dispatcher.
 */
export const FANVUE_READINESS_PROFILES: Readonly<Record<FanvueReadinessProfileId, FanvueReadinessProfile>> = {
  read_only: {
    id: "read_only",
    label: "Read-only creator baseline",
    description: "Verify the connected creator and use verified performance observations in planning.",
    requestedCapabilities: ["read_profile", "read_insights"],
    requestedScopes: [...FANVUE_SYSTEM_OAUTH_SCOPES, "read:self", "read:insights"],
    boundary: "No posts, messages, tracking links, payments, or account changes are permitted.",
  },
  inbox_drafts: {
    id: "inbox_drafts",
    label: "Inbound inbox drafts",
    description: "Read existing conversations so Media Engine can prepare an operator-reviewed reply draft.",
    requestedCapabilities: ["read_profile", "read_inbox"],
    requestedScopes: [...FANVUE_SYSTEM_OAUTH_SCOPES, "read:self", "read:chat"],
    boundary: "Draft-only. This profile deliberately does not include write:chat or mass-message access.",
  },
  content_review: {
    id: "content_review",
    label: "Approved subscription-post workflow",
    description: "Prepare for a separately approved post or scheduled post after the official dispatcher is installed.",
    requestedCapabilities: ["read_profile", "read_insights", "schedule_content", "publish_subscription_post"],
    requestedScopes: [...FANVUE_SYSTEM_OAUTH_SCOPES, "read:self", "read:insights", "write:post"],
    boundary: "A consent record alone cannot publish. The exact content, destination, and action must each be approved first.",
  },
  reviewed_inbound_replies: {
    id: "reviewed_inbound_replies",
    label: "Individually reviewed inbound replies",
    description: "Prepare for a server-side reply only to a real inbound conversation after a human approves the draft.",
    requestedCapabilities: ["read_profile", "read_inbox", "send_subscription_chat_reply"],
    requestedScopes: [...FANVUE_SYSTEM_OAUTH_SCOPES, "read:self", "read:chat", "write:chat"],
    boundary: "No cold outreach, mass messaging, payment handling, or autonomous sends are represented by this profile.",
  },
  tracking_links: {
    id: "tracking_links",
    label: "Approved tracking links",
    description: "Prepare to create a provider tracking link only for a separately reviewed public destination.",
    requestedCapabilities: ["read_profile", "manage_tracking_links"],
    requestedScopes: [...FANVUE_SYSTEM_OAUTH_SCOPES, "read:self", "write:tracking_links"],
    boundary: "No redirect is created by this record, and a governed funnel still needs its own review and activation.",
  },
};

export const DEFAULT_FANVUE_READINESS_PROFILE_ID: FanvueReadinessProfileId = "read_only";

export function getFanvueReadinessProfile(
  profileId: FanvueReadinessProfileId = DEFAULT_FANVUE_READINESS_PROFILE_ID,
): FanvueReadinessProfile {
  return FANVUE_READINESS_PROFILES[profileId];
}

/**
 * Converts stored Media Engine capabilities into the smallest official scope
 * set that can support them. It rejects unrecognised labels rather than
 * guessing an OAuth permission.
 */
export function fanvueScopesForCapabilities(
  capabilities: readonly string[],
): readonly FanvueOAuthScope[] {
  const scopes = new Set<FanvueOAuthScope>(FANVUE_SYSTEM_OAUTH_SCOPES);
  for (const capability of capabilities) {
    switch (capability) {
      case "read_profile":
        scopes.add("read:self");
        break;
      case "read_insights":
        scopes.add("read:insights");
        break;
      case "read_inbox":
        scopes.add("read:chat");
        break;
      case "schedule_content":
      case "publish_subscription_post":
        scopes.add("write:post");
        break;
      case "send_subscription_chat_reply":
        scopes.add("read:chat");
        scopes.add("write:chat");
        break;
      case "manage_tracking_links":
        scopes.add("write:tracking_links");
        break;
      default:
        throw new Error(`Unsupported Fanvue readiness capability: ${capability}`);
    }
  }
  return [...scopes];
}
