"""Tests for operator.journal — SessionJournal."""
from __future__ import annotations

import json

import pytest

from operator_mcp.journal import SessionJournal


class TestSessionJournal:
    def test_init_creates_dir(self, journal_path):
        j = SessionJournal(journal_path)
        assert j.path == journal_path
        assert len(j.session_id) == 12

    def test_record_creates_entry(self, journal_path):
        j = SessionJournal(journal_path)
        j.record("agent-1", "created", agent_type="claude", title="Test Agent")
        with open(journal_path) as f:
            lines = f.readlines()
        assert len(lines) == 1
        entry = json.loads(lines[0])
        assert entry["agent_id"] == "agent-1"
        assert entry["event"] == "created"
        assert entry["agent_type"] == "claude"
        assert entry["title"] == "Test Agent"
        assert entry["session"] == j.session_id
        assert "ts" in entry

    def test_record_optional_fields(self, journal_path):
        j = SessionJournal(journal_path)
        j.record("agent-2", "idle", exit_code=0, summary="Done")
        with open(journal_path) as f:
            entry = json.loads(f.readline())
        assert entry["exit_code"] == 0
        assert entry["summary"] == "Done"

    def test_record_omits_empty_fields(self, journal_path):
        j = SessionJournal(journal_path)
        j.record("agent-3", "running")
        with open(journal_path) as f:
            entry = json.loads(f.readline())
        assert "agent_type" not in entry
        assert "title" not in entry
        assert "exit_code" not in entry

    def test_record_multiple(self, journal_path):
        j = SessionJournal(journal_path)
        j.record("a1", "created")
        j.record("a1", "running")
        j.record("a1", "idle")
        with open(journal_path) as f:
            lines = f.readlines()
        assert len(lines) == 3

    def test_load_history_empty(self, journal_path):
        j = SessionJournal(journal_path)
        assert j.load_history() == []

    def test_load_history(self, journal_path):
        j = SessionJournal(journal_path)
        j.record("a1", "created")
        j.record("a1", "running")
        j.record("a1", "idle")
        history = j.load_history()
        assert len(history) == 3
        # newest first
        assert history[0]["event"] == "idle"
        assert history[-1]["event"] == "created"

    def test_load_history_limit(self, journal_path):
        j = SessionJournal(journal_path)
        for i in range(10):
            j.record(f"a-{i}", "created")
        history = j.load_history(limit=3)
        assert len(history) == 3

    def test_load_history_filter_agent(self, journal_path):
        j = SessionJournal(journal_path)
        j.record("a1", "created")
        j.record("a2", "created")
        j.record("a1", "running")
        history = j.load_history(agent_id="a1")
        assert len(history) == 2
        assert all(e["agent_id"] == "a1" for e in history)

    def test_load_history_filter_session(self, journal_path):
        j1 = SessionJournal(journal_path)
        j1.record("a1", "created")
        # Write an entry with a different session ID manually
        with open(journal_path, "a") as f:
            f.write(json.dumps({"session": "other-session", "agent_id": "a2", "event": "created", "ts": ""}) + "\n")
        history = j1.load_history(session_id=j1.session_id)
        assert len(history) == 1
        assert history[0]["agent_id"] == "a1"

    def test_list_sessions_empty(self, journal_path):
        j = SessionJournal(journal_path)
        assert j.list_sessions() == []

    def test_list_sessions(self, journal_path):
        j = SessionJournal(journal_path)
        j.record("a1", "created")
        j.record("a2", "created")
        j.record("a1", "running")
        sessions = j.list_sessions()
        assert len(sessions) == 1
        assert sessions[0]["session_id"] == j.session_id
        assert sessions[0]["agent_count"] == 2
        assert sessions[0]["events"] == 3

    def test_list_sessions_multiple(self, journal_path):
        j1 = SessionJournal(journal_path)
        j1.record("a1", "created")
        # Simulate a second session
        with open(journal_path, "a") as f:
            f.write(json.dumps({"session": "sess-2", "agent_id": "a2", "event": "created", "ts": "2025-01-02T00:00:00Z"}) + "\n")
        sessions = j1.list_sessions()
        assert len(sessions) == 2

    def test_load_history_handles_bad_json(self, journal_path):
        j = SessionJournal(journal_path)
        j.record("a1", "created")
        with open(journal_path, "a") as f:
            f.write("not valid json\n")
        j.record("a1", "running")
        history = j.load_history()
        assert len(history) == 2  # bad line skipped
