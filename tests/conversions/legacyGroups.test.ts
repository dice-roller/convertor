import { Roll, Roller } from "@dice-roller/rpg-dice-roller";
import { DiceRoll, DiceRoller } from "rpg-dice-roller-v5";
import { fromLegacy, ConversionError } from "../../src/index.js";
import type {
  ConversionWarning,
  LegacyRollData,
  LegacyResultGroup,
  LegacyRollResults,
} from "../../src/index.js";

function legacy(notation: string): LegacyRollData {
  return JSON.parse(
    new DiceRoll(notation).export() as string,
  ) as LegacyRollData;
}

function group(source: LegacyRollData): LegacyResultGroup {
  const item = source.rolls[0];
  if (!item || typeof item !== "object" || item.type !== "result-group")
    throw new Error("Expected group");
  return item;
}

function member(value: number): LegacyResultGroup {
  const pool: LegacyRollResults = {
    type: "roll-results",
    value,
    rolls: [
      {
        type: "result",
        value,
        initialValue: value,
        calculationValue: value,
        useInTotal: true,
        modifiers: [],
        modifierFlags: "",
      },
    ],
  };
  return {
    type: "result-group",
    results: [pool],
    value,
    calculationValue: value,
    useInTotal: true,
    isRollGroup: false,
    modifiers: [],
    modifierFlags: "",
  };
}

function sortedFixture(notation: string, values: number[]): LegacyRollData {
  const source = legacy(notation);
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    ...source,
    total,
    rolls: [
      {
        ...group(source),
        value: total,
        calculationValue: total,
        results: values.map(member),
      },
    ],
  };
}

describe("legacy roll groups", () => {
  it.each([
    "{d6,d8}",
    "{2d6+3,d8*2}",
    "{d6,d8}kh1",
    "{d6,d8}kl1",
    "{d6,d8}dh1",
    "{d6,d8}dl1",
    "{d6,d8}>=4f<=2",
    "{4d6+2d8}kh3",
    "{4d6+2d8}dl2",
    "{4d6kh3+2d8}kh2",
    "{4d6+2d8}sa",
    "{d6+1,d8*2}sd",
    "{2,1}sa",
    "{d6,d6}sa",
    "{d6,d6}kh1sd",
    "{d6,d8}kh1+2d4",
    "{(1+2)d6,d(3+4)}",
    "{2d6>=3,d8}>=2",
  ])("preserves %s", (notation) => {
    const source = legacy(notation);
    const data = fromLegacy(source, 1);
    if (data.type !== "roll") throw new Error("Expected roll");
    expect(data.total).toBe(source.total);
    expect(data.minTotal).toBe(source.minTotal);
    expect(data.maxTotal).toBe(source.maxTotal);
    expect(data.averageTotal).toBe(source.averageTotal);
    expect(Roll.import(data).export()).toEqual(data);
  });

  it("retains group member scores and flags", () => {
    const source = legacy("{d6,d8}kh1>=3");
    const result = fromLegacy(source, 1);
    if (result.type !== "roll" || result.result.type !== "group")
      throw new Error("Expected group");
    expect(
      result.result.members.map(
        ({ value, calculationValue, useInTotal, flags }) => ({
          value,
          calculationValue,
          useInTotal,
          flags,
        }),
      ),
    ).toEqual(
      group(source).results.map((item) => {
        if (!item || typeof item !== "object" || item.type !== "result-group")
          throw new Error("Expected member");
        return {
          value: item.value,
          calculationValue: item.calculationValue,
          useInTotal: item.useInTotal,
          flags: item.modifiers,
        };
      }),
    );
  });

  it("restores a uniquely identifiable sorted order", () => {
    const source = sortedFixture("{d20,d6}sa", [2, 17]);
    const result = fromLegacy(source, 1);
    if (result.type !== "roll" || result.result.type !== "group")
      throw new Error("Expected group");
    expect(
      result.result.members.map((entry) =>
        entry.result.type === "pool" ? entry.result.die.max : null,
      ),
    ).toEqual([6, 20]);
    expect(result.total).toBe(19);
  });

  it("rejects ambiguous sorted groups in strict mode, and warns in best-effort mode", () => {
    const source = sortedFixture("{d6,d8}sa", [2, 5]);
    expect(() => fromLegacy(source, 1)).toThrow(
      /multiple notation expressions/,
    );
    const warnings: ConversionWarning[] = [];
    const result = fromLegacy(source, 1, {
      strict: false,
      onWarning: (warning) => warnings.push(warning),
    });
    expect(result).toEqual(fromLegacy(source, 1, { strict: false }));
    expect(result.total).toBe(7);
    expect(warnings.map(({ code }) => code)).toEqual(["ambiguous-group-order"]);
  });

  it("does not warn about interchangeable identical members", () => {
    const source = sortedFixture("{d6,d6}sa", [2, 5]);
    expect(fromLegacy(source, 1).total).toBe(7);
  });

  it("rejects an impossible assignment even in best-effort mode", () => {
    expect(() =>
      fromLegacy(sortedFixture("{d6,d8}sa", [7, 8]), 1, { strict: false }),
    ).toThrow(ConversionError);
  });

  it("converts group histories", () => {
    const roller = new DiceRoller();
    roller.roll("{d6,d8}kh1", "d6+2", "{4d6+2d8}kh2");
    const data = fromLegacy(roller.export() as string, 1);
    if (data.type !== "history") throw new Error("Expected history");
    const restored = new Roller();
    restored.import(data);
    expect(restored.export()).toEqual(data);
  });
});
