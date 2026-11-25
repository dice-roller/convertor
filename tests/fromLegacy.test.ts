import { Roll } from "@dice-roller/rpg-dice-roller";
import type {
  ConciseRollData,
  EncodedExportData,
} from "@dice-roller/rpg-dice-roller";
import { DiceRoll } from "rpg-dice-roller-v5";
import {
  convert,
  fromLegacy,
  ConversionPathError,
  UnsupportedVersionError,
  VersionDetectionError,
} from "../src/index.js";
import type { FromOptions, LegacyExportData } from "../src/index.js";

const json = new DiceRoll("2d6 [café]").export() as string;
const legacy = JSON.parse(json) as object;

describe("fromLegacy", () => {
  it("matches generic conversion with an explicit legacy source", () => {
    const result: LegacyExportData = fromLegacy(legacy, "legacy");
    expect(result).toEqual(convert(legacy, "legacy", { from: "legacy" }));
  });

  it("accepts all input encodings and forwards output options", () => {
    for (const input of [legacy, json, btoa(json)]) {
      const result: string = fromLegacy(input, "legacy", {
        encoding: "base64",
      });

      expect(result).toBe(
        convert(input, "legacy", { from: "legacy", encoding: "base64" }),
      );
      expect(JSON.parse(atob(result))).toEqual(legacy);
    }
  });

  it("rejects non-legacy input rather than detecting a different source", () => {
    const current = Roll.import({ notation: "d6", rolls: [[3]] }).export();
    expect(() => fromLegacy(current, 1)).toThrow(VersionDetectionError);
  });

  it("fixes the source even when an untyped caller supplies from", () => {
    const options = Object.freeze({ from: 1 }) as unknown as FromOptions;
    expect(fromLegacy(legacy, "legacy", options)).toEqual(legacy);

    const current = Roll.import({ notation: "d6", rolls: [[3]] }).export();
    expect(() => fromLegacy(current, 1, options)).toThrow(
      VersionDetectionError,
    );
  });

  it("accepts latest but does not invent an unregistered migration", () => {
    expect(() => fromLegacy(legacy, 1)).toThrow(ConversionPathError);
    expect(() => fromLegacy(legacy, "latest")).toThrow(ConversionPathError);
  });

  it("rejects unsupported target versions", () => {
    expect(() => fromLegacy(legacy, 42)).toThrow(UnsupportedVersionError);
  });
});

// Compile-time contracts are checked by tsc but never execute.
function checkTypes(data: object): void {
  const full: EncodedExportData = fromLegacy(data, 1);
  const latest: EncodedExportData = fromLegacy(data, "latest");
  const concise: ConciseRollData = fromLegacy(data, 1, { format: "concise" });
  const encoded: string = fromLegacy(data, 1, { encoding: "json" });
  const encodedConcise: string = fromLegacy(data, "latest", {
    format: "concise",
    encoding: "base64",
  });
  // @ts-expect-error destination is required
  fromLegacy(data);
  // @ts-expect-error source cannot be overridden
  fromLegacy(data, 1, { from: "legacy" });
  const options = { from: "legacy" } as const;
  // @ts-expect-error source cannot be overridden via a variable either
  fromLegacy(data, 1, options);
  void [full, latest, concise, encoded, encodedConcise];
}
void checkTypes;
