/**
 * @iboss/sdk — public API surface.
 *
 * Quick start:
 * ```ts
 * import { IbossClient } from "@iboss/sdk";
 *
 * const client = IbossClient.fromEnv();
 * // or: new IbossClient({ domain, credentials: { apiKey } })
 * await client.connect();
 * ```
 */

// Client
export { IbossClient } from "./client/IbossClient.js";
export type { IbossClientConfig, FromConfigOptions } from "./client/config.js";
export { DEFAULT_USER_AGENT } from "./client/config.js";
export type { SessionState, AccountInfo } from "./client/session.js";
export { parseIbossExpiry } from "./client/session.js";
export type { HostTier, HostMap, HostOverrides } from "./client/hosts.js";
export { inferHostTier, hostOverridesFromEnv, hostnameFromEnvValue } from "./client/hosts.js";
export type { RequestOptions } from "./client/request.js";

// Credentials
export type {
  Credential,
  CredentialContext,
  CredentialProvider,
} from "./client/credentials/CredentialProvider.js";
export { ApiKeyCredentialProvider } from "./client/credentials/apiKey.js";
export {
  UserPasswordCredentialProvider,
  type UserPasswordCredentials,
} from "./client/credentials/passwordLogin.js";

// Errors
export {
  IbossError,
  IbossApiError,
  IbossAuthError,
  IbossXsrfError,
  IbossSubscriptionError,
  IbossHostUnavailableError,
  IbossNotConnectedError,
  IbossNetworkError,
  IbossVerifyError,
  IbossPolicyTypeError,
  type HttpMethod,
} from "./client/errors.js";

// Logging
export type { Logger } from "./client/logger.js";
export { consoleLogger, noopLogger } from "./client/logger.js";

// Feature-area types & helpers
export type { SuccessResponse, EntriesResponse } from "./api/base.js";
export type { RotateCredentialResult, GeneralSettings, NtpSettings } from "./api/account.js";
export type { FilteringGroup, ReportingGroup } from "./api/groups.js";
export {
  generateCategoryFields,
  generatePriorityFields,
  generateBypassSslMitmFields,
  emptyCategoriesBitmap,
  type PolicyLayer,
  type PolicyLayerType,
  type CreateLayerResult,
  type CreateResourcePolicyParams,
  type CreateResourcePolicyResult,
} from "./api/policies.js";
export {
  AI_SERVICES_BIT,
  CATEGORIES_BITMAP_LENGTH,
  CATEGORIES_SELECTED_TYPE,
  WEB_CATEGORY_BITS,
  aiServicesDestination,
  encodeDestinationBits,
  decodeDestinations,
  isCategoryBitSet,
  isCategoriesCustomType,
  destinationTypeConflict,
  prepareDestinationWrite,
  assertDestinationsExpressable,
  type DestinationMode,
  type DestinationSpec,
  type ResourcePolicyDestinations,
  type WebCategory,
  type WrongTypeBehavior,
} from "./api/destinations.js";
export {
  RESOURCE_POLICY_SETTINGS_WIRE_PATH,
  mergePatch,
  omitGeneratedSettingsFamilies,
  sparseSettingsBody,
  type ResourcePolicySettingsPatch,
  type ResourcePolicySettingsTransport,
} from "./api/resourcePolicySparse.js";
export {
  mergeResourcePolicySettings,
  summarizeResourcePolicySettings,
  type ResourcePolicyPatch,
  type ResourcePolicySettingsSummary,
} from "./api/resourcePolicySettings.js";
export {
  POLICY_FIELD_FAMILY_MAX,
  hasFieldFamily,
  ensureFieldFamilies,
  isGeneratedSettingsFamilyKey,
} from "./api/policyFields.js";
export {
  KNOWN_AI_RISK_ENGINES,
  encodeAiRiskEngines,
  type AiRiskEngine,
  type AiRiskEnginesInput,
} from "./api/aiRiskEngines.js";
export {
  POLICY_KINDS,
  POLICY_KIND_ALIASES,
  POLICY_KIND_FILTERS,
  POLICY_KIND_ALL_FILTER,
  POLICY_TYPE_FILTER,
  POLICY_CUSTOM_TYPE,
  classifyPolicyKind,
  resolvePolicyKind,
  toPolicySummary,
  toPolicyList,
  type PolicyKind,
  type PolicyKindInput,
  type PolicyKindWireFilter,
  type PolicyList,
  type PolicyListKind,
  type PolicySummary,
} from "./api/policyKinds.js";
export type { PacZone, PrivateNetwork } from "./api/locations.js";
export type { ZeroTrustResource, ListResourcesOptions } from "./api/resources.js";
export type { FirewallRule } from "./api/firewall.js";
export type { ContentAnalysisRule, DlpPolicyResponse } from "./api/dlp.js";
export type { ZtnaPeer } from "./api/network.js";
export type { ProxyUser, ProxyDevice } from "./api/directory.js";
export type { DrillDownReport, UrlLogEntry, TopNOptions } from "./api/reporting.js";
export {
  GovernanceApi,
  AI_GOVERNANCE_CONVERSATIONS_PATH,
  AI_CONVERSATION_TYPICAL_LAG_MINUTES,
  AI_CONVERSATION_TEXT_CONTAINS_MAX,
  AI_CONVERSATION_VENDOR_WIRE,
} from "./api/governance.js";
export type {
  AiConversationDetail,
  AiConversationList,
  AiConversationListFilter,
  AiConversationMessage,
  AiConversationSummary,
  AiConversationTime,
  ListAiConversationsOptions,
  GetAiConversationOptions,
  WaitForAiConversationOptions,
} from "./api/governance.js";

// Workflows
export { defineWorkflow } from "./workflows/define.js";
export type {
  WorkflowDefinition,
  WorkflowContext,
  WorkflowEvent,
  WorkflowRunResult,
} from "./workflows/types.js";
export { discoverWorkflows } from "./workflows/discover.js";
export { runWorkflow } from "./workflows/runner.js";

// Config / profiles
export {
  resolveProfile,
  loadConfigFile,
  saveUserConfig,
  saveProjectConfig,
  userConfigPath,
  accountsOfProfile,
  upsertProfileAccount,
  removeProfileAccount,
  type AccountCredential,
  type ResolvedProfile,
  type IbossConfigFile,
} from "./config/profiles.js";
