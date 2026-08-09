import { mutation as unsafeMutation, query as unsafeQuery } from "./_generated/server";

const RETIRED_MESSAGE =
  "This legacy Media Engine workflow is retired. Use the authenticated Client Work workspace instead.";

/**
 * Legacy modules were historically called directly from an unauthenticated
 * browser Convex client. Keep their function names registered only long enough
 * to fail closed for stale browser tabs and queued work; their former handlers
 * are never entered, so they cannot disclose data or change state.
 *
 * New client production uses creativeGateway, which has a separate service-token
 * boundary. Do not use these wrappers for a new workflow.
 */
export const query: typeof unsafeQuery = ((definition: any) =>
  unsafeQuery({
    ...definition,
    handler: async () => {
      throw new Error(RETIRED_MESSAGE);
    },
  })) as typeof unsafeQuery;

export const mutation: typeof unsafeMutation = ((definition: any) =>
  unsafeMutation({
    ...definition,
    handler: async () => {
      throw new Error(RETIRED_MESSAGE);
    },
  })) as typeof unsafeMutation;
