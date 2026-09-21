/**
 * @iboss/sdk — public API surface.
 *
 * Quick start:
 * ```ts
 * import { IbossClient } from "@iboss/sdk";
 *
 * const client = new IbossClient({
 *   domain: process.env.IBOSS_CLOUD_DOMAIN!,
 *   credentials: { apiKey: process.env.IBOSS_API_KEY! },
 * });
 * await client.connect();
 * ```
 */

// Client
export { IbossClient } from "./client/IbossClient.js";
export type { IbossClientConfig } from "./client/config.js";
export type { SessionState, AccountInfo } from "./client/session.js";
export { parseIbossExpiry } from "./client/session.js";
export type { HostTier, HostMap } from "./client/hosts.js";
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
  CATEGORIES_SELECTED_TYPE,
  WEB_CATEGORY_BITS,
  aiServicesDestination,
  decodeDestinations,
  encodeDestinationBits,
  type DestinationSpec,
  type ResourcePolicyDestinations,
  type WebCategory,
} from "./api/destinations.js";
export type { ResourcePolicySettingsPatch } from "./api/resourcePolicyCreate.js";
export type { PacZone, PrivateNetwork } from "./api/locations.js";
export type { ZeroTrustResource, ListResourcesOptions } from "./api/resources.js";
export type { FirewallRule } from "./api/firewall.js";
export type { ContentAnalysisRule, DlpPolicyResponse } from "./api/dlp.js";
export type { ZtnaPeer } from "./api/network.js";
export type { ProxyUser, ProxyDevice } from "./api/directory.js";
export type { DrillDownReport, UrlLogEntry, TopNOptions } from "./api/reporting.js";

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
