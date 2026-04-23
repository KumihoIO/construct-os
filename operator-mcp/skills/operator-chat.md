# Operator Chat Skill

**Pattern:** Async coordination protocol via persistent chat rooms.

Chat rooms are the primary coordination layer for multi-agent work. They serve as shared memory, async mailbox, and decision log.

## Core Concepts

### Rooms as Async Mailbox
- Agents catch up by reading from the beginning (or since their last read)
- Messages persist for the session lifetime
- Rooms outlive individual agents — they're the team's memory

### Active Mentions vs Passive Posts
- **Normal post**: Written to the room log. Other agents see it when they read.
- **@mention**: Actively interrupts the mentioned agent. If the agent is idle, it receives the message as a follow-up prompt immediately. If running, the notification is queued.
- **Use mentions sparingly.** Most coordination is async — only mention when you need an immediate response.

### Reply Tracking
- Use `reply_to` to thread conversations
- Helps agents follow specific discussion threads without reading everything

## Room Lifecycle

### Create
```
chat_create(name="<project>-<purpose>", purpose="<objective>")
```
Good room names: `auth-refactor-sync`, `ci-fix-coordination`, `design-review`

### Seed with Context
First message should set the stage:
```
chat_post(
    room_id=room_id,
    content="Objective: <what we're doing>\nTeam: <who's involved>\nConstraints: <guardrails>",
    sender_name="Operator"
)
```

### Coordinate
Typical message types agents should post:
- **Status updates**: "Finished implementing the auth middleware. 3 files changed."
- **Blockers**: "Blocked on missing type definition for SessionToken. @coder-types can you add it?"
- **Handoffs**: "Review ready. Changes in src/auth/. @reviewer-auth please check."
- **Decisions**: "Going with approach B (JWT rotation) based on the performance analysis."
- **Questions**: "Should we keep backward compat with v1 tokens? @operator"

### Monitor
```
# Read recent messages
chat_read(room_id=room_id, limit=20)

# Wait for new activity (blocks up to 30s)
chat_wait(room_id=room_id, timeout=30000)
```

### Clean Up
Delete rooms when the project is complete:
```
chat_delete(room_id=room_id)
```

## Patterns

### Coordination Room + Status Updates
One room per project. All agents post status. Operator reads periodically.
Best for: teams of 3+ agents working on related tasks.

### Review Channel
Dedicated room for code review findings. Reviewers post, coders read and fix.
Best for: iterative review cycles.

### Escalation Room
Room where agents post blockers and questions for the operator/user.
Best for: complex projects where agents need guidance.

## Guidelines

- **Bounded reads.** Use `limit=20` or `limit=50`. Don't read entire room histories — agents should focus on recent messages.
- **Post summaries, not dumps.** "3 files changed, tests pass" is better than pasting the full diff.
- **One room per concern.** Don't mix unrelated projects in the same room.
- **Rooms are cheap.** Create them freely. Delete when done.
- **Channel visibility.** Chat room activity is forwarded to connected channels (Slack, Discord, dashboard). Users can see agent coordination in real-time and post messages to rooms via channel commands.
