/**
 * Chat Service — in-memory chat rooms for inter-agent communication.
 *
 * Provides persistent (within session) chat rooms where agents can post
 * messages, @mention other agents, and coordinate asynchronously.
 *
 * Mention-based interrupts:
 *   When agent A posts with mentions=[agentB], the AgentManager is notified
 *   so it can inject the message into B's next turn if B is idle, or queue
 *   it if B is running.
 */
import { randomUUID } from "node:crypto";
const log = (msg) => process.stderr.write(`[session-mgr:chat] ${msg}\n`);
export class ChatService {
    rooms = new Map();
    waiters = new Map();
    onMention = null;
    /**
     * Register a callback for @mention notifications.
     * Called whenever a message mentions an agent ID.
     */
    setMentionHandler(handler) {
        this.onMention = handler;
    }
    /**
     * Create a new chat room.
     */
    createRoom(name, purpose) {
        // Check for existing room with same name
        for (const room of this.rooms.values()) {
            if (room.name === name) {
                log(`Room already exists: ${name} (${room.id})`);
                return room;
            }
        }
        const room = {
            id: randomUUID(),
            name,
            purpose,
            messages: [],
            createdAt: new Date().toISOString(),
        };
        this.rooms.set(room.id, room);
        log(`Created room: ${name} (${room.id})`);
        return room;
    }
    /**
     * Post a message to a room.
     */
    postMessage(roomId, senderId, senderName, content, mentions = [], replyTo) {
        const room = this.rooms.get(roomId);
        if (!room)
            return null;
        const message = {
            id: randomUUID(),
            senderId,
            senderName,
            content,
            mentions,
            replyTo,
            timestamp: new Date().toISOString(),
        };
        room.messages.push(message);
        // Cap at 500 messages per room
        if (room.messages.length > 500) {
            room.messages = room.messages.slice(-500);
        }
        log(`[${room.name}] ${senderName}: ${content.slice(0, 80)}${content.length > 80 ? "..." : ""}`);
        // Notify waiters
        const roomWaiters = this.waiters.get(roomId);
        if (roomWaiters) {
            for (const resolve of roomWaiters) {
                resolve(message);
            }
            this.waiters.delete(roomId);
        }
        // Trigger mention callbacks
        if (mentions.length > 0 && this.onMention) {
            for (const _mentionedId of mentions) {
                try {
                    this.onMention(roomId, message);
                }
                catch {
                    // don't let callback errors break the chat
                }
            }
        }
        return message;
    }
    /**
     * Read messages from a room.
     */
    readMessages(roomId, limit = 50, since) {
        const room = this.rooms.get(roomId);
        if (!room)
            return [];
        let messages = room.messages;
        if (since) {
            const sinceTime = new Date(since).getTime();
            messages = messages.filter((m) => new Date(m.timestamp).getTime() > sinceTime);
        }
        return messages.slice(-limit);
    }
    /**
     * Wait for a new message in a room (with timeout).
     */
    async waitForMessage(roomId, timeoutMs = 30000) {
        const room = this.rooms.get(roomId);
        if (!room)
            return null;
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                // Remove this waiter on timeout
                const roomWaiters = this.waiters.get(roomId);
                if (roomWaiters) {
                    const idx = roomWaiters.indexOf(resolve);
                    if (idx >= 0)
                        roomWaiters.splice(idx, 1);
                }
                resolve(null);
            }, timeoutMs);
            const wrappedResolve = (msg) => {
                clearTimeout(timer);
                resolve(msg);
            };
            if (!this.waiters.has(roomId)) {
                this.waiters.set(roomId, []);
            }
            this.waiters.get(roomId).push(wrappedResolve);
        });
    }
    /**
     * List all rooms.
     */
    listRooms() {
        return Array.from(this.rooms.values()).map((r) => ({
            id: r.id,
            name: r.name,
            purpose: r.purpose,
            messageCount: r.messages.length,
            createdAt: r.createdAt,
        }));
    }
    /**
     * Get a specific room.
     */
    getRoom(roomId) {
        return this.rooms.get(roomId);
    }
    /**
     * Find a room by name.
     */
    findRoomByName(name) {
        for (const room of this.rooms.values()) {
            if (room.name === name)
                return room;
        }
        return undefined;
    }
    /**
     * Delete a room.
     */
    deleteRoom(roomId) {
        const room = this.rooms.get(roomId);
        if (!room)
            return false;
        log(`Deleted room: ${room.name} (${roomId})`);
        this.rooms.delete(roomId);
        this.waiters.delete(roomId);
        return true;
    }
}
//# sourceMappingURL=chat-service.js.map