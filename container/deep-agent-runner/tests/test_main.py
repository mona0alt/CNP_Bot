import json
import os
import uuid
import tempfile
import asyncio
import types
import sys
from contextlib import contextmanager, ExitStack, asynccontextmanager, AsyncExitStack
import pytest
from src.protocol import parse_container_input
import src.main as main_mod
from src.main import _load_system_prompt, _poll_ipc_input


def test_parse_input_and_inject_secrets():
    input_data = {
        "prompt": "hello",
        "groupFolder": "test",
        "chatJid": "web:abc",
        "isMain": False,
        "secrets": {"TEST_SECRET_KEY": "test-value-123"},
    }
    ci = parse_container_input(json.dumps(input_data))
    if ci.secrets:
        for k, v in ci.secrets.items():
            os.environ[k] = v
    assert os.environ.get("TEST_SECRET_KEY") == "test-value-123"
    del os.environ["TEST_SECRET_KEY"]


def test_session_id_generation():
    ci_new = parse_container_input(json.dumps({
        "prompt": "hi", "groupFolder": "g", "chatJid": "j", "isMain": False
    }))
    thread_id = ci_new.session_id or str(uuid.uuid4())
    assert ci_new.session_id is None
    assert len(thread_id) == 36

    ci_resume = parse_container_input(json.dumps({
        "prompt": "hi", "groupFolder": "g", "chatJid": "j", "isMain": False,
        "sessionId": "existing-123"
    }))
    thread_id = ci_resume.session_id or str(uuid.uuid4())
    assert thread_id == "existing-123"


def test_load_system_prompt():
    with tempfile.TemporaryDirectory() as d:
        os.makedirs(os.path.join(d, "global"))
        os.makedirs(os.path.join(d, "group"))
        with open(os.path.join(d, "global", "CLAUDE.md"), "w") as f:
            f.write("global prompt")
        with open(os.path.join(d, "group", "CLAUDE.md"), "w") as f:
            f.write("group prompt")
        result = _load_system_prompt(d)
        assert "global prompt" in result
        assert "group prompt" in result


def test_load_system_prompt_empty():
    with tempfile.TemporaryDirectory() as d:
        result = _load_system_prompt(d)
        assert result == ""


def test_build_agent_config_sets_high_recursion_limit():
    config = main_mod._build_agent_config("thread-xyz")
    assert config["configurable"]["thread_id"] == "thread-xyz"
    assert config["recursion_limit"] == 1000


def test_poll_ipc_input_close():
    async def _test():
        with tempfile.TemporaryDirectory() as d:
            open(os.path.join(d, "_close"), "w").close()
            result = await _poll_ipc_input(d)
            assert result is None
    asyncio.run(_test())


def test_poll_ipc_input_message():
    async def _test():
        with tempfile.TemporaryDirectory() as d:
            msg_path = os.path.join(d, "001.json")
            with open(msg_path, "w") as f:
                json.dump({"type": "message", "text": "follow up"}, f)
            result = await _poll_ipc_input(d)
            assert result == "follow up"
            assert not os.path.exists(msg_path)
    asyncio.run(_test())


def test_open_checkpointer_async_enters_context_and_returns_saver():
    seen = []

    @asynccontextmanager
    async def fake_saver_factory(conn_string):
        seen.append(conn_string)
        yield {"conn_string": conn_string}

    async def _test():
        with tempfile.TemporaryDirectory() as d:
            checkpoint_db = os.path.join(d, "nested", "checkpoints.db")
            async with AsyncExitStack() as stack:
                checkpointer = await main_mod._open_checkpointer_async(
                    checkpoint_db,
                    stack,
                    saver_factory=fake_saver_factory,
                )
                assert checkpointer == {"conn_string": checkpoint_db}
                assert seen == [checkpoint_db]
                assert os.path.isdir(os.path.dirname(checkpoint_db))

    asyncio.run(_test())


def test_run_query_emits_text_from_list_content(monkeypatch):
    stream_events = []
    outputs = []

    fake_messages_mod = types.ModuleType("langchain_core.messages")

    class FakeHumanMessage:
        def __init__(self, content):
            self.content = content

    fake_messages_mod.HumanMessage = FakeHumanMessage
    monkeypatch.setitem(sys.modules, "langchain_core.messages", fake_messages_mod)

    class FakeChunk:
        def __init__(self, content):
            self.content = content

    class FakeOutput:
        def __init__(self):
            self.response_metadata = {"usage": {"input_tokens": 1, "output_tokens": 2}}

    class FakeAgent:
        async def astream_events(self, *_args, **_kwargs):
            yield {
                "event": "on_chat_model_stream",
                "data": {
                    "chunk": FakeChunk([
                        {"type": "text", "text": "你好"},
                    ])
                },
            }
            yield {
                "event": "on_chat_model_stream",
                "data": {
                    "chunk": FakeChunk([
                        {"type": "text", "text": "！"},
                    ])
                },
            }
            yield {
                "event": "on_chat_model_end",
                "data": {"output": FakeOutput()},
            }

    monkeypatch.setattr(main_mod, "emit_stream_event", lambda event: stream_events.append(event))
    monkeypatch.setattr(main_mod, "emit_output", lambda output: outputs.append(output))

    asyncio.run(main_mod._run_query(FakeAgent(), "你好", {}, "thread-1"))

    assert stream_events == [
        {"type": "text_delta", "text": "你好"},
        {"type": "text_delta", "text": "！"},
    ]
    assert outputs[-1]["status"] == "success"
    assert outputs[-1]["result"] == "你好！"


def test_run_query_emits_thinking_as_compatible_content_block_events(monkeypatch):
    stream_events = []
    outputs = []

    fake_messages_mod = types.ModuleType("langchain_core.messages")

    class FakeHumanMessage:
        def __init__(self, content):
            self.content = content

    fake_messages_mod.HumanMessage = FakeHumanMessage
    monkeypatch.setitem(sys.modules, "langchain_core.messages", fake_messages_mod)

    class FakeChunk:
        def __init__(self, content):
            self.content = content

    class FakeOutput:
        def __init__(self):
            self.response_metadata = {"usage": {"input_tokens": 1, "output_tokens": 2}}

    class FakeAgent:
        async def astream_events(self, *_args, **_kwargs):
            yield {
                "event": "on_chat_model_stream",
                "data": {
                    "chunk": FakeChunk([
                        {"type": "thinking", "thinking": "先"},
                        {"type": "text", "text": "你好"},
                    ])
                },
            }
            yield {
                "event": "on_chat_model_stream",
                "data": {
                    "chunk": FakeChunk([
                        {"type": "thinking", "thinking": "思考"},
                        {"type": "text", "text": "！"},
                    ])
                },
            }
            yield {
                "event": "on_chat_model_end",
                "data": {"output": FakeOutput()},
            }

    monkeypatch.setattr(main_mod, "emit_stream_event", lambda event: stream_events.append(event))
    monkeypatch.setattr(main_mod, "emit_output", lambda output: outputs.append(output))

    asyncio.run(main_mod._run_query(FakeAgent(), "你好", {}, "thread-think"))

    assert stream_events == [
        {
            "type": "content_block_start",
            "index": 0,
            "content_block": {"type": "thinking", "text": ""},
        },
        {
            "type": "content_block_delta",
            "index": 0,
            "delta": {"type": "thinking_delta", "thinking": "先"},
        },
        {"type": "text_delta", "text": "你好"},
        {
            "type": "content_block_delta",
            "index": 0,
            "delta": {"type": "thinking_delta", "thinking": "思考"},
        },
        {"type": "text_delta", "text": "！"},
        {"type": "content_block_stop", "index": 0},
    ]
    assert outputs[-1]["result"] == "你好！"


def test_run_query_emits_tool_events_as_frontend_compatible_blocks(monkeypatch):
    stream_events = []
    outputs = []

    fake_messages_mod = types.ModuleType("langchain_core.messages")

    class FakeHumanMessage:
        def __init__(self, content):
            self.content = content

    fake_messages_mod.HumanMessage = FakeHumanMessage
    monkeypatch.setitem(sys.modules, "langchain_core.messages", fake_messages_mod)

    class FakeToolOutput:
        def __init__(self, content):
            self.content = content

    class FakeOutput:
        def __init__(self):
            self.response_metadata = {"usage": {"input_tokens": 1, "output_tokens": 2}}

    class FakeAgent:
        async def astream_events(self, *_args, **_kwargs):
            yield {
                "event": "on_tool_start",
                "name": "execute",
                "run_id": "tool-run-1",
                "data": {"input": {"command": "pwd"}},
            }
            yield {
                "event": "on_tool_end",
                "name": "execute",
                "run_id": "tool-run-1",
                "data": {"output": FakeToolOutput("/tmp/project\n\n[Command succeeded with exit code 0]")},
            }
            yield {
                "event": "on_chat_model_end",
                "data": {"output": FakeOutput()},
            }

    monkeypatch.setattr(main_mod, "emit_stream_event", lambda event: stream_events.append(event))
    monkeypatch.setattr(main_mod, "emit_output", lambda output: outputs.append(output))

    asyncio.run(main_mod._run_query(FakeAgent(), "执行 pwd", {}, "thread-tool"))

    assert stream_events == [
        {
            "type": "content_block_start",
            "index": 0,
            "content_block": {
                "type": "tool_use",
                "id": "tool-run-1",
                "name": "Bash",
                "input": {"command": "pwd"},
            },
        },
        {
            "type": "tool_result",
            "tool_use_id": "tool-run-1",
            "content": "/tmp/project\n\n[Command succeeded with exit code 0]",
            "is_error": False,
        },
    ]


def test_run_query_uses_unique_block_indexes_across_repeated_thinking_and_tool_phases(monkeypatch):
    stream_events = []
    outputs = []

    fake_messages_mod = types.ModuleType("langchain_core.messages")

    class FakeHumanMessage:
        def __init__(self, content):
            self.content = content

    fake_messages_mod.HumanMessage = FakeHumanMessage
    monkeypatch.setitem(sys.modules, "langchain_core.messages", fake_messages_mod)

    class FakeChunk:
        def __init__(self, content):
            self.content = content

    class FakeOutput:
        def __init__(self, content=None):
            self.content = content or []
            self.response_metadata = {"usage": {"input_tokens": 1, "output_tokens": 2}}

    class FakeToolOutput:
        def __init__(self, content):
            self.content = content

    class FakeAgent:
        async def astream_events(self, *_args, **_kwargs):
            yield {
                "event": "on_chat_model_stream",
                "data": {"chunk": FakeChunk([{"type": "thinking", "thinking": "先想"}])},
            }
            yield {
                "event": "on_chat_model_end",
                "data": {"output": FakeOutput()},
            }
            yield {
                "event": "on_tool_start",
                "name": "execute",
                "run_id": "tool-run-2",
                "data": {"input": {"command": "pwd"}},
            }
            yield {
                "event": "on_tool_end",
                "name": "execute",
                "run_id": "tool-run-2",
                "data": {"output": FakeToolOutput("/app\n\n[Command succeeded with exit code 0]")},
            }
            yield {
                "event": "on_chat_model_stream",
                "data": {"chunk": FakeChunk([{"type": "thinking", "thinking": "再想"}])},
            }
            yield {
                "event": "on_chat_model_end",
                "data": {"output": FakeOutput([{"type": "text", "text": "当前工作目录是 /app"}])},
            }

    monkeypatch.setattr(main_mod, "emit_stream_event", lambda event: stream_events.append(event))
    monkeypatch.setattr(main_mod, "emit_output", lambda output: outputs.append(output))

    asyncio.run(main_mod._run_query(FakeAgent(), "执行 pwd", {}, "thread-tool-2"))

    assert stream_events == [
        {
            "type": "content_block_start",
            "index": 0,
            "content_block": {"type": "thinking", "text": ""},
        },
        {
            "type": "content_block_delta",
            "index": 0,
            "delta": {"type": "thinking_delta", "thinking": "先想"},
        },
        {"type": "content_block_stop", "index": 0},
        {
            "type": "content_block_start",
            "index": 1,
            "content_block": {
                "type": "tool_use",
                "id": "tool-run-2",
                "name": "Bash",
                "input": {"command": "pwd"},
            },
        },
        {
            "type": "tool_result",
            "tool_use_id": "tool-run-2",
            "content": "/app\n\n[Command succeeded with exit code 0]",
            "is_error": False,
        },
        {
            "type": "content_block_start",
            "index": 2,
            "content_block": {"type": "thinking", "text": ""},
        },
        {
            "type": "content_block_delta",
            "index": 2,
            "delta": {"type": "thinking_delta", "thinking": "再想"},
        },
        {"type": "content_block_stop", "index": 2},
    ]
    assert outputs[-1]["result"] == "当前工作目录是 /app"
