import { Roll } from "@dice-roller/rpg-dice-roller";
import type {
  ConciseDieResult,
  ConciseGroupResult,
  ConciseRollData,
  EncodedRollData,
  RollInputData,
  results,
} from "@dice-roller/rpg-dice-roller";
import { UnsupportedFormatError } from "../errors.js";
import { sameData, matchPermutation } from "./matching.js";

function dieOutcome(die: results.DieResult): ConciseDieResult {
  if (
    !Number.isFinite(die.value) ||
    !Number.isFinite(die.initialValue) ||
    !Number.isFinite(die.calculationValue)
  ) {
    throw new UnsupportedFormatError(
      "Concise output requires finite die values",
    );
  }

  if (
    die.initialValue === die.value &&
    die.calculationValue === die.value &&
    die.useInTotal &&
    die.flags.length === 0
  ) {
    return die.value;
  }

  return {
    value: die.value,
    ...(die.initialValue !== die.value && { initialValue: die.initialValue }),
    ...(die.calculationValue !== die.value && {
      calculationValue: die.calculationValue,
    }),
    ...(!die.useInTotal && { useInTotal: false }),
    ...(die.flags.length > 0 && { flags: die.flags }),
  };
}

function memberScore(
  member: results.GroupMemberResult,
): Partial<results.ScoredItem> {
  const { value, calculationValue, useInTotal, flags } = member;
  const valueChanged = !Object.is(value, member.result.value);
  const scoreChanged = !Object.is(calculationValue, value);
  if (
    (valueChanged && !Number.isFinite(value)) ||
    (scoreChanged && !Number.isFinite(calculationValue))
  ) {
    throw new UnsupportedFormatError(
      "Concise output cannot represent non-finite group score overrides",
    );
  }
  return {
    ...(valueChanged && { value }),
    ...(scoreChanged && { calculationValue }),
    ...(!useInTotal && { useInTotal: false }),
    ...(flags.length > 0 && { flags }),
  };
}

/** Produce concise data in evaluator encounter order and verify it restores
 * the same result tree. Statistics are intentionally not part of this format.
 */
export function toConcise(
  full: EncodedRollData,
  data?: RollInputData,
): ConciseRollData {
  const original = Roll.import(full);
  const rolls: ConciseDieResult[][] = [];
  const groups: Record<number, ConciseGroupResult> = {};
  let groupIndex = 0;

  function visit(result: results.ExpressionResult): void {
    switch (result.type) {
      case "number":
      case "reference":
        return;
      case "binary":
      case "comparison":
        visit(result.left);
        visit(result.right);
        return;
      case "unary":
        visit(result.operand);
        return;
      case "paren":
        visit(result.inner);
        return;
      case "function":
        result.args.forEach(visit);
        return;
      case "conditional":
        visit(result.condition);
        visit(result.selectedResult);
        return;
      case "pool":
        rolls.push(result.rolls.map(dieOutcome));
        visit(result.qty);
        result.dieArgs.forEach(visit);
        result.modifierArguments?.forEach(({ result }) => visit(result));
        return;
      case "group": {
        const index = groupIndex++;
        const order = matchPermutation(
          result.node.expressions.map((expression) =>
            result.members.map((member) =>
              sameData(expression, member.result.node),
            ),
          ),
        );
        if (!order || order.length !== result.members.length) {
          throw new UnsupportedFormatError(
            "Cannot match v1 group members to their notation",
          );
        }
        const scores: Record<number, Partial<results.ScoredItem>> = {};
        for (const [source, stored] of order.entries()) {
          const member = result.members[stored];
          if (!member)
            throw new UnsupportedFormatError("Missing v1 group member");
          const score = memberScore(member);
          if (Object.keys(score).length) scores[source] = score;
          visit(member.result);
        }
        const reordered = order.some((stored, source) => stored !== source);
        if (reordered || Object.keys(scores).length) {
          groups[index] = {
            ...(reordered && {
              order: result.members.map((_, stored) => order.indexOf(stored)),
            }),
            ...(Object.keys(scores).length > 0 && { members: scores }),
          };
        }
        result.modifierArguments?.forEach(({ result }) => visit(result));
        return;
      }
    }
  }

  visit(original.result);
  const concise: ConciseRollData = {
    notation: full.notation,
    rolls,
    ...(Object.keys(groups).length > 0 && { groups }),
  };

  let reconstructed: Roll;
  try {
    reconstructed = Roll.import(concise, { data });
  } catch (cause) {
    throw new UnsupportedFormatError(
      "The full roll cannot be reconstructed from concise data",
      { cause },
    );
  }

  if (
    !sameData(original.result, reconstructed.result) ||
    !Object.is(original.total, reconstructed.total)
  ) {
    throw new UnsupportedFormatError(
      "Concise output would change the stored result or total",
    );
  }
  return concise;
}
