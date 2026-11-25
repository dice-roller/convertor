import {
  getSupportedFormats,
  getSupportedTargetVersions,
  getSupportedVersions,
  supportedEncodings,
  UnsupportedVersionError,
} from "../src/index.js";

describe("conversion capabilities", () => {
  it("lists registered schemas", () => {
    expect(getSupportedVersions()).toEqual(["legacy", 1]);
    expect(getSupportedTargetVersions()).toEqual(["legacy", 1]);
  });

  it("includes reachable targets and same-schema re-encoding", () => {
    expect(getSupportedTargetVersions("legacy")).toEqual(["legacy", 1]);
    expect(getSupportedTargetVersions(1)).toEqual([1]);
  });

  it("lists supported formats for explicit and latest targets", () => {
    expect(getSupportedFormats("legacy")).toEqual(["full"]);
    expect(getSupportedFormats(1)).toEqual(["full", "concise"]);
    expect(getSupportedFormats("latest")).toEqual(["full", "concise"]);
  });

  it("rejects unsupported versions", () => {
    expect(() => getSupportedTargetVersions(42)).toThrow(
      UnsupportedVersionError,
    );
    expect(() => getSupportedFormats(42)).toThrow(UnsupportedVersionError);
  });

  it("lists the supported encodings", () => {
    expect(supportedEncodings).toEqual(["object", "json", "base64"]);
    expect(Object.isFrozen(supportedEncodings)).toBe(true);
  });
});
