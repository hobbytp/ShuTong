import fs from 'fs/promises';

interface StreamEntry {
    handle: fs.FileHandle;
    lastActivity: number;
    timeout: NodeJS.Timeout;
}

export class StreamManager {
    private streams = new Map<string, StreamEntry>();
    private readonly IDLE_TIMEOUT_MS = 30000; // 30 seconds

    constructor() { }

    async createStream(filePath: string): Promise<string> {
        try {
            const handle = await fs.open(filePath, 'w');
            const streamId = Math.random().toString(36).substring(7);

            this.addStream(streamId, handle);

            return streamId;
        } catch (error) {
            console.error('[StreamManager] Failed to create stream:', error);
            throw error;
        }
    }

    private addStream(streamId: string, handle: fs.FileHandle) {
        const timeout = setTimeout(() => {
            console.warn(`[StreamManager] Stream ${streamId} idle timed out. Auto-closing.`);
            this.closeStream(streamId);
        }, this.IDLE_TIMEOUT_MS);

        this.streams.set(streamId, {
            handle,
            lastActivity: Date.now(),
            timeout
        });
    }

    async writeChunk(streamId: string, chunk: ArrayBuffer) {
        const entry = this.streams.get(streamId);
        if (!entry) {
            throw new Error(`Stream ${streamId} not found or closed`);
        }

        // Reset timeout
        clearTimeout(entry.timeout);
        entry.timeout = setTimeout(() => {
            console.warn(`[StreamManager] Stream ${streamId} idle timed out. Auto-closing.`);
            this.closeStream(streamId);
        }, this.IDLE_TIMEOUT_MS);
        entry.lastActivity = Date.now();

        try {
            await entry.handle.write(Buffer.from(chunk));
        } catch (err) {
            console.error(`[StreamManager] Failed to write to stream ${streamId}:`, err);
            // If write fails, maybe close it? Or just throw?
            throw err;
        }
    }

    async closeStream(streamId: string) {
        const entry = this.streams.get(streamId);
        if (!entry) return;

        clearTimeout(entry.timeout);
        this.streams.delete(streamId);

        try {
            await entry.handle.close();
        } catch (err) {
            console.error(`[StreamManager] Error closing stream ${streamId}:`, err);
        }
    }

    async dispose() {
        if (this.streams.size === 0) return;

        console.log(`[StreamManager] Disposing ${this.streams.size} active streams...`);
        const closePromises: Promise<void>[] = [];

        for (const [_id, entry] of this.streams) {
            clearTimeout(entry.timeout);
            closePromises.push(entry.handle.close().catch(e => console.error('Error closing stream on dispose:', e)));
        }

        this.streams.clear();
        await Promise.allSettled(closePromises);
    }

    getActiveCount(): number {
        return this.streams.size;
    }
}

export const streamManager = new StreamManager();
