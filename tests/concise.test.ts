import { Roll, Roller } from "@dice-roller/rpg-dice-roller";
import type { ConciseRollData } from "@dice-roller/rpg-dice-roller";
import { DiceRoll, DiceRoller } from "rpg-dice-roller-v5";
import { convert, fromLegacy, UnsupportedFormatError } from "../src/index.js";

describe("concise output", () => {
  it("uses numbers for ordinary dice and only necessary overrides for modified dice", () => {
    const original = Roll.import({
      notation: "3d6kh2",
      rolls: [
        [
          6,
          { value: 5, initialValue: 2, flags: ["re-roll"] },
          { value: 1, useInTotal: false, flags: ["drop"] },
        ],
      ],
    });
    const concise = convert(original.export(), 1, { format: "concise" });
    expect(concise).toEqual({
      notation: "3d6kh2",
      rolls: [
        [
          6,
          { value: 5, initialValue: 2, flags: ["re-roll"] },
          { value: 1, useInTotal: false, flags: ["drop"] },
        ],
      ],
    });
    expect(Roll.import(concise).result).toEqual(original.result);
  });

  it.each<ConciseRollData>([
    { notation: "2d6+max(d8,d10)", rolls: [[2, 4], [5], [8]] },
    { notation: "d(d6)", rolls: [[3], [6]] },
    { notation: "(d2)d6", rolls: [[2, 5], [2]] },
    { notation: "4d6kh(d2)", rolls: [[1, 2, 3, 4], [2]] },
    { notation: "(d6>=4)?(d8):(d10)", rolls: [[5], [8]] },
    { notation: "(d6>=4)?(d8):(d10)", rolls: [[2], [9]] },
    { notation: "(d6)?:(d8)", rolls: [[4]] },
    {
      notation: "{d6,d8}kh1sd",
      rolls: [[3], [7]],
      groups: {
        0: {
          order: [1, 0],
          members: { 0: { useInTotal: false, flags: ["drop"] } },
        },
      },
    },
    {
      notation: "{d6,{d8,d10}sa}sd",
      rolls: [[3], [7], [4]],
      groups: { 0: { order: [1, 0] }, 1: { order: [1, 0] } },
    },
    {
      notation: "{d6,d6}sa",
      rolls: [[5], [2]],
      groups: { 0: { order: [1, 0] } },
    },
    {
      notation: "{d6,d8}>=4",
      rolls: [[3], [7]],
      groups: {
        0: {
          members: {
            0: { calculationValue: 0 },
            1: { calculationValue: 1, flags: ["target-success"] },
          },
        },
      },
    },
    { notation: "1/0", rolls: [] },
  ])("round-trips $notation", (fixture) => {
    const original = Roll.import(fixture);
    const output = convert(original.export(), "latest", { format: "concise" });
    expect(Roll.import(output).result).toEqual(original.result);
    expect(Roll.import(output).total).toBe(original.total);
  });

  it("converts genuine legacy exports directly to concise output in every encoding", () => {
    const json = new DiceRoll("{4d6+2d8}kh3").export() as string;
    const full = fromLegacy(json, 1);
    if (full.type !== "roll") throw new Error("Expected roll");
    const concise = fromLegacy(json, 1, { format: "concise" });
    expect(Roll.import(concise).result).toEqual(Roll.import(full).result);
    expect(
      JSON.parse(fromLegacy(json, 1, { format: "concise", encoding: "json" })),
    ).toEqual(concise);
    expect(
      Roll.import(
        fromLegacy(json, 1, { format: "concise", encoding: "base64" }),
      ).result,
    ).toEqual(Roll.import(full).result);
  });

  it("rejects history output rather than returning an undocumented array", () => {
    const v5 = new DiceRoller();
    v5.roll("d6", "d8");
    const v6 = new Roller();
    v6.import({ notation: "d6", rolls: [[3]] });
    expect(() =>
      fromLegacy(v5.export() as string, 1, { format: "concise" }),
    ).toThrow(UnsupportedFormatError);
    expect(() => convert(v6.export(), 1, { format: "concise" })).toThrow(
      UnsupportedFormatError,
    );
  });

  it("rejects a stored total which cannot survive concise reconstruction", () => {
    const full = Roll.import({ notation: "d6", rolls: [[3]] }).export();
    expect(() =>
      convert({ ...full, total: 999 }, 1, { format: "concise" }),
    ).toThrow(/stored result or total/);
  });

  it("rejects caller-data-dependent expressions which cannot be restored without data", () => {
    const full = new Roll("$data.bonus + d6", {
      data: { data: { bonus: 4 } },
    }).export();
    expect(() => convert(full, 1, { format: "concise" })).toThrow(
      UnsupportedFormatError,
    );
  });

  it("round-trips variable-dependent rolls using the original bindings", () => {
    const data = { bonus: 3 };
    const original = new Roll("d20+$bonus", { data });
    const full = original.export();
    const concise = convert(full, 1, { format: "concise", data });

    expect(concise).not.toHaveProperty("data");
    expect(Roll.import(concise, { data }).result).toEqual(original.result);
    expect(convert(concise, 1, { data })).toEqual(full);
    expect(convert(concise, 1, { format: "concise", data })).toEqual(concise);
    expect(() =>
      convert(full, 1, { format: "concise", data: { bonus: 4 } }),
    ).toThrow(/stored result or total/);
  });

  it("does not require historical statistics to survive concise output", () => {
    const source = new DiceRoll("d6^2").export() as string;
    const full = fromLegacy(source, 1);
    const concise = fromLegacy(source, 1, { format: "concise" });
    expect(Roll.import(concise).total).toBe(full.total);
    if (full.type !== "roll") throw new Error("Expected roll");
    expect(full.averageTotal).toBe(18.5);
  });
});
