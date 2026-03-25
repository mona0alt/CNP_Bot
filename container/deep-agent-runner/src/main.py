#!/usr/bin/env python3
"""CNP-Bot Deep Agent Runner — entry point.

Invoked by host as: python -m src.main (from container/deep-agent-runner/)
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import uuid

from src.protocol import parse_container_input, emit_output, emit_stream_event
from src.ipc_tools import create_ipc_tools
from src.hooks import load_dangerous_rules, create_execute_tool


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
        from deepagents.backends.filesystem import FilesystemBackend
        from langchain_core.messages import HumanMessage
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
    execute_tool = create_execute_tool(
        os.path.join(workspace_root, "group"), rules, confirm_bin
    )

    # 8. Build agent
    # Use FilesystemBackend (not LocalShellBackend/SandboxBackendProtocol)
    # to avoid duplicate execute tool — our custom execute_tool replaces the default.
    backend = FilesystemBackend(root_dir=os.path.join(workspace_root, "group"))

    checkpoint_db = os.environ.get("DEEPAGENT_CHECKPOINT_DB", "")
    checkpointer = None
    if checkpoint_db:
        os.makedirs(os.path.dirname(checkpoint_db), exist_ok=True)
        from langgraph.checkpoint.sqlite import SqliteSaver
        checkpointer = SqliteSaver.from_conn_string(checkpoint_db)

    model = os.environ.get("DEEP_AGENT_MODEL", "claude-sonnet-4-6")

    agent = create_deep_agent(
        model=model,
        backend=backend,
        tools=[*ipc_tools, execute_tool],
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

    try:
        async for event in agent.astream_events(
            {"messages": [HumanMessage(content=prompt)]},
            config=config,
            version="v2",
        ):
            kind = event.get("event", "")

            if kind == "on_chat_model_stream":
                chunk = event.get("data", {}).get("chunk")
                if chunk and hasattr(chunk, "content") and isinstance(chunk.content, str) and chunk.content:
                    emit_stream_event({"type": "text_delta", "text": chunk.content})
                    result_text += chunk.content

            elif kind == "on_tool_start":
                emit_stream_event({
                    "type": "tool_use_start",
                    "name": event.get("name", ""),
                    "input": event.get("data", {}).get("input", {}),
                })

            elif kind == "on_tool_end":
                emit_stream_event({
                    "type": "tool_use_end",
                    "name": event.get("name", ""),
                    "output": str(event.get("data", {}).get("output", "")),
                })

            elif kind == "on_chat_model_end":
                output_data = event.get("data", {}).get("output")
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
