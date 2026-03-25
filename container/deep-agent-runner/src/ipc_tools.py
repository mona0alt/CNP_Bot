from __future__ import annotations
import json
import os
import time
import uuid

def create_ipc_tools(ipc_dir: str, chat_jid: str, group_folder: str) -> list:
    """Create IPC tools bound to a specific IPC directory and session context.

    Returns a list of tool functions. When langchain_core is available,
    these are decorated as LangChain tools. Otherwise, plain callables.
    """
    try:
        from langchain_core.tools import tool as lc_tool
    except ImportError:
        # Fallback: use a simple decorator that preserves function metadata
        def lc_tool(fn):
            fn.name = fn.__name__
            fn.invoke = lambda args: fn(**args)
            return fn

    @lc_tool
    def send_message(message: str) -> str:
        """Send a message to the user immediately."""
        msg_id = f"{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"
        payload = {
            "type": "message",
            "chatJid": chat_jid,
            "text": message,
            "groupFolder": group_folder,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        }
        fpath = os.path.join(ipc_dir, "messages", f"{msg_id}.json")
        with open(fpath, "w") as f:
            json.dump(payload, f)
        return "Message sent."

    @lc_tool
    def ask_user(question: str) -> str:
        """Ask the user a question and wait for their response."""
        request_id = uuid.uuid4().hex
        payload = {
            "type": "ask_user",
            "requestId": request_id,
            "chatJid": chat_jid,
            "question": question,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        }
        req_path = os.path.join(ipc_dir, "ask_requests", f"{request_id}.json")
        with open(req_path, "w") as f:
            json.dump(payload, f)
        resp_path = os.path.join(ipc_dir, "ask_responses", f"{request_id}.json")
        deadline = time.time() + 300
        while time.time() < deadline:
            if os.path.exists(resp_path):
                with open(resp_path) as f:
                    resp = json.load(f)
                os.remove(resp_path)
                return resp.get("answer", "")
            time.sleep(0.5)
        return "[Timeout: no response from user]"

    @lc_tool
    def schedule_task(name: str, schedule_type: str, schedule_value: str, prompt: str) -> str:
        """Schedule a recurring or one-time task."""
        task_id = uuid.uuid4().hex
        payload = {
            "type": "schedule_task",
            "taskId": task_id,
            "prompt": prompt,
            "schedule_type": schedule_type,
            "schedule_value": schedule_value,
            "targetJid": chat_jid,
            "createdBy": group_folder,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        }
        fpath = os.path.join(ipc_dir, "tasks", f"{task_id}.json")
        with open(fpath, "w") as f:
            json.dump(payload, f)
        return f"Task '{name}' scheduled (id: {task_id})."

    @lc_tool
    def list_tasks() -> str:
        """List all scheduled tasks for this group."""
        tasks_file = os.path.join(ipc_dir, "current_tasks.json")
        if not os.path.exists(tasks_file):
            return "No tasks found."
        with open(tasks_file) as f:
            tasks = json.load(f)
        return json.dumps(tasks, indent=2) if tasks else "No tasks found."

    def _write_task_action(action: str, task_id: str):
        payload = {"type": action, "taskId": task_id}
        fpath = os.path.join(ipc_dir, "tasks", f"{action}_{task_id}.json")
        with open(fpath, "w") as f:
            json.dump(payload, f)

    @lc_tool
    def pause_task(task_id: str) -> str:
        """Pause a scheduled task."""
        _write_task_action("pause_task", task_id)
        return f"Task {task_id} paused."

    @lc_tool
    def resume_task(task_id: str) -> str:
        """Resume a paused task."""
        _write_task_action("resume_task", task_id)
        return f"Task {task_id} resumed."

    @lc_tool
    def cancel_task(task_id: str) -> str:
        """Cancel a scheduled task."""
        _write_task_action("cancel_task", task_id)
        return f"Task {task_id} cancelled."

    return [send_message, ask_user, schedule_task, list_tasks, pause_task, resume_task, cancel_task]
