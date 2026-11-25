import {
  ConversionError,
  detectVersion,
  InvalidInputError,
  VersionDetectionError,
} from "../src/index.js";

describe("detectVersion", () => {
  it.each([
    { type: "dice-roll", notation: "d6", rolls: [] },
    { type: "dice-roller", log: [] },
  ])("detects legacy exports: %p", (data) => {
    expect(detectVersion(data)).toBe("legacy");
    expect(detectVersion(JSON.stringify(data))).toBe("legacy");
    expect(detectVersion(btoa(JSON.stringify(data)))).toBe("legacy");
  });

  it.each(["roll", "history"])("detects versioned %s exports", (type) => {
    const data = { type, version: 1 };
    expect(detectVersion(data)).toBe(1);
    expect(detectVersion(JSON.stringify(data))).toBe(1);
    expect(detectVersion(btoa(JSON.stringify(data)))).toBe(1);
  });

  it("detects future schema versions independently of conversion support", () => {
    expect(detectVersion({ type: "roll", version: 42 })).toBe(42);
  });

  it.each([
    { notation: "2d6", rolls: [[2, 3]] },
    { notation: "2+3", rolls: [] },
    { notation: "d6", rolls: [[{ value: 2 }]], groups: {} },
  ])("detects unversioned concise data as version 1: %p", (data) => {
    expect(detectVersion(data)).toBe(1);
    expect(detectVersion(JSON.stringify(data))).toBe(1);
    expect(detectVersion(btoa(JSON.stringify(data)))).toBe(1);
  });

  it.each([
    undefined,
    null,
    "1",
    "latest",
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid data version %p", (version) => {
    expect(() => detectVersion({ type: "roll", version })).toThrow(
      VersionDetectionError,
    );
  });

  it.each([
    {},
    { version: 1 },
    { type: "other", version: 1 },
    { type: "dice-roll", version: 1 },
    { notation: "d6", rolls: [3] },
    { notation: "d6", rolls: [[3]], version: 1 },
    { notation: "d6", rolls: [[3]], type: undefined },
    { notation: "d6", rolls: [[3]], result: {} },
    { notation: "d6", rolls: [[3]], rawRolls: [3] },
    { rawRolls: [3], notation: "d6" },
  ])("rejects unrecognised or conflicting envelopes: %p", (data) => {
    expect(() => detectVersion(data)).toThrow(VersionDetectionError);
  });

  it("does not accept inherited discriminators", () => {
    const data = {};
    Object.setPrototypeOf(data, { type: "roll", version: 1 });
    expect(() => detectVersion(data)).toThrow(VersionDetectionError);
  });

  it("exposes distinct conversion errors", () => {
    expect(() => detectVersion("")).toThrow(InvalidInputError);
    expect(() => detectVersion({})).toThrow(ConversionError);
  });
});
