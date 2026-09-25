/**
 * In-process mock of the iboss platform for integration tests.
 *
 * Simulates the three host tiers (dispatched by hostname), Set-Cookie
 * issuance, XSRF enforcement on mutating requests, and the discovery
 * endpoints. Use `mockFetch(state)` as the IbossClient's injected fetch —
 * no listener/port required.
 */
import { Hono } from "hono";
import {
  CLOUD_HOST,
  CLOUD_XSRF,
  GATEWAY_HOST,
  GATEWAY_XSRF,
  KEY_SCOPES,
  REPORTER_HOST,
  REPORTER_XSRF,
  clustersResponse,
  mySettingsFor,
  type MockKeyScope,
} from "./fixtures.js";

export interface MockRequestMeta {
  method: string;
  host: string;
  path: string;
  authorization?: string;
  userAgent?: string;
}

export interface MockSettingsWrite {
  method: string;
  merge?: string;
  body: Record<string, unknown>;
}

export interface MockState {
  /** Requests received, for assertions: "METHOD host/path". */
  requests: string[];
  /** Last-seen headers per request (auth + UA). */
  requestMeta: MockRequestMeta[];
  /** Policy layers created via the two-step flow. */
  policyLayers: Array<Record<string, unknown>>;
  /** Settings payloads applied to layers (body as sent). */
  layerSettings: Array<Record<string, unknown>>;
  /** Latest stored settings by customCategoryId (what GET returns). */
  settingsById: Record<number, Record<string, unknown>>;
  /** Settings writes with verb + merge query (sparse PATCH tests). */
  settingsWrites: MockSettingsWrite[];
  /** Last query string on GET policyLayers/all (kind-list tests). */
  lastPolicyListQuery: Record<string, string>;
  /** URLs added to layers. */
  layerUrls: Array<Record<string, unknown>>;
  /** Resource associations: query customCategoryId + body. */
  resourceAssociations: Array<{ customCategoryId: string; body: Record<string, unknown> }>;
  /** Force 5xx on the next N matching GETs of this path (transient-failure tests). */
  failNextGets: { path: string; remaining: number } | null;
  /**
   * When false, PATCH /policyLayers/settings returns 405 (node without native PATCH).
   * Auto SDK path then falls back to get→merge→full POST.
   */
  nativeSettingsPatch: boolean;
  /**
   * When false, POST `?merge=1` is treated as a full replace (old gateway
   * ignores the query). Used to prove why `auto` must not send merge-post.
   */
  nativeSettingsMergePost: boolean;
  /** PATCH/merge-post succeeds but GET omits the patched keys. */
  dropPatchFieldsOnRead: boolean;
  /**
   * POST settings returns success but GET omits the destination bitmap —
   * the Sep 10 "successful POST, empty saveIgnoredEntries, bit 110 missing" case.
   */
  dropDestinationsOnPost: boolean;
  /** Reporter AI Governance conversation rows. */
  aiConversations: Array<Record<string, unknown>>;
  /** Last query string on the conversations list/detail routes. */
  lastAiConversationQuery: Record<string, string> | null;
  aiConversationListNull: boolean;
  aiConversationVisibleAfterGets: number;
  aiConversationGetHits: number;
  nextLayerId: number;
}

export function createMockState(): MockState {
  return {
    requests: [],
    requestMeta: [],
    policyLayers: [],
    layerSettings: [],
    settingsById: {},
    settingsWrites: [],
    lastPolicyListQuery: {},
    layerUrls: [],
    resourceAssociations: [],
    failNextGets: null,
    nativeSettingsPatch: true,
    nativeSettingsMergePost: true,
    dropPatchFieldsOnRead: false,
    dropDestinationsOnPost: false,
    aiConversations: [],
    lastAiConversationQuery: null,
    aiConversationListNull: false,
    aiConversationVisibleAfterGets: 0,
    aiConversationGetHits: 0,
    nextLayerId: 100,
  };
}

function wireCustomType(createType: unknown): unknown {
  if (createType === "e_custom_category_type_allowlist") return 1;
  if (createType === "e_custom_category_type_categories") return 3;
  if (createType === "e_custom_category_type_blacklist") return 0;
  return createType;
}

function isAllowlistType(createType: unknown): boolean {
  return createType === "e_custom_category_type_allowlist" || createType === 1 || createType === "1";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** RFC 7396 JSON Merge Patch for settings PATCH and POST ?merge=1. */
function mergePatch(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete out[key];
    } else if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = mergePatch(out[key] as Record<string, unknown>, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** The single account the presented API key is scoped to (platform-faithful). */
function scopeOf(c: { req: { header(name: string): string | undefined } }): MockKeyScope | undefined {
  const auth = c.req.header("authorization") ?? "";
  const key = auth.startsWith("Token ") ? auth.slice("Token ".length) : "";
  return KEY_SCOPES[key];
}

export function createMockIboss(state: MockState): Hono {
  const app = new Hono();

  // Global auth + bookkeeping middleware.
  app.use("*", async (c, next) => {
    const host = new URL(c.req.url).hostname;
    const path = new URL(c.req.url).pathname;
    state.requests.push(`${c.req.method} ${host}${path}`);
    state.requestMeta.push({
      method: c.req.method,
      host,
      path,
      authorization: c.req.header("authorization"),
      userAgent: c.req.header("user-agent"),
    });

    if (!scopeOf(c)) {
      return c.json({ message: "Unauthorized" }, 401);
    }

    // XSRF enforcement for mutating requests, Spring-style: the X-XSRF-TOKEN
    // header must match a token this server issued (host-specific token, or
    // the cloud token as cross-host fallback).
    if (["POST", "PUT", "DELETE", "PATCH"].includes(c.req.method)) {
      const header = c.req.header("x-xsrf-token");
      const validTokens = new Set([CLOUD_XSRF, GATEWAY_XSRF, REPORTER_XSRF]);
      if (!header || !validTokens.has(header)) {
        return c.json({ message: "XSRF token mismatch" }, 403);
      }
    }
    await next();
  });

  // Transient failure injection.
  app.use("*", async (c, next) => {
    if (
      c.req.method === "GET" &&
      state.failNextGets &&
      state.failNextGets.remaining > 0 &&
      new URL(c.req.url).pathname === state.failNextGets.path
    ) {
      state.failNextGets.remaining--;
      return c.json({ message: "flaky" }, 502);
    }
    await next();
  });

  const dispatchByHost = (handlers: Record<string, (app: Hono) => void>) => {
    for (const [host, register] of Object.entries(handlers)) {
      const sub = new Hono();
      register(sub);
      app.use("*", async (c, next) => {
        if (new URL(c.req.url).hostname === host) {
          const res = await sub.fetch(c.req.raw);
          if (res.status !== 404) return res;
        }
        await next();
      });
    }
  };

  dispatchByHost({
    [CLOUD_HOST]: (cloud) => {
      cloud.get("/ibcloud/web/users/mySettings", (c) => {
        c.header("Set-Cookie", `XSRF-TOKEN=${CLOUD_XSRF}; Path=/`, { append: true });
        c.header("Set-Cookie", "JSESSIONID=cloud-session-0001; Path=/; HttpOnly", { append: true });
        // Platform-faithful: a key sees exactly its one account.
        return c.json(mySettingsFor(scopeOf(c)!));
      });
      cloud.get("/ibcloud/web/users/me", (c) => c.json({ ibCloudUserId: scopeOf(c)!.ibCloudUserId }));
      cloud.get("/ibcloud/web/users/:id", (c) => {
        const scope = scopeOf(c)!;
        if (c.req.param("id") !== String(scope.ibCloudUserId)) {
          return c.json({ message: "not found" }, 404);
        }
        return c.json({ ibCloudUserId: scope.ibCloudUserId, apiCredentialExpiresAt: 4102444800 });
      });
      cloud.get("/ibcloud/web/account/clusters", (c) => {
        if (!c.req.query("accountSettingsId")) {
          return c.json({ message: "accountSettingsId required" }, 400);
        }
        return c.json(clustersResponse);
      });
      cloud.post("/ibcloud/web/users/account/:acct/apiUser/:user/rotateCredential", (c) =>
        c.json({ opaqueToken: "rotated-key-not-a-real-credential", expiresAtMillis: 4102444800000 }),
      );
      cloud.get("/ibcloud/web/groups/filtering", (c) =>
        c.json([{ groupNumber: 1, groupName: "Default", reservedGroup: 0 }]),
      );
    },

    [GATEWAY_HOST]: (gateway) => {
      // Every gateway response issues the gateway-host XSRF cookie, mirroring
      // how the platform establishes a gateway session on first contact.
      gateway.use("*", async (c, next) => {
        await next();
        c.header("Set-Cookie", `XSRF-TOKEN=${GATEWAY_XSRF}; Path=/`, { append: true });
      });

      gateway.get("/json/controls/policyLayers", (c) =>
        c.json({ entries: state.policyLayers, totalCount: state.policyLayers.length }),
      );
      gateway.get("/json/controls/policyLayers/all", (c) => {
        // The real endpoint requires the pagination + filter params.
        if (!c.req.query("maxItems") || c.req.query("isZeroTrustLayer") === undefined) {
          return c.json({ message: "missing required pagination/filter params" }, 400);
        }
        const url = new URL(c.req.url);
        state.lastPolicyListQuery = Object.fromEntries(url.searchParams.entries());
        const isZt = Number(c.req.query("isZeroTrustLayer"));
        const typeFilter = Number(c.req.query("typeFilter") ?? -1);
        let entries = state.policyLayers;
        if (isZt === 0) {
          entries = entries.filter((layer) => Number(layer.isZeroTrustResourcePolicy ?? 0) !== 1);
        } else if (isZt === 1) {
          entries = entries.filter((layer) => Number(layer.isZeroTrustResourcePolicy ?? 0) === 1);
        }
        if (typeFilter !== -1 && !Number.isNaN(typeFilter)) {
          entries = entries.filter((layer) => Number(layer.customType) === typeFilter);
        }
        const currentRow = Number(c.req.query("currentRow") ?? 0);
        const maxItems = Number(c.req.query("maxItems") ?? 100);
        const page = entries.slice(currentRow, currentRow + maxItems);
        return c.json({ entries: page, totalCount: entries.length });
      });
      gateway.put("/json/controls/resourcePolicy/resources", async (c) => {
        const customCategoryId = c.req.query("customCategoryId");
        if (!customCategoryId) return c.json({ message: "customCategoryId required" }, 400);
        const body = await c.req.json<Record<string, unknown>>();
        if (!Array.isArray(body.resourceIds)) {
          return c.json({ message: "resourceIds required" }, 400);
        }
        state.resourceAssociations.push({ customCategoryId, body });
        return c.json({ successful: true });
      });
      gateway.get("/json/controls/resourcePolicies", (c) => {
        const entries = state.policyLayers.filter(
          (layer) => Number(layer.isZeroTrustResourcePolicy ?? 0) === 1,
        );
        return c.json({ entries, totalCount: entries.length });
      });
      gateway.get("/json/controls/policyLayers/settings", (c) => {
        const id = Number(c.req.query("customCategoryId"));
        if (!Number.isFinite(id)) return c.json({ message: "customCategoryId required" }, 400);
        const layer = state.policyLayers.find((l) => l.customCategoryId === id);
        const stored = state.settingsById[id];
        if (!layer && !stored) return c.json({ message: "not found" }, 404);
        const customType = wireCustomType(layer?.customType ?? stored?.customType);
        // After a settings POST, some live GETs report 13 instead of 3 — both are categories-shaped.
        const afterUpdate = stored && customType === 3 ? 13 : customType;
        const body: Record<string, unknown> = {
          ...(layer ?? {}),
          ...(stored ?? {}),
          customCategoryId: id,
          customType: afterUpdate,
          categoryType: afterUpdate,
        };
        if (state.dropPatchFieldsOnRead) {
          delete body.aiRiskEnabled;
          delete body.aiRiskEngines;
        }
        return c.json(body);
      });
      gateway.put("/json/controls/policyLayers", async (c) => {
        const body = await c.req.json<Record<string, unknown>>();
        const id = state.nextLayerId++;
        const layer = { ...body, customCategoryId: id, customCategoryNumber: id + 1000 };
        state.policyLayers.push(layer);
        return c.json({ customCategoryId: id, customCategoryNumber: id + 1000, id, successful: true });
      });
      const applySettingsWrite = (
        method: string,
        merge: string | undefined,
        body: Record<string, unknown>,
      ) => {
        state.layerSettings.push(body);
        state.settingsWrites.push({ method, merge, body });
        const id = Number(body.customCategoryId);
        const layer = state.policyLayers.find((l) => l.customCategoryId === id);
        const current = (Number.isFinite(id) ? state.settingsById[id] : undefined) ?? {};
        const useMerge = method === "PATCH" || (method === "POST" && merge === "1");
        const next = useMerge ? mergePatch(current, body) : { ...body };
        // Allowlist recreate / dropDestinationsOnPost silently drops the bitmap
        // on full POST (Sep 9–10 traces). Merge PATCH keeps existing bits.
        if (!useMerge && (isAllowlistType(layer?.customType) || state.dropDestinationsOnPost)) {
          next.categories = "";
          delete next.categoriesSelectedType;
        }
        if (Number.isFinite(id)) state.settingsById[id] = next;
        return {
          message: "Successfully updated Resource Policy.",
          saveIgnoredEntries: [],
          successful: true,
        };
      };
      gateway.patch("/json/controls/policyLayers/settings", async (c) => {
        if (!state.nativeSettingsPatch) {
          return c.json({ message: "Method Not Allowed" }, 405);
        }
        const body = await c.req.json<Record<string, unknown>>();
        return c.json(applySettingsWrite("PATCH", c.req.query("merge"), body));
      });
      gateway.post("/json/controls/policyLayers/settings", async (c) => {
        const body = await c.req.json<Record<string, unknown>>();
        const merge = c.req.query("merge");
        if (merge === "1" && !state.nativeSettingsMergePost) {
          // Older nodes: ignore merge and full-replace (wipe-on-omit).
          return c.json(applySettingsWrite("POST", undefined, body));
        }
        return c.json(applySettingsWrite("POST", merge, body));
      });
      gateway.get("/json/controls/policyLayers/urls", (c) => c.json({ entries: state.layerUrls }));
      gateway.put("/json/controls/policyLayers/urls", async (c) => {
        state.layerUrls.push(await c.req.json<Record<string, unknown>>());
        return c.json({ successful: true });
      });
      gateway.delete("/json/controls/policyLayers/urls", (c) => {
        const url = c.req.query("url");
        if (!c.req.query("customCategoryId") || !url) {
          return c.json({ message: "customCategoryId and url required" }, 400);
        }
        const before = state.layerUrls.length;
        state.layerUrls = state.layerUrls.filter((entry) => entry.url !== url);
        if (state.layerUrls.length === before) return c.json({ message: "not found" }, 404);
        return c.json({ successful: true });
      });
      gateway.put("/bulk/controls/policyLayers/urls", async (c) => {
        const body = await c.req.json<{ importList?: Record<string, unknown>[]; defaults?: Record<string, unknown> }>();
        if (!Array.isArray(body.importList) || !body.defaults?.customCategoryNumber) {
          return c.json({ message: "importList and defaults required" }, 400);
        }
        for (const entry of body.importList) state.layerUrls.push({ ...entry, ...body.defaults });
        return c.json({ successful: true, imported: body.importList.length });
      });
      gateway.delete("/json/controls/policyLayers", (c) => {
        const id = Number(c.req.query("customCategoryId"));
        state.policyLayers = state.policyLayers.filter((l) => l.customCategoryId !== id);
        return c.json({ successful: true });
      });
      // Simulates a module the account is not subscribed to.
      gateway.put("/json/contentAnalysisRule/dlpPolicyResponse", (c) =>
        c.json({ message: "DLP subscription required" }, 422),
      );
    },

    [REPORTER_HOST]: (reporter) => {
      reporter.get("/ibreports/web/users/me", (c) => {
        c.header("Set-Cookie", `XSRF-TOKEN=${REPORTER_XSRF}; Path=/`, { append: true });
        c.header("Set-Cookie", "JSESSIONID=reporter-session-0001; Path=/; HttpOnly", { append: true });
        return c.json({ userId: scopeOf(c)!.ibCloudUserId });
      });
      reporter.get("/ibreports/web/reports/lite", (c) => c.json([{ reportId: 9, reportName: "Daily" }]));

      const visibleConversations = () => {
        if (state.aiConversationListNull) return null;
        if (state.aiConversationGetHits < state.aiConversationVisibleAfterGets) return [];
        return state.aiConversations;
      };

      const noteConversationQuery = (url: string): "reject" | "ok" => {
        const query = Object.fromEntries(new URL(url, "http://reporter.invalid").searchParams.entries());
        state.lastAiConversationQuery = query;
        // Live reporter (2026-09-22): plain since/until (ms or ISO) is 400.
        // intervalStartTime/intervalEndTime + filterByIntervalTime is 200.
        if (query.since !== undefined || query.until !== undefined) return "reject";
        return "ok";
      };

      reporter.get("/ibreports/web/aiSecurityGovernance/conversations", (c) => {
        if (noteConversationQuery(c.req.url) === "reject") {
          return c.json(
            {
              message:
                "since/until are not reporter parameters; use intervalStartTime, intervalEndTime, and filterByIntervalTime",
            },
            400,
          );
        }
        state.aiConversationGetHits++;
        const conversations = visibleConversations();
        return c.json({
          result: {
            conversations,
            intervalStartTime: Number(c.req.query("intervalStartTime") ?? 0),
            intervalEndTime: Number(c.req.query("intervalEndTime") ?? 0),
          },
        });
      });
      reporter.get("/ibreports/web/aiSecurityGovernance/conversations/:id", (c) => {
        if (noteConversationQuery(c.req.url) === "reject") {
          return c.json(
            {
              message:
                "since/until are not reporter parameters; use intervalStartTime, intervalEndTime, and filterByIntervalTime",
            },
            400,
          );
        }
        state.aiConversationGetHits++;
        if (state.aiConversationGetHits <= state.aiConversationVisibleAfterGets) {
          return c.json({ message: "not found" }, 404);
        }
        const id = c.req.param("id");
        const row = state.aiConversations.find(
          (entry) => String(entry.conversationId ?? entry.id) === id,
        );
        if (!row) return c.json({ message: "not found" }, 404);
        return c.json({
          result: {
            conversation: row,
            messages: Array.isArray(row.messages) ? row.messages : [],
          },
        });
      });
    },
  });

  app.all("*", (c) => c.json({ message: `mock: no route for ${c.req.method} ${c.req.url}` }, 404));
  return app;
}

/** A fetch-compatible function that routes requests into the mock app. */
export function mockFetch(state: MockState): typeof globalThis.fetch {
  const app = createMockIboss(state);
  return ((input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) =>
    app.fetch(new Request(input, init))) as typeof globalThis.fetch;
}
