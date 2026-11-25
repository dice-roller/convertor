import { conversionRegistry } from "./conversions/registry.js";
import { ConversionPathError } from "./errors.js";
import type {
  DataEncoding,
  DataVersion,
  ResultFormat,
  SupportedDataVersion,
  TargetVersion,
} from "./types.js";

const formats: Record<SupportedDataVersion, readonly ResultFormat[]> = {
  legacy: ["full"],
  1: ["full", "concise"],
};

/** Encodings accepted by the conversion API. */
export const supportedEncodings = Object.freeze([
  "object",
  "json",
  "base64",
] as const satisfies readonly DataEncoding[]);

/** All data schemas registered by this release. */
export function getSupportedVersions(): readonly SupportedDataVersion[] {
  return conversionRegistry.getVersions();
}

/**
 * Schemas reachable from the source, including same-schema re-encoding.
 * With no source, return all registered schemas.
 */
export function getSupportedTargetVersions(
  from?: DataVersion,
): readonly SupportedDataVersion[] {
  const versions = getSupportedVersions();

  if (from === undefined) {
    return versions;
  }

  return versions.filter((target) => {
    try {
      conversionRegistry.resolvePath(from, target);
      return true;
    } catch (error) {
      if (error instanceof ConversionPathError) {
        return false;
      }
      throw error;
    }
  });
}

/** Result formats supported by the resolved destination schema. */
export function getSupportedFormats(
  target: TargetVersion,
): readonly ResultFormat[] {
  return [...formats[conversionRegistry.resolveTarget(target)]];
}
