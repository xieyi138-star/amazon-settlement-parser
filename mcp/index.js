#!/usr/bin/env node
// Amazon settlement report MCP server.
//
// Exposes the fee-code reference in ../data/fee-codes.json plus a reconciliation
// checker for Flat File V2 settlement reports. Everything runs locally over
// stdio; the server makes no network requests and reads no file other than the
// reference data shipped beside it.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const HERE = dirname(fileURLToPath(import.meta.url));

// Prefer a vendored copy (npm package), fall back to the repository layout.
const DATA_PATH = [join(HERE, 'fee-codes.json'), join(HERE, '..', 'data', 'fee-codes.json')]
  .find((p) => existsSync(p));
if (!DATA_PATH) {
  console.error('fee-codes.json not found next to index.js or in ../data/');
  process.exit(1);
}
const REF = JSON.parse(readFileSync(DATA_PATH, 'utf8'));

const BY_DESC = new Map(REF.entries.map((e) => [e.description.toLowerCase(), e]));
const KNOWN_TYPES = new Set(REF.amount_types_observed_literally);

const OFFICIAL_COLUMNS = [
  'settlement-id', 'settlement-start-date', 'settlement-end-date', 'deposit-date',
  'total-amount', 'currency', 'transaction-type', 'order-id', 'merchant-order-id',
  'adjustment-id', 'shipment-id', 'marketplace-name', 'amount-type', 'amount-description',
  'amount', 'fulfillment-id', 'posted-date', 'posted-date-time', 'order-item-code',
  'merchant-order-item-id', 'merchant-adjustment-item-id', 'sku', 'quantity-purchased',
  'promotion-id',
];
const RESERVE_KEYS = ['Current Reserve Amount', 'Previous Reserve Amount Balance'];

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isNaN(n) ? 0 : n;
};
const asDate = (s) => {
  const t = Date.parse(String(s ?? '').replace(/ UTC$/, 'Z'));
  return Number.isNaN(t) ? null : t;
};
const round2 = (n) => Math.round(n * 100) / 100;
const json = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o, null, 2) }] });

// --- report parsing -------------------------------------------------------
// Mirrors the browser tool's logic: detect the delimiter rather than trusting
// the extension, treat a row with no transaction-type and no amount as a
// summary row, and never drop a value that isn't recognised.
function parseReport(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.length);
  if (!lines.length) throw new Error('The report is empty.');
  const probe = lines.slice(0, 5).join('\n');
  const delimiter = probe.split('\t').length >= probe.split(',').length ? '\t' : ',';
  const header = lines[0].split(delimiter).map((s) => s.trim().replace(/^"|"$/g, ''));
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(delimiter);
    const row = {};
    header.forEach((h, i) => { row[h] = (cells[i] ?? '').trim().replace(/^"|"$/g, ''); });
    return row;
  });
  return {
    rows,
    header,
    delimiter: delimiter === '\t' ? 'tab' : 'comma',
    missing_official_columns: OFFICIAL_COLUMNS.filter((c) => !header.includes(c)),
  };
}

function checkReport(text) {
  const parsed = parseReport(text);
  const isSummary = (r) => !r['transaction-type'] && !r['amount'];
  const summaryRows = parsed.rows.filter(isSummary);
  const dataRows = parsed.rows.filter((r) => !isSummary(r));
  const meta = summaryRows[0] || parsed.rows[0] || {};

  const declared = summaryRows.reduce((a, r) => a + num(r['total-amount']), 0)
    || num(meta['total-amount']);
  const startT = asDate(meta['settlement-start-date']);
  const endT = asDate(meta['settlement-end-date']);

  const byCurrency = {};
  for (const r of dataRows) (byCurrency[r['currency'] || '(blank)'] ??= []).push(r);
  const currencies = Object.keys(byCurrency);

  const warnings = [];

  // --- reconciliation ---
  const reconciliation = currencies.map((cur) => {
    const calculated = round2(byCurrency[cur].reduce((a, r) => a + num(r['amount']), 0));
    const single = currencies.length === 1;
    const difference = single ? round2(calculated - declared) : null;
    if (single && Math.abs(difference) > 0.01) {
      warnings.push({
        severity: 'high',
        code: 'total_mismatch',
        message: `Declared total-amount ${declared.toFixed(2)} does not match the sum of amount rows ${calculated.toFixed(2)} (difference ${difference.toFixed(2)}). Usual causes: reserve rows excluded, the summary row counted as data, or an unrecognised row type.`,
      });
    }
    return {
      currency: cur,
      declared_total_amount: single ? round2(declared) : null,
      sum_of_amount_rows: calculated,
      difference,
      rows: byCurrency[cur].length,
    };
  });

  if (currencies.length > 1) {
    warnings.push({
      severity: 'high',
      code: 'multi_currency',
      message: `This report contains ${currencies.length} currencies (${currencies.join(', ')}). Flat File V2 has a currency column and no exchange-rate column, so totals must stay separated by currency. A cross-currency total cannot be derived from this file.`,
    });
  }

  // --- value inventory, checked against the reference ---
  const seenTypes = {};
  const seenDescs = {};
  const seenTxTypes = {};
  for (const r of dataRows) {
    if (r['amount-type']) seenTypes[r['amount-type']] = (seenTypes[r['amount-type']] || 0) + 1;
    if (r['amount-description']) seenDescs[r['amount-description']] = (seenDescs[r['amount-description']] || 0) + 1;
    if (r['transaction-type']) seenTxTypes[r['transaction-type']] = (seenTxTypes[r['transaction-type']] || 0) + 1;
  }

  const unknownTypes = Object.keys(seenTypes).filter((t) => !KNOWN_TYPES.has(t));
  const unknownDescs = Object.keys(seenDescs).filter((d) => !BY_DESC.has(d.toLowerCase()));
  // The reference is allowed to run ahead of the browser tool's built-in list,
  // so a value can be documented here and still be tagged "unrecognised" there.
  const notInBrowserParser = Object.keys(seenDescs).filter((d) => {
    const e = BY_DESC.get(d.toLowerCase());
    return e && !e.in_parser_known_list;
  });
  const misplaced = [];
  for (const r of dataRows) {
    const entry = BY_DESC.get((r['amount-description'] || '').toLowerCase());
    if (!entry || !entry.amount_types.length || !r['amount-type']) continue;
    if (!entry.amount_types.includes(r['amount-type'])) {
      const key = `${r['amount-description']}|${r['amount-type']}`;
      if (!misplaced.some((m) => m.key === key)) {
        misplaced.push({
          key,
          amount_description: r['amount-description'],
          seen_under: r['amount-type'],
          reference_lists: entry.amount_types,
        });
      }
    }
  }

  if (unknownTypes.length) {
    warnings.push({
      severity: 'medium',
      code: 'unknown_amount_type',
      message: `amount-type values not in the reference: ${unknownTypes.join(', ')}. Amazon publishes no enumeration for this field, so this is expected from time to time. Please report them so the public reference can be extended.`,
    });
  }
  if (unknownDescs.length) {
    warnings.push({
      severity: 'medium',
      code: 'unknown_amount_description',
      message: `amount-description values not in the reference: ${unknownDescs.join(', ')}. Amazon publishes no enumeration for this field. Nothing has been dropped from the totals above.`,
    });
  }
  if (misplaced.length) {
    warnings.push({
      severity: 'low',
      code: 'unexpected_amount_type_pairing',
      message: `${misplaced.length} amount-description value(s) appear under an amount-type the reference does not list for them. The reference is incomplete by construction, so this is information rather than an error.`,
    });
  }

  // --- reserve ---
  const reserveRows = dataRows.filter((r) => RESERVE_KEYS.includes(r['amount-description']));
  const reserve = {};
  for (const r of reserveRows) {
    const k = `${r['amount-description']} (${r['currency'] || 'blank'})`;
    reserve[k] = round2((reserve[k] || 0) + num(r['amount']));
  }
  if (!reserveRows.length) {
    warnings.push({
      severity: 'medium',
      code: 'no_reserve_rows',
      message: 'No Current Reserve Amount or Previous Reserve Amount Balance rows were found. If the deposit does not match, a reserve movement is the most common missing piece.',
    });
  }

  // --- postings outside the settlement period ---
  let outOfPeriod = null;
  if (startT && endT) {
    const oob = dataRows.filter((r) => {
      const p = asDate(r['posted-date'] || r['posted-date-time']);
      return p !== null && (p < startT || p > endT);
    });
    outOfPeriod = {
      rows: oob.length,
      share_percent: dataRows.length ? round2((oob.length / dataRows.length) * 100) : 0,
      total: round2(oob.reduce((a, r) => a + num(r['amount']), 0)),
    };
    if (oob.length) {
      warnings.push({
        severity: 'medium',
        code: 'postings_outside_period',
        message: `${oob.length} row(s) have a posted-date outside the settlement period, totalling ${outOfPeriod.total.toFixed(2)}. This is a definition difference, not corrupt data: aggregate by settlement period, not by posted-date.`,
      });
    }
  }

  // --- per SKU ---
  // quantity-purchased repeats on every row of an order item, so both the item
  // count and the quantity are de-duplicated by order-id + order-item-code.
  const perSku = [];
  for (const cur of currencies) {
    const acc = {};
    for (const r of byCurrency[cur]) {
      const sku = r['sku'];
      if (!sku) continue;
      const a = (acc[sku] ??= { net: 0, rows: 0, items: new Map() });
      a.net += num(r['amount']);
      a.rows += 1;
      const key = `${r['order-id'] || ''}|${r['order-item-code'] || ''}`;
      const isRefund = /refund/i.test(r['transaction-type'] || '');
      const existing = a.items.get(key);
      if (!existing) a.items.set(key, { qty: num(r['quantity-purchased']), refund: isRefund });
      else {
        if (!existing.qty) existing.qty = num(r['quantity-purchased']);
        if (isRefund) existing.refund = true;
      }
    }
    for (const [sku, a] of Object.entries(acc)) {
      let sold = 0, refunded = 0;
      for (const it of a.items.values()) (it.refund ? (refunded += it.qty) : (sold += it.qty));
      perSku.push({
        currency: cur, sku, order_items: a.items.size, sold, refunded,
        rows: a.rows, net: round2(a.net),
      });
    }
  }
  perSku.sort((a, b) => a.net - b.net);

  if (parsed.missing_official_columns.length) {
    warnings.push({
      severity: 'high',
      code: 'missing_columns',
      message: `${parsed.missing_official_columns.length} of the 24 official columns are absent: ${parsed.missing_official_columns.join(', ')}. Results below may be incomplete.`,
    });
  }

  return {
    caveat: 'These figures are Amazon-side net amounts. None of the 24 columns carries cost of goods, freight or advertising spend, so nothing here is profit. One settlement file, one seller account.',
    file: {
      delimiter: parsed.delimiter,
      detail_rows: dataRows.length,
      summary_rows: summaryRows.length,
      missing_official_columns: parsed.missing_official_columns,
    },
    settlement: {
      settlement_id: meta['settlement-id'] || null,
      period_start: meta['settlement-start-date'] || null,
      period_end: meta['settlement-end-date'] || null,
      deposit_date: meta['deposit-date'] || null,
    },
    reconciliation,
    reserve: { rows: reserveRows.length, totals: reserve },
    postings_outside_period: outOfPeriod,
    value_inventory: {
      transaction_type: seenTxTypes,
      amount_type: seenTypes,
      amount_description: seenDescs,
      unknown_amount_types: unknownTypes,
      unknown_amount_descriptions: unknownDescs,
      documented_here_but_flagged_by_the_browser_tool: notInBrowserParser,
      unexpected_pairings: misplaced.map(({ key, ...rest }) => rest),
    },
    per_sku: perSku,
    warnings,
  };
}

// --- server ---------------------------------------------------------------
const server = new McpServer(
  { name: 'amazon-settlement', version: '1.0.0' },
  {
    instructions:
      'Reference and verification for Amazon Flat File V2 settlement reports. Amazon publishes the 24 column names but no permitted values for transaction-type, amount-type or amount-description, so the fee-code data here was collected from real reports and third-party documentation and is incomplete by construction. Use check_settlement_report to reconcile a report and surface the failure modes that do not raise errors on their own.',
  },
);

server.registerTool(
  'lookup_fee_code',
  {
    title: 'Look up a settlement fee code',
    description:
      'Look up one amount-description value (for example Principal, ShippingHB, Current Reserve Amount) and return the amount-type values it has been observed under, where that observation came from, and whether the browser parser recognises it. Matching is case-insensitive.',
    inputSchema: { description: z.string().describe('The amount-description value to look up.') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ description }) => {
    const entry = BY_DESC.get(description.trim().toLowerCase());
    if (!entry) {
      const needle = description.trim().toLowerCase();
      const near = REF.entries
        .map((e) => e.description)
        .filter((d) => d.toLowerCase().includes(needle) || needle.includes(d.toLowerCase()))
        .slice(0, 8);
      return json({
        found: false,
        queried: description,
        note: 'Not in the reference. Amazon publishes no enumeration for this field, so an unlisted value is not necessarily invalid — it may simply not have been collected yet.',
        similar: near,
      });
    }
    return json({
      found: true,
      ...entry,
      note: entry.conflict
        ? 'Sources disagree on which amount-type this belongs under. Both placements are listed; read the amount-type on the same row rather than keying on the description alone.'
        : undefined,
    });
  },
);

server.registerTool(
  'list_fee_codes',
  {
    title: 'List settlement fee codes',
    description:
      'List the collected amount-description values, optionally filtered to one amount-type or to entries whose amount-type placement is disputed between sources.',
    inputSchema: {
      amount_type: z
        .enum(['ItemPrice', 'ItemFees', 'Shipment-Fees', 'other-transaction', 'Promotion'])
        .optional()
        .describe('Restrict the result to one amount-type.'),
      conflicting_only: z
        .boolean()
        .optional()
        .describe('Return only values whose amount-type placement differs between sources.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ amount_type, conflicting_only }) => {
    let list = REF.entries;
    if (amount_type) list = list.filter((e) => e.amount_types.includes(amount_type));
    if (conflicting_only) list = list.filter((e) => e.conflict);
    return json({
      provenance: REF.sources,
      official_position: REF.official_position,
      count: list.length,
      entries: list.map((e) => ({
        description: e.description,
        amount_types: e.amount_types,
        sources: e.sources,
        conflict: e.conflict,
        in_parser_known_list: e.in_parser_known_list,
      })),
    });
  },
);

server.registerTool(
  'check_settlement_report',
  {
    title: 'Check a settlement report',
    description:
      'Parse a Flat File V2 settlement report and reconcile it. Returns the declared total against the sum of rows, reserve movements, postings that fall outside the settlement period, a full value inventory checked against the fee-code reference, and per-SKU net amounts. Reports the failure modes that produce a plausible wrong number rather than an error: an excluded reserve, quantity-purchased summed without de-duplication, and totals added across currencies. Nothing is filtered out — unrecognised values are reported, not dropped. Pass the file contents as text; the report is tab-separated even when the extension is .csv.',
    inputSchema: {
      report_text: z
        .string()
        .describe('The full contents of the settlement report file, including the header row.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ report_text }) => {
    try {
      return json(checkReport(report_text));
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Could not parse the report: ${err.message}` }],
      };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
