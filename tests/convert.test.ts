import { Roll, Roller } from "@dice-roller/rpg-dice-roller";
import { DiceRoll, DiceRoller } from "rpg-dice-roller-v5";
import { convertWithRegistry } from "../src/convert.js";
import { ConversionRegistry } from "../src/conversions/registry.js";
import type { RegisteredStep } from "../src/conversions/registry.js";
import {
  convert,
  ConversionError,
  ConversionPathError,
  InvalidInputError,
  UnsupportedFormatError,
  UnsupportedVersionError,
  VersionDetectionError,
} from "../src/index.js";
import type {
  ConversionStep,
  LegacyExportData,
  SupportedDataVersion,
} from "../src/index.js";

const concise = { notation: "2d6 [café 🎲]", rolls: [[2, 5]] };
const current = Roll.import(concise).export();
const legacy = JSON.parse(new DiceRoll("2d6").export() as string) as object;

describe("convert", () => {
  it("validates and copies a legacy export without rerolling", () => {
    const result: LegacyExportData = convert(legacy, "legacy");
    expect(result).toEqual(legacy);
    expect(result).not.toBe(legacy);
  });

  it("preserves a genuine legacy history", () => {
    const roller = new DiceRoller();
    roller.roll("d6", "2d8");
    const json = roller.export() as string;
    expect(convert(json, "legacy", { encoding: "json" })).toBe(json);
  });

  it("re-encodes a full v1 roll using the selected output representation", () => {
    expect(convert(current, 1)).toEqual(current);
    const json: string = convert(current, 1, { encoding: "json" });
    expect(JSON.parse(json)).toEqual(current);
    const base64: string = convert(json, "latest", { encoding: "base64" });
    expect(Roll.import(base64).export()).toEqual(current);
  });

  it("expands concise input to full without drawing new dice", () => {
    const result = convert(concise, 1);
    expect(result).toEqual(current);
    expect(result.total).toBe(7);
    expect(convert(concise, "latest", { format: "concise" })).toEqual(concise);
  });

  it("preserves stored totals including non-finite number tags", () => {
    const data = Roll.import({ notation: "1/0", rolls: [] }).export();
    expect(convert(data, 1)).toEqual(data);
  });

  it("preserves the stored total of a full history", () => {
    const roller = new Roller();
    roller.import(current);
    const history = { ...roller.export(), total: 1234 };

    expect(convert(history, 1)).toEqual(history);
  });

  it("accepts an explicit matching source version", () => {
    expect(convert(current, 1, { from: 1 })).toEqual(current);
    expect(convert(legacy, "legacy", { from: "legacy" })).toEqual(legacy);
  });

  it("rejects a conflicting explicit source version", () => {
    expect(() => convert(current, 1, { from: "legacy" })).toThrow(
      VersionDetectionError,
    );
  });

  it("rejects unknown source or target versions", () => {
    expect(() => convert({ type: "roll", version: 2 }, 1)).toThrow(
      UnsupportedVersionError,
    );
    expect(() => convert(current, 42)).toThrow(UnsupportedVersionError);
  });

  it("rejects missing migration paths", () => {
    expect(() => convert(current, "legacy")).toThrow(ConversionPathError);
  });

  it("rejects malformed input even for an identity conversion", () => {
    expect(() => convert({ type: "dice-roll" }, "legacy")).toThrow(
      InvalidInputError,
    );
    expect(() => convert({ type: "roll", version: 1 }, 1)).toThrow(
      InvalidInputError,
    );
    expect(() => convert({ notation: "d6", rolls: [] }, 1)).toThrow(
      InvalidInputError,
    );
  });

  it("rejects unsupported output formats explicitly", () => {
    expect(() => convert(legacy, "legacy", { format: "concise" })).toThrow(
      UnsupportedFormatError,
    );
    const roller = new Roller();
    roller.import(current);
    expect(() => convert(roller.export(), 1, { format: "concise" })).toThrow(
      UnsupportedFormatError,
    );
  });

  it("does not accept latest as a source version", () => {
    const from = "latest" as unknown as 1;
    expect(() => convert(current, 1, { from })).toThrow(VersionDetectionError);
  });
});

describe("migration execution", () => {
  function registryFor(step: ConversionStep<"legacy", 1>) {
    return new ConversionRegistry<SupportedDataVersion, RegisteredStep>(
      ["legacy", 1],
      [step],
    );
  }

  it("executes a registered migration before encoding", () => {
    const step: ConversionStep<"legacy", 1> = {
      from: "legacy",
      to: 1,
      convert(data, context) {
        expect(data).toEqual(legacy);
        expect(data).not.toBe(legacy);
        expect(context.strict).toBe(true);
        return current;
      },
    };

    const result = convertWithRegistry(
      legacy,
      "latest",
      { encoding: "json" },
      registryFor(step),
    );
    expect(result).toBe(JSON.stringify(current));
  });

  it("rejects warnings by default and delivers them in best-effort mode", () => {
    const warning = {
      code: "ambiguous",
      path: "data.rolls",
      message: "Ambiguous",
    };
    const step: ConversionStep<"legacy", 1> = {
      from: "legacy",
      to: 1,
      convert(_data, context) {
        context.warn(warning);
        return current;
      },
    };
    const registry = registryFor(step);

    expect(() => convertWithRegistry(legacy, 1, {}, registry)).toThrow(
      ConversionError,
    );

    const warnings: unknown[] = [];
    expect(
      convertWithRegistry(
        legacy,
        1,
        { strict: false, onWarning: (entry) => warnings.push(entry) },
        registry,
      ),
    ).toEqual(current);
    expect(warnings).toEqual([warning]);
  });
});
