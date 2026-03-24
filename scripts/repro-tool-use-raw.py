#!/usr/bin/env python3
import argparse
import concurrent.futures
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from typing import Any, Dict, List, Optional, Tuple


DEFAULT_URL = "http://192.168.231.128:30080"
DEFAULT_ENDPOINT = "/v1/messages"
DEFAULT_MODEL = "/model/MiniMax-M2___5"
DEFAULT_COMMAND = "printf 'tool-503-probe\\n'"
DEFAULT_USER_AGENT = "Claude-Code/2.1.34 sdk-ts-probe"


def join_url(base: str, endpoint: str) -> str:
    if base.endswith("/") and endpoint.startswith("/"):
        return base[:-1] + endpoint
    if not base.endswith("/") and not endpoint.startswith("/"):
        return base + "/" + endpoint
    return base + endpoint


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="绕过 Claude Agent SDK，直接用原始 messages/tool_use 协议复现 503。",
    )
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    parser.add_argument("--model", default=os.getenv("ANTHROPIC_MODEL", DEFAULT_MODEL))
    parser.add_argument("--api-key", default=os.getenv("ANTHROPIC_API_KEY", "sk-ant-dummy"))
    parser.add_argument("--command", default=DEFAULT_COMMAND, help="要求模型传给 tool_use 的命令")
    parser.add_argument("--iterations", type=int, default=1)
    parser.add_argument("--concurrency", type=int, default=1)
    parser.add_argument("--max-tokens", type=int, default=256)
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--retries", type=int, default=1, help="每个 HTTP 请求最多尝试次数；默认 1 表示不重试")
    parser.add_argument(
        "--post-tool-fanout",
        type=int,
        default=1,
        help="在拿到 tool_use 后，并发发起多少路 tool_result follow-up 请求；1 表示普通原始模式，3 更接近 SDK 现象",
    )
    parser.add_argument(
        "--sdk-headers",
        type=int,
        default=1,
        help="是否附带更像 Claude Agent SDK 的请求头；1 开启，0 关闭",
    )
    return parser.parse_args()


def build_headers(
    *,
    api_key: str,
    timeout: int,
    retry_count: int,
    sdk_headers: bool,
    idempotency_key: str,
) -> Dict[str, str]:
    headers = {
        "content-type": "application/json",
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
    }
    if sdk_headers:
        headers.update(
            {
                "Accept": "application/json",
                "User-Agent": DEFAULT_USER_AGENT,
                "x-app": "cli",
                "anthropic-dangerous-direct-browser-access": "true",
                "x-stainless-retry-count": str(retry_count),
                "x-stainless-timeout": str(timeout),
                "Idempotency-Key": idempotency_key,
                "x-anthropic-billing-header": "cc_version=2.1.34.7bf; cc_entrypoint=sdk-ts;",
            }
        )
    return headers


def post_json(
    url: str,
    api_key: str,
    payload: Dict[str, Any],
    timeout: int,
    retry_count: int,
    sdk_headers: bool,
    idempotency_key: str,
) -> Tuple[int, str, int]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url=url,
        data=body,
        method="POST",
        headers=build_headers(
            api_key=api_key,
            timeout=timeout,
            retry_count=retry_count,
            sdk_headers=sdk_headers,
            idempotency_key=idempotency_key,
        ),
    )

    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode("utf-8", errors="replace")
            elapsed_ms = int((time.time() - started) * 1000)
            return resp.status, text, elapsed_ms
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")
        elapsed_ms = int((time.time() - started) * 1000)
        return exc.code, text, elapsed_ms
    except Exception as exc:  # noqa: BLE001
        elapsed_ms = int((time.time() - started) * 1000)
        return 0, str(exc), elapsed_ms


def find_tool_use_block(content: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(content, list):
        return None
    for block in content:
        if isinstance(block, dict) and block.get("type") == "tool_use":
            return block
    return None


def request_with_retries(
    *,
    url: str,
    api_key: str,
    payload: Dict[str, Any],
    timeout: int,
    retries: int,
    sdk_headers: bool,
) -> Dict[str, Any]:
    attempts: List[Dict[str, Any]] = []
    idempotency_key = f"stainless-node-retry-{uuid.uuid4()}"
    for attempt in range(1, retries + 1):
        retry_count = attempt - 1
        status, text, elapsed_ms = post_json(
            url,
            api_key,
            payload,
            timeout,
            retry_count,
            sdk_headers,
            idempotency_key,
        )
        attempts.append(
            {
                "attempt": attempt,
                "status": status,
                "elapsedMs": elapsed_ms,
                "bodyPreview": text[:300],
            }
        )
        should_retry = status in {408, 409, 429, 500, 502, 503, 504}
        if not should_retry or attempt >= retries:
            return {
                "status": status,
                "body": text,
                "elapsedMs": elapsed_ms,
                "attempts": attempts,
            }
        max_retries = retries - 1
        current_remaining = max_retries - retry_count
        exp = max_retries - current_remaining
        backoff_seconds = min(0.5 * (2 ** exp), 8)
        jitter = 1 - (0.25 * ((time.time_ns() % 1000000) / 1000000.0))
        sleep_seconds = backoff_seconds * jitter
        time.sleep(sleep_seconds)
    last = attempts[-1]
    return {
        "status": last["status"],
        "body": last["bodyPreview"],
        "elapsedMs": last["elapsedMs"],
        "attempts": attempts,
    }


def run_once(worker_id: int, round_id: int, args: argparse.Namespace) -> Dict[str, Any]:
    url = join_url(args.url, args.endpoint)
    started = time.time()
    print(
        f"[worker={worker_id} round={round_id}] start url={url} model={args.model} command={args.command!r}",
        flush=True,
    )

    first_payload = {
        "model": args.model,
        "max_tokens": args.max_tokens,
        "tools": [
            {
                "name": "probe_bash",
                "description": "Call this tool exactly once to run the provided probe command.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "command": {"type": "string"},
                    },
                    "required": ["command"],
                },
            }
        ],
        "tool_choice": {"type": "tool", "name": "probe_bash"},
        "messages": [
            {
                "role": "user",
                "content": (
                    "You must call the tool probe_bash exactly once. "
                    f"Pass command={args.command!r}. "
                    "Do not answer directly before the tool call. "
                    "After tool_result, reply DONE only."
                ),
            }
        ],
    }

    first = request_with_retries(
        url=url,
        api_key=args.api_key,
        payload=first_payload,
        timeout=args.timeout,
        retries=args.retries,
        sdk_headers=bool(args.sdk_headers),
    )

    first_json: Optional[Dict[str, Any]] = None
    try:
        first_json = json.loads(first["body"])
    except Exception:  # noqa: BLE001
        first_json = None

    tool_block = find_tool_use_block((first_json or {}).get("content"))
    tool_use_found = tool_block is not None
    tool_use_id = tool_block.get("id") if tool_block else None

    followup_results: List[Dict[str, Any]] = []
    final_done = False
    if first["status"] == 200 and tool_block and first_json:
        second_payload_base = {
            "model": args.model,
            "max_tokens": args.max_tokens,
            "tools": first_payload["tools"],
            "messages": [
                first_payload["messages"][0],
                {
                    "role": "assistant",
                    "content": first_json["content"],
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": tool_use_id,
                            "content": [
                                {
                                    "type": "text",
                                    "text": "tool-503-probe",
                                }
                            ],
                        }
                    ],
                },
            ],
        }

        def do_followup(followup_index: int) -> Dict[str, Any]:
            payload = dict(second_payload_base)
            payload["metadata"] = {"followup_index": followup_index, "mode": "sdk_post_tool_fanout"}
            resp = request_with_retries(
                url=url,
                api_key=args.api_key,
                payload=payload,
                timeout=args.timeout,
                retries=args.retries,
                sdk_headers=bool(args.sdk_headers),
            )
            done = False
            if resp["status"] == 200:
                try:
                    second_json = json.loads(resp["body"])
                    final_text = json.dumps(second_json.get("content", []), ensure_ascii=False)
                    done = "DONE" in final_text
                except Exception:  # noqa: BLE001
                    done = False
            return {
                "followupIndex": followup_index,
                "status": resp["status"],
                "elapsedMs": resp["elapsedMs"],
                "done": done,
                "attempts": resp["attempts"],
                "bodyPreview": resp["body"][:300],
            }

        with concurrent.futures.ThreadPoolExecutor(max_workers=args.post_tool_fanout) as executor:
            futures = [
                executor.submit(do_followup, index + 1)
                for index in range(args.post_tool_fanout)
            ]
            for future in concurrent.futures.as_completed(futures):
                followup_results.append(future.result())

        followup_results.sort(key=lambda item: item["followupIndex"])
        final_done = any(item["done"] for item in followup_results)

    elapsed_ms = int((time.time() - started) * 1000)
    all_attempts = list(first["attempts"])
    for item in followup_results:
        for attempt in item["attempts"]:
            all_attempts.append(
                {
                    **attempt,
                    "followupIndex": item["followupIndex"],
                }
            )
    http_503_count = sum(1 for item in all_attempts if item.get("status") == 503)
    saw_503 = http_503_count > 0
    followup_200 = sum(1 for item in followup_results if item["status"] == 200)

    result = {
        "workerId": worker_id,
        "roundId": round_id,
        "url": url,
        "toolUseFound": tool_use_found,
        "toolUseId": tool_use_id,
        "toolInput": tool_block.get("input") if tool_block else None,
        "firstRequestStatus": first["status"],
        "firstRequestMs": first["elapsedMs"],
        "postToolFanout": args.post_tool_fanout,
        "followup200Count": followup_200,
        "followupResults": followup_results,
        "finalDone": final_done,
        "saw503": saw_503,
        "http503Count": http_503_count,
        "elapsedMs": elapsed_ms,
        "attempts": all_attempts,
        "firstBodyPreview": first["body"][:300],
    }

    print(
        f"[worker={worker_id} round={round_id}] done "
        f"first={result['firstRequestStatus']} followup200={followup_200}/{args.post_tool_fanout} "
        f"tool_use={'Y' if tool_use_found else 'N'} final_done={'Y' if final_done else 'N'} "
        f"503={http_503_count} total={elapsed_ms}ms",
        flush=True,
    )
    return result


def main() -> int:
    args = parse_args()
    print(
        f"raw tool_use 压测配置: concurrency={args.concurrency} iterations={args.iterations} "
        f"url={args.url} endpoint={args.endpoint} retries={args.retries} "
        f"post_tool_fanout={args.post_tool_fanout} command={args.command!r}",
        flush=True,
    )

    results: List[Dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        futures = []
        for worker_id in range(1, args.concurrency + 1):
            for round_id in range(1, args.iterations + 1):
                futures.append(executor.submit(run_once, worker_id, round_id, args))
        for future in concurrent.futures.as_completed(futures):
            results.append(future.result())

    results.sort(key=lambda item: (item["workerId"], item["roundId"]))
    total = len(results)
    tool_use_ok = sum(1 for item in results if item["toolUseFound"])
    final_done_ok = sum(1 for item in results if item["finalDone"])
    saw_503 = sum(1 for item in results if item["saw503"])
    total_503 = sum(item["http503Count"] for item in results)
    avg_total = int(sum(item["elapsedMs"] for item in results) / total) if total else 0
    max_total = max((item["elapsedMs"] for item in results), default=0)

    print("\n=== 汇总 ===")
    print(f"总轮次: {total}")
    print(f"触发 tool_use: {tool_use_ok}/{total}")
    print(f"最终 DONE: {final_done_ok}/{total}")
    print(f"出现 503: {saw_503}/{total}")
    print(f"503 总次数: {total_503}")
    print(f"总耗时 平均: {avg_total}ms")
    print(f"总耗时 最大: {max_total}ms")
    print("\n=== 明细(简表) ===")
    for item in results:
        print(
            f"worker={item['workerId']} round={item['roundId']} "
            f"first={item['firstRequestStatus']} followup200={item['followup200Count']}/{item['postToolFanout']} "
            f"tool_use={'Y' if item['toolUseFound'] else 'N'} "
            f"done={'Y' if item['finalDone'] else 'N'} "
            f"503={item['http503Count']} total={item['elapsedMs']}ms"
        )
    print("\n=== 明细(JSON) ===")
    print(json.dumps(results, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
