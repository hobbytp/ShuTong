/**
 * Typed IPC Client for Renderer Process
 * 
 * Provides type-safe wrapper around ipcRenderer.invoke() that enforces
 * the IPCContract at compile time, eliminating @ts-ignore annotations.
 */

import type { IPCArgs, IPCChannel, IPCReturn } from '@shared/ipc-contract';

// Re-export types for convenience
export * from '@shared/ipc-contract';

/**
 * Type-safe IPC invoke function.
 * 
 * @example
 * // No more @ts-ignore!
 * const settings = await invoke('get-settings'); // Returns Settings type
 * await invoke('set-setting', 'key', 'value');   // Args are type-checked
 */
export async function invoke<K extends IPCChannel>(
    channel: K,
    ...args: IPCArgs<K>
): Promise<IPCReturn<K>> {
    // @ts-ignore - window.ipcRenderer is injected by preload
    return window.ipcRenderer.invoke(channel, ...args);
}

/**
 * Subscribe to IPC events from main process.
 * Returns an unsubscribe function.
 * 
 * @example
 * const unsubscribe = on('event:card:generated', (event, data) => {
 *   console.log('New card:', data.cardId);
 * });
 * // Later: unsubscribe?.();
 */
export function on<T = unknown>(
    channel: string,
    callback: (event: unknown, data: T) => void
): (() => void) | undefined {
    // @ts-ignore - window.ipcRenderer is injected by preload
    if (!window.ipcRenderer?.on) return undefined;
    // @ts-ignore - window.ipcRenderer is injected by preload
    return window.ipcRenderer.on(channel, callback);
}

/**
 * Send one-way message to main process.
 * Use invoke() for request-response patterns.
 */
export function send(channel: string, ...args: unknown[]): void {
    // @ts-ignore - window.ipcRenderer is injected by preload
    window.ipcRenderer.send(channel, ...args);
}
