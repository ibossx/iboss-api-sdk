import { describe, expect, it, vi } from "vitest";
import { ApiKeyCredentialProvider } from "../../src/client/credentials/apiKey.js";
import type { CredentialProvider } from "../../src/client/credentials/CredentialProvider.js";
import { UserPasswordCredentialProvider } from "../../src/client/credentials/passwordLogin.js";
import { IbossAuthError } from "../../src/client/errors.js";
import { noopLogger } from "../../src/client/logger.js";

const ctx = (fetchImpl: typeof globalThis.fetch) => ({
  domain: "api.example.invalid",
  fetch: fetchImpl,
  logger: noopLogger,
});

describe("ApiKeyCredentialProvider", () => {
  it("returns the key as the token", async () => {
    const provider = new ApiKeyCredentialProvider("  my-test-key  ");
    const cred = await provider.getCredential(ctx(globalThis.fetch));
    expect(cred.token).toBe("my-test-key");
  });

  it("rejects empty keys", () => {
    expect(() => new ApiKeyCredentialProvider("")).toThrow();
    expect(() => new ApiKeyCredentialProvider("   ")).toThrow();
  });

  it("has no refresh (static keys are terminal on 401)", () => {
    const provider: CredentialProvider = new ApiKeyCredentialProvider("k");
    expect(provider.refresh).toBeUndefined();
  });
});

describe("UserPasswordCredentialProvider", () => {
  it("logs in via the accounts host with Basic auth and caches the token", async () => {
    const fetchMock = vi.fn(async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.hostname).toBe("accounts.example.invalid");
      expect(url.searchParams.get("ignoreAuthModule")).toBe("true");
      const auth = (init?.headers as Record<string, string>).Authorization;
      expect(auth).toBe(`Basic ${Buffer.from("user@example.com:pw").toString("base64")}`);
      return new Response(JSON.stringify({ token: "session-token-1" }), {
        headers: { "content-type": "application/json" },
      });
    });

    const provider = new UserPasswordCredentialProvider({ username: "user@example.com", password: "pw" });
    const first = await provider.getCredential(ctx(fetchMock as unknown as typeof globalThis.fetch));
    const second = await provider.getCredential(ctx(fetchMock as unknown as typeof globalThis.fetch));
    expect(first.token).toBe("session-token-1");
    expect(second.token).toBe("session-token-1");
    expect(fetchMock).toHaveBeenCalledTimes(1); // cached
  });

  it("includes the TOTP code when provided", async () => {
    const fetchMock = vi.fn(async (input: Parameters<typeof globalThis.fetch>[0]) => {
      expect(new URL(String(input)).searchParams.get("totpCode")).toBe("123456");
      return new Response(JSON.stringify({ token: "t" }));
    });
    const provider = new UserPasswordCredentialProvider({
      username: "u",
      password: "p",
      totpProvider: () => "123456",
    });
    await provider.getCredential(ctx(fetchMock as unknown as typeof globalThis.fetch));
  });

  it("throws IbossAuthError on 401", async () => {
    const fetchMock = async () => new Response("bad credentials", { status: 401 });
    const provider = new UserPasswordCredentialProvider({ username: "u", password: "wrong" });
    await expect(provider.getCredential(ctx(fetchMock as typeof globalThis.fetch))).rejects.toBeInstanceOf(
      IbossAuthError,
    );
  });

  it("refresh() re-authenticates", async () => {
    let calls = 0;
    const fetchMock = async () => new Response(JSON.stringify({ token: `t${++calls}` }));
    const provider = new UserPasswordCredentialProvider({ username: "u", password: "p" });
    const c = ctx(fetchMock as typeof globalThis.fetch);
    expect((await provider.getCredential(c)).token).toBe("t1");
    expect((await provider.refresh(c)).token).toBe("t2");
  });
});
