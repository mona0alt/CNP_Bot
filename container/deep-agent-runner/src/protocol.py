from __future__ import annotations
import json
import sys
from dataclasses import dataclass
from typing import Any

OUTPUT_START = "---CNP_BOT_OUTPUT_START---"
OUTPUT_END = "---CNP_BOT_OUTPUT_END---"

@dataclass
class ContainerInput:
    prompt: str
    group_folder: str
    chat_jid: str
    is_main: bool
    session_id: str | None = None
    is_scheduled_task: bool = False
    assistant_name: str | None = None
    secrets: dict[str, str] | None = None

def parse_container_input(raw: str) -> ContainerInput:
    data = json.loads(raw)
    return ContainerInput(
        prompt=data["prompt"],
        group_folder=data["groupFolder"],
        chat_jid=data["chatJid"],
        is_main=data.get("isMain", False),
        session_id=data.get("sessionId"),
        is_scheduled_task=data.get("isScheduledTask", False),
        assistant_name=data.get("assistantName"),
        secrets=data.get("secrets"),
    )

def emit_output(data: dict[str, Any]) -> None:
    payload = json.dumps(data, ensure_ascii=False)
    sys.stdout.write(f"{OUTPUT_START}\n{payload}\n{OUTPUT_END}\n")
    sys.stdout.flush()

def emit_stream_event(event: dict[str, Any]) -> None:
    emit_output({"status": "success", "result": None, "streamEvent": event})
