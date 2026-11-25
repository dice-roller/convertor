import { conversionRegistry } from "./conversions/registry.js";
import type {
  ConversionRegistry,
  RegisteredStep,
} from "./conversions/registry.js";
import { detectDataVersion } from "./detectVersion.js";
import { decodeInput, encodeOutput } from "./encoding.js";
import {
  ConversionError,
  UnsupportedFormatError,
  VersionDetectionError,
} from "./errors.js";
import { toConcise } from "./formats/concise.js";
import { prepareSource } from "./formats/normalise.js";
import type { FullData } from "./formats/normalise.js";
import type {
  ConversionContext,
  ConversionInput,
  ConversionStep,
  ConvertFunction,
  ConvertOptions,
  SupportedDataVersion,
  TargetVersion,
} from "./types.js";

type Registry = ConversionRegistry<SupportedDataVersion, RegisteredStep>;

/** Internal engine, with a registry parameter so migrations can be tested independently. */
export function convertWithRegistry(
  input: ConversionInput,
  to: TargetVersion,
  options: ConvertOptions = {},
  registry: Registry = conversionRegistry,
): object | string {
  const data = decodeInput(input);
  const detected = detectDataVersion(data);
  const from = options.from ?? detected;

  if (from !== detected) {
    throw new VersionDetectionError(
      `Expected source version ${String(from)}, detected ${String(detected)}`,
    );
  }

  const target = registry.resolveTarget(to);
  const path = registry.resolvePath(from, target);
  const source = path[0]?.from ?? target;
  const format = options.format ?? "full";

  if (format !== "full" && (format !== "concise" || target === "legacy")) {
    throw new UnsupportedFormatError(
      `Unsupported output format ${String(format)} for version ${String(target)}`,
    );
  }

  const context: ConversionContext = {
    strict: options.strict ?? true,
    warn(warning) {
      if (context.strict) {
        throw new ConversionError(`${warning.path}: ${warning.message}`);
      }

      options.onWarning?.(warning);
    },
  };

  const prepared = prepareSource(data, source);
  let full: FullData = prepared.full;

  for (const step of path) {
    // The registry resolves a contiguous path, so the input's validated schema
    // matches this step's source. Erase the pairing only at the execution boundary.
    const migration: ConversionStep<
      SupportedDataVersion,
      SupportedDataVersion
    > = step;
    full = migration.convert(full, context);
  }

  if (format === "concise") {
    if (path.length === 0 && prepared.concise !== undefined) {
      return encodeOutput(
        prepared.concise,
        target,
        options.encoding ?? "object",
      );
    }

    if (full.type !== "roll") {
      throw new UnsupportedFormatError(
        "Concise output requires an individual v1 roll",
      );
    }

    return encodeOutput(toConcise(full), target, options.encoding ?? "object");
  }

  return encodeOutput(full, target, options.encoding ?? "object");
}

/** Convert an export to an explicitly selected schema and representation. */
export const convert = ((
  data: ConversionInput,
  to: TargetVersion,
  options?: ConvertOptions,
) => convertWithRegistry(data, to, options)) as ConvertFunction;
