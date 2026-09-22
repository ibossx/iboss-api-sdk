import { describe, expect, it } from "vitest";
import { IbossApiError } from "../../src/client/errors.js";
import {
  emptyCategoriesBitmap,
  generateBypassSslMitmFields,
  generateCategoryFields,
  generatePriorityFields,
  hasFieldFamily,
  POLICY_FIELD_FAMILY_MAX,
} from "../../src/api/policyFields.js";
import {
  assertSparsePatch,
  collectSparseVerifyFailures,
  isNativePatchUnsupported,
  mergePatch,
  mergeResourcePolicySettingsForFallback,
  omitGeneratedSettingsFamilies,
  sparseSettingsBody,
} from "../../src/api/resourcePolicySparse.js";

function currentSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    customCategoryId: 1114,
    customCategoryNumber: 2114,
    customCategoryName: "AI Security Policy",
    isZeroTrustResourcePolicy: 1,
    policyEnabled: 1,
    showPACUrl: 1,
    allowLargeFiles: 1,
    note: "keep me",
    ...generateCategoryFields(),
    ...generatePriorityFields(),
    ...generateBypassSslMitmFields(),
    categories: emptyCategoriesBitmap(),
    dlpPolicyMethod: 2,
    ...overrides,
  };
}

describe("omitGeneratedSettingsFamilies", () => {
  it("hides catN / prioN / bypassSslMitmN and the bitmap from agents", () => {
    const summary = omitGeneratedSettingsFamilies(
      currentSettings({ cat7: 9, prio3: 4, bypassSslMitm10: 1, aiRiskEnabled: 0 }),
    );
    expect(summary.aiRiskEnabled).toBe(0);
    expect(summary.note).toBe("keep me");
    expect(summary.cat7).toBeUndefined();
    expect(summary.prio3).toBeUndefined();
    expect(summary.bypassSslMitm10).toBeUndefined();
    expect(summary.categories).toBeUndefined();
    expect(Object.keys(summary).some((key) => /^cat\d+$/.test(key))).toBe(false);
  });
});

describe("sparseSettingsBody", () => {
  it("sends only changed fields plus customCategoryId — no invented families", () => {
    const body = sparseSettingsBody(1114, { aiRiskEnabled: 1, unused: undefined });
    expect(body).toEqual({ customCategoryId: 1114, aiRiskEnabled: 1 });
    expect(body.cat0).toBeUndefined();
    expect(body.prio0).toBeUndefined();
    expect(body.categories).toBeUndefined();
  });
});

describe("mergePatch (RFC 7396)", () => {
  it("keeps omitted keys and applies only the patch", () => {
    const next = mergePatch(currentSettings({ cat7: 9, prio3: 4 }), { aiRiskEnabled: 1 }) as Record<
      string,
      unknown
    >;
    expect(next.aiRiskEnabled).toBe(1);
    expect(next.cat7).toBe(9);
    expect(next.prio3).toBe(4);
    expect(next.note).toBe("keep me");
    expect(hasFieldFamily(next, "cat")).toBe(true);
  });

  it("treats null as delete", () => {
    const next = mergePatch({ note: "x", keep: 1 }, { note: null }) as Record<string, unknown>;
    expect(next.note).toBeUndefined();
    expect(next.keep).toBe(1);
  });
});

describe("mergeResourcePolicySettingsForFallback (DEVELOP-34914)", () => {
  it("omit-safe: omitted patch fields keep prior GET values, including full families", () => {
    const current = currentSettings({
      cat7: 9,
      prio3: 4,
      bypassSslMitm10: 1,
      showPACUrl: 1,
    });
    const next = mergeResourcePolicySettingsForFallback(current, { aiRiskEnabled: 1 });
    expect(next.aiRiskEnabled).toBe(1);
    expect(next.cat7).toBe(9);
    expect(next.prio3).toBe(4);
    expect(next.bypassSslMitm10).toBe(1);
    expect(next.showPACUrl).toBe(1);
    expect(next.note).toBe("keep me");
    expect(hasFieldFamily(next, "cat")).toBe(true);
    expect(hasFieldFamily(next, "prio")).toBe(true);
    expect(hasFieldFamily(next, "bypassSslMitm")).toBe(true);
    for (let i = 0; i <= POLICY_FIELD_FAMILY_MAX; i++) {
      expect(next[`cat${i}`]).toBeDefined();
      expect(next[`prio${i}`]).toBeDefined();
      expect(next[`bypassSslMitm${i}`]).toBeDefined();
    }
  });

  it("fills only family members the GET lacked so Gateway POST cannot default them", () => {
    const next = mergeResourcePolicySettingsForFallback(
      { customCategoryId: 1, isZeroTrustResourcePolicy: 1, cat7: 9 },
      { linkPolicyToAllSubjects: 1 },
    );
    expect(next.cat7).toBe(9);
    expect(next.cat0).toBe(3);
    expect(next.cat110).toBe(3);
    expect(next.dlpPolicyMethod).toBe(2);
    expect(hasFieldFamily(next, "prio")).toBe(true);
  });
});

describe("assertSparsePatch / verify / 405 detection", () => {
  it("rejects an empty patch so agents cannot POST a no-op blob", () => {
    expect(() => assertSparsePatch({})).toThrow(/at least one field/);
    expect(() => assertSparsePatch({ unused: undefined })).toThrow(/at least one field/);
  });

  it("collects verify failures only for patched keys", () => {
    expect(collectSparseVerifyFailures({ aiRiskEnabled: 0 }, { aiRiskEnabled: 1 })).toEqual([
      "aiRiskEnabled is 0, expected 1",
    ]);
    expect(collectSparseVerifyFailures({ aiRiskEnabled: 1, note: "x" }, { aiRiskEnabled: 1 })).toEqual(
      [],
    );
  });

  it("treats 404/405 as native PATCH unsupported, not 422/403", () => {
    const details = { method: "PATCH" as const, url: "https://gw.example/settings", status: 405 };
    expect(isNativePatchUnsupported(new IbossApiError("no", { ...details, status: 405 }))).toBe(true);
    expect(isNativePatchUnsupported(new IbossApiError("no", { ...details, status: 404 }))).toBe(true);
    expect(isNativePatchUnsupported(new IbossApiError("no", { ...details, status: 422 }))).toBe(false);
    expect(isNativePatchUnsupported(new IbossApiError("no", { ...details, status: 403 }))).toBe(false);
  });
});
