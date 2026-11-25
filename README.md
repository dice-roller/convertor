# RPG Dice Roller Convertor

Convert exported [RPG Dice Roller](https://github.com/dice-roller/rpg-dice-roller) data between data schema versions without rolling the dice again.

The convertor currently migrates v5 exports to the version 1 data schema introduced in v6. It also supports re-encoding data within the same schema.

## Installation

```sh
npm install @dice-roller/convertor
```

The package is ESM and supports Node.js 22 and newer. It uses the v6 dice roller for parsing and reconstructing finished rolls.

## Usage

```typescript
import { convert, detectVersion, fromLegacy } from "@dice-roller/convertor";
import { Roll, Roller } from "@dice-roller/rpg-dice-roller";

// legacyData can be an exported object, JSON string or Base64 string.
const version = detectVersion(legacyData); // "legacy"
const data = convert(legacyData, 1);

// Import an individual roll or a history into v6.
if (data.type === "roll") {
  const roll = Roll.import(data);
  console.log(roll.total);
} else {
  const roller = new Roller();
  roller.import(data);
}

// Equivalent when the source is known to be legacy.
const json = fromLegacy(legacyData, 1, { encoding: "json" });
```

### Data versions

The destination is always required. Data versions describe the export schema, **not** the dice roller's package version.

| Version    | Meaning                                                                         |
| ---------- | ------------------------------------------------------------------------------- |
| `"legacy"` | Unversioned v5 export (roll or history).                                        |
| `1`        | Version 1 of the v6 export schema.                                              |
| `"latest"` | Highest numbered schema supported by this convertor release (destination only). |

Use an explicit version for reproducible migrations. Opt in to `"latest"` if you want to use the newest supported schema when upgrading the convertor. Reverse migrations to legacy are not currently supported.

### Discovering conversion capabilities

Applications can build their own conversion controls using the public runtime metadata:

```typescript
import {
  getSupportedVersions,
  getSupportedTargetVersions,
  getSupportedFormats,
  supportedEncodings,
} from "@dice-roller/convertor";

getSupportedVersions(); // ["legacy", 1]
getSupportedTargetVersions("legacy"); // ["legacy", 1]
getSupportedTargetVersions(1); // [1]
getSupportedFormats("latest"); // ["full", "concise"]
supportedEncodings; // ["object", "json", "base64"]
```

Target versions include same-schema re-encoding. Omitting the source returns
all registered schemas; an explicit source restricts the list to reachable
targets. The `"latest"` alias can be used separately as a destination.
Supported formats describe the target schema, not the validity of individual
inputs (for example, histories cannot be converted to concise output).
Unsupported source or target versions throw `UnsupportedVersionError`.

### Options

```typescript
const converted = convert(legacyData, 1, {
  from: "legacy",
  format: "full",
  encoding: "object",
  strict: true,
});
```

| Option      | Default             | Description                                                                                             |
| ----------- | ------------------- | ------------------------------------------------------------------------------------------------------- |
| `from`      | Automatic detection | Explicit source schema; must agree with the detected version. Not available on `fromLegacy()`.          |
| `format`    | `"full"`            | Result structure: `"full"` or `"concise"`.                                                              |
| `encoding`  | `"object"`          | Output representation: `"object"`, `"json"` or `"base64"`.                                              |
| `strict`    | `true`              | Reject recoverable inconsistencies and ambiguous conversions rather than choosing a best-effort result. |
| `onWarning` | None                | Optional callback receiving a warning with `code`, `message` and `path` in best-effort mode.            |

The output type is inferred from the destination, format and encoding. Input encoding is detected independently. Legacy Base64 output uses ASCII-escaped JSON to preserve Unicode while remaining compatible with v5's Latin-1 Base64 decoding; versioned output uses UTF-8.

### Concise output

For an individual roll, you can request the v6 concise import format:

```typescript
const concise = fromLegacy(legacyRollData, 1, { format: "concise" });
const roll = Roll.import(concise);
```

Or convert a full v6 export to concise data:

```typescript
const concise = convert(v6RollData, 1, { format: "concise" });
```

Concise data preserves notation, finished dice, scoring, flags and group order, but does not store historical minimum, maximum or average totals. Those statistics are calculated by v6 on import. Use full output to preserve them. The convertor checks that concise output reconstructs the same result tree and total; exports depending on unavailable caller data or custom dice factories may not be representable. A history cannot be exported in concise format; convert its individual rolls instead.

See the [Dice Roller documentation](https://dice-roller.github.io/documentation/) for the notation and import formats.

### Best-effort conversion

A legacy sorted group may have lost the relationship between stored members and their original positions in the notation. For example, the results `[2]` and `[5]` in `{d6,d8}sa` could belong to either pool.

By default the convertor rejects such ambiguous data. To accept a deterministic compatible assignment and receive warnings:

```typescript
const result = fromLegacy(legacyData, 1, {
  strict: false,
  onWarning(warning) {
    console.warn(warning.code, warning.path, warning.message);
  },
});
```

Best-effort mode also permits reconstructed totals to replace inconsistent stored totals. It cannot invent missing dice, recover unknown flags, or convert data whose structure cannot be matched to its notation.

### Compatibility and limitations

- Standard, percentile and Fudge dice; arithmetic, maths functions, calculated integer quantities and sides, dice modifiers, roll groups and histories are supported.
- Full output retains finished dice values, initial and calculation values, dropped dice, semantic modifier flags, ordering and historical statistics. Legacy rendered output strings are not stored in v6; use its presenters.
- Compound explosions and rerolls retain the finished values recorded by v5; intermediate draws not stored in the legacy export cannot be recovered.
- Legacy parameter expressions coerced to a different value by v5 (for example a fractional quantity or zero defaulting to one) are rejected rather than altering the notation.
- Non-finite legacy totals serialised as `null` can only be recovered when the expression determines the value. Non-finite group member score overrides and unrecoverable statistics are rejected.
- No random dice are drawn during conversion.

## Development

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

The v5 package is installed as a development-only dependency to generate genuine legacy fixtures.

## Licence

[MIT](LICENSE)
