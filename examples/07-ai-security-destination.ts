/**
 * Agent-friendly Resource Policy helpers (DEVELOP-34913 / 34914 / 34916).
 *
 *   npx tsx examples/07-ai-security-destination.ts
 *
 * Uses IbossClient.fromEnv() / fromProfile() so the key never enters the
 * script. Typed destinations hide the 400-char categories bitmap (bit 110 =
 * AI Services, categoriesSelectedType 0 = Selected Destinations). Patch
 * UPDATE get-merge-posts so you send only changed fields; the SDK re-GETs
 * and refuses to trust POST success alone.
 */
import { IbossClient } from "@iboss/sdk";

const client = (() => {
  try {
    return IbossClient.fromEnv();
  } catch {
    return IbossClient.fromProfile();
  }
})();

const POLICY_NAME = "Example AI Security";

const existing = (await client.policies.listResourcePolicies()).find(
  (row) => row.customCategoryName === POLICY_NAME,
) as { customCategoryId?: number } | undefined;

const policy = existing?.customCategoryId
  ? await client.policies.patchResourcePolicySettings(Number(existing.customCategoryId), {
      destinations: { mode: "selectedWebCategories", categories: ["AI_SERVICES"] },
      aiRiskEnabled: 1,
      linkPolicyToAllSubjects: 1,
    })
  : await client.policies.createResourcePolicy({
      name: POLICY_NAME,
      destinations: { mode: "selectedWebCategories", categories: ["AI_SERVICES"] },
      aiRiskEnabled: true,
      aiRiskEngines: "chatgpt",
      linkPolicyToAllSubjects: true,
      aiRiskMonitoringMessage: "AI use is monitored.",
      aiRiskMonitoringMessageEnabled: true,
      aiRiskMonitoringMessageTitle: "Warning",
    });

const verified = await client.policies.ensureAiSecurityDestination(
  (policy as { customCategoryId: number }).customCategoryId,
);

console.log(JSON.stringify(verified, null, 2));
