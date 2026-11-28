import { Roll, Roller } from "@dice-roller/rpg-dice-roller";
import type {
  ConciseRollData,
  EncodedExportData,
  EncodedNumber,
  EncodedRollData,
  RollInputData,
} from "@dice-roller/rpg-dice-roller";
import type { InputData } from "../encoding.js";
import { InvalidInputError } from "../errors.js";
import type { DataFormatMap, SupportedDataVersion } from "../types.js";
import { validateLegacy } from "./validateLegacy.js";

export type FullData = DataFormatMap[SupportedDataVersion]["full"];

interface PreparedSource {
  readonly full: FullData;
  readonly concise?: ConciseRollData;
}

function encodeTotal(value: EncodedNumber): EncodedNumber {
  if (typeof value !== "number" || Number.isFinite(value)) {
    return value;
  }

  return {
    $number: Number.isNaN(value) ? "NaN" : value > 0 ? "Infinity" : "-Infinity",
  };
}

/** Validate and normalise inputs using the appropriate schema's import rules. */
export function prepareSource(
  data: InputData,
  version: SupportedDataVersion,
  variables?: RollInputData,
): PreparedSource {
  try {
    const copy = structuredClone(data);

    if (version === "legacy") {
      return { full: validateLegacy(copy) };
    }

    if (copy.type === "history") {
      const history = copy as unknown as EncodedExportData;
      const roller = new Roller();
      const rolls = roller.import(history);

      // Import validates the stored history total but Roller.export recomputes it.
      // Keep the original snapshot total instead of changing it during encoding.
      if (history.type !== "history") {
        throw new InvalidInputError("Expected a history");
      }

      return {
        full: {
          type: "history",
          version: 1,
          rolls: rolls.map((roll) => roll.export()),
          total: encodeTotal(history.total),
        },
      };
    }

    if (!Object.hasOwn(copy, "type")) {
      const concise = copy as unknown as ConciseRollData;
      return {
        full: Roll.import(concise, { data: variables }).export(),
        concise,
      };
    }

    return { full: Roll.import(copy as unknown as EncodedRollData).export() };
  } catch (cause) {
    if (cause instanceof InvalidInputError) {
      throw cause;
    }

    throw new InvalidInputError("Invalid source export data", { cause });
  }
}
