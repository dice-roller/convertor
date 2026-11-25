import { convert } from "./convert.js";
import type { FromFunction } from "./types.js";

/** Convert a legacy export to an explicitly selected destination schema. */
export const fromLegacy: FromFunction = (data, to, options) =>
  convert(data, to, { ...options, from: "legacy" });
