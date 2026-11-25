import { decodeInput } from "./encoding.js";
import type { InputData } from "./encoding.js";
import { VersionDetectionError } from "./errors.js";
import type { ConversionInput, DataVersion } from "./types.js";

/**
 * Identify the schema from its envelope, not from the dice notation.
 * Future positive integer versions are detectable even before conversions
 * for them are implemented.
 */
export function detectDataVersion(data: InputData): DataVersion {
  const hasType = Object.hasOwn(data, "type");
  const hasVersion = Object.hasOwn(data, "version");

  if (hasType && (data.type === "dice-roll" || data.type === "dice-roller")) {
    if (hasVersion) {
      throw new VersionDetectionError("Legacy exports cannot have a version");
    }

    return "legacy";
  }

  if (hasType && (data.type === "roll" || data.type === "history")) {
    const version = data.version;

    if (
      !hasVersion ||
      typeof version !== "number" ||
      !Number.isSafeInteger(version) ||
      version < 1
    ) {
      throw new VersionDetectionError(
        "Expected a positive integer data version",
      );
    }

    return version;
  }

  // The concise import contract has no discriminator or version. Only match
  // its envelope; the dice roller validates individual dice and group data.
  if (
    !hasType &&
    !hasVersion &&
    !Object.hasOwn(data, "result") &&
    !Object.hasOwn(data, "rawRolls") &&
    Object.hasOwn(data, "notation") &&
    typeof data.notation === "string" &&
    Object.hasOwn(data, "rolls") &&
    Array.isArray(data.rolls) &&
    data.rolls.every(Array.isArray)
  ) {
    return 1;
  }

  throw new VersionDetectionError("Unrecognised dice roller data format");
}

/** Detect the source data version in an object, JSON or Base64 export. */
export function detectVersion(data: ConversionInput): DataVersion {
  return detectDataVersion(decodeInput(data));
}
