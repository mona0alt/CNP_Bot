#!/usr/bin/env python3
"""CNP-Bot Deep Agent Runner — entry point.

Invoked by host as: python -m src.main (from container/deep-agent-runner/)
"""
from __future__ import annotations

import asyncio
from contextlib import AsyncExitStack
import json
import os
import sys
import uuid

from src.protocol import parse_container_input, emit_output, emit_stream_event
from src.ipc_tools import create_ipc_tools
from src.hooks import load_dangerous_rules, create_confirming_backend


def main():
    try:
        asyncio.run(async_main())
    except Exception as e:
        emit_output({"status": "error", "result": None, "error": str(e)})
        sys.exit(1)


async def async_main():
    # 1. Startup validation — late imports
    try:
        from deepagents import create_deep_agent
    except ImportError as e:
        emit_output({"status": "error", "result": None, "error": f"Failed to import deepagents: {e}"})
        sys.exit(1)

    # 2. Read stdin
    raw = sys.stdin.read()
    container_input = parse_container_input(raw)

    # 3. Inject secrets (never write to disk)
    if container_input.secrets:
        for key, value in container_input.secrets.items():
            os.environ[key] = value

    # 4. Session ID
    thread_id = container_input.session_id or str(uuid.uuid4())

    # 5. System prompt
    workspace_root = os.environ.get("WORKSPACE_ROOT", "/workspace")
    system_prompt = _load_system_prompt(workspace_root)

    # 6. IPC tools
    ipc_dir = os.environ.get("IPC_DIR", os.path.join(workspace_root, "ipc"))
    ipc_tools = create_ipc_tools(ipc_dir, container_input.chat_jid, container_input.group_folder)

    # 7. Dangerous command rules + custom execute
    shared_rules_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "..", "shared", "dangerous-commands.json"
    )
    confirm_bin = os.environ.get("CNP_CONFIRM_BIN")
    rules = load_dangerous_rules(shared_rules_path) if os.path.exists(shared_rules_path) else []
    backend = create_confirming_backend(
        os.path.join(workspace_root, "group"),
        rules,
        confirm_bin,
    )

    # 8. Build agent
    model = os.environ.get("DEEP_AGENT_MODEL", "claude-sonnet-4-6")
    checkpoint_db = os.environ.get("DEEPAGENT_CHECKPOINT_DB", "")

    async with AsyncExitStack() as exit_stack:
        checkpointer = await _open_checkpointer_async(checkpoint_db, exit_stack)

        agent = create_deep_agent(
            model=model,
            backend=backend,
            tools=ipc_tools,
            system_prompt=system_prompt,
            checkpointer=checkpointer,
        )

        config = {"configurable": {"thread_id": thread_id}}

        # 9. Run first query
        await _run_query(agent, container_input.prompt, config, thread_id)

        # 10. Multi-turn loop
        input_dir = os.path.join(ipc_dir, "input")
        os.makedirs(input_dir, exist_ok=True)

        while True:
            msg = await _poll_ipc_input(input_dir)
            if msg is None:
                break
            await _run_query(agent, msg, config, thread_id)


async def _run_query(agent, prompt, config, thread_id):
    """Run one agent query and stream output."""
    from langchain_core.messages import HumanMessage

    result_text = ""
    usage_info = {}
    active_thinking_indexes = set()
    thinking_index_map = {}
    next_block_index = 0

    try:
        async for event in agent.astream_events(
            {"messages": [HumanMessage(content=prompt)]},
            config=config,
            version="v2",
        ):
            kind = event.get("event", "")

            if kind == "on_chat_model_stream":
                chunk = event.get("data", {}).get("chunk")
                content = getattr(chunk, "content", None)
                if isinstance(content, list):
                    for item in content:
                        if not isinstance(item, dict):
                            continue
                        item_type = item.get("type")
                        item_index = item.get("index", 0)
                        if item_type == "thinking":
                            frontend_index = thinking_index_map.get(item_index)
                            if frontend_index is None:
                                frontend_index = next_block_index
                                next_block_index += 1
                                thinking_index_map[item_index] = frontend_index
                            if frontend_index not in active_thinking_indexes:
                                emit_stream_event({
                                    "type": "content_block_start",
                                    "index": frontend_index,
                                    "content_block": {"type": "thinking", "text": ""},
                                })
                                active_thinking_indexes.add(frontend_index)
                            thinking_text = item.get("thinking")
                            if isinstance(thinking_text, str) and thinking_text:
                                emit_stream_event({
                                    "type": "content_block_delta",
                                    "index": frontend_index,
                                    "delta": {"type": "thinking_delta", "thinking": thinking_text},
                                })
                text = _extract_text_content(getattr(chunk, "content", None))
                if text:
                    emit_stream_event({"type": "text_delta", "text": text})
                    result_text += text

            elif kind == "on_tool_start":
                tool_id = event.get("run_id") or event.get("name", "")
                tool_index = next_block_index
                next_block_index += 1
                emit_stream_event({
                    "type": "content_block_start",
                    "index": tool_index,
                    "content_block": {
                        "type": "tool_use",
                        "id": tool_id,
                        "name": _normalize_tool_name(event.get("name", "")),
                        "input": _normalize_tool_input(event.get("name", ""), event.get("data", {}).get("input", {})),
                    },
                })

            elif kind == "on_tool_end":
                tool_id = event.get("run_id") or event.get("name", "")
                emit_stream_event({
                    "type": "tool_result",
                    "tool_use_id": tool_id,
                    "content": _extract_tool_output(event.get("data", {}).get("output")),
                    "is_error": False,
                })

            elif kind == "on_chat_model_end":
                for item_index in sorted(active_thinking_indexes):
                    emit_stream_event({"type": "content_block_stop", "index": item_index})
                active_thinking_indexes.clear()
                thinking_index_map.clear()
                output_data = event.get("data", {}).get("output")
                if output_data and not result_text:
                    result_text = _extract_text_content(getattr(output_data, "content", None))
                if output_data and hasattr(output_data, "response_metadata"):
                    rm = output_data.response_metadata or {}
                    u = rm.get("usage", {})
                    usage_info = {
                        "input_tokens": u.get("input_tokens", 0),
                        "output_tokens": u.get("output_tokens", 0),
                        "model_usage": {
                            os.environ.get("DEEP_AGENT_MODEL", "unknown"): {
                                "input_tokens": u.get("input_tokens", 0),
                                "output_tokens": u.get("output_tokens", 0),
                            }
                        },
                    }
    except Exception as e:
        emit_output({"status": "error", "result": None, "error": str(e)})
        return

    emit_output({
        "status": "success",
        "result": result_text or None,
        "newSessionId": thread_id,
        "usage": usage_info,
    })


async def _poll_ipc_input(input_dir: str) -> str | None:
    """Poll IPC input directory for follow-up messages. Returns None on _close."""
    while True:
        close_path = os.path.join(input_dir, "_close")
        if os.path.exists(close_path):
            try:
                os.remove(close_path)
            except OSError:
                pass
            return None

        try:
            files = sorted(f for f in os.listdir(input_dir) if f.endswith(".json"))
        except OSError:
            files = []

        if files:
            fpath = os.path.join(input_dir, files[0])
            try:
                with open(fpath) as f:
                    data = json.load(f)
                os.remove(fpath)
                return data.get("text", "")
            except (json.JSONDecodeError, OSError):
                try:
                    os.remove(fpath)
                except OSError:
                    pass

        await asyncio.sleep(0.5)


async def _open_checkpointer_async(checkpoint_db: str, exit_stack: AsyncExitStack, saver_factory=None):
    """Open async sqlite checkpointer context and return the actual saver instance."""
    if not checkpoint_db:
        return None

    os.makedirs(os.path.dirname(checkpoint_db), exist_ok=True)

    if saver_factory is None:
        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
        saver_factory = AsyncSqliteSaver.from_conn_string

    return await exit_stack.enter_async_context(saver_factory(checkpoint_db))


def _extract_text_content(content) -> str:
    if isinstance(content, str):
        return content

    if isinstance(content, list):
        parts = []
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "text" and isinstance(item.get("text"), str):
                parts.append(item["text"])
        return "".join(parts)

    return ""


def _normalize_tool_name(tool_name: str) -> str:
    if tool_name == "execute":
        return "Bash"
    return tool_name


def _normalize_tool_input(tool_name: str, tool_input):
    if tool_name == "execute" and isinstance(tool_input, dict):
        normalized = {}
        if "command" in tool_input:
            normalized["command"] = tool_input["command"]
        if "timeout" in tool_input:
            normalized["timeout"] = tool_input["timeout"]
        return normalized or tool_input
    return tool_input


def _extract_tool_output(output) -> str:
    if isinstance(output, str):
        return output

    content = getattr(output, "content", None)
    if isinstance(content, str):
        return content

    if isinstance(content, list):
        return _extract_text_content(content) or str(content)

    return str(output)


def _load_system_prompt(workspace_root: str) -> str:
    """Load system prompt from CLAUDE.md files."""
    parts = []
    for sub in ["global/CLAUDE.md", "group/CLAUDE.md"]:
        p = os.path.join(workspace_root, sub)
        if os.path.exists(p):
            with open(p) as f:
                parts.append(f.read())
    return "\n\n".join(parts) if parts else ""


if __name__ == "__main__":
    main()
