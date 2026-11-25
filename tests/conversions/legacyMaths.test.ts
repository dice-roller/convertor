import { Roll, Roller } from "@dice-roller/rpg-dice-roller";
import type { results } from "@dice-roller/rpg-dice-roller";
import { DiceRoll, DiceRoller } from "rpg-dice-roller-v5";
import { fromLegacy } from "../../src/index.js";
import type { LegacyRollData } from "../../src/index.js";

function legacyRoll(notation: string): LegacyRollData {
  return JSON.parse(
    new DiceRoll(notation).export() as string,
  ) as LegacyRollData;
}

function pools(result: results.ExpressionResult): results.PoolResult[] {
  switch (result.type) {
    case "pool":
      return [result];
    case "binary":
      return [...pools(result.left), ...pools(result.right)];
    case "unary":
      return pools(result.operand);
    case "paren":
      return pools(result.inner);
    case "function":
      return result.args.flatMap(pools);
    default:
      return [];
  }
}

describe("legacy mathematical expressions", () => {
  it.each([
    "2d6+3",
    "d6+d8*2",
    "(d6+d8)*2",
    "2d6-3.5",
    "d6/3",
    "d6%3",
    "d6^2",
    "d6**2",
    "-2^2+d6",
    "d6+(-2)",
    "d6*-2",
    "2^-2+d6",
    "5%-3+d6",
    "abs(d6-7)",
    "ceil(d6/2)",
    "floor(d6/2)",
    "round(-2.5)+d6",
    "cos(d6)",
    "sin(d6)",
    "tan(d6)",
    "exp(d6)",
    "log(d6)",
    "sqrt(d6)",
    "sign(d6-4)",
    "pow(d6,2)",
    "max(d6,d8)",
    "min(d6,d8)",
    "max(d6,min(d8,d10+2))",
    "((2d6+3)*4)-d8",
    "4d6kh3 + 2d8sd",
    "2d6 [attack]+d8 [damage]",
    "2+3*4",
    "0",
    "-2",
    "pow(2,3)",
    "2^3^2",
  ])("preserves finished expression %s", (notation) => {
    const source = legacyRoll(notation);
    const before = structuredClone(source);
    const data = fromLegacy(source, 1);

    if (data.type !== "roll") throw new Error("Expected roll");
    expect(data.notation).toBe(source.notation);
    expect(data.total).toBe(source.total);
    expect(data.minTotal).toBe(source.minTotal);
    expect(data.maxTotal).toBe(source.maxTotal);
    expect(data.averageTotal).toBe(source.averageTotal);

    const originalPools = source.rolls.filter(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        item.type === "roll-results",
    );
    const restored = Roll.import(data);
    expect(pools(restored.result).map((pool) => pool.rolls)).toEqual(
      originalPools.map((pool) =>
        pool.rolls.map((die) => ({
          type: "die",
          value: die.value,
          initialValue: die.initialValue,
          calculationValue: die.calculationValue,
          useInTotal: die.useInTotal,
          flags: die.modifiers,
        })),
      ),
    );
    expect(restored.export()).toEqual(data);
    expect(source).toEqual(before);
  });

  it("rejects changed operators, constants and unused tokens even if totals match", () => {
    const source = legacyRoll("d6+0");
    for (const rolls of [
      [source.rolls[0], "-", 0],
      [source.rolls[0], "+", 1],
      [...source.rolls, "+", 0],
      source.rolls.slice(0, 1),
    ]) {
      expect(() =>
        fromLegacy({ ...source, rolls }, 1, { strict: false }),
      ).toThrow(/token|Unused/);
    }
  });

  it("keeps distinct pools in encounter order even when their totals match", () => {
    const source = legacyRoll("d6+d8");
    const data = fromLegacy(source, 1);
    if (data.type !== "roll") throw new Error("Expected roll");
    const restored = pools(Roll.import(data).result);
    expect(restored.map((pool) => pool.die.max)).toEqual([6, 8]);
  });

  it("preserves historical average for non-linear expressions", () => {
    const data = fromLegacy(legacyRoll("d6^2"), 1);
    if (data.type !== "roll") throw new Error("Expected roll");
    expect(data.averageTotal).toBe(18.5);
    expect(Roll.import(data).averageTotal).toBe(18.5);
  });

  it.each(["1/0", "-1/0"])("recovers non-finite totals from %s", (notation) => {
    const source = legacyRoll(notation);
    const result = fromLegacy(source, 1);
    if (result.type !== "roll") throw new Error("Expected roll");
    const tag = {
      $number: notation.startsWith("-") ? "-Infinity" : "Infinity",
    };
    expect(result.total).toEqual(tag);
    expect(result.minTotal).toEqual(tag);
    expect(result.maxTotal).toEqual(tag);
    expect(result.averageTotal).toEqual(tag);
  });

  it("converts histories containing expressions and pools", () => {
    const roller = new DiceRoller();
    roller.roll("d6+3", "max(d8,d10)", "d6");
    const history = fromLegacy(roller.export() as string, 1);
    if (history.type !== "history") throw new Error("Expected history");
    expect(history.total).toBe(roller.total);
    const restored = new Roller();
    restored.import(history);
    expect(restored.export()).toEqual(history);
  });
});
