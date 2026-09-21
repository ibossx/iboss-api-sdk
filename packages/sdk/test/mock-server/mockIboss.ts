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

export interface MockState {
  /** Requests received, for assertions: "METHOD host/path". */
  requests: string[];
  /** Last-seen headers per request (auth + UA). */
  requestMeta: MockRequestMeta[];
  /** Policy layers created via the two-step flow. */
  policyLayers: Array<Record<string, unknown>>;
  /** Settings payloads applied to layers (POST body as sent). */
  layerSettings: Array<Record<string, unknown>>;
  /** Latest stored settings by customCategoryId (what GET returns). */
  settingsById: Record<number, Record<string, unknown>>;
  /** URLs added to layers. */
  layerUrls: Array<Record<string, unknown>>;
  /** Resource associations: query customCategoryId + body. */
  resourceAssociations: Array<{ customCategoryId: string; body: Record<string, unknown> }>;
  /** Force 5xx on the next N matching GETs of this path (transient-failure tests). */
  failNextGets: { path: string; remaining: number } | null;
  /**
   * POST settings returns success but GET omits the destination bitmap —
   * the Sep 10 "successful POST, empty saveIgnoredEntries, bit 110 missing" case.
   */
  dropDestinationsOnPost: boolean;
  nextLayerId: number;
}

export function createMockState(): MockState {
  return {
    requests: [],
    requestMeta: [],
    policyLayers: [],
    layerSettings: [],
    settingsById: {},
    layerUrls: [],
    resourceAssociations: [],
    failNextGets: null,
    dropDestinationsOnPost: false,
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

function cookieMap(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
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
        return c.json({ entries: state.policyLayers, totalCount: state.policyLayers.length });
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
        const entries = state.policyLayers.filter((l) => l.isZeroTrustResourcePolicy === 1);
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
        const afterUpdate =
          stored && customType === 3 ? 13 : customType;
        return c.json({
          ...(layer ?? {}),
          ...(stored ?? {}),
          customCategoryId: id,
          customType: afterUpdate,
          categoryType: afterUpdate,
        });
      });
      gateway.put("/json/controls/policyLayers", async (c) => {
        const body = await c.req.json<Record<string, unknown>>();
        const id = state.nextLayerId++;
        const layer = { ...body, customCategoryId: id, customCategoryNumber: id + 1000 };
        state.policyLayers.push(layer);
        return c.json({ customCategoryId: id, customCategoryNumber: id + 1000, id, successful: true });
      });
      gateway.post("/json/controls/policyLayers/settings", async (c) => {
        const body = await c.req.json<Record<string, unknown>>();
        state.layerSettings.push(body);
        const id = Number(body.customCategoryId);
        const layer = state.policyLayers.find((l) => l.customCategoryId === id);
        const stored: Record<string, unknown> = { ...body };
        // Allowlist recreate silently drops the bitmap (Sep 9–10 traces).
        if (isAllowlistType(layer?.customType) || state.dropDestinationsOnPost) {
          stored.categories = "";
          delete stored.categoriesSelectedType;
        }
        if (Number.isFinite(id)) state.settingsById[id] = stored;
        return c.json({
          message: "Successfully updated Resource Policy.",
          saveIgnoredEntries: [],
          successful: true,
        });
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
