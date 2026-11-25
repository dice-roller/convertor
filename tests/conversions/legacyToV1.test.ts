import { Roll, Roller } from "@dice-roller/rpg-dice-roller";
import { DiceRoll, DiceRoller } from "rpg-dice-roller-v5";
import { ConversionError, convert, fromLegacy } from "../../src/index.js";
import type {
  ConversionWarning,
  LegacyRollData,
  LegacyRollResults,
} from "../../src/index.js";

function legacyRoll(notation: string): LegacyRollData {
  return JSON.parse(
    new DiceRoll(notation).export() as string,
  ) as LegacyRollData;
}

function poolOf(roll: LegacyRollData): LegacyRollResults {
  const pool = roll.rolls[0];
  if (
    typeof pool !== "object" ||
    pool === null ||
    pool.type !== "roll-results"
  ) {
    throw new Error("Expected pool fixture");
  }

  return pool;
}

describe("legacy to v1 basic pools", () => {
  it.each(["d6", "4d20", "2d%", "4dF", "3dF.1", "3dF.2", "2d6 [café]"])(
    "preserves the finished dice and totals of %s",
    (notation) => {
      const source = legacyRoll(notation);
      const before = structuredClone(source);
      const values = poolOf(source).rolls.map((die) => die.value);
      const result = fromLegacy(source, 1);

      expect(result.type).toBe("roll");
      if (result.type !== "roll") {
        throw new Error("Expected roll");
      }

      expect(result.notation).toBe(source.notation);
      expect(result.total).toBe(source.total);
      expect(result.minTotal).toBe(source.minTotal);
      expect(result.maxTotal).toBe(source.maxTotal);
      expect(result.averageTotal).toBe(source.averageTotal);
      expect(result.result.type).toBe("pool");
      if (result.result.type !== "pool") {
        throw new Error("Expected pool");
      }

      expect(result.result.rolls.map((die) => die.value)).toEqual(values);
      expect(result.result.rolls.map((die) => die.initialValue)).toEqual(
        values,
      );
      expect(result.result.rolls.map((die) => die.calculationValue)).toEqual(
        values,
      );
      expect(result.result.rolls.every((die) => die.useInTotal)).toBe(true);
      expect(result.result.rolls.every((die) => die.flags.length === 0)).toBe(
        true,
      );
      expect(Roll.import(result).export()).toEqual(result);
      expect(convert(source, 1)).toEqual(result);
      expect(source).toEqual(before);
    },
  );

  it("converts genuine legacy JSON and Base64 into all full output encodings", () => {
    const json = new DiceRoll("3d6 [café]").export() as string;
    const result = fromLegacy(json, 1);
    expect(fromLegacy(btoa(json), "latest")).toEqual(result);
    expect(JSON.parse(fromLegacy(json, 1, { encoding: "json" }))).toEqual(
      result,
    );
    expect(
      Roll.import(fromLegacy(json, 1, { encoding: "base64" })).export(),
    ).toEqual(result);
  });

  it("converts a history in its original order", () => {
    const roller = new DiceRoller();
    roller.roll("d6", "2d8", "4dF");
    const history = fromLegacy(roller.export() as string, 1);
    if (history.type !== "history") {
      throw new Error("Expected history");
    }

    expect(history.rolls.map((roll) => roll.notation)).toEqual([
      "d6",
      "2d8",
      "4dF",
    ]);
    expect(history.total).toBe(roller.total);
    const restored = new Roller();
    restored.import(history);
    expect(restored.export()).toEqual(history);
  });

  it("converts an empty legacy history", () => {
    expect(fromLegacy(new DiceRoller().export() as string, 1)).toEqual({
      type: "history",
      version: 1,
      rolls: [],
      total: 0,
    });
  });

  it("rejects inconsistent totals in strict mode and reports them in best-effort mode", () => {
    const source = legacyRoll("2d6");
    const modified = { ...source, total: 999 };
    expect(() => fromLegacy(modified, 1)).toThrow(ConversionError);
    const warnings: ConversionWarning[] = [];
    expect(
      fromLegacy(modified, 1, {
        strict: false,
        onWarning: (warning) => warnings.push(warning),
      }),
    ).toEqual(fromLegacy(source, 1));
    expect(warnings).toEqual([
      {
        code: "total-mismatch",
        path: "data.total",
        message: `Stored value 999 differs from reconstructed value ${String(source.total)}`,
      },
    ]);
  });

  it("rejects a missing die rather than inventing a replacement", () => {
    const source = legacyRoll("2d6");
    const pool = poolOf(source);
    const modified = {
      ...source,
      rolls: [{ ...pool, rolls: pool.rolls.slice(0, 1) }],
    };
    expect(() => fromLegacy(modified, 1, { strict: false })).toThrow(
      /dice count/,
    );
  });

  it("rejects impossible die values even in best-effort mode", () => {
    const source = legacyRoll("d6");
    const pool = poolOf(source);
    const modified = {
      ...source,
      rolls: [
        {
          ...pool,
          rolls: pool.rolls.map((die) => ({
            ...die,
            value: 7,
            initialValue: 7,
            calculationValue: 7,
          })),
        },
      ],
    };
    expect(() => fromLegacy(modified, 1, { strict: false })).toThrow(
      /outside its possible range/,
    );
  });

  it.each(["{d6,d8}", "(1+1)d6"])(
    "explicitly rejects notation not implemented yet: %s",
    (notation) => {
      expect(() =>
        fromLegacy(legacyRoll(notation), 1, { strict: false }),
      ).toThrow(ConversionError);
    },
  );
});

describe("legacy to v1 pool modifiers", () => {
  it.each([
    "4d6kh3",
    "4d6kl2",
    "4d6dh1",
    "4d6dl1",
    "4d6sa",
    "4d6sd",
    "4d6min7",
    "4d6max0",
    "4d6min2.5",
    "4d6max3.5",
    "4d6>=4f<=2",
    "4d6cs>=4cf<=2",
    "4d6ro<3",
    "4d6r<3",
    "4d6u",
    "4d6uo",
    "4d6!",
    "4d6!!",
    "4d6!p",
    "4d6!!p",
    "4d6!kh3sd",
    "4d6min3max4kh2>=4",
  ])("preserves the finished results of %s", (notation) => {
    const source = legacyRoll(notation);
    const before = structuredClone(source);
    const converted = fromLegacy(source, 1);

    if (converted.type !== "roll" || converted.result.type !== "pool") {
      throw new Error("Expected a pool");
    }

    expect(converted.total).toBe(source.total);
    expect(converted.minTotal).toBe(source.minTotal);
    expect(converted.maxTotal).toBe(source.maxTotal);
    expect(converted.averageTotal).toBe(source.averageTotal);
    expect(converted.result.rolls).toEqual(
      poolOf(source).rolls.map((die) => ({
        type: "die",
        initialValue: die.initialValue,
        value: die.value,
        calculationValue: die.calculationValue,
        useInTotal: die.useInTotal,
        flags: die.modifiers,
      })),
    );
    expect(Roll.import(converted).export()).toEqual(converted);
    expect(source).toEqual(before);
  });

  it.each([
    {
      notation: "d6!",
      values: [6, 6, 2],
      initialValues: [6, 6, 2],
      flags: [["explode"], ["explode"], []],
    },
    {
      notation: "d6!!",
      values: [14],
      initialValues: [6],
      flags: [["explode", "compound"]],
    },
    {
      notation: "d6!p",
      values: [6, 5, 0],
      initialValues: [6, 6, 1],
      flags: [["explode", "penetrate"], ["explode", "penetrate"], []],
    },
    {
      notation: "d6!!p",
      values: [11],
      initialValues: [6],
      flags: [["explode", "compound", "penetrate"]],
    },
    {
      notation: "d6r=1",
      values: [5],
      initialValues: [1],
      flags: [["re-roll"]],
    },
    {
      notation: "d6ro=1",
      values: [1],
      initialValues: [1],
      flags: [["re-roll-once"]],
    },
  ])(
    "preserves explicit finished outcomes for $notation",
    ({ notation, values, initialValues, flags }) => {
      const source = legacyRoll(notation);
      const total = values.reduce((sum, value) => sum + value, 0);
      const pool = poolOf(source);
      const fixture = {
        ...source,
        total,
        rolls: [
          {
            ...pool,
            value: total,
            rolls: values.map((value, index) => ({
              type: "result",
              value,
              initialValue: initialValues[index],
              calculationValue: value,
              useInTotal: true,
              modifiers: flags[index],
              modifierFlags: "",
            })),
          },
        ],
      };

      const result = fromLegacy(fixture, 1);
      if (result.type !== "roll" || result.result.type !== "pool") {
        throw new Error("Expected a pool");
      }

      expect(result.total).toBe(total);
      expect(result.result.rolls.map((die) => die.value)).toEqual(values);
      expect(result.result.rolls.map((die) => die.initialValue)).toEqual(
        initialValues,
      );
      expect(result.result.rolls.map((die) => die.flags)).toEqual(flags);
    },
  );

  it("rejects unknown flags instead of silently losing them", () => {
    const source = legacyRoll("d6sa");
    const pool = poolOf(source);
    const modified = {
      ...source,
      rolls: [
        {
          ...pool,
          rolls: pool.rolls.map((die) => ({ ...die, modifiers: ["unknown"] })),
        },
      ],
    };
    expect(() => fromLegacy(modified, 1, { strict: false })).toThrow(
      /Unknown legacy modifier flag/,
    );
  });

  it("rejects a missing exploding die", () => {
    const source = legacyRoll("d6!");
    const pool = poolOf(source);
    const modified = {
      ...source,
      rolls: [
        {
          ...pool,
          rolls: [
            {
              type: "result",
              value: 6,
              initialValue: 6,
              calculationValue: 6,
              useInTotal: true,
              modifiers: ["explode"],
              modifierFlags: "!",
            },
          ],
        },
      ],
    };
    expect(() => fromLegacy(modified, 1, { strict: false })).toThrow(
      /dice count/,
    );
  });
});
