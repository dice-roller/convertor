import { Roll } from "@dice-roller/rpg-dice-roller";
import { DiceRoll } from "rpg-dice-roller-v5";
import { fromLegacy } from "../../src/index.js";
import type { LegacyRollData } from "../../src/index.js";

function legacy(notation: string): LegacyRollData {
  return JSON.parse(
    new DiceRoll(notation).export() as string,
  ) as LegacyRollData;
}

describe("calculated legacy dice parameters", () => {
  it.each([
    ["(1+2)d6", 3, 6],
    ["2d(3*2)", 2, 6],
    ["(2^2)d(12/2)", 4, 6],
    ["(2+2)d%", 4, 100],
    ["(1+2)dF.1", 3, 1],
    ["(5-1)d(2+4)kh2", 4, 6],
  ])("preserves %s", (notation, qty, max) => {
    const source = legacy(notation);
    const data = fromLegacy(source, 1);
    if (data.type !== "roll") throw new Error("Expected roll");
    const restored = Roll.import(data);
    if (restored.result.type !== "pool") throw new Error("Expected pool");
    expect(restored.result.qty.value).toBe(qty);
    expect(restored.result.die.max).toBe(max);
    expect(restored.result.rolls).toHaveLength(qty);
    expect(data.notation).toBe(notation);
    expect(data.total).toBe(source.total);
    expect(data.minTotal).toBe(source.minTotal);
    expect(data.maxTotal).toBe(source.maxTotal);
    expect(data.averageTotal).toBe(source.averageTotal);
  });

  it("converts calculated parameters inside larger expressions", () => {
    const source = legacy("(1+2)d6 + 2d(2^3)");
    expect(fromLegacy(source, 1).total).toBe(source.total);
  });

  it.each(["(1-1)d6", "(3/2)d6", "d(3/2)"])(
    "rejects legacy coercions which cannot be represented faithfully: %s",
    (notation) => {
      // Some v5 versions reject fractional sides at roll time; construct
      // a valid-shaped snapshot so the converter's own rejection is tested.
      const source = { ...legacy("d6"), notation };
      expect(() => fromLegacy(source, 1, { strict: false })).toThrow(
        /positive safe integer/,
      );
    },
  );
});
