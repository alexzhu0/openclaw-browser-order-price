#!/usr/bin/env python3
"""Run the order-price agent through Windows-side OpenClaw with real browser access."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

from prepare_order_task import build_payload
from validate_order_result import validate_result


PROJECT_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = PROJECT_DIR / "openclaw.windows.json"
SUPPORTED_PROFILES = {"openclaw", "user", "chrome-relay"}


def load_dotenv(dotenv_path: Path) -> None:
    if not dotenv_path.exists():
        return

    for raw_line in dotenv_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def build_prompt(task: dict, profile: str) -> str:
    agent_contract = (PROJECT_DIR / "AGENT.md").read_text().strip()
    runbook = (PROJECT_DIR / "references" / "operator-runbook.md").read_text().strip()

    profile_notes = {
        "openclaw": [
            "Use browser profile \"openclaw\" for every browser tool call.",
            "This is the isolated managed browser profile.",
        ],
        "user": [
            "Use browser profile \"user\" for every browser tool call.",
            "This profile is for the real signed-in Chrome session.",
            "If a site requires first-time QR login, leave the browser visible so the human can scan and finish login, then continue the task.",
            "If the user profile is not attached or reachable, return an exception explaining that the real Chrome session must be attached first.",
        ],
        "chrome-relay": [
            "Use browser profile \"chrome-relay\" for every browser tool call.",
            "This profile requires the OpenClaw Chrome extension relay to be attached to a live tab first.",
            "If relay is not attached, return an exception with that exact reason.",
        ],
    }[profile]

    instructions = [
        "You are executing a real browser order-price verification task through OpenClaw.",
        *profile_notes,
        "Use browser tools to open the page, inspect the page, click controls, wait for visual stability, and capture the result.",
        "Do not guess any missing state.",
        "Return JSON only.",
    ]

    return "\n\n".join(
        [
            agent_contract,
            runbook,
            "\n".join(instructions),
            f"Task:\n{json.dumps(task, ensure_ascii=False, indent=2)}",
        ]
    )


def build_windows_env() -> dict[str, str]:
    env = os.environ.copy()

    api_key = env.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("missing OPENROUTER_API_KEY in environment or .env")

    env["OPENROUTER_API_KEY"] = api_key
    env["OPENCLAW_CONFIG_PATH"] = str(CONFIG_PATH)

    wslenv_entries = [entry for entry in env.get("WSLENV", "").split(":") if entry]
    required_entries = {
        "OPENCLAW_CONFIG_PATH/p",
        "OPENROUTER_API_KEY",
    }
    for entry in required_entries:
        if entry not in wslenv_entries:
            wslenv_entries.append(entry)
    env["WSLENV"] = ":".join(wslenv_entries)

    return env


def run_openclaw_local_agent(prompt: str, timeout_seconds: int) -> subprocess.CompletedProcess[bytes]:
    cmd = [
        "cmd.exe",
        "/c",
        "openclaw",
        "agent",
        "--local",
        "--agent",
        "browser-order-price",
        "--json",
        "--timeout",
        str(timeout_seconds),
        "--message",
        prompt,
    ]
    return subprocess.run(
        cmd,
        check=False,
        capture_output=True,
        text=False,
        env=build_windows_env(),
    )


def decode_windows_output(raw: bytes) -> str:
    for encoding in ("utf-8", "gbk", "cp936"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def extract_json_payload(text: str) -> dict:
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError("no JSON object found in OpenClaw output")
    return json.loads(text[start : end + 1])


def looks_like_result(payload: dict) -> bool:
    return "status" in payload or (
        "error" in payload and "screenshot_path" in payload and "url" in payload
    )


def unwrap_result_payload(payload: object) -> dict | None:
    if isinstance(payload, dict):
        if looks_like_result(payload):
            return payload

        for key in ("text", "reply", "message", "result", "output", "content", "data"):
            if key not in payload:
                continue
            nested = unwrap_result_payload(payload[key])
            if nested is not None:
                return nested

        for value in payload.values():
            nested = unwrap_result_payload(value)
            if nested is not None:
                return nested

    if isinstance(payload, list):
        for item in payload:
            nested = unwrap_result_payload(item)
            if nested is not None:
                return nested

    if isinstance(payload, str):
        inner = payload.strip()
        if inner.startswith("{") and inner.endswith("}"):
            try:
                decoded = json.loads(inner)
            except json.JSONDecodeError:
                return None
            return unwrap_result_payload(decoded)

    return None


def normalize_result(raw: dict, task: dict) -> dict:
    if isinstance(raw, dict) and raw.get("payloads") == []:
        return {
            "task_id": task["task_id"],
            "url": task["url"],
            "status": "exception",
            "price_text": "",
            "price_value": "",
            "currency": "",
            "purchase_entry": "",
            "checkout_signal": "",
            "screenshot_path": task["screenshot_path"],
            "error": "OpenClaw agent completed without returning a final text payload",
        }

    result = unwrap_result_payload(raw) or dict(raw)

    result.setdefault("task_id", task["task_id"])
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
    parser.add_argument("--task-id", default="", help="Optional external task id")
    parser.add_argument(
        "--screenshot-path",
        default="",
        help="Preferred screenshot output path",
    )
    parser.add_argument(
        "--profile",
        default="openclaw",
        choices=sorted(SUPPORTED_PROFILES),
        help="Browser profile: openclaw for isolated browsing, user for real Chrome session, chrome-relay for extension relay",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=180,
        help="OpenClaw agent timeout in seconds",
    )
    args = parser.parse_args()

    load_dotenv(PROJECT_DIR / ".env")

    task = build_payload(
        task_id=args.task_id,
        url=args.url,
        screenshot_path=args.screenshot_path,
    )
    prompt = build_prompt(task=task, profile=args.profile)

    completed = run_openclaw_local_agent(prompt, timeout_seconds=args.timeout_seconds)
    stdout_text = decode_windows_output(completed.stdout)
    stderr_text = decode_windows_output(completed.stderr)
    if completed.returncode != 0:
        stderr = stderr_text.strip() or stdout_text.strip()
        print(stderr, file=sys.stderr)
        return completed.returncode

    try:
        raw_payload = extract_json_payload(stdout_text)
        result = normalize_result(raw_payload, task)
    except (ValueError, json.JSONDecodeError) as exc:
        print(f"failed to parse OpenClaw output: {exc}", file=sys.stderr)
        if stdout_text.strip():
            print(stdout_text.strip(), file=sys.stderr)
        return 1

    validation_errors = validate_result(result)
    if validation_errors:
        for validation_error in validation_errors:
            print(validation_error, file=sys.stderr)
        print("raw OpenClaw output:", file=sys.stderr)
        print(stdout_text.strip(), file=sys.stderr)
        return 1

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
