from __future__ import annotations
import json
import os
import re
import subprocess

def load_dangerous_rules(json_path: str) -> list[dict]:
    with open(json_path) as f:
        rules = json.load(f)
    for rule in rules:
        flags = 0
        if rule.get("flags") and "i" in rule["flags"]:
            flags |= re.IGNORECASE
        rule["_compiled"] = re.compile(rule["pattern"], flags)
    return rules

def check_dangerous(command: str, rules: list[dict]) -> dict | None:
    for rule in rules:
        if rule["_compiled"].search(command):
            return {"severity": rule["severity"], "reason": rule["reason"]}
    return None


def create_confirming_backend(workspace_root: str, rules: list[dict], confirm_bin: str | None = None):
    """Create a LocalShellBackend variant that asks for confirmation on dangerous commands."""
    from deepagents.backends import LocalShellBackend
    from deepagents.backends.protocol import ExecuteResponse

    class ConfirmingLocalShellBackend(LocalShellBackend):
        def execute(self, command: str, *, timeout: int | None = None) -> ExecuteResponse:
            danger = check_dangerous(command, rules)
            if danger and danger["severity"] == "high" and confirm_bin:
                try:
                    result = subprocess.run(
                        [confirm_bin, command, danger["reason"]],
                        timeout=300,
                        capture_output=True,
                        text=True,
                    )
                    if result.returncode == 2:
                        return ExecuteResponse(
                            output=f"Command denied by user: {danger['reason']}",
                            exit_code=2,
                            truncated=False,
                        )
                except subprocess.TimeoutExpired:
                    return ExecuteResponse(
                        output="Command confirmation timed out.",
                        exit_code=124,
                        truncated=False,
                    )
                except FileNotFoundError:
                    pass

            return super().execute(command, timeout=timeout)

    return ConfirmingLocalShellBackend(
        root_dir=workspace_root,
        virtual_mode=False,
        inherit_env=True,
    )


def create_execute_tool(workspace_root: str, rules: list[dict], confirm_bin: str | None = None):
    """Create a custom execute tool with dangerous command checking."""
    try:
        from langchain_core.tools import tool as lc_tool
    except ImportError:
        def lc_tool(fn):
            fn.name = fn.__name__
            fn.invoke = lambda args: fn(**args)
            return fn

    @lc_tool
    def execute(command: str, timeout: int = 120) -> str:
        """Execute a shell command in the workspace."""
        danger = check_dangerous(command, rules)
        if danger and danger["severity"] == "high" and confirm_bin:
            try:
                result = subprocess.run(
                    [confirm_bin, command, danger["reason"]],
                    timeout=300,
                    capture_output=True,
                )
                if result.returncode == 2:
                    return f"Command denied by user: {danger['reason']}"
            except subprocess.TimeoutExpired:
                return "Command confirmation timed out."
            except FileNotFoundError:
                pass

        try:
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=workspace_root,
                env={**os.environ},
            )
            output = result.stdout
            if result.stderr:
                output += f"\nSTDERR:\n{result.stderr}"
            return f"Exit code: {result.returncode}\n{output}"
        except subprocess.TimeoutExpired:
            return f"Command timed out after {timeout}s"
        except Exception as e:
            return f"Error executing command: {e}"

    return execute
