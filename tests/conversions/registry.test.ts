import {
  ConversionRegistry,
  conversionRegistry,
} from "../../src/conversions/registry.js";
import {
  ConversionPathError,
  UnsupportedVersionError,
} from "../../src/index.js";
import type { DataVersion } from "../../src/index.js";

interface TestStep {
  readonly from: DataVersion;
  readonly to: DataVersion;
  readonly name: string;
}

function step(from: DataVersion, to: DataVersion): TestStep {
  return { from, to, name: `${String(from)}-to-${String(to)}` };
}

describe("ConversionRegistry", () => {
  const first = step("legacy", 1);
  const second = step(1, 2);
  const third = step(2, 3);
  const versions: readonly DataVersion[] = ["legacy", 1, 2, 3];

  it("returns the registered migration steps in order", () => {
    const registry = new ConversionRegistry(versions, [third, first, second]);

    const path = registry.resolvePath("legacy", 3);
    expect(path).toEqual([first, second, third]);
    expect(path[0]).toBe(first);
  });

  it("resolves latest to the greatest numeric version regardless of order", () => {
    const unordered: readonly DataVersion[] = [3, "legacy", 2, 1];
    const registry = new ConversionRegistry(unordered, [first, second, third]);

    expect(registry.resolveTarget("latest")).toBe(3);
    expect(registry.resolvePath("legacy", "latest")).toEqual([
      first,
      second,
      third,
    ]);
  });

  it("does not fall back to an earlier reachable version for latest", () => {
    const registry = new ConversionRegistry(versions, [first]);

    expect(registry.resolveTarget("latest")).toBe(3);
    expect(() => registry.resolvePath("legacy", "latest")).toThrow(
      ConversionPathError,
    );
  });

  it("prefers a direct migration over a longer path", () => {
    const direct = step("legacy", 3);
    const registry = new ConversionRegistry(versions, [
      first,
      second,
      third,
      direct,
    ]);

    expect(registry.resolvePath("legacy", 3)).toEqual([direct]);
  });

  it("uses registration order to break ties between equal-length paths", () => {
    const alternativeFirst = step("legacy", 2);
    const alternativeLast = step(1, 3);
    const registry = new ConversionRegistry(versions, [
      alternativeFirst,
      first,
      alternativeLast,
      third,
    ]);

    expect(registry.resolvePath("legacy", 3)).toEqual([
      alternativeFirst,
      third,
    ]);
  });

  it("returns an empty path when no schema migration is needed", () => {
    const registry = new ConversionRegistry(versions, []);

    expect(registry.resolvePath("legacy", "legacy")).toEqual([]);
    expect(registry.resolvePath(1, 1)).toEqual([]);
    expect(registry.resolvePath(3, "latest")).toEqual([]);
  });

  it("does not invent reverse migrations", () => {
    const registry = new ConversionRegistry(versions, [first, second]);

    expect(() => registry.resolvePath(2, "legacy")).toThrow(
      ConversionPathError,
    );
  });

  it("supports explicitly registered reverse migrations and handles cycles", () => {
    const reverse = step(1, "legacy");
    const registry = new ConversionRegistry(versions, [first, reverse, second]);

    expect(registry.resolvePath(1, "legacy")).toEqual([reverse]);
    expect(registry.resolvePath("legacy", 2)).toEqual([first, second]);
    expect(() => registry.resolvePath("legacy", 3)).toThrow(
      ConversionPathError,
    );
  });

  it("rejects unsupported versions even for an identity conversion", () => {
    const registry = new ConversionRegistry(versions, [first]);

    expect(() => registry.resolvePath(42, 42)).toThrow(UnsupportedVersionError);
    expect(() => registry.resolvePath(1, 42)).toThrow(UnsupportedVersionError);
    expect(() => registry.resolveTarget(0)).toThrow(UnsupportedVersionError);
  });

  it("requires a numeric schema when resolving latest", () => {
    const registry = new ConversionRegistry(["legacy"], []);

    expect(() => registry.resolveTarget("latest")).toThrow(
      UnsupportedVersionError,
    );
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid registered version %p",
    (version) => {
      expect(() => new ConversionRegistry([version], [])).toThrow(TypeError);
    },
  );

  it("rejects duplicate schema versions", () => {
    expect(() => new ConversionRegistry([1, 1], [])).toThrow(TypeError);
  });

  it("rejects invalid or duplicate routes", () => {
    expect(() => new ConversionRegistry(versions, [step(1, 1)])).toThrow(
      TypeError,
    );
    expect(() => new ConversionRegistry(versions, [step(42, 1)])).toThrow(
      TypeError,
    );
    expect(() => new ConversionRegistry(versions, [step(1, 42)])).toThrow(
      TypeError,
    );
    expect(() => new ConversionRegistry(versions, [first, first])).toThrow(
      TypeError,
    );
  });

  it("does not retain mutable registration arrays", () => {
    const mutableVersions: DataVersion[] = ["legacy", 1];
    const mutableSteps = [first];
    const registry = new ConversionRegistry(mutableVersions, mutableSteps);

    mutableVersions.push(2);
    mutableSteps.length = 0;

    expect(registry.resolveTarget("latest")).toBe(1);
    expect(registry.resolvePath("legacy", 1)).toEqual([first]);
  });
});

describe("built-in conversion registry", () => {
  it("registers the forward legacy migration but not a reverse migration", () => {
    expect(conversionRegistry.resolveTarget("latest")).toBe(1);
    expect(conversionRegistry.resolveTarget("legacy")).toBe("legacy");
    expect(conversionRegistry.resolvePath(1, 1)).toEqual([]);
    expect(conversionRegistry.resolvePath("legacy", 1)).toHaveLength(1);
    expect(() => conversionRegistry.resolvePath(1, "legacy")).toThrow(
      ConversionPathError,
    );
  });
});
