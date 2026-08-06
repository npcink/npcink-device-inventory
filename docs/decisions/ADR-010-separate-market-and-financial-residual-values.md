# ADR-010: Separate market value from financial residual value

## Status

Accepted

## Date

2026-08-06

## Context

The asset model previously stored one `residualValue` value while the admin UI
used it both as a manually assessed second-hand price and as an accounting
residual value. Those concepts can legitimately differ, and using one number
for both made exports, depreciation summaries, and renewal thresholds
ambiguous.

Existing installations, backups, and older admin bundles already depend on the
`residual_value` database column and the `residualValue` REST field. A destructive
rename would make downgrade and mixed-version operation unsafe.

## Decision

- Treat the existing `residual_value` column as the second-hand market value.
- Add `financial_residual_value` as a separate non-negative decimal column.
- Expose the explicit REST fields `secondHandMarketValue` and
  `financialResidualValue`.
- Keep `residualValue` as a deprecated read/write alias of
  `secondHandMarketValue` for compatibility.
- Use `financialResidualValue` for depreciation, residual-rate analysis, and
  renewal thresholds.
- Calculate a suggested financial residual value with straight-line monthly
  depreciation using the global depreciation period and terminal residual
  rate. Assets default to automatic mode when no historical manual value exists.
- Store `metadata.finance.financial_residual_mode` as `auto` or `manual`.
  Automatic mode uses the live calculation for detail views, analysis, and
  exports; manual mode uses the explicitly entered accounting value.
- Export and import the two values as separate columns. Legacy imports named
  `residualValue`, `残值`, or `二手价` are interpreted as second-hand market
  value; they never populate the new accounting value automatically.

## Alternatives Considered

### Rename `residual_value` to `second_hand_market_value`

Rejected because older plugin code and downgrade paths would fail against the
renamed schema.

### Copy the old value into both new meanings

Rejected because it would create false accounting data. Existing values came
from a UI labelled as second-hand price, so the new financial residual value
starts at zero until explicitly entered or imported.

### Keep one field and change labels only

Rejected because labels cannot resolve the underlying semantic conflict.

## Consequences

- Existing second-hand price data remains intact.
- Finance must enter the accounting residual value separately after upgrade.
- The system calculates the current value by default, while finance can switch
  exceptional assets to manual mode for impairment, early retirement, or other
  accounting adjustments.
- Old REST clients continue to operate through the deprecated alias.
- The database keeps a legacy column name whose precise meaning is documented
  here and in `docs/asset-data-model.md`.
