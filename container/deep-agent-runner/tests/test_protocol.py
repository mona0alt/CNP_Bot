import json
import pytest
from src.protocol import parse_container_input, emit_output, ContainerInput

def test_parse_container_input_full():
    raw = json.dumps({
        "prompt": "hello",
        "sessionId": "sess-123",
        "groupFolder": "my-group",
        "chatJid": "web:abc",
        "isMain": False,
        "isScheduledTask": False,
        "assistantName": "Bot",
        "secrets": {"ANTHROPIC_API_KEY": "sk-test"},
    })
    ci = parse_container_input(raw)
    assert ci.prompt == "hello"
    assert ci.session_id == "sess-123"
    assert ci.group_folder == "my-group"
    assert ci.secrets == {"ANTHROPIC_API_KEY": "sk-test"}

def test_parse_container_input_minimal():
    raw = json.dumps({
        "prompt": "hi",
        "groupFolder": "g1",
        "chatJid": "web:x",
        "isMain": True,
    })
    ci = parse_container_input(raw)
    assert ci.prompt == "hi"
    assert ci.session_id is None
    assert ci.secrets is None

def test_emit_output_format(capsys):
    emit_output({"status": "success", "result": "done", "newSessionId": "s1"})
    captured = capsys.readouterr()
    assert "---CNP_BOT_OUTPUT_START---" in captured.out
    assert "---CNP_BOT_OUTPUT_END---" in captured.out
    start = captured.out.index("---CNP_BOT_OUTPUT_START---") + len("---CNP_BOT_OUTPUT_START---\n")
    end = captured.out.index("---CNP_BOT_OUTPUT_END---")
    data = json.loads(captured.out[start:end].strip())
    assert data["status"] == "success"
    assert data["result"] == "done"
    assert data["newSessionId"] == "s1"

def test_emit_stream_event(capsys):
    from src.protocol import emit_stream_event
    emit_stream_event({"type": "text_delta", "text": "hi"})
    captured = capsys.readouterr()
    start = captured.out.index("---CNP_BOT_OUTPUT_START---") + len("---CNP_BOT_OUTPUT_START---\n")
    end = captured.out.index("---CNP_BOT_OUTPUT_END---")
    data = json.loads(captured.out[start:end].strip())
    assert data["streamEvent"]["type"] == "text_delta"
    assert data["streamEvent"]["text"] == "hi"
