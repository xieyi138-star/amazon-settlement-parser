# Amazon Settlement Report Parser

Drop an Amazon **Flat File V2** settlement report onto the page and see how the payout was actually built: fee composition, reserve amounts, postings that fall outside the settlement period, and net per SKU. One HTML file, no build step, no server, no upload.

English: [`index.html`](index.html) · 中文: [`zh/index.html`](zh/index.html) · [跳到中文说明](#中文说明)

---

## Your file never leaves your browser

The report is read with `FileReader` and parsed by JavaScript inlined in the page. There is no upload endpoint, no analytics, no CDN script, no external font. Both HTML files contain **zero subresource references** — no `<script src>`, no `<link rel="stylesheet">`, no `<img>`, no `fetch`, no `XMLHttpRequest`, no `sendBeacon`, no WebSocket.

**Check it yourself. Two ways, neither requires trusting this README:**

1. **Watch the network.** Open the page → DevTools (<kbd>F12</kbd>) → **Network** tab → clear the log → drag your settlement report in and let it render. The request count stays at **0**. Nothing leaves the machine.
2. **Cut the network.** Go offline (unplug, or airplane mode), open `index.html` from disk, and use it normally. It behaves identically, because there is nothing for it to reach.

The only outbound URLs in the pages are the language switcher, the `<link rel="canonical">` / `hreflang` tags, and `mailto:` addresses. All of them require you to click; none is fetched.

## Usage

| | How |
|---|---|
| **Offline** | Download [`index.html`](index.html) (or [`zh/index.html`](zh/index.html)) and double-click it. That one file is the entire tool. |
| **GitHub Pages** | <https://xieyi138-star.github.io/amazon-settlement-parser/> · 中文 <https://xieyi138-star.github.io/amazon-settlement-parser/zh/> |
| **Canonical version** | <https://nexusaistart.com/tools/amazon-settlement-parser/> — the maintained original. This repository is a mirror, which is why the `canonical` tags here point back to that domain. |

Where the report comes from: Seller Central → **Payments** → **All Statements** → **Download Flat File V2**. The contents are tab-separated even though the extension is usually `.txt` or `.csv`, so detect the delimiter rather than trusting the extension.

## Sample file

[`sample/settlement-sample.txt`](sample/settlement-sample.txt) is **synthetic data, written for testing.** It contains no real seller, order, buyer, SKU or payout — every identifier and every amount in it is invented. Do not cite any number in it as a real Amazon figure.

Loading it should produce: declared total `582.89`, sum of rows `582.89`, difference `0.00`, and exactly two unrecognised values (`Subscription Fee` and `LowInventoryLevelFee`).

## MCP server

[`mcp/`](mcp/) exposes the fee-code reference and a reconciliation checker to Claude Code, Claude Desktop, or any other MCP client — so an agent working on a settlement report can verify values instead of guessing at them.

```sh
claude mcp add amazon-settlement -- npx -y amazon-settlement-mcp
```

Three tools: `lookup_fee_code`, `list_fee_codes`, and `check_settlement_report` — which reconciles a report and reports the failure modes that produce a plausible wrong number rather than an error. Setup and full tool documentation: [`mcp/README.md`](mcp/README.md).

Same data file, same limits, no network requests.

## Amazon settlement report field reference

> Column names come from Amazon's SP-API documentation. **The value enumerations do not — Amazon does not publish permitted values for `transaction-type`, `amount-type` or `amount-description`.** Everything below in those three fields was collected from third-party documentation and from real settlement reports. It is therefore incomplete by construction. If your report contains a value that is missing here, send it to <support@nexusaistart.com> and it gets added — that is the whole point of publishing this table.

### Report type

| Item | Value |
|---|---|
| Current report type | `GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2` (Seller Central sellers) |
| Deprecated | `GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE`, `GET_V2_SETTLEMENT_REPORT_DATA_XML` |
| Delimiter | Tab |
| How it is produced | Generated automatically on Amazon's schedule — **it cannot be requested on demand** |
| Where to download | Seller Central → Payments → All Statements → Download Flat File V2 |
| Retention | Roughly the last 90 days, about six settlement periods |

### The 24 columns, in order

`settlement-id` · `settlement-start-date` · `settlement-end-date` · `deposit-date` · `total-amount` · `currency` · `transaction-type` · `order-id` · `merchant-order-id` · `adjustment-id` · `shipment-id` · `marketplace-name` · `amount-type` · `amount-description` · `amount` · `fulfillment-id` · `posted-date` · `posted-date-time` · `order-item-code` · `merchant-order-item-id` · `merchant-adjustment-item-id` · `sku` · `quantity-purchased` · `promotion-id`

Amazon's documentation lists these names but gives **no data types and no nullability** for any of them.

The first row of a real file is a summary row carrying only `settlement-id`, the two period dates, `deposit-date`, `total-amount` and `currency`. Read as a data row, it double-counts the total.

### `transaction-type`

**No official enumeration exists.** The `Order / Refund / Transfer / Liquidations` list that circulates online has no citable Amazon source, so the parser classifies nothing here and prints every value it encounters.

The bundled synthetic sample uses `Order`, `Refund`, `ServiceFee`, `Shipment`, `Adjustment`, `Transfer` — illustrative, **not** an enumeration.

Refund detection in the parser is a heuristic: `transaction-type` containing `refund`, case-insensitive. Cross-check it against the value inventory the tool prints for your own file.

One further value worth knowing about: **`Order_Retrocharge`**. A seller reported it in issue #2345 on Amazon's own `amzn/selling-partner-api-models` repository, while trying to locate the XML format's `Retrocharge` node inside Flat File V2. Amazon never answered; the thread was closed by a bot for inactivity, and the original reporter could not find the value in his own file. Treat it as unconfirmed — and as a fair illustration of how these fields are documented.

Amazon's own V1 → V2 migration table also states that the old `transaction-type` maps to "**transaction-type or amount-description**", and that "disjointed amounts may be consolidated". A parser reading only the `transaction-type` column will therefore miss rows, silently.

### `amount-type` → `amount-description`

**64 observed values.** Machine-readable source of truth: [`data/fee-codes.json`](data/fee-codes.json) — that file is canonical, this table is generated from it.

Source column: **●●** = seen in real reports *and* in third-party documentation · **●** = seen in real reports only · **○** = third-party documentation only, not yet confirmed against a real file.

**Known** = whether the value is in the parser's built-in `KNOWN` list. Anything not in that list is still shown in full and tagged *unrecognised* — the parser never drops a row it does not know.

**`ItemPrice`** (8 values)

| amount-description | Src | Known | Notes |
|---|:--:|:--:|---|
| `GiftWrap` | ●● | yes |  |
| `GiftWrapTax` | ○ | **no** |  |
| `Goodwill` | ●● | yes | also seen under `ItemFees` |
| `Principal` | ●● | yes |  |
| `RestockingFee` | ●● | yes | also seen under `ItemFees` |
| `Shipping` | ●● | yes | also seen under `Shipment-Fees` `Promotion` |
| `ShippingTax` | ●● | yes |  |
| `Tax` | ●● | yes | also seen under `other-transaction` |

**`ItemFees`** (16 values)

| amount-description | Src | Known | Notes |
|---|:--:|:--:|---|
| `Commission` | ●● | yes |  |
| `DigitalServicesFee` | ● | yes |  |
| `FBAPerOrderFulfillmentFee` | ●● | yes | also seen under `Shipment-Fees` |
| `FBAPerUnitFulfillmentFee` | ●● | yes |  |
| `FBAWeightBasedFee` | ●● | yes |  |
| `GiftwrapChargeback` | ●● | yes |  |
| `Goodwill` | ●● | yes | also seen under `ItemPrice` |
| `MarketplaceFacilitatorVAT-Principal` | ● | yes |  |
| `MarketplaceFacilitatorVAT-Shipping` | ● | yes |  |
| `RefundCommission` | ●● | yes |  |
| `RestockingFee` | ●● | yes | also seen under `ItemPrice` |
| `ReturnShipping` | ○ | **no** |  |
| `SalesTaxServiceFee` | ○ | **no** |  |
| `ShippingChargeback` | ●● | yes |  |
| `ShippingHB` | ●● | yes | also seen under `other-transaction` |
| `VariableClosingFee` | ●● | yes |  |

**`Shipment-Fees`** (4 values)

| amount-description | Src | Known | Notes |
|---|:--:|:--:|---|
| `FBAPerOrderFulfillmentFee` | ●● | yes | also seen under `ItemFees` |
| `FBATransportationFee` | ●● | yes |  |
| `Multi-Channel Fulfillment Brand-Neutral Box Fee` | ○ | **no** |  |
| `Shipping` | ●● | yes | also seen under `ItemPrice` `Promotion` |

**`other-transaction`** (40 values)

| amount-description | Src | Known | Notes |
|---|:--:|:--:|---|
| `Additional Other Expenses` | ○ | **no** |  |
| `Adjustment` | ○ | **no** |  |
| `Amazon Capital Services` | ○ | **no** |  |
| `BalanceAdjustment` | ○ | **no** |  |
| `CS_ERROR_ITEMS` | ○ | **no** |  |
| `Current Reserve Amount` | ●● | yes |  |
| `DisposalComplete` | ●● | yes |  |
| `Failed Disbursement` | ○ | **no** |  |
| `FBA Inventory Reimbursement - Customer Return` | ○ | **no** |  |
| `FBACustomerReturnPerOrderFee` | ○ | **no** |  |
| `FBACustomerReturnPerUnitFee` | ○ | **no** |  |
| `FBACustomerReturnWeightBasedFee` | ○ | **no** |  |
| `FBAInboundTransportationFee` | ○ | **no** |  |
| `INCORRECT_FEES_ITEMS` | ○ | **no** |  |
| `INCORRECT_FEES_NON_ITEMIZED` | ○ | **no** |  |
| `LightningDealFee Special` | ○ | **no** |  |
| `Manual Processing Fee` | ○ | **no** |  |
| `Manual Processing Fee Reimbursement` | ○ | **no** |  |
| `MISSING_FROM_INBOUND` | ○ | **no** |  |
| `MULTICHANNEL_ORDER_DAMAGED` | ○ | **no** |  |
| `MULTICHANNEL_ORDER_LATE` | ○ | **no** |  |
| `MULTICHANNEL_ORDER_LOST` | ○ | **no** |  |
| `NonSubscriptionFeeAdj` | ○ | **no** |  |
| `Previous Reserve Amount Balance` | ●● | yes |  |
| `Refund Reimbursal` | ●● | yes |  |
| `REMOVAL_ORDER_DAMAGED` | ○ | **no** |  |
| `RemovalComplete` | ○ | **no** |  |
| `REVERSAL_REIMBURSEMENT` | ○ | **no** |  |
| `Shipping label purchase` | ○ | **no** |  |
| `ShippingHB` | ●● | yes | also seen under `ItemFees` |
| `ShippingServices` | ○ | **no** |  |
| `ShippingServicesRefund` | ○ | **no** |  |
| `Storage Fee` | ●● | yes |  |
| `StorageRenewalBilling` | ●● | yes |  |
| `Subscription Fee` | ●● | **no** |  |
| `Tax` | ●● | yes | also seen under `ItemPrice` |
| `TransactionTotalAmount` | ○ | **no** |  |
| `WAREHOUSE_DAMAGE` | ○ | **no** |  |
| `WAREHOUSE_DAMAGE_EXCEPTION` | ○ | **no** |  |
| `WAREHOUSE_LOST` | ○ | **no** |  |

**`Promotion`** (1 value)

| amount-description | Src | Known | Notes |
|---|:--:|:--:|---|
| `Shipping` | ●● | yes | also seen under `ItemPrice` `Shipment-Fees` |

**Values with no confident amount-type** (2 values)

| amount-description | Src | Known | Notes |
|---|:--:|:--:|---|
| `Balance Adjustment` | ○ | **no** |  |
| `Merchant Bad Debt` | ○ | **no** |  |

#### The same description appears under different amount-types

This is the most important thing on this page. Six values are filed differently depending on source and context:

| amount-description | Seen in real reports | Webgility |
|---|---|---|
| `FBAPerOrderFulfillmentFee` | `Shipment-Fees` | `ItemFees` |
| `Goodwill` | `ItemPrice` | `ItemFees` |
| `RestockingFee` | `ItemPrice` | `ItemFees` |
| `Shipping` | `ItemPrice` | `Shipment-Fees` `ItemPrice` `Promotion` |
| `ShippingHB` | `other-transaction` | `ItemFees` |
| `Tax` | `ItemPrice` | `other-transaction` |

**Do not key on `amount-description` alone.** `Shipping` alone shows up under `ItemPrice`, `Shipment-Fees` and `Promotion`, plus a refund context. Always read the `amount-type` on the same row.

Where the two sources disagree, both placements are listed rather than one being silently picked. The disagreement is real data, not noise: Webgility groups fees under its own labels for accounting export, so its placement is medium-confidence, while values marked ● or ●● were observed directly in settlement files.

### What Amazon does not document

These gaps are why most reconciliation tooling quietly gets things wrong.

| Gap | Consequence |
|---|---|
| No enumeration for `transaction-type`. | Any tool that hard-codes four values silently drops rows it does not recognise. |
| No enumeration for `amount-type` or `amount-description`. | New fee codes appear without notice; a hard-coded mapping goes stale without erroring. |
| No documented sign convention. | Whether a given fee arrives negative is inferred, not specified. |
| No documented character encoding. | Non-ASCII SKUs and product names can corrupt on import. |
| No documented summary-row structure. | Read as a data row, the first line double-counts the total. |
| No data types or nullability for any of the 24 columns. | Parsers guess. |

## Known limits

Stated plainly, because a reconciliation tool that overstates itself is worse than none.

- **This is Amazon-side net, not profit.** None of the 24 columns carries cost of goods, inbound freight, advertising spend or any other cost. The per-SKU "net" is what Amazon's ledger says and nothing more — do not read it as margin.
- **One period, one seller account.** The tool parses a single settlement file at a time. It does not merge periods, accounts or marketplaces, and it holds no state between files.
- **Currencies are never summed.** Flat File V2 has a `currency` column and **no exchange-rate column**, so figures are grouped per currency and kept apart. A cross-currency total is not produced, because it cannot be derived from this file alone.
- **Refund detection is a heuristic**, since `transaction-type` has no published enumeration.
- **Reports expire.** Amazon generates them on its own schedule, they cannot be requested on demand, and Seller Central keeps roughly the last 90 days.

## Contact

| | |
|---|---|
| English / technical, and new fee codes | <support@nexusaistart.com> |
| 中文 / 商务合作 | WeChat `nexusaistart`（备注「结算工具」） |

## License

[CC BY 4.0](LICENSE). Use it, modify it, ship it commercially — keep the attribution.

---
---

# 中文说明

把亚马逊 **Flat File V2** 结算报告拖进页面，看清这笔回款到底是怎么算出来的：费用构成、储备金、落在结算周期外的过账、每个 SKU 的净额。单个 HTML 文件，无构建、无服务器、不上传。

英文版：[`index.html`](index.html) · 中文版：[`zh/index.html`](zh/index.html)

## 你的文件不会离开浏览器

报告用 `FileReader` 读入，由内联在页面里的 JavaScript 解析。没有上传接口、没有统计脚本、没有 CDN、没有外部字体。两个 HTML **零子资源引用**——没有 `<script src>`、没有 `<link rel="stylesheet">`、没有 `<img>`、没有 `fetch`、没有 `XMLHttpRequest`、没有 `sendBeacon`、没有 WebSocket。

**两种自己验的办法，都不需要相信这份 README：**

1. **看网络面板。** 打开页面 → 按 <kbd>F12</kbd> → **Network** 标签 → 清空记录 → 把结算报告拖进去，等它渲染完。请求数始终是 **0**，什么都没发出去。
2. **直接断网。** 拔网线或开飞行模式，从硬盘打开 `index.html` 正常使用。表现完全一样，因为它本来就没有要连的地方。

页面里仅有的外部 URL 是语言切换链接、`<link rel="canonical">` / `hreflang` 标签、以及 `mailto:` 邮箱——全都要你点了才会走，没有一个是自动请求的。

## 用法

| | 怎么用 |
|---|---|
| **离线** | 下载 [`zh/index.html`](zh/index.html)（或英文版 [`index.html`](index.html)）双击打开。这一个文件就是工具全部。 |
| **GitHub Pages** | <https://xieyi138-star.github.io/amazon-settlement-parser/zh/> · English <https://xieyi138-star.github.io/amazon-settlement-parser/> |
| **正式版** | <https://nexusaistart.com/zh/tools/amazon-settlement-parser/> —— 持续维护的正本。**本仓库是镜像**，所以这里的 `canonical` 标签仍然指回那个域名。 |

报告哪来：卖家后台 → **Payments** → **All Statements** → **Download Flat File V2**。扩展名通常是 `.txt` 或 `.csv`，但里面是制表符分隔的，要按分隔符探测，别信扩展名。

## 测试样本

[`sample/settlement-sample.txt`](sample/settlement-sample.txt) 是**合成数据，专为测试生成**。里面没有任何真实卖家、订单、买家、SKU 或回款——每一个标识符、每一个金额都是编的。**不要把里面任何数字当成真实的亚马逊数据引用。**

加载它应当得到：声明总额 `582.89`、逐行加总 `582.89`、差额 `0.00`，以及恰好两个未识别取值（`Subscription Fee` 与 `LowInventoryLevelFee`）。

## MCP server

[`mcp/`](mcp/) 把这张对照表和一个对账检查器暴露给 Claude Code、Claude Desktop 或任何 MCP 客户端——让 agent 在处理结算报告时**能去核实取值，而不是猜**。

```sh
claude mcp add amazon-settlement -- npx -y amazon-settlement-mcp
```

三个工具：`lookup_fee_code`、`list_fee_codes`，以及 `check_settlement_report`——后者跑完整对账，并专门报出那些**不报错、只给你一个看着合理的错数**的失败模式。安装方法和完整工具说明见 [`mcp/README.md`](mcp/README.md)。

同一份数据文件，同样的边界，零网络请求。

## 亚马逊结算报告字段与费用代码对照表

> 列名来自亚马逊 SP-API 官方文档。**但取值枚举不是——亚马逊从未公布 `transaction-type`、`amount-type`、`amount-description` 三个字段的允许取值。** 下面这三个字段的内容全部来自第三方文档和真实报告的收集，因此**注定是不完整的**。你的报告里如果出现表里没有的取值，发到 <support@nexusaistart.com>，我加进来——公开这张表就是为了这个。

### 报告类型

| 项 | 值 |
|---|---|
| 当前版本 | `GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2`（Seller Central 卖家） |
| 已弃用 | `GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE`、`GET_V2_SETTLEMENT_REPORT_DATA_XML` |
| 分隔符 | 制表符 |
| 怎么生成的 | 亚马逊自动排期生成，**无法主动请求** |
| 去哪下载 | 卖家后台 → Payments → All Statements → Download Flat File V2 |
| 保留多久 | 大约最近 90 天，约六个结算周期 |

### 24 个列名，按顺序

`settlement-id` · `settlement-start-date` · `settlement-end-date` · `deposit-date` · `total-amount` · `currency` · `transaction-type` · `order-id` · `merchant-order-id` · `adjustment-id` · `shipment-id` · `marketplace-name` · `amount-type` · `amount-description` · `amount` · `fulfillment-id` · `posted-date` · `posted-date-time` · `order-item-code` · `merchant-order-item-id` · `merchant-adjustment-item-id` · `sku` · `quantity-purchased` · `promotion-id`

官方文档给了列名，但**没给数据类型，也没说哪些可以为空**。

真实文件的首行是汇总行，只带 `settlement-id`、两个周期日期、`deposit-date`、`total-amount` 和 `currency`。当成数据行读进去，总额会被重复计一遍。

### `transaction-type`

**官方没有枚举。** 网上流传的 `Order / Refund / Transfer / Liquidations` 那套找不到亚马逊官方出处，所以工具在这个字段上不做任何归类，遇到什么值就原样列出什么值。

随附的合成样本里用到 `Order`、`Refund`、`ServiceFee`、`Shipment`、`Adjustment`、`Transfer`——仅作示例，**不是枚举**。

工具的退款判定是启发式的：`transaction-type` 里含 `refund`（不分大小写）。请对照工具为你自己文件打印出的取值清单核一下。

还有一个值得知道的取值：**`Order_Retrocharge`**。2022 年有卖家在亚马逊自己的 `amzn/selling-partner-api-models` 仓库提了 issue #2345，问 XML 格式里的 `Retrocharge` 到 Flat File V2 该怎么找。**亚马逊全程没有回复**，帖子最后被机器人以长期无人关注自动关闭，提问者也没能在自己的文件里找到这个值。所以这个取值算未证实——它同时也很能说明这几个字段的文档现状。

另外，亚马逊官方的 V1 → V2 迁移映射表自己写着：旧的 `transaction-type` 映射到「**transaction-type 或 amount-description**」，还有一行注着「disjointed amounts may be consolidated」。**只读 `transaction-type` 那一列的解析器会漏行，而且不报错。**

### `amount-type` → `amount-description`

**64 个已观察取值。** 机器可读的正本在 [`data/fee-codes.json`](data/fee-codes.json)，下面这张表由它生成。

来源列：**●●** = 真实报告和第三方文档都出现过 · **●** = 仅在真实报告里见过 · **○** = 仅见于第三方文档，尚未在真实文件里核实。

**工具已收录** = 该取值是否在解析器内置的 `KNOWN` 清单里。不在清单里的照样完整显示并标注「未识别」，工具绝不丢弃它不认识的行。

**`ItemPrice`** (8 个)

| amount-description | 来源 | 工具已收录 | 备注 |
|---|:--:|:--:|---|
| `GiftWrap` | ●● | 是 |  |
| `GiftWrapTax` | ○ | **否** |  |
| `Goodwill` | ●● | 是 | 也出现在 `ItemFees` 下 |
| `Principal` | ●● | 是 |  |
| `RestockingFee` | ●● | 是 | 也出现在 `ItemFees` 下 |
| `Shipping` | ●● | 是 | 也出现在 `Shipment-Fees` `Promotion` 下 |
| `ShippingTax` | ●● | 是 |  |
| `Tax` | ●● | 是 | 也出现在 `other-transaction` 下 |

**`ItemFees`** (16 个)

| amount-description | 来源 | 工具已收录 | 备注 |
|---|:--:|:--:|---|
| `Commission` | ●● | 是 |  |
| `DigitalServicesFee` | ● | 是 |  |
| `FBAPerOrderFulfillmentFee` | ●● | 是 | 也出现在 `Shipment-Fees` 下 |
| `FBAPerUnitFulfillmentFee` | ●● | 是 |  |
| `FBAWeightBasedFee` | ●● | 是 |  |
| `GiftwrapChargeback` | ●● | 是 |  |
| `Goodwill` | ●● | 是 | 也出现在 `ItemPrice` 下 |
| `MarketplaceFacilitatorVAT-Principal` | ● | 是 |  |
| `MarketplaceFacilitatorVAT-Shipping` | ● | 是 |  |
| `RefundCommission` | ●● | 是 |  |
| `RestockingFee` | ●● | 是 | 也出现在 `ItemPrice` 下 |
| `ReturnShipping` | ○ | **否** |  |
| `SalesTaxServiceFee` | ○ | **否** |  |
| `ShippingChargeback` | ●● | 是 |  |
| `ShippingHB` | ●● | 是 | 也出现在 `other-transaction` 下 |
| `VariableClosingFee` | ●● | 是 |  |

**`Shipment-Fees`** (4 个)

| amount-description | 来源 | 工具已收录 | 备注 |
|---|:--:|:--:|---|
| `FBAPerOrderFulfillmentFee` | ●● | 是 | 也出现在 `ItemFees` 下 |
| `FBATransportationFee` | ●● | 是 |  |
| `Multi-Channel Fulfillment Brand-Neutral Box Fee` | ○ | **否** |  |
| `Shipping` | ●● | 是 | 也出现在 `ItemPrice` `Promotion` 下 |

**`other-transaction`** (40 个)

| amount-description | 来源 | 工具已收录 | 备注 |
|---|:--:|:--:|---|
| `Additional Other Expenses` | ○ | **否** |  |
| `Adjustment` | ○ | **否** |  |
| `Amazon Capital Services` | ○ | **否** |  |
| `BalanceAdjustment` | ○ | **否** |  |
| `CS_ERROR_ITEMS` | ○ | **否** |  |
| `Current Reserve Amount` | ●● | 是 |  |
| `DisposalComplete` | ●● | 是 |  |
| `Failed Disbursement` | ○ | **否** |  |
| `FBA Inventory Reimbursement - Customer Return` | ○ | **否** |  |
| `FBACustomerReturnPerOrderFee` | ○ | **否** |  |
| `FBACustomerReturnPerUnitFee` | ○ | **否** |  |
| `FBACustomerReturnWeightBasedFee` | ○ | **否** |  |
| `FBAInboundTransportationFee` | ○ | **否** |  |
| `INCORRECT_FEES_ITEMS` | ○ | **否** |  |
| `INCORRECT_FEES_NON_ITEMIZED` | ○ | **否** |  |
| `LightningDealFee Special` | ○ | **否** |  |
| `Manual Processing Fee` | ○ | **否** |  |
| `Manual Processing Fee Reimbursement` | ○ | **否** |  |
| `MISSING_FROM_INBOUND` | ○ | **否** |  |
| `MULTICHANNEL_ORDER_DAMAGED` | ○ | **否** |  |
| `MULTICHANNEL_ORDER_LATE` | ○ | **否** |  |
| `MULTICHANNEL_ORDER_LOST` | ○ | **否** |  |
| `NonSubscriptionFeeAdj` | ○ | **否** |  |
| `Previous Reserve Amount Balance` | ●● | 是 |  |
| `Refund Reimbursal` | ●● | 是 |  |
| `REMOVAL_ORDER_DAMAGED` | ○ | **否** |  |
| `RemovalComplete` | ○ | **否** |  |
| `REVERSAL_REIMBURSEMENT` | ○ | **否** |  |
| `Shipping label purchase` | ○ | **否** |  |
| `ShippingHB` | ●● | 是 | 也出现在 `ItemFees` 下 |
| `ShippingServices` | ○ | **否** |  |
| `ShippingServicesRefund` | ○ | **否** |  |
| `Storage Fee` | ●● | 是 |  |
| `StorageRenewalBilling` | ●● | 是 |  |
| `Subscription Fee` | ●● | **否** |  |
| `Tax` | ●● | 是 | 也出现在 `ItemPrice` 下 |
| `TransactionTotalAmount` | ○ | **否** |  |
| `WAREHOUSE_DAMAGE` | ○ | **否** |  |
| `WAREHOUSE_DAMAGE_EXCEPTION` | ○ | **否** |  |
| `WAREHOUSE_LOST` | ○ | **否** |  |

**`Promotion`** (1 个)

| amount-description | 来源 | 工具已收录 | 备注 |
|---|:--:|:--:|---|
| `Shipping` | ●● | 是 | 也出现在 `ItemPrice` `Shipment-Fees` 下 |

**暂无可靠 amount-type 归属** (2 个)

| amount-description | 来源 | 工具已收录 | 备注 |
|---|:--:|:--:|---|
| `Balance Adjustment` | ○ | **否** |  |
| `Merchant Bad Debt` | ○ | **否** |  |

#### 同一个 description 会挂在不同的 amount-type 下

这是这一页最重要的一件事。有六个取值，按来源和上下文归属不同：

| amount-description | 真实报告观察 | Webgility |
|---|---|---|
| `FBAPerOrderFulfillmentFee` | `Shipment-Fees` | `ItemFees` |
| `Goodwill` | `ItemPrice` | `ItemFees` |
| `RestockingFee` | `ItemPrice` | `ItemFees` |
| `Shipping` | `ItemPrice` | `Shipment-Fees` `ItemPrice` `Promotion` |
| `ShippingHB` | `other-transaction` | `ItemFees` |
| `Tax` | `ItemPrice` | `other-transaction` |

**不要只按 `amount-description` 归类。** 光是 `Shipping` 就同时出现在 `ItemPrice`、`Shipment-Fees`、`Promotion` 三处，退款场景下还有一处。**必须连同同一行的 `amount-type` 一起读。**

两个来源打架的地方，我把两种归属都列出来，不替你挑一个。这个分歧本身就是数据，不是噪音：Webgility 是按自己的记账口径分组的，所以它的归属只能算中等置信；标 ● 或 ●● 的是直接在结算文件里看到的。

### 官方没说的六件事

大部分对账工具悄悄算错，根子都在这里。

| 缺口 | 后果 |
|---|---|
| `transaction-type` 没有官方枚举。 | 硬编码那四个值的工具，遇到没见过的取值会静默丢行。 |
| `amount-type`、`amount-description` 也没有官方枚举。 | 新费用代码随时出现，硬编码的映射表会悄悄过期且不报错。 |
| 没有说明正负号规则。 | 某项费用是不是负数，只能靠推断。 |
| 没有说明文件编码。 | SKU 或商品名里有非 ASCII 字符时可能乱码。 |
| 没有说明汇总行结构。 | 当成数据行读，首行会把总额重复计一遍。 |
| 24 个列全都没给数据类型和可空性。 | 解析器只能靠猜。 |

## 已知边界

明说，因为一个夸大自己的对账工具比没有更糟。

- **这是亚马逊侧净额，不是利润。** 24 个字段里**没有任何成本字段**——没有采购成本、没有头程运费、没有广告花费。每个 SKU 的「净额」只是亚马逊账本上的数，**不要当毛利读**。
- **单期、单店铺。** 一次只解析一个结算文件，不合并周期、不合并账号、不合并站点，文件之间不保留任何状态。
- **绝不跨币种相加。** Flat File V2 只有一个 `currency` 列、**没有汇率列**，所以所有金额按币种分开统计。不出跨币种合计，因为仅凭这个文件根本算不出来。
- **退款判定是启发式的**，因为 `transaction-type` 没有官方枚举。
- **报告会过期。** 亚马逊自动排期生成、无法主动请求，后台大约只留最近 90 天。

## 联系方式

| | |
|---|---|
| 英文 / 技术问题、新费用代码 | <support@nexusaistart.com> |
| 中文 / 商务合作 | 微信 `nexusaistart`（备注「结算工具」） |

## 许可

[CC BY 4.0](LICENSE)。可自由使用、修改、商用，保留署名即可。
