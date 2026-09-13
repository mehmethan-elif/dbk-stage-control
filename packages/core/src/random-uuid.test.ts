import { afterEach, describe, expect, it } from "vitest";
import { createId, randomUuid } from "./models.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const original = globalThis.crypto;

afterEach(() => {
  Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
});

/** The band opens the master page over plain http, where `randomUUID` is missing. */
function withoutRandomUUID(): void {
  Object.defineProperty(globalThis, "crypto", {
    value: { getRandomValues: original.getRandomValues.bind(original) },
    configurable: true
  });
}

describe("randomUuid", () => {
  it("builds a v4 uuid when randomUUID exists", () => {
    expect(randomUuid()).toMatch(UUID);
  });

  it("still builds a v4 uuid outside a secure context", () => {
    withoutRandomUUID();
    expect(randomUuid()).toMatch(UUID);
  });

  it("keeps createId working outside a secure context", () => {
    withoutRandomUUID();
    expect(createId("client")).toMatch(/^client_/);
  });

  it("does not repeat ids", () => {
    withoutRandomUUID();
    const ids = new Set(Array.from({ length: 500 }, () => randomUuid()));
    expect(ids.size).toBe(500);
  });
});
