// `settings.set` is a public Convex mutation. Keep the one value that can
// start Codex/paid-media work behind an authenticated identity while allowing
// anyone to stop that work during an incident.
export function requireAuthenticatedAiEnable(
  key: string,
  value: unknown,
  authenticated: boolean,
): void {
  if (key === "aiEnabled" && value === true && !authenticated) {
    throw new Error("Authentication is required to enable AI generation");
  }
}
