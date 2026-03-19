# Operator Runbook

## Goal

Reach checkout and extract the actual payable amount without submitting the order.

## Decision Order

1. Confirm the page loaded and stabilized.
2. Check whether the product is out of stock.
3. Find the best purchase entry.
4. Handle minimum required selections.
5. Verify arrival at checkout.
6. Read the final payable amount.
7. Capture a screenshot.
8. Return JSON only.

## Stock And Blocking Signals

Treat these as exceptions unless the flow still exposes a working purchase entry:

- `缺货`
- `无货`
- `售罄`
- `补货中`
- `暂不可售`
- `仅支持到店`
- `登录后购买`
- `验证码`

## Purchase Entry Priority

Highest priority:

- `立即购买`
- `去结算`
- `结算`
- `Buy Now`
- `Checkout`

Lower priority:

- `加入购物车`

Use `加入购物车` only when the site clearly redirects or exposes a settlement step immediately after the click.

## Price Reading Priority

When several prices appear at once, select the value nearest to actual payment in this order:

1. `应付金额`
2. `实付款`
3. `结算金额`
4. `应付合计`
5. `订单总额`
6. `到手价`

Do not record:

- crossed-out list price
- promotional slogan price
- coupon threshold text
- installment hint text

## JSON Rules

- Return JSON only.
- Use `status: success` only when a payable amount is confirmed.
- Use `status: exception` for any blocked or ambiguous case.
- Keep `error` empty on success.
