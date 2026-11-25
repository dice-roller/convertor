import { Parser, Roll } from "@dice-roller/rpg-dice-roller";
import type {
  ConciseDieResult,
  EncodedRollData,
  results,
  ExpressionNode,
} from "@dice-roller/rpg-dice-roller";
import { ConversionError } from "../errors.js";
import type {
  LegacyDieResult,
  LegacyRollData,
  LegacyNumber,
} from "../formats/legacy.js";
import type { ConversionContext, ConversionStep } from "../types.js";

function fail(path: string, message: string): never {
  throw new ConversionError(`${path}: ${message}`);
}

function checkTotal(
  actual: LegacyNumber,
  expected: number,
  path: string,
  context: ConversionContext,
): void {
  if (actual !== expected) {
    context.warn({
      code: "total-mismatch",
      path,
      message: `Stored value ${String(actual)} differs from reconstructed value ${String(expected)}`,
    });
  }
}

// v5's modifier names correspond directly to these v6 semantic result flags.
const legacyFlags = [
  "explode",
  "compound",
  "penetrate",
  "re-roll",
  "re-roll-once",
  "unique",
  "unique-once",
  "drop",
  "min",
  "max",
  "target-success",
  "target-failure",
  "critical-success",
  "critical-failure",
] as const satisfies readonly results.ResultFlag[];

function isLegacyFlag(flag: string): flag is (typeof legacyFlags)[number] {
  return legacyFlags.some((known) => known === flag);
}

function convertDie(die: LegacyDieResult, path: string): ConciseDieResult {
  const { initialValue, value, calculationValue, useInTotal } = die;

  if (
    initialValue === null ||
    !Number.isSafeInteger(initialValue) ||
    value === null ||
    !Number.isFinite(value) ||
    calculationValue === null ||
    !Number.isFinite(calculationValue)
  ) {
    fail(path, "Expected finite die results and an integer initial value");
  }

  const flags = die.modifiers.map((flag) => {
    if (!isLegacyFlag(flag)) {
      fail(path, `Unknown legacy modifier flag: ${flag}`);
    }

    return flag;
  });

  if (new Set(flags).size !== flags.length) {
    fail(path, "Duplicate legacy modifier flags");
  }

  return { initialValue, value, calculationValue, useInTotal, flags };
}

function storedStatistic(value: LegacyNumber, path: string): number {
  if (value === null || !Number.isFinite(value)) {
    fail(path, "Cannot recover a non-finite legacy statistic from null");
  }

  return value;
}

/** Reconstruct a finished pool using v6's concise import. */
function convertRoll(
  data: LegacyRollData,
  context: ConversionContext,
  path: string,
): EncodedRollData {
  let node: ExpressionNode;

  try {
    node = new Parser().parse(data.notation);
  } catch (cause) {
    throw new ConversionError(
      `${path}.notation: Cannot parse legacy notation`,
      {
        cause,
      },
    );
  }

  if (
    node.type !== "pool" ||
    node.qty.type !== "number" ||
    !["standard", "percentile", "fudge"].includes(node.die.name) ||
    node.die.args.some((arg) => arg.type !== "number")
  ) {
    fail(`${path}.notation`, "Only basic dice pools are supported so far");
  }

  const pool = data.rolls[0];
  if (
    data.rolls.length !== 1 ||
    typeof pool !== "object" ||
    pool === null ||
    pool.type !== "roll-results"
  ) {
    fail(`${path}.rolls`, "Expected exactly one legacy dice pool");
  }

  const explode = node.modifiers.find(
    (modifier) => modifier.name === "explode",
  );
  const modified = node.modifiers.length > 0;

  // Each non-compound v5 explosion adds exactly one die per flagged trigger,
  // even if a sorting modifier has reordered the pool.
  const extras =
    explode && !explode.compound
      ? pool.rolls.filter((die) => die.modifiers.includes("explode")).length
      : 0;

  if (pool.rolls.length !== node.qty.value + extras) {
    fail(`${path}.rolls[0].rolls`, "Stored dice count does not match notation");
  }

  const values = pool.rolls.map((die, index) => {
    const diePath = `${path}.rolls[0].rolls[${index}]`;

    if (
      !modified &&
      (die.modifiers.length !== 0 ||
        die.modifierFlags !== "" ||
        !die.useInTotal ||
        die.value !== die.initialValue ||
        die.value !== die.calculationValue)
    ) {
      fail(diePath, "Unexpected modified die in an unmodified pool");
    }

    return convertDie(die, diePath);
  });

  let roll: Roll;
  try {
    roll = Roll.import({ notation: data.notation, rolls: [values] });
  } catch (cause) {
    throw new ConversionError(`${path}: Cannot reconstruct legacy dice pool`, {
      cause,
    });
  }

  if (roll.result.type !== "pool") {
    fail(path, "Expected a reconstructed dice pool");
  }

  const { min, max } = roll.result.die;
  for (const [index, die] of roll.result.rolls.entries()) {
    // Final values may be outside the natural die range (min/max, compound,
    // or penetration). The initial value is always the actual original draw.
    if (die.initialValue < min || die.initialValue > max) {
      fail(
        `${path}.rolls[0].rolls[${index}]`,
        "Die value is outside its possible range",
      );
    }
  }

  checkTotal(pool.value, roll.result.value, `${path}.rolls[0].value`, context);
  checkTotal(data.total, roll.total, `${path}.total`, context);

  if (modified) {
    // v5 and v6 can calculate different bounds for the same modifiers.
    // Preserve the original finite statistics, without running modifiers again.
    return Roll.import({
      type: "roll",
      version: 1,
      notation: roll.notation,
      result: roll.result,
      total: roll.total,
      minTotal: storedStatistic(data.minTotal, `${path}.minTotal`),
      maxTotal: storedStatistic(data.maxTotal, `${path}.maxTotal`),
      averageTotal: storedStatistic(data.averageTotal, `${path}.averageTotal`),
    }).export();
  }

  checkTotal(data.minTotal, roll.minTotal, `${path}.minTotal`, context);
  checkTotal(data.maxTotal, roll.maxTotal, `${path}.maxTotal`, context);
  checkTotal(
    data.averageTotal,
    roll.averageTotal,
    `${path}.averageTotal`,
    context,
  );

  return roll.export();
}

/** Legacy-to-v1 migration. Other notation structures will be added incrementally. */
export const legacyToV1: ConversionStep<"legacy", 1> = {
  from: "legacy",
  to: 1,
  convert(data, context) {
    if (data.type === "dice-roll") {
      return convertRoll(data, context, "data");
    }

    const rolls = data.log.map((roll, index) =>
      convertRoll(roll, context, `data.log[${index}]`),
    );
    const total = rolls.reduce((sum, roll) => {
      if (typeof roll.total !== "number") {
        fail("data.log", "Expected a finite roll total");
      }

      return sum + roll.total;
    }, 0);

    checkTotal(data.total, total, "data.total", context);

    return { type: "history", version: 1, rolls, total };
  },
};
