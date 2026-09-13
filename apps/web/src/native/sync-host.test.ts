import { describe, expect, it } from "vitest";
import { httpSyncOrigin, parseSyncHostname, syncSocketUrls } from "./sync-host";

describe("parseSyncHostname", () => {
  it("accepts the master address as shown on LAN", () => {
    expect(parseSyncHostname("192.168.1.184:8787")).toBe("192.168.1.184");
    expect(parseSyncHostname("192.168.1.184")).toBe("192.168.1.184");
  });

  it("accepts the client page URL", () => {
    expect(parseSyncHostname("http://192.168.1.184:8788/client")).toBe("192.168.1.184");
  });
});

describe("syncSocketUrls", () => {
  it("tries the client HTTP port before the show clock port", () => {
    expect(syncSocketUrls("192.168.1.184:8787")).toEqual([
      "ws://192.168.1.184:8788/sync",
      "ws://192.168.1.184:8787/sync"
    ]);
  });

  it("uses the client HTTP port for same-page sync", () => {
    expect(httpSyncOrigin("192.168.1.184:8787")).toBe("http://192.168.1.184:8788");
  });
});
