/**
 * This is intentionally a constant policy, not an environment toggle. The old
 * social, outbound-email, and repurposing tasks cannot be re-enabled until each
 * path has an authenticated server boundary and a deliberate product review.
 */
export function legacyWorkflowDisabled(): boolean {
  return true;
}
