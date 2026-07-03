/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as analytics from "../analytics.js";
import type * as personas from "../personas.js";
import type * as posts from "../posts.js";
import type * as prompts from "../prompts.js";
import type * as seed from "../seed.js";
import type * as seedData from "../seedData.js";
import type * as settings from "../settings.js";
import type * as spend from "../spend.js";
import type * as streams from "../streams.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  analytics: typeof analytics;
  personas: typeof personas;
  posts: typeof posts;
  prompts: typeof prompts;
  seed: typeof seed;
  seedData: typeof seedData;
  settings: typeof settings;
  spend: typeof spend;
  streams: typeof streams;
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
