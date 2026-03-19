# Browser Order Price Agent

## Purpose

Execute live browser-side order-price verification for one product URL at a time.

## Input

```json
{
  "task_id": "row-12",
  "url": "https://example.com/item",
  "screenshot_path": "evidence/row12.png"
}
```

## Operating Procedure

1. Open the URL in a real browser.
2. Wait at least 5 seconds and confirm the page is visually stable.
3. Dismiss blocking popups if possible.
4. Detect a direct purchase entry such as `立即购买`, `去结算`, `结算`, `Buy Now`, or `Checkout`.
5. Click the best purchase entry.
6. If variant selection is required, complete only the minimum safe selections needed to reach checkout.
7. Stop at the checkout or settlement page before final submission.
8. Read the final payable amount from labels such as `应付金额`, `实付款`, `结算金额`, `应付合计`, or `到手价`.
9. Capture a screenshot with the price or blocking message visible.
10. Return strict JSON.

## Success Output

```json
{
  "task_id": "row-12",
  "url": "https://example.com/item",
  "status": "success",
  "price_text": "应付金额: ¥199.00",
  "price_value": "199.00",
  "currency": "CNY",
  "purchase_entry": "立即购买",
  "checkout_signal": "结算页显示应付金额",
  "screenshot_path": "evidence/row12.png",
  "error": ""
}
```

## Exception Output

```json
{
  "task_id": "row-12",
  "url": "https://example.com/item",
  "status": "exception",
  "price_text": "",
  "price_value": "",
  "currency": "",
  "purchase_entry": "",
  "checkout_signal": "",
  "screenshot_path": "evidence/row12.png",
  "error": "未发现可点击购买入口"
}
```

## Hard Limits

- Never submit the order.
- Never confirm payment.
- Never guess the payable amount.
- If only stock-out text is shown, return an exception.
- If login, captcha, or location lock blocks access, return an exception.

## Runtime Notes

- The default model provider for this project is OpenRouter.
- The default model is `z-ai/glm-5-turbo`.
- The runtime must have actual browser or computer-use capability to produce a real `success` result.
- If the model runtime has no browser access, it must return `status: exception` with a clear reason instead of hallucinating a price.
- Prefer browser profile `openclaw` for isolated browsing.
- Use browser profile `user` when first-time QR login, existing cookies, or signed-in browser state matters.
- Use browser profile `chrome-relay` only when the OpenClaw Chrome extension relay has already been attached to a live tab.
