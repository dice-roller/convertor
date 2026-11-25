import { ast, Parser, Roll } from "@dice-roller/rpg-dice-roller";
import type {
  ConciseDieResult,
  ConciseGroupResult,
  EncodedRollData,
  results,
  EncodedNumber,
  ExpressionNode,
} from "@dice-roller/rpg-dice-roller";
import { ConversionError } from "../errors.js";
import { sameData, matchPermutation } from "../formats/matching.js";
import type {
  LegacyDieResult,
  LegacyExpressionItem,
  LegacyResultGroup,
  LegacyRollResults,
  LegacyRollData,
  LegacyNumber,
} from "../formats/legacy.js";
import type {
  ConversionContext,
  ConversionStep,
  ConversionWarning,
} from "../types.js";

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

  const flags = convertFlags(die.modifiers, path);
  return { initialValue, value, calculationValue, useInTotal, flags };
}

function convertFlags(
  modifiers: readonly string[],
  path: string,
): results.ResultFlag[] {
  const flags = modifiers.map((flag) => {
    if (!isLegacyFlag(flag)) {
      fail(path, `Unknown legacy modifier flag: ${flag}`);
    }

    return flag;
  });

  if (new Set(flags).size !== flags.length) {
    fail(path, "Duplicate legacy modifier flags");
  }

  return flags;
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

interface MatchedGroup {
  readonly source: LegacyResultGroup;
  readonly path: string;
  readonly members: readonly LegacyResultGroup[];
  readonly override: ConciseGroupResult;
}

function groupWrapper(
  value: LegacyExpressionItem | undefined,
  isRollGroup: boolean,
  path: string,
): LegacyResultGroup {
  if (
    typeof value !== "object" ||
    value === null ||
    value.type !== "result-group" ||
    value.isRollGroup !== isRollGroup
  ) {
    fail(
      path,
      isRollGroup
        ? "Expected a legacy roll group"
        : "Expected a legacy group member",
    );
  }
  return value;
}

function memberScore(
  member: LegacyResultGroup,
  path: string,
): results.ScoredItem {
  if (member.value === null || member.calculationValue === null) {
    fail(path, "Cannot recover non-finite legacy group member scores");
  }
  return {
    value: member.value,
    calculationValue: member.calculationValue,
    useInTotal: member.useInTotal,
    flags: convertFlags(member.modifiers, path),
  };
}

/** v5 stores infix tokens, whereas v6 stores a tree. Match the original
 * token stream in notation order before handing finished dice to v6.
 */
class ExpressionMatcher {
  private index = 0;
  readonly pools: MatchedPool[] = [];
  readonly groups: MatchedGroup[] = [];
  readonly warnings: ConversionWarning[] = [];

  constructor(
    private readonly tokens: readonly LegacyExpressionItem[],
    private readonly path: string,
    private readonly inheritedSort = false,
    private readonly inheritedDrop = false,
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
          values: convertPool(node, pool, path, this.inheritedDrop),
        });
        return;
      }
      case "group":
        this.matchGroup(node);
        return;
      default:
        fail(this.path, `Unsupported legacy expression type: ${node.type}`);
    }
  }

  private matchGroup(node: ast.GroupNode): void {
    const path = `${this.path}[${this.index}]`;
    const source = groupWrapper(this.tokens[this.index++], true, path);
    if (source.results.length !== node.expressions.length) {
      fail(path, "Stored group member count does not match notation");
    }
    if (
      !source.useInTotal ||
      source.modifiers.length ||
      source.value !== source.calculationValue
    ) {
      fail(path, "Unexpected scoring on the outer legacy group");
    }
    const sorted =
      this.inheritedSort ||
      node.modifiers.some((modifier) => modifier.name === "sort");
    const flattened =
      node.expressions.length === 1 &&
      node.modifiers.some(
        (modifier) => modifier.name === "keep" || modifier.name === "drop",
      );
    const members = source.results.map((item, index) =>
      groupWrapper(item, false, `${path}.results[${index}]`),
    );
    const candidates = node.expressions.map((child, sourceIndex) =>
      members.map((member, storedIndex) => {
        if (!sorted && sourceIndex !== storedIndex) return undefined;
        const memberPath = `${path}.results[${storedIndex}]`;
        const matcher = new ExpressionMatcher(
          member.results,
          `${memberPath}.results`,
          sorted,
          flattened,
        );
        try {
          matcher.finish(child);
          memberScore(member, memberPath);
          return matcher;
        } catch (error) {
          if (!(error instanceof ConversionError)) throw error;
          if (!sorted) throw error;
          return undefined;
        }
      }),
    );
    const edges = candidates.map((row) =>
      row.map((entry) => entry !== undefined),
    );
    const order = matchPermutation(edges);
    if (!order) fail(path, "Cannot match legacy group members to notation");

    // Search for a materially different compatible assignment, ignoring
    // interchangeable identical ASTs and identical stored snapshots.
    if (sorted) {
      const ambiguous = order.some((storedIndex, sourceIndex) =>
        edges[sourceIndex]?.some((allowed, alternative) => {
          if (
            !allowed ||
            alternative === storedIndex ||
            sameData(members[alternative], members[storedIndex])
          )
            return false;
          const otherSource = order.indexOf(alternative);
          if (
            sameData(
              node.expressions[sourceIndex],
              node.expressions[otherSource],
            )
          )
            return false;
          return (
            matchPermutation(
              edges.map((row, rowIndex) =>
                row.map(
                  (edge, column) =>
                    edge &&
                    (rowIndex === sourceIndex
                      ? column === alternative
                      : column !== alternative),
                ),
              ),
            ) !== undefined
          );
        }),
      );
      if (ambiguous)
        this.warnings.push({
          code: "ambiguous-group-order",
          path,
          message:
            "Sorted legacy members can match multiple notation expressions; using a deterministic compatible assignment",
        });
    }

    const scores: Record<number, results.ScoredItem> = {};
    const notationMembers: LegacyResultGroup[] = [];
    const orderedIndexes = members.map((_, storedIndex) =>
      order.indexOf(storedIndex),
    );
    this.groups.push({
      source,
      path,
      members: notationMembers,
      override: { order: orderedIndexes, members: scores },
    });
    for (const [sourceIndex, storedIndex] of order.entries()) {
      const member = members[storedIndex];
      const matcher = candidates[sourceIndex]?.[storedIndex];
      if (!member || !matcher) fail(path, "Missing matched group member");
      notationMembers.push(member);
      scores[sourceIndex] = memberScore(
        member,
        `${path}.results[${storedIndex}]`,
      );
      this.pools.push(...matcher.pools);
      this.groups.push(...matcher.groups);
      this.warnings.push(...matcher.warnings);
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

/** v5 computed parameters contain only numeric arithmetic, never another pool. */
function isNumericExpression(node: ExpressionNode): boolean {
  switch (node.type) {
    case "number":
      return true;
    case "binary":
      return isNumericExpression(node.left) && isNumericExpression(node.right);
    case "unary":
      return isNumericExpression(node.operand);
    case "paren":
      return isNumericExpression(node.expression);
    default:
      return false;
  }
}

function parameter(node: ExpressionNode, path: string): number {
  if (!isNumericExpression(node)) {
    fail(
      path,
      "Legacy calculated parameters must contain only numeric arithmetic",
    );
  }
  let value: number;
  try {
    value =
      node.type === "number"
        ? node.value
        : Roll.import({
            notation: ast.nodeToNotation(node),
            rolls: [],
          }).result.value;
  } catch (cause) {
    throw new ConversionError(
      `${path}: Cannot evaluate legacy dice parameter`,
      { cause },
    );
  }
  // v5 sometimes coerced fractional quantities or defaulted zero to one.
  // v6 preserves computed expressions but cannot represent those coercions
  // without changing the notation or the evaluated AST.
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(path, "Legacy dice parameter is not a positive safe integer");
  }
  return value;
}

function convertPool(
  node: ast.PoolNode,
  pool: LegacyRollResults,
  path: string,
  inheritedDrop = false,
): readonly ConciseDieResult[] {
  if (!["standard", "percentile", "fudge"].includes(node.die.name)) {
    fail(path, "Unsupported legacy die type");
  }

  const qty = parameter(node.qty, `${path}.qty`);
  const args = node.die.args.map((arg, index) =>
    parameter(arg, `${path}.die.args[${index}]`),
  );
  const min = node.die.name === "fudge" ? -1 : 1;
  const max =
    node.die.name === "fudge"
      ? 1
      : node.die.name === "percentile"
        ? 100
        : args[0];
  if (max === undefined) fail(path, "Missing die sides");

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

  if (pool.rolls.length !== qty + extras) {
    fail(`${path}.rolls`, "Stored dice count does not match notation");
  }

  return pool.rolls.map((die, index) => {
    const diePath = `${path}.rolls[${index}]`;

    if (
      !modified &&
      (die.modifiers.some((flag) => !inheritedDrop || flag !== "drop") ||
        (!inheritedDrop && die.modifierFlags !== "") ||
        (!die.useInTotal &&
          !(inheritedDrop && die.modifiers.includes("drop"))) ||
        die.value !== die.initialValue ||
        die.value !== die.calculationValue)
    ) {
      fail(diePath, "Unexpected modified die in an unmodified pool");
    }

    if (
      die.initialValue !== null &&
      (die.initialValue < min || die.initialValue > max)
    ) {
      fail(diePath, "Die value is outside its possible range");
    }
    return convertDie(die, diePath);
  });
}

/** Visit reconstructed results in source order, including reordered groups. */
function validateRestored(
  result: results.ExpressionResult,
  matcher: ExpressionMatcher,
  context: ConversionContext,
): void {
  let poolIndex = 0;
  let groupIndex = 0;

  function visit(node: results.ExpressionResult): void {
    switch (node.type) {
      case "number":
        return;
      case "pool": {
        const source = matcher.pools[poolIndex++];
        if (!source) fail("data.rolls", "Unexpected reconstructed pool");
        checkTotal(
          source.pool.value,
          node.value,
          `${source.path}.value`,
          context,
        );
        return;
      }
      case "binary":
        visit(node.left);
        visit(node.right);
        return;
      case "unary":
        visit(node.operand);
        return;
      case "paren":
        visit(node.inner);
        return;
      case "function":
        node.args.forEach(visit);
        return;
      case "group": {
        const group = matcher.groups[groupIndex++];
        if (!group) fail("data.rolls", "Unexpected reconstructed group");
        checkTotal(
          group.source.value,
          node.value,
          `${group.path}.value`,
          context,
        );
        for (const [index, source] of group.members.entries()) {
          const storedIndex = group.override.order?.indexOf(index) ?? index;
          const member = node.members[storedIndex];
          if (!member) fail(group.path, "Missing reconstructed member");
          checkTotal(
            source.value,
            member.result.value,
            `${group.path}.results[${storedIndex}].value`,
            context,
          );
          visit(member.result);
        }
        return;
      }
      default:
        fail("data.rolls", `Unsupported reconstructed result: ${node.type}`);
    }
  }

  visit(result);
  if (
    poolIndex !== matcher.pools.length ||
    groupIndex !== matcher.groups.length
  ) {
    fail("data.rolls", "Unused reconstructed pools or groups");
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

  const matcher = new ExpressionMatcher(data.rolls, `${path}.rolls`);
  const pools = matcher.finish(node);
  matcher.warnings.forEach((warning) => context.warn(warning));
  let roll: Roll;
  try {
    roll = Roll.import({
      notation: data.notation,
      rolls: pools.map((pool) => pool.values),
      ...(matcher.groups.length && {
        groups: Object.fromEntries(
          matcher.groups.map((group, index) => [index, group.override]),
        ),
      }),
    });
  } catch (cause) {
    throw new ConversionError(`${path}: Cannot reconstruct legacy dice pool`, {
      cause,
    });
  }

  validateRestored(roll.result, matcher, context);
  checkTotal(data.total, roll.total, `${path}.total`, context);

  if (
    node.type !== "pool" ||
    node.modifiers.length > 0 ||
    node.qty.type !== "number" ||
    node.die.args.some((arg) => arg.type !== "number")
  ) {
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
        matcher.groups.length === 0 &&
          pools.every(({ node }) => node.modifiers.length === 0)
          ? () => roll.minTotal
          : undefined,
      ),
      maxTotal: storedStatistic(
        data.maxTotal,
        `${path}.maxTotal`,
        matcher.groups.length === 0 &&
          pools.every(({ node }) => node.modifiers.length === 0)
          ? () => roll.maxTotal
          : undefined,
      ),
      averageTotal: storedStatistic(
        data.averageTotal,
        `${path}.averageTotal`,
        matcher.groups.length === 0 &&
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
