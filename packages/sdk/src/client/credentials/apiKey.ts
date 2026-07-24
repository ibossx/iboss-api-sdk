import type { Credential, CredentialContext, CredentialProvider } from "./CredentialProvider.js";

/**
 * API-key authentication — the recommended flow.
 *
 * The key generated in the iboss admin console is used directly as the bearer:
 * `Authorization: Token <apiKey>` on every request, no login exchange. A 401
 * with a static key is terminal (expired, revoked, or wrong cloud domain), so
 * there is no refresh().
 */
export class ApiKeyCredentialProvider implements CredentialProvider {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey || !apiKey.trim()) {
      throw new Error("ApiKeyCredentialProvider requires a non-empty API key");
    }
    this.apiKey = apiKey.trim();
  }

  async getCredential(_ctx: CredentialContext): Promise<Credential> {
    return { token: this.apiKey };
  }
}
