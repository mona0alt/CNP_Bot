import json
import os
import uuid
import tempfile
import asyncio
import pytest
from src.protocol import parse_container_input
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
