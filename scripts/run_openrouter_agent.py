#!/usr/bin/env python3
"""Call OpenRouter with the project agent prompt and validate the JSON response."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from urllib import error, request

from prepare_order_task import build_payload
from validate_order_result import validate_result


PROJECT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = "z-ai/glm-5-turbo"


def load_dotenv(dotenv_path: Path) -> None:
    if not dotenv_path.exists():
        return

    for raw_line in dotenv_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def build_messages(task: dict) -> list[dict]:
    system_prompt = "\n\n".join(
        [
            (PROJECT_DIR / "AGENT.md").read_text().strip(),
            (PROJECT_DIR / "references" / "operator-runbook.md").read_text().strip(),
        ]
    )
    user_prompt = (
        "Process exactly one browser order-price verification task.\n"
        "If the runtime cannot access a real browser session, return an exception JSON instead of fabricating a result.\n\n"
        f"Task:\n{json.dumps(task, ensure_ascii=False, indent=2)}"
    )
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]


def call_openrouter(api_key: str, base_url: str, model: str, messages: list[dict]) -> str:
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
    }
    req = request.Request(
        url=f"{base_url.rstrip('/')}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://local.agent/openclaw-browser-order-price",
            "X-Title": "openclaw-browser-order-price",
        },
        method="POST",
    )

    with request.urlopen(req, timeout=90) as resp:
        body = json.loads(resp.read().decode("utf-8"))

    try:
        return body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"unexpected OpenRouter response shape: {exc}") from exc


def normalize_result(raw_result: dict, task: dict) -> dict:
    result = dict(raw_result)

    # Preserve caller-controlled identity fields even when the model omits them.
    result.setdefault("task_id", task.get("task_id", ""))
    result.setdefault("url", task["url"])
    result.setdefault("screenshot_path", task["screenshot_path"])

    for field in [
        "price_text",
        "price_value",
        "currency",
        "purchase_entry",
        "checkout_signal",
        "error",
    ]:
        result.setdefault(field, "")

    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True, help="Target product URL")
    parser.add_argument("--task-id", default="", help="Optional task identifier")
    parser.add_argument("--screenshot-path", default="", help="Preferred screenshot path")
    args = parser.parse_args()

    load_dotenv(PROJECT_DIR / ".env")

    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    base_url = os.environ.get("OPENROUTER_BASE_URL", DEFAULT_BASE_URL).strip()
    model = os.environ.get("OPENROUTER_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
    if not api_key:
        print("missing OPENROUTER_API_KEY", file=sys.stderr)
        return 1

    task_id = args.task_id.strip()
    screenshot_path = args.screenshot_path.strip()
    task = build_payload(task_id=task_id, url=args.url, screenshot_path=screenshot_path)

    try:
        content = call_openrouter(
            api_key=api_key,
            base_url=base_url,
            model=model,
            messages=build_messages(task),
        )
        result = normalize_result(json.loads(content), task)
    except json.JSONDecodeError as exc:
        print(f"model did not return valid JSON: {exc}", file=sys.stderr)
        return 1
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        print(f"openrouter http error: {exc.code} {detail}", file=sys.stderr)
        return 1
    except error.URLError as exc:
        print(f"openrouter network error: {exc}", file=sys.stderr)
        return 1
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    validation_errors = validate_result(result)
    if validation_errors:
        for validation_error in validation_errors:
            print(validation_error, file=sys.stderr)
        return 1

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
