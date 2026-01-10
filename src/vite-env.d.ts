/// <reference types="vite/client" />

interface Window {
    ipcRenderer?: {
        invoke(channel: string, ...args: any[]): Promise<any>;
        on(channel: string, func: (...args: any[]) => void): () => void;
        off(channel: string, func: (...args: any[]) => void): void;
        once(channel: string, func: (...args: any[]) => void): void;
        removeListener(channel: string, func: (...args: any[]) => void): void;
        send(channel: string, ...args: any[]): void;
    };

    videoAPI?: {
        saveVideo(buffer: ArrayBuffer, filePath: string): Promise<void>;
        openStream(filePath: string): Promise<string>;
        writeChunk(streamId: string, chunk: ArrayBuffer): Promise<void>;
        closeStream(streamId: string): Promise<void>;
    };
}
