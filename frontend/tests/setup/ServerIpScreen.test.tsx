import { describe, expect, it } from "vitest";
import { looksLikeHost, parseHostInput } from "@/pages/setup/screens/ServerIpScreen";

describe("parseHostInput", () => {
  it("returns just the host when no user prefix is given", () => {
    expect(parseHostInput("203.0.113.10")).toEqual({ host: "203.0.113.10" });
  });

  it("splits a user@host input", () => {
    expect(parseHostInput("ubuntu@203.0.113.10")).toEqual({ host: "203.0.113.10", user: "ubuntu" });
    expect(parseHostInput("root@my.server.example")).toEqual({ host: "my.server.example", user: "root" });
  });

  it("ignores an empty user prefix and trims whitespace", () => {
    expect(parseHostInput("@1.2.3.4")).toEqual({ host: "1.2.3.4" });
    expect(parseHostInput("  ubuntu@1.2.3.4  ")).toEqual({ host: "1.2.3.4", user: "ubuntu" });
  });
});

describe("looksLikeHost", () => {
  it("accepts IPs and hostnames with an optional user", () => {
    expect(looksLikeHost("203.0.113.10")).toBe(true);
    expect(looksLikeHost("ubuntu@203.0.113.10")).toBe(true);
    expect(looksLikeHost("my-server.example")).toBe(true);
  });

  it("rejects empty hosts and invalid users", () => {
    expect(looksLikeHost("")).toBe(false);
    expect(looksLikeHost("ubuntu@")).toBe(false);
    expect(looksLikeHost("bad user@1.2.3.4")).toBe(false);
    expect(looksLikeHost("-oProxyCommand=bad")).toBe(false);
  });
});
