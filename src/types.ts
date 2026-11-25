import type {
  ConciseRollData,
  EncodedExportData,
  ExportFormat,
} from "@dice-roller/rpg-dice-roller";
import type { LegacyExportData } from "./formats/legacy.js";

/** The unversioned legacy schema, or a positive integer export schema version. */
export type DataVersion = "legacy" | number;

/** An explicit target schema, or the latest numeric schema supported by the convertor. */
export type TargetVersion = DataVersion | "latest";

/** The structure of the converted results, independent of their encoding. */
export type ResultFormat = "full" | "concise";

/** The representation of the converted data, matching the dice roller's export encodings. */
export type DataEncoding = ExportFormat;

/** An exported object or a JSON / Base64 string. Input is validated during conversion. */
export type ConversionInput = object | string;

/** A recoverable conversion issue. Paths identify the affected part of the source data. */
export interface ConversionWarning {
  readonly code: string;
  readonly message: string;
  readonly path: string;
}

/** Configuration shared by generic conversion and source-specific helpers. */
export interface ConversionOptions<
  Format extends ResultFormat = ResultFormat,
  Encoding extends DataEncoding = DataEncoding,
> {
  /** The output result structure. Defaults to full. */
  readonly format?: Format;
  /** The output representation. Defaults to object. */
  readonly encoding?: Encoding;
  /** Reject ambiguous or lossy conversions. Defaults to true. */
  readonly strict?: boolean;
  /** Receives recoverable issues when best-effort conversion is enabled. */
  readonly onWarning?: (warning: ConversionWarning) => void;
}

/** Options for generic conversion, with automatic source detection by default. */
export interface ConvertOptions<
  Format extends ResultFormat = ResultFormat,
  Encoding extends DataEncoding = DataEncoding,
> extends ConversionOptions<Format, Encoding> {
  readonly from?: DataVersion;
}

/** Source-specific helpers cannot override their source schema. */
export interface FromOptions<
  Format extends ResultFormat = ResultFormat,
  Encoding extends DataEncoding = DataEncoding,
> extends ConversionOptions<Format, Encoding> {
  readonly from?: never;
}

/**
 * Supported schema types. Add an entry when a new schema is introduced.
 * Concise data currently represents an individual roll, not an entire history.
 * An absent format is unsupported for that schema.
 */
export interface DataFormatMap {
  legacy: { full: LegacyExportData };
  1: { full: EncodedExportData; concise: ConciseRollData };
}

/** The schema identifiers understood by this release. */
export type SupportedDataVersion = keyof DataFormatMap;

/** The current latest supported numeric schema (keep in sync with the registry). */
export type LatestDataVersion = 1;

type ResolvedTarget<Version extends TargetVersion> = Version extends "latest"
  ? LatestDataVersion
  : number extends Version
    ? Extract<SupportedDataVersion, number> | Extract<Version, "legacy">
    : Version;

/** A decoded result structure for a supported target and output format. */
export type ObjectOutput<
  Version extends TargetVersion,
  Format extends ResultFormat,
> = Version extends TargetVersion
  ? ResolvedTarget<Version> extends infer Resolved
    ? Resolved extends SupportedDataVersion
      ? Format extends keyof DataFormatMap[Resolved]
        ? DataFormatMap[Resolved][Format]
        : never
      : never
    : never
  : never;

/** The result type depends on the target schema, result structure and encoding. */
export type ConversionOutput<
  Version extends TargetVersion = TargetVersion,
  Format extends ResultFormat = "full",
  Encoding extends DataEncoding = "object",
> = Encoding extends "object"
  ? ObjectOutput<Version, Format>
  : ObjectOutput<Version, Format> extends never
    ? never
    : string;

/** Public contract for convert(data, to, options?). */
export interface ConvertFunction {
  <
    Version extends TargetVersion,
    Format extends ResultFormat = "full",
    Encoding extends DataEncoding = "object",
  >(
    data: ConversionInput,
    to: Version,
    options?: ConvertOptions<Format, Encoding>,
  ): ConversionOutput<Version, Format, Encoding>;
}

/** Public contract shared by fromLegacy and future source-specific helpers. */
export interface FromFunction {
  <
    Version extends TargetVersion,
    Format extends ResultFormat = "full",
    Encoding extends DataEncoding = "object",
  >(
    data: ConversionInput,
    to: Version,
    options?: FromOptions<Format, Encoding>,
  ): ConversionOutput<Version, Format, Encoding>;
}

/** Public contract for detecting a source schema without converting it. */
export type DetectVersionFunction = (data: ConversionInput) => DataVersion;

/** Shared, resolved configuration passed to each step of a conversion path. */
export interface ConversionContext {
  readonly strict: boolean;
  /** Reports an issue; the conversion engine controls how warnings are delivered. */
  readonly warn: (warning: ConversionWarning) => void;
}

/**
 * One directed schema migration. Steps consume and produce full, decoded data;
 * the conversion engine handles detection, path resolution and final encoding.
 */
export interface ConversionStep<
  From extends SupportedDataVersion,
  To extends SupportedDataVersion,
> {
  readonly from: From;
  readonly to: To;
  convert(
    data: DataFormatMap[From]["full"],
    context: ConversionContext,
  ): DataFormatMap[To]["full"];
}
