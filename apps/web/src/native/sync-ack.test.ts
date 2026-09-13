import { describe, expect, it } from "vitest";
import { helloAcknowledged } from "./sync";

describe("helloAcknowledged", () => {
  it("requires Serkan in the master's peer list", () => {
    expect(
      helloAcknowledged({ type: "Peers", peers: [] }, "Serkan")
    ).toBe(false);
    expect(
      helloAcknowledged(
        { type: "Peers", peers: [{ deviceId: "x", deviceKind: "client", deviceName: "Elif" }] },
        "Serkan"
      )
    ).toBe(false);
    expect(
      helloAcknowledged(
        { type: "Peers", peers: [{ deviceId: "x", deviceKind: "client", deviceName: "Serkan" }] },
        "Serkan"
      )
    ).toBe(true);
  });
});
