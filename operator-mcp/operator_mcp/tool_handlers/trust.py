"""Agent trust/reputation tool handlers."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .._log import _log
from ..construct_config import harness_project
from ..kumiho_clients import KumihoAgentPoolClient


async def tool_record_agent_outcome(args: dict[str, Any], pool_client: KumihoAgentPoolClient) -> dict[str, Any]:
    if not pool_client._available:
        return {"error": "Kumiho not available."}

    agent_id = args["agent_id"]
    template_name = args.get("template_name", f"adhoc-{agent_id[:8]}")
    outcome = args["outcome"]
    task_summary = args["task_summary"]
    _project = harness_project()
    trust_space = f"/{_project}/AgentTrust"

    try:
        await pool_client.ensure_space(_project, "AgentTrust")

        items = await pool_client.list_items(trust_space)
        existing_kref = None
        existing_meta = {}
        for item in items:
            if item.get("item_name") == template_name:
                existing_kref = item.get("kref")
                rev = await pool_client.get_latest_revision(existing_kref)
                if rev:
                    existing_meta = rev.get("metadata", {})
                else:
                    existing_meta = item.get("metadata", {})
                break

        now = datetime.now(timezone.utc).isoformat()
        score_weights = {"success": 1.0, "partial": 0.5, "failed": 0.0}
        score_val = score_weights.get(outcome, 0.5)

        if existing_kref:
            total_runs = int(existing_meta.get("total_runs", 0)) + 1
            total_score = float(existing_meta.get("total_score", 0.0)) + score_val
            trust_score = round(total_score / total_runs, 3)

            recent = existing_meta.get("recent_outcomes", "")
            recent_list = [r for r in recent.split("|") if r] if recent else []
            recent_list.append(f"{outcome}:{task_summary[:50]}:{now}")
            recent_list = recent_list[-10:]

            meta = {
                "total_runs": total_runs,
                "total_score": round(total_score, 3),
                "trust_score": trust_score,
                "recent_outcomes": "|".join(recent_list),
                "last_run": now,
                "template_name": template_name,
            }
            await pool_client.create_revision(existing_kref, meta)
        else:
            meta = {
                "total_runs": 1,
                "total_score": score_val,
                "trust_score": score_val,
                "recent_outcomes": f"{outcome}:{task_summary[:50]}:{now}",
                "last_run": now,
                "template_name": template_name,
            }
            item = await pool_client.create_item(trust_space, template_name, "trust_record", meta)
            await pool_client.create_revision(item["kref"], meta)

        _log(f"Recorded {outcome} for '{template_name}' (trust: {meta['trust_score']})")
        return {
            "recorded": True,
            "template_name": template_name,
            "trust_score": meta["trust_score"],
            "total_runs": meta["total_runs"],
        }
    except Exception as e:
        _log(f"Trust recording failed: {e}")
        return {"error": f"Failed to record outcome: {e}"}


async def tool_get_agent_trust(args: dict[str, Any], pool_client: KumihoAgentPoolClient) -> dict[str, Any]:
    if not pool_client._available:
        return {"error": "Kumiho not available.", "agents": []}

    template_name = args.get("template_name")
    trust_space = f"/{harness_project()}/AgentTrust"

    try:
        items = await pool_client.list_items(trust_space)

        agents = []
        for item in items:
            name = item.get("item_name", "")
            if template_name and name != template_name:
                continue
            rev = await pool_client.get_latest_revision(item.get("kref", ""))
            meta = rev.get("metadata", {}) if rev else item.get("metadata", {})
            recent_raw = meta.get("recent_outcomes", "")
            recent = []
            for entry in recent_raw.split("|"):
                if entry:
                    parts = entry.split(":", 2)
                    if len(parts) >= 2:
                        recent.append({"outcome": parts[0], "task": parts[1], "when": parts[2] if len(parts) > 2 else ""})

            agents.append({
                "template_name": name,
                "trust_score": float(meta.get("trust_score", 0.0)),
                "total_runs": int(meta.get("total_runs", 0)),
                "last_run": meta.get("last_run", ""),
                "recent_outcomes": recent,
            })

        agents.sort(key=lambda a: -a["trust_score"])
        return {"agents": agents, "count": len(agents)}
    except Exception as e:
        _log(f"Trust retrieval failed: {e}")
        return {"error": f"Trust retrieval failed: {e}", "agents": []}
