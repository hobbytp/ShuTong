export interface ShuTongIpcRenderer {
    on(channel: string, listener: (event: any, ...args: any[]) => void): () => void;
    off(channel: string, ...args: any[]): void;
    send(channel: string, ...args: any[]): void;
    invoke(channel: string, ...args: any[]): Promise<any>;
    platform: string;
}

declare global {
    interface Window {
        ipcRenderer: ShuTongIpcRenderer;
        videoAPI: {
            saveVideo(buffer: ArrayBuffer, filePath: string): Promise<void>;
            openStream(filePath: string): Promise<string>;
            writeChunk(streamId: string, chunk: ArrayBuffer): Promise<void>;
            closeStream(streamId: string): Promise<void>;
        };
    }
}
