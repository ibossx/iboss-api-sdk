import { IbossAuthError } from "../errors.js";
import { accountsHostFor } from "../hosts.js";
import type { Credential, CredentialContext, CredentialProvider } from "./CredentialProvider.js";

export interface UserPasswordCredentials {
  username: string;
  password: string;
  /** Static TOTP code (single use) — prefer totpProvider for long-running processes. */
  totpCode?: string;
  /** Called whenever a fresh MFA code is needed. */
  totpProvider?: () => Promise<string> | string;
}

/** Session tokens issued by the login endpoint last 4 hours. */
const TOKEN_LIFETIME_MS = 4 * 60 * 60 * 1000;
/** Refresh slightly early to avoid using a token at the edge of expiry. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

/**
 * Alternative flow: exchange username/password (+ optional MFA) for a session
 * token via `GET https://accounts.<domain>/ibossauth/web/tokens` with HTTP
 * Basic auth. The returned token is then used exactly like an API key. Tokens
 * expire after ~4h; refresh() re-authenticates automatically.
 */
export class UserPasswordCredentialProvider implements CredentialProvider {
  private readonly creds: UserPasswordCredentials;
  private cached?: Credential;

  constructor(creds: UserPasswordCredentials) {
    if (!creds.username || !creds.password) {
      throw new Error("UserPasswordCredentialProvider requires username and password");
    }
    this.creds = creds;
  }

  async getCredential(ctx: CredentialContext): Promise<Credential> {
    if (this.cached && this.cached.expiresAt && this.cached.expiresAt.getTime() - Date.now() > EXPIRY_MARGIN_MS) {
      return this.cached;
    }
    return this.login(ctx);
  }

  async refresh(ctx: CredentialContext): Promise<Credential> {
    this.cached = undefined;
    return this.login(ctx);
  }

  private async login(ctx: CredentialContext): Promise<Credential> {
    const host = accountsHostFor(ctx.domain);
    const url = new URL(`https://${host}/ibossauth/web/tokens`);
    url.searchParams.set("ignoreAuthModule", "true");

    const totp = this.creds.totpProvider ? await this.creds.totpProvider() : this.creds.totpCode;
    if (totp) url.searchParams.set("totpCode", totp);

    const basic = Buffer.from(`${this.creds.username}:${this.creds.password}`).toString("base64");
    ctx.logger.debug("Logging in via accounts host", { host });

    const response = await ctx.fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Basic ${basic}`,
        Accept: "application/json",
        "User-Agent": "ibossAPI",
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new IbossAuthError(
        `Login failed (${response.status}). Check username/password${totp ? "/MFA code" : ""}.`,
        { method: "GET", url: url.toString(), status: response.status, body: body.slice(0, 500) },
      );
    }

    const data = (await response.json()) as { token?: string };
    if (!data.token) {
      throw new IbossAuthError("Login response did not include a token.", {
        method: "GET",
        url: url.toString(),
        status: response.status,
      });
    }

    this.cached = {
      token: data.token,
      expiresAt: new Date(Date.now() + TOKEN_LIFETIME_MS),
    };
    return this.cached;
  }
}
