import { describe, expect, it } from "vitest";
import { CookieJar } from "../../src/client/cookies.js";

function responseWithCookies(cookies: string[]): Response {
  const headers = new Headers();
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response("", { headers });
}

describe("CookieJar", () => {
  it("scopes cookies to the host that set them", () => {
    const jar = new CookieJar();
    jar.storeFromResponse("https://a.example.invalid/x", responseWithCookies(["XSRF-TOKEN=aaa; Path=/"]));
    jar.storeFromResponse("https://b.example.invalid/y", responseWithCookies(["XSRF-TOKEN=bbb; Path=/"]));

    expect(jar.cookieHeaderFor("https://a.example.invalid/z")).toBe("XSRF-TOKEN=aaa");
    expect(jar.cookieHeaderFor("https://b.example.invalid/z")).toBe("XSRF-TOKEN=bbb");
    expect(jar.get("XSRF-TOKEN", "https://a.example.invalid/")).toBe("aaa");
    expect(jar.get("XSRF-TOKEN", "https://b.example.invalid/")).toBe("bbb");
  });

  it("does not leak cookies to unrelated hosts", () => {
    const jar = new CookieJar();
    jar.storeFromResponse("https://a.example.invalid/", responseWithCookies(["JSESSIONID=s1"]));
    expect(jar.cookieHeaderFor("https://other.invalid/")).toBe("");
    expect(jar.get("JSESSIONID", "https://other.invalid/")).toBeUndefined();
  });

  it("flows cloud-host cookies to node subdomains (parent-domain match)", () => {
    // The platform's gateway/reporter nodes are subdomains of the cloud
    // domain and expect the cloud session cookies — this mirrors verified
    // platform behavior, so gateway GETs don't 403.
    const jar = new CookieJar();
    jar.storeFromResponse("https://example.invalid/", responseWithCookies(["XSRF-TOKEN=cloud1"]));
    expect(jar.cookieHeaderFor("https://node.example.invalid/")).toBe("XSRF-TOKEN=cloud1");
    expect(jar.get("XSRF-TOKEN", "https://deep.node.example.invalid/")).toBe("cloud1");
    // …but never to sibling/unrelated hosts
    expect(jar.cookieHeaderFor("https://exampleXinvalid.other/")).toBe("");
  });

  it("honors Domain attribute for subdomain matching", () => {
    const jar = new CookieJar();
    jar.storeFromResponse(
      "https://api.example.invalid/",
      responseWithCookies(["shared=yes; Domain=.example.invalid; Path=/"]),
    );
    expect(jar.cookieHeaderFor("https://node.example.invalid/")).toBe("shared=yes");
    expect(jar.cookieHeaderFor("https://example.invalid/")).toBe("shared=yes");
    expect(jar.cookieHeaderFor("https://evil.invalid/")).toBe("");
  });

  it("updates existing cookies instead of duplicating them", () => {
    const jar = new CookieJar();
    jar.storeFromResponse("https://a.example.invalid/", responseWithCookies(["XSRF-TOKEN=v1"]));
    jar.storeFromResponse("https://a.example.invalid/", responseWithCookies(["XSRF-TOKEN=v2"]));
    expect(jar.cookieHeaderFor("https://a.example.invalid/")).toBe("XSRF-TOKEN=v2");
  });

  it("joins multiple cookies for one host", () => {
    const jar = new CookieJar();
    jar.storeFromResponse(
      "https://a.example.invalid/",
      responseWithCookies(["XSRF-TOKEN=t; Path=/", "JSESSIONID=s; HttpOnly"]),
    );
    const header = jar.cookieHeaderFor("https://a.example.invalid/");
    expect(header).toContain("XSRF-TOKEN=t");
    expect(header).toContain("JSESSIONID=s");
  });

  it("clear() empties the jar", () => {
    const jar = new CookieJar();
    jar.storeFromResponse("https://a.example.invalid/", responseWithCookies(["k=v"]));
    jar.clear();
    expect(jar.cookieHeaderFor("https://a.example.invalid/")).toBe("");
  });
});
