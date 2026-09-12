import { describe, expect, it } from "vitest";
import { parseSyncHostname, syncSocketUrl, syncSocketUrls } from "./sync-host";

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
  it("tries the show clock and the client HTTP port", () => {
    expect(syncSocketUrls("192.168.1.184:8787")).toEqual([
      "ws://192.168.1.184:8787/sync",
      "ws://192.168.1.184:8788/sync",
      "ws://192.168.1.184:8787/"
    ]);
    expect(syncSocketUrl("http://192.168.1.184:8788/client")).toBe("ws://192.168.1.184:8787/sync");
  });
});
