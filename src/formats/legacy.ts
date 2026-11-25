/** Legacy JSON numbers; non-finite values were serialised as null. */
export type LegacyNumber = number | null;

/** A finished die from a legacy RollResult export. */
export interface LegacyDieResult {
  readonly type: "result";
  readonly initialValue: LegacyNumber;
  readonly value: LegacyNumber;
  readonly calculationValue: LegacyNumber;
  readonly useInTotal: boolean;
  readonly modifiers: readonly string[];
  readonly modifierFlags: string;
}

/** A dice pool from a legacy RollResults export. */
export interface LegacyRollResults {
  readonly type: "roll-results";
  readonly rolls: readonly LegacyDieResult[];
  readonly value: LegacyNumber;
}

/** A token or nested result in the legacy evaluated expression. */
export type LegacyExpressionItem = LegacyNumber | string | LegacyNestedResult;

type LegacyNestedResult = LegacyRollResults | LegacyResultGroup;

/** A legacy ResultGroup, either a roll group or an expression wrapper. */
export interface LegacyResultGroup {
  readonly type: "result-group";
  readonly results: readonly LegacyExpressionItem[];
  readonly isRollGroup: boolean;
  readonly value: LegacyNumber;
  readonly calculationValue: LegacyNumber;
  readonly useInTotal: boolean;
  readonly modifiers: readonly string[];
  readonly modifierFlags: string;
}

/** An individual, unversioned DiceRoll export. */
export interface LegacyRollData {
  readonly type: "dice-roll";
  readonly notation: string;
  readonly rolls: readonly LegacyExpressionItem[];
  readonly output: string;
  readonly total: LegacyNumber;
  readonly minTotal: LegacyNumber;
  readonly maxTotal: LegacyNumber;
  readonly averageTotal: LegacyNumber;
}

/** An unversioned DiceRoller export containing an ordered roll history. */
export interface LegacyHistoryData {
  readonly type: "dice-roller";
  readonly log: readonly LegacyRollData[];
  readonly output: string;
  readonly total: LegacyNumber;
}

/** The complete legacy export structures, rather than partial import payloads. */
export type LegacyExportData = LegacyRollData | LegacyHistoryData;
