#!/usr/bin/env python3
"""Build a normalized single-URL task payload for the browser order-price agent."""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path


BUY_KEYWORDS = [
    "立即购买",
    "去结算",
    "结算",
    "Buy Now",
    "Checkout",
    "立即下单",
]

PRICE_KEYWORDS = [
    "应付金额",
    "实付款",
    "结算金额",
    "应付合计",
    "订单总额",
    "到手价",
]

EXCEPTION_KEYWORDS = [
    "缺货",
    "无货",
    "售罄",
    "补货中",
    "登录后购买",
    "验证码",
]


def build_default_screenshot_path(task_id: str) -> str:
    timestamp = datetime.now().strftime("%Y%m%dT%H%M%S")
    return str(Path("evidence") / f"{task_id}_{timestamp}.png")


def build_payload(task_id: str, url: str, screenshot_path: str) -> dict:
    normalized_task_id = task_id or datetime.now().strftime("task-%Y%m%dT%H%M%S")
    normalized_screenshot_path = screenshot_path or build_default_screenshot_path(normalized_task_id)

    return {
        "task_id": normalized_task_id,
        "url": url,
        "screenshot_path": normalized_screenshot_path,
        "workflow": [
            "open_url",
            "force_wait_for_page_ready",
            "detect_purchase_entry",
            "click_into_checkout",
            "read_final_payable_price",
            "capture_screenshot",
            "return_json",
        ],
        "buy_keywords": BUY_KEYWORDS,
        "price_keywords": PRICE_KEYWORDS,
        "exception_keywords": EXCEPTION_KEYWORDS,
        "result_schema": {
            "task_id": "string",
            "url": "string",
            "status": "success|exception",
            "price_text": "string",
            "price_value": "string",
            "currency": "string",
            "purchase_entry": "string",
            "checkout_signal": "string",
            "screenshot_path": "string",
            "error": "string",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True, help="Target product URL")
    parser.add_argument("--task-id", default="", help="Optional task identifier")
    parser.add_argument(
        "--screenshot-path",
        default="",
        help="Optional preferred screenshot path",
    )
    args = parser.parse_args()

    payload = build_payload(
        task_id=args.task_id,
        url=args.url,
        screenshot_path=args.screenshot_path,
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
