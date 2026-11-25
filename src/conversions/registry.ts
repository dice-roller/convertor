import { ConversionPathError, UnsupportedVersionError } from "../errors.js";
import type {
  ConversionStep,
  DataVersion,
  SupportedDataVersion,
  TargetVersion,
} from "../types.js";

/** A directed edge in the schema migration graph. */
interface ConversionRoute<Version extends DataVersion> {
  readonly from: Version;
  readonly to: Version;
}

/** Internal registry; the public API remains functional. */
export class ConversionRegistry<
  Version extends DataVersion,
  Step extends ConversionRoute<Version>,
> {
  private readonly versions: readonly Version[];
  private readonly steps: readonly Step[];

  constructor(versions: readonly Version[], steps: readonly Step[]) {
    this.versions = [...versions];
    this.steps = [...steps];

    for (const version of this.versions) {
      if (
        typeof version === "number" &&
        (!Number.isSafeInteger(version) || version < 1)
      ) {
        throw new TypeError(`Invalid registered version: ${String(version)}`);
      }
    }

    if (new Set(this.versions).size !== this.versions.length) {
      throw new TypeError("Duplicate registered schema versions");
    }

    const routes = new Map<Version, Set<Version>>();

    for (const step of this.steps) {
      if (
        step.from === step.to ||
        !this.versions.includes(step.from) ||
        !this.versions.includes(step.to)
      ) {
        throw new TypeError("Invalid registered conversion route");
      }

      const destinations = routes.get(step.from) ?? new Set<Version>();

      if (destinations.has(step.to)) {
        throw new TypeError("Duplicate registered conversion route");
      }

      destinations.add(step.to);
      routes.set(step.from, destinations);
    }
  }

  private requireVersion(
    version: DataVersion,
    role: "source" | "target",
  ): Version {
    const supported = this.versions.find((entry) => entry === version);

    if (supported === undefined) {
      throw new UnsupportedVersionError(
        `Unsupported ${role} data version: ${String(version)}`,
      );
    }

    return supported;
  }

  /** Resolve latest to the highest registered numeric schema, not the library version. */
  resolveTarget(target: TargetVersion): Version {
    if (target !== "latest") {
      return this.requireVersion(target, "target");
    }

    let latest: Version | undefined;

    for (const version of this.versions) {
      if (
        typeof version === "number" &&
        (typeof latest !== "number" || version > latest)
      ) {
        latest = version;
      }
    }

    if (latest === undefined) {
      throw new UnsupportedVersionError("No numeric data versions registered");
    }

    return latest;
  }

  /**
   * Find the shortest directed migration path using breadth-first search.
   * Equal-length paths are resolved in registration order.
   * The steps are returned, not executed. An empty path means no migration is needed.
   */
  resolvePath(from: DataVersion, to: TargetVersion): readonly Step[] {
    const source = this.requireVersion(from, "source");
    const target = this.resolveTarget(to);

    const visited = new Set<Version>([source]);
    const queue: { version: Version; path: readonly Step[] }[] = [
      { version: source, path: [] },
    ];

    for (const { version, path } of queue) {
      if (version === target) {
        return path;
      }

      for (const step of this.steps) {
        if (step.from !== version || visited.has(step.to)) {
          continue;
        }

        visited.add(step.to);
        queue.push({ version: step.to, path: [...path, step] });
      }
    }

    throw new ConversionPathError(
      `No conversion path from ${String(source)} to ${String(target)}`,
    );
  }
}

/** A union of concrete step contracts, preserving each source/target pairing. */
type RegisteredStep = {
  [From in SupportedDataVersion]: {
    [To in Exclude<SupportedDataVersion, From>]: ConversionStep<From, To>;
  }[Exclude<SupportedDataVersion, From>];
}[SupportedDataVersion];

const versions: readonly SupportedDataVersion[] = ["legacy", 1];

/** The built-in registry. Actual migrations will be registered as they are implemented. */
export const conversionRegistry = new ConversionRegistry<
  SupportedDataVersion,
  RegisteredStep
>(versions, []);
