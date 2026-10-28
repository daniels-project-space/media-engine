import { action } from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

// This fixed dispatch table is a server capability boundary, not a public RPC
// proxy. No caller may choose an arbitrary Convex module or function.
const mutations = {
  savePlan: "marketingPlans:save",
  saveResearch: "marketingResearch:save",
  startDiscovery: "marketingResearch:startDiscovery",
  finishDiscovery: "marketingResearch:finishDiscovery",
  createPlanDraft: "marketingPlans:createDraft",
  startPlan: "marketingPlans:start",
  claimPlan: "marketingPlans:claim",
  finishPlan: "marketingPlans:finish",
  requestHyperImport: "marketingHyperImports:request",
  claimHyperImport: "marketingHyperImports:claim",
  settleHyperImport: "marketingHyperImports:settle",
  createProject: "marketing:createProject",
  updateProject: "marketing:updateProject",
  recordCost: "marketingOverview:recordCost",
  voidCost: "marketingOverview:voidCost",
  syncAccounts: "marketing:syncAccounts",
  saveChannel: "marketing:saveChannel",
  createItem: "marketing:createItem",
  approveItem: "marketing:approveItem",
  claimItem: "marketing:claimItem",
  recordOutcome: "marketing:recordOutcome",
  setProjectStatus: "marketing:setProjectStatus",
  ingestConversion: "marketing:ingestConversion",
  registerAsset: "marketing:registerAsset",
  ingestWebhook: "marketing:ingestWebhook",
  generateWeek: "marketing:generateWeek",
  blockItem: "marketing:blockItem",
  reserveMetricsRead: "marketing:reserveMetricsRead",
  completeMetricsRead: "marketing:completeMetricsRead",
  editDraft: "marketing:editDraft",
  recheckItem: "marketing:recheckItem",
  settleAdBilling: "marketing:settleAdBilling",
  recordInventoryFailure: "marketing:recordInventoryFailure",
  recordPlanningFailure: "marketing:recordPlanningFailure",
  requestRenderImport: "marketingRenders:requestImport",
  claimRenderImport: "marketingRenders:claimImport",
  settleRenderImport: "marketingRenders:settleImport",
} as const;
const queries = {
  latestPlan: "marketingPlans:latest",
  listResearch: "marketingResearch:list",
  latestPlanRun: "marketingPlans:latestRun",
  latestHyperImport: "marketingHyperImports:latest",
  overview: "marketingOverview:overview",
  contentTable: "marketingOverview:contentTable",
  listWorkspace: "marketing:listWorkspace",
  getItem: "marketing:getItem",
  getAsset: "marketing:getAsset",
  dueItems: "marketing:dueItems",
  dueProjects: "marketing:dueProjects",
  providerInventory: "marketing:providerInventory",
  availableRenders: "marketingRenders:available",
} as const;

export const call = action({
  args: { serviceToken: v.string(), operation: v.string(), payload: v.any() },
  handler: async (ctx, args): Promise<unknown> => {
    const expected = process.env.MEDIA_ENGINE_CONVEX_SERVICE_TOKEN;
    if (!expected || expected.length < 32 || args.serviceToken !== expected)
      throw new Error("Unauthorised marketing service call");
    if (Object.hasOwn(mutations, args.operation)) {
      return ctx.runMutation(
        makeFunctionReference<"mutation">(
          mutations[args.operation as keyof typeof mutations],
        ),
        args.payload,
      );
    }
    if (Object.hasOwn(queries, args.operation)) {
      return ctx.runQuery(
        makeFunctionReference<"query">(
          queries[args.operation as keyof typeof queries],
        ),
        args.payload,
      );
    }
    throw new Error("Unknown marketing operation");
  },
});
