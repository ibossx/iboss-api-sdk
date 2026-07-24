import { z } from "zod";

/**
 * An iboss API key is scoped to exactly one account, so a profile that spans
 * multiple accounts holds one credential per account.
 */
export const accountCredentialSchema = z.object({
  name: z.string().min(1).describe("Label for this account, e.g. hq or emea"),
  apiKey: z.string().min(1).describe("API key for this account"),
  accountSettingsId: z.string().optional().describe("Pin the accountSettingsId (optional)"),
  domain: z.string().optional().describe("Cloud base API host override for this account (optional)"),
});

const singleKeyProfileSchema = z.object({
  domain: z.string().min(1).describe("Cloud base API host, e.g. api.ibosscloud.com"),
  apiKey: z.string().min(1).describe("iboss API key"),
  accountSettingsId: z.string().optional().describe("Pin a specific account (optional)"),
});

const multiAccountProfileSchema = z.object({
  domain: z.string().min(1).describe("Default cloud base API host for the profile"),
  accounts: z
    .array(accountCredentialSchema)
    .min(1)
    .describe("One credential per account (an API key maps to exactly one account)")
    .refine(
      (accounts) => new Set(accounts.map((a) => a.name)).size === accounts.length,
      "account names must be unique within a profile",
    ),
});

export const profileSchema = z.union([singleKeyProfileSchema, multiAccountProfileSchema]);

export const configFileSchema = z.object({
  $comment: z.string().optional(),
  defaultProfile: z.string().optional(),
  profiles: z.record(z.string(), profileSchema).default({}),
});

export type AccountCredentialConfig = z.infer<typeof accountCredentialSchema>;
export type SingleKeyProfile = z.infer<typeof singleKeyProfileSchema>;
export type MultiAccountProfile = z.infer<typeof multiAccountProfileSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type IbossConfigFile = z.infer<typeof configFileSchema>;

export function isMultiAccountProfile(profile: Profile): profile is MultiAccountProfile {
  return "accounts" in profile && Array.isArray((profile as MultiAccountProfile).accounts);
}
