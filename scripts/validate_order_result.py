#!/usr/bin/env python3
"""Validate the JSON result produced by the browser order-price agent."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


REQUIRED_FIELDS = [
    "url",
    "status",
    "price_text",
    "price_value",
    "currency",
    "purchase_entry",
    "checkout_signal",
    "screenshot_path",
    "error",
]


def load_json(source: str) -> dict:
    path = Path(source)
    if path.exists():
        return json.loads(path.read_text())
    return json.loads(source)


def validate_result(payload: dict) -> list[str]:
    errors: list[str] = []

    for field in REQUIRED_FIELDS:
        if field not in payload:
            errors.append(f"missing field: {field}")

    status = payload.get("status")
    if status not in {"success", "exception"}:
        errors.append("status must be 'success' or 'exception'")

    if status == "success":
        if not str(payload.get("price_value", "")).strip():
            errors.append("success result must include price_value")
        if not str(payload.get("price_text", "")).strip():
            errors.append("success result must include price_text")
        if str(payload.get("error", "")).strip():
            errors.append("success result must not include error text")

    if status == "exception":
        if not str(payload.get("error", "")).strip():
            errors.append("exception result must include error")

    if not str(payload.get("screenshot_path", "")).strip():
        errors.append("screenshot_path must not be empty")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("result", help="JSON string or path to JSON file")
    args = parser.parse_args()

    try:
        payload = load_json(args.result)
    except json.JSONDecodeError as exc:
        print(f"invalid json: {exc}", file=sys.stderr)
        return 1

    errors = validate_result(payload)
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1

    print("result is valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
