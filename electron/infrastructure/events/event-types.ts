export interface EventMap {
    // Card Domain Events
    'card:created': { cardId: number; batchId?: number };
    'card:updated': { cardId: number };
    'card:deleted': { cardId: number };

    // Batch Domain Events
    'batch:completed': { batchId: number; cardIds: number[] };

    // Capture Domain Events
    'recording:state-changed': { isRecording: boolean };
    'capture:error': { title: string; message: string; fatal?: boolean };

    // Video Domain Events
    'video:generated': { cardId: number; videoPath: string };
    'video:generation-failed': { cardId: number; error: string };
    'video:deleted': { cardId: number };

    // Commands (empty object payload is more type-safe than void)
    'command:toggle-recording': {};

    // Analysis Domain Events
    'analysis:started': { batchId: number };
    'analysis:completed': { batchId: number; cardCount: number };
}

export type EventKey = keyof EventMap;

export interface EventBusPayload<K extends EventKey> {
    type: K;
    payload: EventMap[K];
    timestamp: number;
}
