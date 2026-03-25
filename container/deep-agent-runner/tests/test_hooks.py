import json
import os
import tempfile
import pytest
from src.hooks import load_dangerous_rules, check_dangerous

@pytest.fixture
def rules_file():
    rules = [
        {"pattern": "rm\\s+-rf\\s+/", "severity": "high", "reason": "Recursive delete from root"},
        {"pattern": "shutdown", "severity": "high", "reason": "System shutdown"},
        {"pattern": "rmdir", "severity": "medium", "reason": "Remove directory"},
        {"pattern": "drop\\s+table", "severity": "high", "reason": "Drop table", "flags": "i"},
    ]
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(rules, f)
        f.flush()
        tmp_name = f.name
    yield tmp_name
    os.unlink(tmp_name)

def test_load_rules(rules_file):
    rules = load_dangerous_rules(rules_file)
    assert len(rules) == 4

def test_check_dangerous_high(rules_file):
    rules = load_dangerous_rules(rules_file)
    result = check_dangerous("rm -rf /etc", rules)
    assert result is not None
    assert result["severity"] == "high"

def test_check_dangerous_medium(rules_file):
    rules = load_dangerous_rules(rules_file)
    result = check_dangerous("rmdir /tmp/foo", rules)
    assert result is not None
    assert result["severity"] == "medium"

def test_check_dangerous_safe(rules_file):
    rules = load_dangerous_rules(rules_file)
    result = check_dangerous("ls -la /tmp", rules)
    assert result is None

def test_check_dangerous_case_insensitive(rules_file):
    rules = load_dangerous_rules(rules_file)
    result = check_dangerous("DROP TABLE users", rules)
    assert result is not None
    assert result["severity"] == "high"
    result2 = check_dangerous("drop table users", rules)
    assert result2 is not None

def test_loads_shared_json():
    """Test loading the actual shared dangerous-commands.json."""
    shared_path = os.path.join(
        os.path.dirname(__file__), '..', '..', 'shared', 'dangerous-commands.json'
    )
    if os.path.exists(shared_path):
        rules = load_dangerous_rules(shared_path)
        assert len(rules) > 0
        result = check_dangerous("rm -rf /", rules)
        assert result is not None
