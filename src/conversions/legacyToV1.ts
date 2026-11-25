import { Parser, Roll } from "@dice-roller/rpg-dice-roller";
import type {
  EncodedRollData,
  ExpressionNode,
} from "@dice-roller/rpg-dice-roller";
import { ConversionError } from "../errors.js";
import type { LegacyRollData, LegacyNumber } from "../formats/legacy.js";
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

/** Reconstruct a finished, unmodified pool using v6's concise import. */
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
    node.modifiers.length !== 0 ||
    node.qty.type !== "number" ||
    !["standard", "percentile", "fudge"].includes(node.die.name) ||
    node.die.args.some((arg) => arg.type !== "number")
  ) {
    fail(
      `${path}.notation`,
      "Only unmodified basic dice pools are supported so far",
    );
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

  if (pool.rolls.length !== node.qty.value) {
    fail(`${path}.rolls[0].rolls`, "Stored dice count does not match notation");
  }

  const values = pool.rolls.map((die, index) => {
    const diePath = `${path}.rolls[0].rolls[${index}]`;

    if (
      die.modifiers.length !== 0 ||
      die.modifierFlags !== "" ||
      !die.useInTotal ||
      die.value !== die.initialValue ||
      die.value !== die.calculationValue
    ) {
      fail(diePath, "Unexpected modified die in an unmodified pool");
    }

    if (die.value === null || !Number.isSafeInteger(die.value)) {
      fail(diePath, "Expected a finite integer die result");
    }

    return die.value;
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
  for (const [index, value] of values.entries()) {
    if (value < min || value > max) {
      fail(
        `${path}.rolls[0].rolls[${index}]`,
        "Die value is outside its possible range",
      );
    }
  }

  checkTotal(pool.value, roll.result.value, `${path}.rolls[0].value`, context);
  checkTotal(data.total, roll.total, `${path}.total`, context);
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
