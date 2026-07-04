/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as analytics from "../analytics.js";
import type * as clients from "../clients.js";
import type * as email from "../email.js";
import type * as personas from "../personas.js";
import type * as posts from "../posts.js";
import type * as prompts from "../prompts.js";
import type * as seed from "../seed.js";
import type * as seedData from "../seedData.js";
import type * as settings from "../settings.js";
import type * as spend from "../spend.js";
import type * as streams from "../streams.js";
import type * as studio from "../studio.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  analytics: typeof analytics;
  clients: typeof clients;
  email: typeof email;
  personas: typeof personas;
  posts: typeof posts;
  prompts: typeof prompts;
  seed: typeof seed;
  seedData: typeof seedData;
  settings: typeof settings;
  spend: typeof spend;
  streams: typeof streams;
  studio: typeof studio;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
