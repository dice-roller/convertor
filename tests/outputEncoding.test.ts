import { Roll } from "@dice-roller/rpg-dice-roller";
import { DiceRoll, exportFormats } from "rpg-dice-roller-v5";
import { decodeInput, encodeOutput } from "../src/encoding.js";
import { OutputEncodingError } from "../src/index.js";

describe("encodeOutput", () => {
  const legacy = {
    type: "dice-roll",
    notation: "d6 [café, 日本語, 🎲, Ã©]",
    output: 'Quotes: " and backslash: \\ and literal \\u00e9',
    rolls: [],
  };
  const current = {
    type: "roll",
    version: 1,
    notation: legacy.notation,
    total: { $number: "Infinity" },
    minTotal: { $number: "-Infinity" },
    averageTotal: { $number: "NaN" },
  };

  it("defaults to object without changing the prepared data", () => {
    expect(encodeOutput(current, 1)).toBe(current);
    expect(encodeOutput(legacy, "legacy", "object")).toBe(legacy);
  });

  it("preserves ordinary Unicode JSON and tagged numbers", () => {
    expect(encodeOutput(legacy, "legacy", "json")).toBe(JSON.stringify(legacy));
    expect(encodeOutput(current, 1, "json")).toBe(JSON.stringify(current));
  });

  it("escapes all non-ASCII legacy JSON code units, including surrogate pairs", () => {
    const encoded = encodeOutput(legacy, "legacy", "base64");
    const json = atob(encoded);

    expect([...json].every((character) => character.charCodeAt(0) < 128)).toBe(
      true,
    );
    expect(json).toContain("caf\\u00e9");
    expect(json).toContain("\\u65e5\\u672c\\u8a9e");
    expect(json).toContain("\\ud83c\\udfb2");
    expect(JSON.parse(json)).toEqual(legacy);
    expect(decodeInput(encoded)).toEqual(legacy);
  });

  it("escapes non-ASCII keys as well as values in legacy histories", () => {
    const history = {
      type: "dice-roller",
      log: [{ ...legacy, "é🎲": "£" }],
    };

    const encoded = encodeOutput(history, "legacy", "base64");

    expect(JSON.parse(atob(encoded))).toEqual(history);
    expect(decodeInput(encoded)).toEqual(history);
  });

  it("retains UTF-8 for versioned and concise exports", () => {
    const concise = { notation: current.notation, rolls: [[3]] };

    for (const data of [current, concise]) {
      const encoded = encodeOutput(data, 1, "base64");
      expect(encoded).toBe(
        Buffer.from(JSON.stringify(data), "utf8").toString("base64"),
      );
      expect(decodeInput(encoded)).toEqual(data);
    }
  });

  it("handles text larger than a single encoding chunk", () => {
    const data = { ...current, notation: "🎲é".repeat(30000) };
    expect(decodeInput(encodeOutput(data, 1, "base64"))).toEqual(data);
  });

  it("matches the native v5 Base64 export for ASCII data", () => {
    const roll = new DiceRoll("d6");
    const data = JSON.parse(roll.export() as string) as object;

    // V5 declares the format argument as the entire enum-like object.
    const format = exportFormats.BASE_64 as unknown as Parameters<
      DiceRoll["export"]
    >[0];
    expect(encodeOutput(data, "legacy", "base64")).toBe(roll.export(format));
  });

  it("can be imported by v5 without corrupting accented descriptions", () => {
    const roll = new DiceRoll("d6 [café]");
    const data = JSON.parse(roll.export() as string) as object;
    const imported = DiceRoll.import(encodeOutput(data, "legacy", "base64"));

    expect(imported.export()).toBe(roll.export());
  });

  it("matches the native v6 export and can be imported by v6", () => {
    const roll = Roll.import({
      notation: current.notation,
      rolls: [[3]],
    });
    const data = roll.export();
    const encoded = encodeOutput(data, 1, "base64");

    expect(encoded).toBe(roll.export("base64"));
    expect(Roll.import(encoded).export()).toEqual(data);
  });

  it("reports serialisation failures as conversion errors", () => {
    const circular: { self?: object } = {};
    circular.self = circular;

    expect(() => encodeOutput(circular, 1, "json")).toThrow(
      OutputEncodingError,
    );
    expect(() => encodeOutput({ value: 1n }, 1, "base64")).toThrow(
      OutputEncodingError,
    );
    expect(() => encodeOutput({ toJSON: () => undefined }, 1, "json")).toThrow(
      OutputEncodingError,
    );
  });
});
