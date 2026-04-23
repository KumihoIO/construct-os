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
import type { ChatRoom, ChatMessage, ChatRoomInfo } from "./types.js";
export type MentionCallback = (roomId: string, message: ChatMessage) => void;
export declare class ChatService {
    private rooms;
    private waiters;
    private onMention;
    /**
     * Register a callback for @mention notifications.
     * Called whenever a message mentions an agent ID.
     */
    setMentionHandler(handler: MentionCallback): void;
    /**
     * Create a new chat room.
     */
    createRoom(name: string, purpose: string): ChatRoom;
    /**
     * Post a message to a room.
     */
    postMessage(roomId: string, senderId: string, senderName: string, content: string, mentions?: string[], replyTo?: string): ChatMessage | null;
    /**
     * Read messages from a room.
     */
    readMessages(roomId: string, limit?: number, since?: string): ChatMessage[];
    /**
     * Wait for a new message in a room (with timeout).
     */
    waitForMessage(roomId: string, timeoutMs?: number): Promise<ChatMessage | null>;
    /**
     * List all rooms.
     */
    listRooms(): ChatRoomInfo[];
    /**
     * Get a specific room.
     */
    getRoom(roomId: string): ChatRoom | undefined;
    /**
     * Find a room by name.
     */
    findRoomByName(name: string): ChatRoom | undefined;
    /**
     * Delete a room.
     */
    deleteRoom(roomId: string): boolean;
}
