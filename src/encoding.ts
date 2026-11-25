import { InvalidInputError } from "./errors.js";

/** A decoded export envelope. Its contents have not yet been validated. */
export type InputData = Readonly<Record<string, unknown>>;

export function isRecord(value: unknown): value is InputData {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new InvalidInputError("The input is not valid JSON", { cause });
  }
}

function parseBase64(text: string): unknown {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) {
    throw new InvalidInputError("The input is not valid JSON or Base64");
  }

  let binary: string;
  try {
    binary = atob(text);
  } catch (cause) {
    throw new InvalidInputError("The input is not valid Base64", { cause });
  }

  if (btoa(binary) !== text) {
    throw new InvalidInputError("The input is not canonical Base64");
  }

  // V5 used btoa(JSON.stringify(data)), not UTF-8. Inspect the ASCII
  // discriminator before decoding any characters to avoid corrupting legacy
  // text that happens to contain a valid UTF-8 byte sequence.
  const data = parseJson(binary);
  if (
    isRecord(data) &&
    (data.type === "dice-roll" || data.type === "dice-roller")
  ) {
    return data;
  }

  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new InvalidInputError("The Base64 input is not valid UTF-8", {
      cause,
    });
  }

  return parseJson(decoded);
}

/**
 * Decode the transport representation without changing the schema or hydrating
 * tagged numbers. Version-specific validation happens after detection.
 * Object inputs are borrowed, not mutated.
 */
export function decodeInput(input: unknown): InputData {
  let data: unknown = input;

  if (typeof input === "string") {
    const text = input.trim();
    if (text === "") {
      throw new InvalidInputError("The input is empty");
    }

    data =
      text.startsWith("{") || text.startsWith("[")
        ? parseJson(text)
        : parseBase64(text);
  }

  if (!isRecord(data)) {
    throw new InvalidInputError("Expected an exported data object");
  }

  return data;
}
