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
