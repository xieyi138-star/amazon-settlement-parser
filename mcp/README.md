# amazon-settlement MCP server

Exposes this repository's fee-code reference and a settlement-report reconciliation checker to any MCP client (Claude Code, Claude Desktop, or your own agent).

It reads [`../data/fee-codes.json`](../data/fee-codes.json) — the same file the README tables are generated from — and makes no network requests.

## Install

```sh
cd mcp
npm install
```

Node 18 or newer.

## Use it from Claude Code

The repository ships a project-scoped [`.mcp.json`](../.mcp.json), so opening this directory in Claude Code offers the server automatically. Approve it once when prompted.

To register it globally instead, from any directory:

```sh
claude mcp add amazon-settlement -- node /absolute/path/to/amazon-settlement-parser/mcp/index.js
```

## Use it from Claude Desktop

Add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "amazon-settlement": {
      "command": "node",
      "args": ["/absolute/path/to/amazon-settlement-parser/mcp/index.js"]
    }
  }
}
```

## Tools

### `lookup_fee_code`

One `amount-description` value in, its observed `amount-type` placements out — with provenance, and a note when sources disagree. Matching is case-insensitive. A value that isn't listed gets near-matches and a reminder that an unlisted value isn't necessarily invalid: Amazon publishes no enumeration for this field.

### `list_fee_codes`

The collected values, optionally filtered to one `amount-type`, or to `conflicting_only: true` for the six values whose placement differs between sources.

### `check_settlement_report`

The reason this server exists. Give it the text of a Flat File V2 report and it returns:

| | |
|---|---|
| `reconciliation` | Declared `total-amount` against the sum of `amount` rows, per currency, with the difference |
| `reserve` | `Current Reserve Amount` / `Previous Reserve Amount Balance` totals — the most commonly missed item |
| `postings_outside_period` | Rows whose `posted-date` falls outside the settlement window |
| `value_inventory` | Every `transaction-type`, `amount-type` and `amount-description` in the file, with the ones absent from the reference called out |
| `per_sku` | Net per SKU, with order items and quantity de-duplicated by `order-id` + `order-item-code` |
| `warnings` | The findings, each with a severity and an explanation of what causes it |

It targets the failure modes that don't raise an error and so pass review: a reserve left out of the total, `quantity-purchased` summed without de-duplication (which multiplies quantity by row count), and figures added across currencies when the file carries no exchange rate.

Nothing is filtered. A value the reference has never seen is reported, not dropped.

## Two lists, deliberately

`value_inventory` separates two cases:

- **`unknown_amount_descriptions`** — absent from the reference entirely. Genuinely new; please send it over.
- **`documented_here_but_flagged_by_the_browser_tool`** — in the reference, but not in the `KNOWN` array inside `index.html`, so the browser tool tags it *unrecognised* while this server does not.

The second list is why the two artifacts can disagree on the same file. The reference is allowed to run ahead of the shipped parser; surfacing the gap is better than hiding it.

## Limits

Same as the browser tool, and worth repeating because a machine-readable answer invites more trust than it should:

- **Amazon-side net, not profit.** None of the 24 columns carries cost of goods, freight or advertising spend.
- **One file, one account, one period.** No merging.
- **Currencies are never summed.** Flat File V2 has no exchange-rate column.
- **Refund detection is a heuristic** — `transaction-type` containing `refund` — because Amazon publishes no enumeration for that field.
- **The reference is incomplete by construction.** It was collected from real reports and third-party documentation, not from a published specification, because no published specification exists.

## Contributing fee codes

If a report contains a value the reference doesn't have, send it to <support@nexusaistart.com>. That is what keeps this useful.
