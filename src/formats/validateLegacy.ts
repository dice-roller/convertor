import { isRecord } from "../encoding.js";
import type { InputData } from "../encoding.js";
import { InvalidInputError } from "../errors.js";
import type { LegacyExportData } from "./legacy.js";

function isNumber(value: unknown): boolean {
  return (
    value === null || (typeof value === "number" && Number.isFinite(value))
  );
}

function isList(value: unknown, check: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && Array.from(value).every(check);
}

function hasNumbers(data: InputData, keys: readonly string[]): boolean {
  return keys.every((key) => isNumber(data[key]));
}

function hasScore(data: InputData): boolean {
  return (
    hasNumbers(data, ["value", "calculationValue"]) &&
    typeof data.useInTotal === "boolean" &&
    typeof data.modifierFlags === "string" &&
    isList(data.modifiers, (modifier) => typeof modifier === "string")
  );
}

function isDie(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.type === "result" &&
    isNumber(value.initialValue) &&
    hasScore(value)
  );
}

function isExpression(value: unknown): boolean {
  if (isNumber(value) || typeof value === "string") {
    return true;
  }

  if (!isRecord(value)) {
    return false;
  }

  if (value.type === "roll-results") {
    return isNumber(value.value) && isList(value.rolls, isDie);
  }

  return (
    value.type === "result-group" &&
    typeof value.isRollGroup === "boolean" &&
    hasScore(value) &&
    isList(value.results, isExpression)
  );
}

function isRoll(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.type === "dice-roll" &&
    typeof value.notation === "string" &&
    typeof value.output === "string" &&
    hasNumbers(value, ["total", "minTotal", "maxTotal", "averageTotal"]) &&
    isList(value.rolls, isExpression)
  );
}

/** Validate the full legacy export shape without parsing notation or rolling. */
export function validateLegacy(data: InputData): LegacyExportData {
  const valid =
    isRoll(data) ||
    (data.type === "dice-roller" &&
      typeof data.output === "string" &&
      isNumber(data.total) &&
      isList(data.log, isRoll));

  if (!valid) {
    throw new InvalidInputError("Invalid legacy export data");
  }

  return data as unknown as LegacyExportData;
}
