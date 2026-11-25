/** Base error for conversion failures. */
export class ConversionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** The input is not an exported object, JSON or Base64-encoded JSON. */
export class InvalidInputError extends ConversionError {}

/** The source schema cannot be identified from the input. */
export class VersionDetectionError extends ConversionError {}

/** The requested source or target schema is not supported by this release. */
export class UnsupportedVersionError extends ConversionError {}

/** No registered migration path connects the requested schemas. */
export class ConversionPathError extends ConversionError {}
