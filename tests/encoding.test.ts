import { decodeInput } from "../src/encoding.js";
import { InvalidInputError } from "../src/errors.js";

function utf8Base64(text: string): string {
  return btoa(
    Array.from(new TextEncoder().encode(text), (byte) =>
      String.fromCharCode(byte),
    ).join(""),
  );
}

describe("decodeInput", () => {
  const legacy = {
    type: "dice-roll",
    notation: "d6 [café, Ã©]",
    rolls: [],
  };
  const current = {
    type: "roll",
    version: 1,
    notation: "d6 [café, 日本語, 🎲]",
    total: { $number: "Infinity" },
  };

  it("leaves object inputs and number tags untouched", () => {
    const input = Object.freeze(current);
    expect(decodeInput(input)).toBe(input);
    expect(input.total).toEqual({ $number: "Infinity" });
  });

  it("decodes JSON with surrounding whitespace", () => {
    expect(decodeInput(` \n${JSON.stringify(current)} \n`)).toEqual(current);
  });

  it("preserves the original Latin-1 characters of legacy Base64", () => {
    expect(decodeInput(btoa(JSON.stringify(legacy)))).toEqual(legacy);
  });

  it("decodes legacy histories using the same encoding", () => {
    const history = { type: "dice-roller", log: [legacy] };
    expect(decodeInput(btoa(JSON.stringify(history)))).toEqual(history);
  });

  it("decodes UTF-8 Base64 and preserves tagged numbers", () => {
    expect(decodeInput(utf8Base64(JSON.stringify(current)))).toEqual(current);
  });

  it("decodes UTF-8 concise data", () => {
    const concise = { notation: "d6 [🎲]", rolls: [[3]] };
    expect(decodeInput(utf8Base64(JSON.stringify(concise)))).toEqual(concise);
  });

  it("rejects invalid UTF-8 in current exports", () => {
    expect(() =>
      decodeInput(btoa(JSON.stringify({ ...current, notation: "é" }))),
    ).toThrow(InvalidInputError);
  });

  it.each([
    "",
    " ",
    "{broken",
    "not-base64!",
    "e30",
    "e31=",
    "[]",
    btoa("[]"),
    btoa("null"),
    null,
    [],
    42,
    undefined,
  ])("rejects invalid input: %p", (input) => {
    expect(() => decodeInput(input)).toThrow(InvalidInputError);
  });
});
