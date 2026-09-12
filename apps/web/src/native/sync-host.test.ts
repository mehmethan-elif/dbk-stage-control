import { describe, expect, it } from "vitest";
import { parseSyncHostname, syncSocketUrl } from "./sync-host";

describe("parseSyncHostname", () => {
  it("accepts the master address as shown on LAN", () => {
    expect(parseSyncHostname("192.168.1.184:8787")).toBe("192.168.1.184");
    expect(parseSyncHostname("192.168.1.184")).toBe("192.168.1.184");
  });

  it("accepts the client page URL", () => {
    expect(parseSyncHostname("http://192.168.1.184:8788/client")).toBe("192.168.1.184");
  });
});

describe("syncSocketUrl", () => {
  it("always talks to the sync port", () => {
    expect(syncSocketUrl("192.168.1.184:8787")).toBe("ws://192.168.1.184:8787/sync");
    expect(syncSocketUrl("http://192.168.1.184:8788/client")).toBe("ws://192.168.1.184:8787/sync");
  });
});
