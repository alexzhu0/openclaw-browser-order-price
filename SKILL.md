---
name: openclaw-browser-order-price
description: Browser automation agent for opening a product URL, waiting for the page to stabilize, finding a purchasable entry such as `立即购买` or `去结算`, clicking into checkout, reading the final order price from checkout text such as `应付金额` or `实付款`, and returning a structured result with screenshot evidence or a clear exception. Use when Codex needs to perform browser-side order-page price verification instead of static scraping.
---

# OpenClaw Browser Order Price Agent

## Overview

Use this agent when the task is operational rather than analytical: open a live product page in a browser-capable environment, navigate to checkout, and capture the actual order price or the blocking reason.

Treat the task as checkout-price verification. Stop before final submission, payment confirmation, or any irreversible order action.

Default runtime:

- provider: `OpenRouter`
- model: `z-ai/glm-5-turbo`
- real computer-use layer: Windows-side `OpenClaw` local agent + browser tool

## Input Contract

Provide a single task at a time with:

- `url`: target product URL
- `task_id`: optional external identifier
- `screenshot_path`: optional preferred screenshot path

If no explicit path is provided, create a timestamped screenshot filename.

## Required Workflow

1. Open the given `url` in the browser.
2. Force-wait for the page to load and stabilize.
3. Check for modal dialogs, cookie notices, region selectors, and basic SKU selectors that block the purchase flow.
4. Look for a clickable purchase entry.
5. If a valid entry exists, click it and continue until the checkout or settlement page is visible.
6. On the checkout page, locate the final payable price.
7. Capture a screenshot that includes the relevant price or blocking state.
8. Return a strict JSON result.

## Wait Rules

Always combine passive wait and visual confirmation:

1. Wait at least 5 seconds after the initial page load.
2. If the page is still rendering, wait again until the main CTA and price region stop changing.
3. After each major click, wait again until the next page or drawer is stable.

Do not assume a page is ready only because the first frame is visible.

## Purchase Entry Detection

Prefer entries whose effect is to start checkout immediately.

Primary keywords:

- `立即购买`
- `马上抢`
- `去结算`
- `结算`
- `Buy Now`
- `Checkout`

Secondary keywords:

- `立即下单`
- `提交订单前往结算`
- `确认选购`

Ignore controls that are obviously unrelated to ordering, such as:

- `加入购物车` when no settlement step follows
- `收藏`
- `分享`
- `客服`

If multiple entry buttons exist, prefer the one most likely to lead directly to settlement instead of the cart.

## Checkout Price Detection

Read the value closest to final payment. Prefer the following labels in order:

1. `应付金额`
2. `实付款`
3. `结算金额`
4. `应付合计`
5. `订单总额`
6. `到手价`

If both original price and payable price are visible, record only the payable amount.

If the page shows a range, estimated price, or promotional teaser without a final payable number, return an exception instead of guessing.

## Exception Rules

Return an exception when any of the following occurs:

- no purchasable entry is found
- the page only shows `缺货`, `无货`, `售罄`, `补货中`, or equivalent
- login, captcha, membership lock, or region lock blocks access
- SKU selection is mandatory but the checkout flow still cannot be reached
- the checkout page opens but no final payable amount can be confirmed

## Output Contract

Return JSON using this schema:

```json
{
  "task_id": "optional-id",
  "url": "https://example.com/item",
  "status": "success",
  "price_text": "应付金额: ¥199.00",
  "price_value": "199.00",
  "currency": "CNY",
  "purchase_entry": "立即购买",
  "checkout_signal": "结算页显示应付金额",
  "screenshot_path": "evidence/row12_20260317T101530.png",
  "error": ""
}
```

For failures:

```json
{
  "task_id": "optional-id",
  "url": "https://example.com/item",
  "status": "exception",
  "price_text": "",
  "price_value": "",
  "currency": "",
  "purchase_entry": "",
  "checkout_signal": "",
  "screenshot_path": "evidence/row12_20260317T101530.png",
  "error": "页面仅显示缺货，未发现可点击购买入口"
}
```

## Execution Constraints

- Do not submit the final order.
- Do not complete payment.
- Do not invent a price when the page is ambiguous.
- Always preserve one screenshot as evidence.
- Process one URL per run unless the caller explicitly provides batching.

## Resources

Use [AGENT.md](AGENT.md) as the direct operator-facing contract.

Use [references/operator-runbook.md](references/operator-runbook.md) when generating a browser execution prompt or checking ambiguous cases.

Use [scripts/prepare_order_task.py](scripts/prepare_order_task.py) to generate a normalized task payload.

Use [scripts/validate_order_result.py](scripts/validate_order_result.py) to validate agent output before persisting it.

Use [scripts/run_openrouter_agent.py](scripts/run_openrouter_agent.py) to call the configured OpenRouter model for one task. This runner validates the returned JSON, but it still requires a browser-capable runtime to produce a true success result.

Use [scripts/run_real_browser_agent.py](scripts/run_real_browser_agent.py) to execute the task through the real OpenClaw computer-use layer on Windows. This runner uses a project-local OpenClaw config in [openclaw.windows.json](openclaw.windows.json), pins the model to `openrouter/z-ai/glm-5-turbo`, and supports:

- `--profile openclaw` for the isolated managed browser
- `--profile user` for the real signed-in Chrome session and QR login flows
- `--profile chrome-relay` for the extension relay flow
