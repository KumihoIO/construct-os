"""Team graph validation — rejects invalid DAGs before they reach storage or spawn.

Validates team edge graphs for:
  - Cycles in execution-relevant edges (DEPENDS_ON, SUPPORTS, FEEDS_INTO)
  - Reciprocal DEPENDS_ON edges (A→B + B→A)
  - Reciprocal REPORTS_TO edges (A→B + B→A)
  - Edges referencing non-existent members
  - Self-referencing edges

Returns structured ValidationResult with specific, actionable error messages.
"""
from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any


# Edge types that affect execution ordering (used in toposort)
_EXECUTION_EDGES = frozenset({"DEPENDS_ON", "SUPPORTS", "FEEDS_INTO"})


@dataclass
class ValidationError:
    """A single validation failure."""
    code: str        # machine-readable: "cycle", "reciprocal_depends", "reciprocal_reports_to", "dangling_ref", "self_edge"
    message: str     # human-readable explanation
    edges: list[dict[str, str]] = field(default_factory=list)  # offending edges


@dataclass
class ValidationResult:
    """Result of team graph validation."""
    valid: bool
    errors: list[ValidationError] = field(default_factory=list)
    warnings: list[ValidationError] = field(default_factory=list)
    stages_preview: list[list[str]] | None = None  # member names per stage if valid

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {"valid": self.valid}
        if self.errors:
            result["errors"] = [
                {"code": e.code, "message": e.message, "edges": e.edges}
                for e in self.errors
            ]
        if self.warnings:
            result["warnings"] = [
                {"code": w.code, "message": w.message, "edges": w.edges}
                for w in self.warnings
            ]
        if self.stages_preview is not None:
            result["stages_preview"] = self.stages_preview
        return result


def validate_team_edges(
    members: list[dict[str, Any]],
    edges: list[dict[str, str]],
    *,
    include_preview: bool = False,
) -> ValidationResult:
    """Validate a team's edge graph.

    Args:
        members: List of member dicts, each with at least "kref" and "name".
        edges: List of edge dicts with "from_kref", "to_kref", "edge_type".
        include_preview: If True and valid, compute topological stage preview.

    Returns:
        ValidationResult with errors (hard failures) and warnings (suspicious but allowed).
    """
    errors: list[ValidationError] = []
    warnings: list[ValidationError] = []

    # Build member kref set and name lookup
    member_krefs: set[str] = set()
    kref_to_name: dict[str, str] = {}
    for m in members:
        kref = m.get("kref", "")
        if kref:
            member_krefs.add(kref)
            kref_to_name[kref] = m.get("name", kref[:12])

    def _name(kref: str) -> str:
        return kref_to_name.get(kref, kref[:12])

    if not edges:
        return ValidationResult(
            valid=True,
            stages_preview=[[_name(k) for k in member_krefs]] if include_preview else None,
        )

    # --- Check 1: Self-referencing edges ---
    for edge in edges:
        from_k = edge.get("from_kref", "")
        to_k = edge.get("to_kref", "")
        if from_k and from_k == to_k:
            errors.append(ValidationError(
                code="self_edge",
                message=f"Self-referencing edge: {_name(from_k)} → {_name(from_k)} ({edge.get('edge_type', '?')})",
                edges=[edge],
            ))

    # --- Check 2: Dangling references ---
    for edge in edges:
        from_k = edge.get("from_kref", "")
        to_k = edge.get("to_kref", "")
        if from_k and from_k not in member_krefs:
            errors.append(ValidationError(
                code="dangling_ref",
                message=f"Edge references non-member: from_kref={from_k[:20]}",
                edges=[edge],
            ))
        if to_k and to_k not in member_krefs:
            errors.append(ValidationError(
                code="dangling_ref",
                message=f"Edge references non-member: to_kref={to_k[:20]}",
                edges=[edge],
            ))

    # --- Check 3: Reciprocal DEPENDS_ON (A→B + B→A) ---
    depends_pairs: set[tuple[str, str]] = set()
    for edge in edges:
        et = edge.get("edge_type", "").upper()
        if et == "DEPENDS_ON":
            pair = (edge.get("from_kref", ""), edge.get("to_kref", ""))
            reverse = (pair[1], pair[0])
            if reverse in depends_pairs:
                errors.append(ValidationError(
                    code="reciprocal_depends",
                    message=f"Reciprocal DEPENDS_ON: {_name(pair[0])} ↔ {_name(pair[1])}. One must run before the other — pick a direction.",
                    edges=[
                        {"from_kref": pair[0], "to_kref": pair[1], "edge_type": "DEPENDS_ON"},
                        {"from_kref": pair[1], "to_kref": pair[0], "edge_type": "DEPENDS_ON"},
                    ],
                ))
            depends_pairs.add(pair)

    # --- Check 4: Reciprocal REPORTS_TO (A→B + B→A) ---
    reports_pairs: set[tuple[str, str]] = set()
    for edge in edges:
        et = edge.get("edge_type", "").upper()
        if et == "REPORTS_TO":
            pair = (edge.get("from_kref", ""), edge.get("to_kref", ""))
            reverse = (pair[1], pair[0])
            if reverse in reports_pairs:
                warnings.append(ValidationError(
                    code="reciprocal_reports_to",
                    message=f"Reciprocal REPORTS_TO: {_name(pair[0])} ↔ {_name(pair[1])}. This is usually a mistake — one should report to the other, not both ways.",
                    edges=[
                        {"from_kref": pair[0], "to_kref": pair[1], "edge_type": "REPORTS_TO"},
                        {"from_kref": pair[1], "to_kref": pair[0], "edge_type": "REPORTS_TO"},
                    ],
                ))
            reports_pairs.add(pair)

    # --- Check 5: Cycle detection on execution-relevant edges ---
    # Build directed graph for execution edges only
    adj: dict[str, list[str]] = defaultdict(list)
    in_degree: dict[str, int] = {k: 0 for k in member_krefs}

    for edge in edges:
        et = edge.get("edge_type", "").upper()
        from_k = edge.get("from_kref", "")
        to_k = edge.get("to_kref", "")
        if from_k not in member_krefs or to_k not in member_krefs:
            continue

        if et == "DEPENDS_ON":
            # from depends on to → to must run before from → edge: to → from
            adj[to_k].append(from_k)
            in_degree[from_k] = in_degree.get(from_k, 0) + 1
        elif et in ("SUPPORTS", "FEEDS_INTO"):
            # from supports to → from must run before to → edge: from → to
            adj[from_k].append(to_k)
            in_degree[to_k] = in_degree.get(to_k, 0) + 1

    # Kahn's algorithm
    queue = deque(k for k in member_krefs if in_degree.get(k, 0) == 0)
    visited = 0
    stages: list[list[str]] = []

    while queue:
        stage = list(queue)
        stages.append(stage)
        next_queue: deque[str] = deque()
        for node in stage:
            visited += 1
            for dep in adj.get(node, []):
                in_degree[dep] -= 1
                if in_degree[dep] == 0:
                    next_queue.append(dep)
        queue = next_queue

    if visited < len(member_krefs):
        # Find the cycle members
        cycle_krefs = [k for k in member_krefs if in_degree.get(k, 0) > 0]
        cycle_names = [_name(k) for k in cycle_krefs]

        # Find the specific edges forming the cycle
        cycle_edges = []
        cycle_set = set(cycle_krefs)
        for edge in edges:
            et = edge.get("edge_type", "").upper()
            if et not in _EXECUTION_EDGES:
                continue
            from_k = edge.get("from_kref", "")
            to_k = edge.get("to_kref", "")
            if from_k in cycle_set and to_k in cycle_set:
                cycle_edges.append(edge)

        errors.append(ValidationError(
            code="cycle",
            message=f"Dependency cycle detected among: {', '.join(cycle_names)}. Break the cycle by removing or reversing an edge.",
            edges=cycle_edges,
        ))

    result = ValidationResult(
        valid=len(errors) == 0,
        errors=errors,
        warnings=warnings,
    )

    if include_preview and result.valid:
        result.stages_preview = [[_name(k) for k in stage] for stage in stages]

    return result


# ---------------------------------------------------------------------------
# Team linting — deeper static analysis beyond graph validation
# ---------------------------------------------------------------------------

_VALID_ROLES = frozenset({"coder", "reviewer", "researcher", "tester", "architect", "planner"})

# Role combinations that suggest missing complementary roles
_COMPLEMENTARY_ROLES: dict[str, str] = {
    "coder": "reviewer",
    "architect": "coder",
    "planner": "coder",
}


def lint_team(
    members: list[dict[str, Any]],
    edges: list[dict[str, str]],
    *,
    task: str = "",
) -> dict[str, Any]:
    """Run comprehensive linting on a team definition.

    Goes beyond graph validation to check:
      - Role balance and coverage
      - Naming conventions
      - Member metadata completeness
      - Task-capability alignment (if task provided)
      - Edge coverage (disconnected members)
      - Team size recommendations

    Returns structured lint report with issues and suggestions.
    """
    issues: list[dict[str, Any]] = []
    suggestions: list[str] = []
    info: dict[str, Any] = {}

    # -- Graph validation first --
    graph_result = validate_team_edges(members, edges, include_preview=True)
    if not graph_result.valid:
        for err in graph_result.errors:
            issues.append({"severity": "error", "code": err.code, "message": err.message})
    for warn in graph_result.warnings:
        issues.append({"severity": "warning", "code": warn.code, "message": warn.message})

    # -- Role analysis --
    roles = [m.get("role", "unknown") for m in members]
    role_counts: dict[str, int] = {}
    for r in roles:
        role_counts[r] = role_counts.get(r, 0) + 1
    info["role_distribution"] = role_counts

    # Check for invalid roles
    for m in members:
        role = m.get("role", "")
        if role and role not in _VALID_ROLES:
            issues.append({
                "severity": "warning",
                "code": "invalid_role",
                "message": f"Member '{m.get('name', '?')}' has non-standard role '{role}'",
            })

    # Check for complementary role suggestions
    present_roles = set(role_counts.keys())
    for role, complement in _COMPLEMENTARY_ROLES.items():
        if role in present_roles and complement not in present_roles:
            suggestions.append(
                f"Team has {role_counts[role]} {role}(s) but no {complement} — consider adding a {complement} for quality assurance"
            )

    # Check for reviewer-without-coder
    if "reviewer" in present_roles and "coder" not in present_roles:
        issues.append({
            "severity": "warning",
            "code": "reviewer_without_coder",
            "message": "Team has reviewer(s) but no coders — reviewer will have nothing to review",
        })

    # -- Naming conventions --
    names = [m.get("name", "") for m in members]
    if any(not n or not n.strip() for n in names):
        issues.append({
            "severity": "warning",
            "code": "unnamed_member",
            "message": "Some team members have no name — this makes logs and tracking harder",
        })

    # Check for duplicate names
    name_counts: dict[str, int] = {}
    for n in names:
        if n:
            name_counts[n] = name_counts.get(n, 0) + 1
    for n, count in name_counts.items():
        if count > 1:
            issues.append({
                "severity": "warning",
                "code": "duplicate_name",
                "message": f"Duplicate member name '{n}' ({count} occurrences) — agents will be hard to distinguish",
            })

    # -- Edge coverage (disconnected members) --
    if edges:
        connected = set()
        for edge in edges:
            connected.add(edge.get("from_kref", ""))
            connected.add(edge.get("to_kref", ""))
        member_krefs = {m.get("kref", "") for m in members if m.get("kref")}
        disconnected = member_krefs - connected
        if disconnected and len(disconnected) < len(member_krefs):
            disc_names = [
                m.get("name", m.get("kref", "?")[:12])
                for m in members if m.get("kref") in disconnected
            ]
            issues.append({
                "severity": "info",
                "code": "disconnected_members",
                "message": f"{len(disconnected)} member(s) have no edges: {', '.join(disc_names)}. They will run in the first wave.",
            })

    # -- Team size --
    info["member_count"] = len(members)
    if len(members) > 8:
        suggestions.append(
            f"Team has {len(members)} members — consider splitting into sub-teams for better coordination"
        )
    elif len(members) == 1:
        suggestions.append(
            "Single-member team — use create_agent directly instead of spawn_team for simpler execution"
        )

    # -- Task-capability alignment --
    if task:
        task_lower = task.lower()
        all_capabilities = set()
        for m in members:
            for cap in m.get("capabilities", []):
                all_capabilities.add(cap.lower())
        info["team_capabilities"] = sorted(all_capabilities)

        # Check for obvious task keywords not covered by capabilities
        task_keywords = {"test", "review", "security", "performance", "deploy", "database", "api", "frontend", "backend"}
        for kw in task_keywords:
            if kw in task_lower and kw not in all_capabilities:
                # Check if any capability is a substring match
                if not any(kw in cap for cap in all_capabilities):
                    suggestions.append(
                        f"Task mentions '{kw}' but no team member has a matching capability"
                    )

    # -- Member metadata completeness --
    for m in members:
        name = m.get("name", "?")
        if not m.get("capabilities"):
            issues.append({
                "severity": "info",
                "code": "no_capabilities",
                "message": f"Member '{name}' has no capabilities listed",
            })

    if graph_result.stages_preview:
        info["stages_preview"] = graph_result.stages_preview

    return {
        "valid": graph_result.valid,
        "issues": issues,
        "suggestions": suggestions,
        "info": info,
        "issue_count": len(issues),
        "error_count": sum(1 for i in issues if i["severity"] == "error"),
        "warning_count": sum(1 for i in issues if i["severity"] == "warning"),
    }
