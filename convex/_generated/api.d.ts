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
import type * as assets from "../assets.js";
import type * as campaigns from "../campaigns.js";
import type * as clients from "../clients.js";
import type * as crossmarketing from "../crossmarketing.js";
import type * as discounts from "../discounts.js";
import type * as email from "../email.js";
import type * as engagement from "../engagement.js";
import type * as funnels from "../funnels.js";
import type * as influencers from "../influencers.js";
import type * as intel from "../intel.js";
import type * as leads from "../leads.js";
import type * as models from "../models.js";
import type * as personas from "../personas.js";
import type * as playbooks from "../playbooks.js";
import type * as posts from "../posts.js";
import type * as products from "../products.js";
import type * as prompts from "../prompts.js";
import type * as seed from "../seed.js";
import type * as seedAgency from "../seedAgency.js";
import type * as seedData from "../seedData.js";
import type * as services from "../services.js";
import type * as settings from "../settings.js";
import type * as spend from "../spend.js";
import type * as stores from "../stores.js";
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
  assets: typeof assets;
  campaigns: typeof campaigns;
  clients: typeof clients;
  crossmarketing: typeof crossmarketing;
  discounts: typeof discounts;
  email: typeof email;
  engagement: typeof engagement;
  funnels: typeof funnels;
  influencers: typeof influencers;
  intel: typeof intel;
  leads: typeof leads;
  models: typeof models;
  personas: typeof personas;
  playbooks: typeof playbooks;
  posts: typeof posts;
  products: typeof products;
  prompts: typeof prompts;
  seed: typeof seed;
  seedAgency: typeof seedAgency;
  seedData: typeof seedData;
  services: typeof services;
  settings: typeof settings;
  spend: typeof spend;
  stores: typeof stores;
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
