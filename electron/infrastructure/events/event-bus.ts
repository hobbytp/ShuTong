import { BrowserWindow } from 'electron';
import { EventEmitter } from 'events';
import { EventKey, EventMap } from './event-types';

class TypedEventBus extends EventEmitter {
    private static instance: TypedEventBus;

    private constructor() {
        super();
        this.setMaxListeners(20); // Slightly higher than default for scaling modules
    }

    public static getInstance(): TypedEventBus {
        if (!TypedEventBus.instance) {
            TypedEventBus.instance = new TypedEventBus();
        }
        return TypedEventBus.instance;
    }

    /**
     * Emit a typed event.
     * Selectively forwards specific events to Renderer process.
     */
    public emitEvent<K extends EventKey>(type: K, payload: EventMap[K]): boolean {
        // console.log(`[EventBus] Emitting event: ${type}`, payload);

        // 1. Emit locally for Main Process listeners
        const emitted = this.emit(type, payload);

        // 2. Forward only user-facing events to Renderer
        const rendererEvents: EventKey[] = [
            'recording:state-changed',
            'capture:error',
            'video:generated',
            'video:generation-failed',
            'card:created'
        ];

        if (rendererEvents.includes(type)) {
            this.broadcastToRenderer('app-event', { type, payload, timestamp: Date.now() });
        }

        return emitted;
    }

    /**
     * Subscribe to a typed event with automatic error handling
     */
    public subscribe<K extends EventKey>(type: K, listener: (payload: EventMap[K]) => void | Promise<void>): void {
        const wrappedListener = async (payload: EventMap[K]) => {
            try {
                await listener(payload);
            } catch (err) {
                console.error(`[EventBus] Error in ${type} listener:`, err);
                // Prevent one failing listener from affecting others
            }
        };
        this.on(type, wrappedListener);
    }

    /**
     * Unsubscribe from a typed event
     */
    public unsubscribe<K extends EventKey>(type: K, listener: (payload: EventMap[K]) => void): void {
        this.off(type, listener);
    }

    private broadcastToRenderer(channel: string, data: any) {
        BrowserWindow.getAllWindows().forEach(win => {
            if (!win.isDestroyed() && !win.webContents.isLoading()) {
                win.webContents.send(channel, data);
            }
        });
    }
}

export const eventBus = TypedEventBus.getInstance();
