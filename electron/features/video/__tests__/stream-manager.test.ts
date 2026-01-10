import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamManager } from '../stream-manager';
import fs from 'fs/promises';

// Mock fs/promises
vi.mock('fs/promises', () => ({
    default: {
        open: vi.fn(),
    }
}));

describe('StreamManager', () => {
    let manager: StreamManager;
    let mockFileHandle: any;

    beforeEach(() => {
        vi.useFakeTimers();
        manager = new StreamManager();
        mockFileHandle = {
            write: vi.fn(),
            close: vi.fn(),
        };
        (fs.open as any).mockResolvedValue(mockFileHandle);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should open a stream and return an ID', async () => {
        const id = await manager.createStream('/tmp/test.mp4');
        expect(id).toBeDefined();
        expect(fs.open).toHaveBeenCalledWith('/tmp/test.mp4', 'w');
        expect(manager.getActiveCount()).toBe(1);
    });

    it('should write chunks to the correct stream', async () => {
        const id = await manager.createStream('/tmp/test.mp4');
        const chunk = new Uint8Array([1, 2, 3]).buffer;

        await manager.writeChunk(id, chunk);
        expect(mockFileHandle.write).toHaveBeenCalled();
    });

    it('should close stream properly', async () => {
        const id = await manager.createStream('/tmp/test.mp4');
        await manager.closeStream(id);
        expect(mockFileHandle.close).toHaveBeenCalled();
        expect(manager.getActiveCount()).toBe(0);
    });

    it('should auto-close stream after idle timeout', async () => {
        await manager.createStream('/tmp/test.mp4');

        // Fast forward time by 30s + 1ms
        vi.advanceTimersByTime(30001);

        expect(mockFileHandle.close).toHaveBeenCalled();
        expect(manager.getActiveCount()).toBe(0);
    });

    it('should reset idle timer on write', async () => {
        const id = await manager.createStream('/tmp/test.mp4');

        // Advance 20s
        vi.advanceTimersByTime(20000);

        // Write chunk
        await manager.writeChunk(id, new ArrayBuffer(1));

        // Advance another 20s (Total 40s from start, but only 20s from write)
        vi.advanceTimersByTime(20000);

        expect(mockFileHandle.close).not.toHaveBeenCalled();

        // Advance another 11s (Total 31s from write)
        vi.advanceTimersByTime(11000);
        expect(mockFileHandle.close).toHaveBeenCalled();
    });

    it('should close all streams on dispose', async () => {
        await manager.createStream('1');
        await manager.createStream('2');
        expect(manager.getActiveCount()).toBe(2);

        await manager.dispose();
        expect(mockFileHandle.close).toHaveBeenCalledTimes(2);
        expect(manager.getActiveCount()).toBe(0);
    });
});
