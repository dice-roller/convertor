import { Parser, Roll } from "@dice-roller/rpg-dice-roller";
import type {
  ConciseDieResult,
  EncodedRollData,
  results,
  ast,
  EncodedNumber,
  ExpressionNode,
} from "@dice-roller/rpg-dice-roller";
import { ConversionError } from "../errors.js";
import type {
  LegacyDieResult,
  LegacyExpressionItem,
  LegacyRollResults,
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
  if (actual === null && !Number.isFinite(expected)) {
    return;
  }
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

function storedStatistic(
  value: LegacyNumber,
  path: string,
  inferred?: () => number,
): number {
  if (value === null && inferred) {
    const candidate = inferred();
    if (!Number.isFinite(candidate)) return candidate;
  }
  if (value === null || !Number.isFinite(value)) {
    fail(path, "Cannot recover a non-finite legacy statistic from null");
  }

  return value;
}

interface MatchedPool {
  readonly node: ast.PoolNode;
  readonly pool: LegacyRollResults;
  readonly path: string;
  readonly values: readonly ConciseDieResult[];
}

/** v5 stores infix tokens, whereas v6 stores a tree. Match the original
 * token stream in notation order before handing finished dice to v6.
 */
class ExpressionMatcher {
  private index = 0;
  readonly pools: MatchedPool[] = [];

  constructor(
    private readonly tokens: readonly LegacyExpressionItem[],
    private readonly path: string,
  ) {}

  private consume(expected: number | string): void {
    if (this.tokens[this.index] !== expected) {
      fail(
        `${this.path}[${this.index}]`,
        `Expected legacy expression token ${String(expected)}`,
      );
    }

    this.index++;
  }

  match(node: ExpressionNode, negative = false): void {
    switch (node.type) {
      case "number":
        this.consume(negative ? -node.value : node.value);
        return;
      case "binary":
        this.match(node.left, negative);
        this.consume(node.op);
        this.match(node.right);
        return;
      case "unary":
        this.match(node.operand, true);
        return;
      case "paren":
        this.consume("(");
        this.match(node.expression);
        this.consume(")");
        return;
      case "function":
        this.consume(`${node.name}(`);
        for (const [index, arg] of node.args.entries()) {
          if (index > 0) this.consume(",");
          this.match(arg);
        }
        this.consume(")");
        return;
      case "pool": {
        const path = `${this.path}[${this.index}]`;
        const pool = this.tokens[this.index++];
        if (
          typeof pool !== "object" ||
          pool === null ||
          pool.type !== "roll-results"
        ) {
          fail(path, "Expected a legacy dice pool");
        }
        this.pools.push({
          node,
          pool,
          path,
          values: convertPool(node, pool, path),
        });
        return;
      }
      default:
        fail(this.path, `Unsupported legacy expression type: ${node.type}`);
    }
  }

  finish(node: ExpressionNode): readonly MatchedPool[] {
    this.match(node);
    if (this.index !== this.tokens.length) {
      fail(`${this.path}[${this.index}]`, "Unused legacy expression results");
    }
    return this.pools;
  }
}

function convertPool(
  node: ast.PoolNode,
  pool: LegacyRollResults,
  path: string,
): readonly ConciseDieResult[] {
  if (
    node.qty.type !== "number" ||
    !["standard", "percentile", "fudge"].includes(node.die.name) ||
    node.die.args.some((arg) => arg.type !== "number")
  ) {
    fail(path, "Only basic dice quantities and sides are supported so far");
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
    fail(`${path}.rolls`, "Stored dice count does not match notation");
  }

  return pool.rolls.map((die, index) => {
    const diePath = `${path}.rolls[${index}]`;

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
}

function collectPools(result: results.ExpressionResult): results.PoolResult[] {
  switch (result.type) {
    case "pool":
      return [result];
    case "binary":
      return [...collectPools(result.left), ...collectPools(result.right)];
    case "unary":
      return collectPools(result.operand);
    case "paren":
      return collectPools(result.inner);
    case "function":
      return result.args.flatMap(collectPools);
    case "number":
      return [];
    default:
      fail("data.rolls", `Unsupported reconstructed result: ${result.type}`);
  }
}

function encodeNumber(value: number): EncodedNumber {
  return Number.isFinite(value)
    ? value
    : {
        $number: Number.isNaN(value)
          ? "NaN"
          : value > 0
            ? "Infinity"
            : "-Infinity",
      };
}

/** Reconstruct a finished expression using v6's concise import. */
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
      { cause },
    );
  }

  const pools = new ExpressionMatcher(data.rolls, `${path}.rolls`).finish(node);
  let roll: Roll;
  try {
    roll = Roll.import({
      notation: data.notation,
      rolls: pools.map((pool) => pool.values),
    });
  } catch (cause) {
    throw new ConversionError(`${path}: Cannot reconstruct legacy dice pool`, {
      cause,
    });
  }

  const restored = collectPools(roll.result);
  if (restored.length !== pools.length) {
    fail(
      `${path}.rolls`,
      "Reconstructed pool count does not match legacy data",
    );
  }
  for (const [index, source] of pools.entries()) {
    const pool = restored[index];
    if (!pool) fail(source.path, "Missing reconstructed pool");

    const { min, max } = pool.die;
    for (const [dieIndex, die] of pool.rolls.entries()) {
      if (die.initialValue < min || die.initialValue > max) {
        fail(
          `${source.path}.rolls[${dieIndex}]`,
          "Die value is outside its possible range",
        );
      }
    }
    checkTotal(source.pool.value, pool.value, `${source.path}.value`, context);
  }
  checkTotal(data.total, roll.total, `${path}.total`, context);

  if (node.type !== "pool" || node.modifiers.length > 0) {
    // v5 and v6 can calculate different statistics for modifiers and maths.
    // Preserve the original finite statistics, without running modifiers again.
    return Roll.import({
      type: "roll",
      version: 1,
      notation: roll.notation,
      result: roll.result,
      total: roll.total,
      minTotal: storedStatistic(
        data.minTotal,
        `${path}.minTotal`,
        pools.every(({ node }) => node.modifiers.length === 0)
          ? () => roll.minTotal
          : undefined,
      ),
      maxTotal: storedStatistic(
        data.maxTotal,
        `${path}.maxTotal`,
        pools.every(({ node }) => node.modifiers.length === 0)
          ? () => roll.maxTotal
          : undefined,
      ),
      averageTotal: storedStatistic(
        data.averageTotal,
        `${path}.averageTotal`,
        pools.every(({ node }) => node.modifiers.length === 0)
          ? () => (roll.minTotal + roll.maxTotal) / 2
          : undefined,
      ),
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
      const value =
        typeof roll.total === "number"
          ? roll.total
          : Number(roll.total.$number);
      return sum + value;
    }, 0);

    checkTotal(data.total, total, "data.total", context);

    return { type: "history", version: 1, rolls, total: encodeNumber(total) };
  },
};
