import json
import os
import tempfile
import pytest
from src.ipc_tools import create_ipc_tools

@pytest.fixture
def ipc_dir():
    with tempfile.TemporaryDirectory() as d:
        for sub in ['messages', 'ask_requests', 'ask_responses', 'tasks']:
            os.makedirs(os.path.join(d, sub))
        yield d

def test_send_message_writes_file(ipc_dir):
    tools = create_ipc_tools(ipc_dir, "web:abc", "test-group")
    send_msg = next(t for t in tools if t.name == "send_message")
    result = send_msg.invoke({"message": "hello world"})
    files = os.listdir(os.path.join(ipc_dir, 'messages'))
    assert len(files) == 1
    data = json.loads(open(os.path.join(ipc_dir, 'messages', files[0])).read())
    assert data["text"] == "hello world"
    assert data["chatJid"] == "web:abc"
    assert data["type"] == "message"

def test_schedule_task_writes_file(ipc_dir):
    tools = create_ipc_tools(ipc_dir, "web:abc", "test-group")
    sched = next(t for t in tools if t.name == "schedule_task")
    result = sched.invoke({
        "name": "check-disk",
        "schedule_type": "cron",
        "schedule_value": "0 * * * *",
        "prompt": "check disk usage",
    })
    files = os.listdir(os.path.join(ipc_dir, 'tasks'))
    assert len(files) == 1
    data = json.loads(open(os.path.join(ipc_dir, 'tasks', files[0])).read())
    assert data["type"] == "schedule_task"
    assert data["prompt"] == "check disk usage"

def test_list_tasks_empty(ipc_dir):
    tools = create_ipc_tools(ipc_dir, "web:abc", "test-group")
    lt = next(t for t in tools if t.name == "list_tasks")
    result = lt.invoke({})
    assert "No tasks" in result

def test_pause_task_writes_file(ipc_dir):
    tools = create_ipc_tools(ipc_dir, "web:abc", "test-group")
    pt = next(t for t in tools if t.name == "pause_task")
    result = pt.invoke({"task_id": "abc123"})
    files = os.listdir(os.path.join(ipc_dir, 'tasks'))
    assert len(files) == 1
    data = json.loads(open(os.path.join(ipc_dir, 'tasks', files[0])).read())
    assert data["type"] == "pause_task"
    assert data["taskId"] == "abc123"
