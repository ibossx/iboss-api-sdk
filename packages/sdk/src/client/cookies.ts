/**
 * Per-host cookie jar.
 *
 * The iboss platform spans multiple hosts (cloud, gateway node, reporter node)
 * and native fetch does not persist cookies, so the client keeps its own jar.
 * Session state (JSESSIONID) and CSRF state (XSRF-TOKEN) are issued per host
 * via Set-Cookie and must be echoed back only to the host that set them.
 */

interface StoredCookie {
  name: string;
  value: string;
  /** Host that set the cookie, or the Domain attribute when present (leading dot stripped). */
  domain: string;
}

function hostOf(url: string): string {
  return new URL(url).hostname.toLowerCase();
}

export class CookieJar {
  private cookies = new Map<string, StoredCookie>();

  /** Store every Set-Cookie header from `response` against the request URL's host. */
  storeFromResponse(url: string, response: Response): void {
    const setCookies = response.headers.getSetCookie();
    if (setCookies.length === 0) return;
    const requestHost = hostOf(url);
    for (const raw of setCookies) {
      const parsed = parseSetCookie(raw, requestHost);
      if (!parsed) continue;
      this.cookies.set(`${parsed.domain}|${parsed.name}`, parsed);
    }
  }

  /** Build the Cookie header value for a request to `url` (empty string if none apply). */
  cookieHeaderFor(url: string): string {
    const host = hostOf(url);
    const parts: string[] = [];
    for (const cookie of this.cookies.values()) {
      if (this.matches(cookie, host)) parts.push(`${cookie.name}=${cookie.value}`);
    }
    return parts.join("; ");
  }

  /** Read one cookie value applicable to `url`, e.g. get("XSRF-TOKEN", gatewayUrl). */
  get(name: string, url: string): string | undefined {
    const host = hostOf(url);
    for (const cookie of this.cookies.values()) {
      if (cookie.name === name && this.matches(cookie, host)) return cookie.value;
    }
    return undefined;
  }

  clear(): void {
    this.cookies.clear();
  }

  private matches(cookie: StoredCookie, host: string): boolean {
    if (cookie.domain === host) return true;
    // Parent-domain match: a cookie set by (or scoped to) example.invalid also
    // applies to node.example.invalid. The platform's discovered node hosts
    // are subdomains of the cloud domain and expect the cloud session cookies.
    return host.endsWith(`.${cookie.domain}`);
  }
}

function parseSetCookie(raw: string, requestHost: string): StoredCookie | null {
  const segments = raw.split(";");
  const first = segments[0];
  if (!first) return null;
  const eq = first.indexOf("=");
  if (eq <= 0) return null;
  const name = first.slice(0, eq).trim();
  const value = first.slice(eq + 1).trim();
  if (!name) return null;

  let domain = requestHost;
  for (const segment of segments.slice(1)) {
    const [attrName, ...rest] = segment.split("=");
    if (attrName && attrName.trim().toLowerCase() === "domain") {
      const attrValue = rest.join("=").trim().toLowerCase().replace(/^\./, "");
      if (attrValue) domain = attrValue;
    }
  }
  return { name, value, domain };
}
