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
     * Optionally forwards to Renderer process if windows are available.
     */
    public emitEvent<K extends EventKey>(type: K, payload: EventMap[K]): boolean {
        // console.log(`[EventBus] Emitting event: ${type}`, payload);

        // 1. Emit locally for Main Process listeners
        const emitted = this.emit(type, payload);

        // 2. Forward to Renderer (Optional: only for specific events or all)
        // For now, consistent with legacy behavior, we might want to be selective.
        // Let's forward everything under 'app-event' channel for simplicity
        this.broadcastToRenderer('app-event', { type, payload, timestamp: Date.now() });

        return emitted;
    }

    /**
     * Subscribe to a typed event
     */
    public subscribe<K extends EventKey>(type: K, listener: (payload: EventMap[K]) => void): void {
        this.on(type, listener);
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
