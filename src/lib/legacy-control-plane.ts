/**
 * Fixed cutover policy. Keeping this as a constant (rather than an environment
 * toggle) prevents a stale deployment variable from re-enabling unauthenticated
 * social, growth, or outbound workflows.
 */
export function legacyControlPlaneRetired(): boolean {
  return true;
}
