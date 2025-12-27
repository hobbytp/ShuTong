/**
 * Typed IPC Utilities for Main Process
 * 
 * Provides type-safe wrappers around ipcMain.handle() that enforce
 * the IPCContract at compile time.
 */

import type { IPCArgs, IPCChannel, IPCReturn } from '@shared/ipc-contract';
import { ipcMain, IpcMainInvokeEvent } from 'electron';

/**
 * Type-safe wrapper for ipcMain.handle().
 * Ensures handler signature matches the IPCContract definition.
 * 
 * @example
 * typedHandle('get-settings', async () => {
 *   return getSettings(); // Must return Settings type
 * });
 */
export function typedHandle<K extends IPCChannel>(
    channel: K,
    handler: (event: IpcMainInvokeEvent, ...args: IPCArgs<K>) => Promise<IPCReturn<K>> | IPCReturn<K>
): void {
    ipcMain.handle(channel, handler as any);
}

/**
 * Register multiple handlers at once with type safety.
 * 
 * @example
 * registerHandlers({
 *   'get-settings': async () => getSettings(),
 *   'set-setting': async (_, key, value) => setSetting(key, value),
 * });
 */
export function registerHandlers<K extends IPCChannel>(
    handlers: {
        [P in K]: (event: IpcMainInvokeEvent, ...args: IPCArgs<P>) => Promise<IPCReturn<P>> | IPCReturn<P>;
    }
): void {
    for (const [channel, handler] of Object.entries(handlers)) {
        ipcMain.handle(channel, handler as any);
    }
}

/**
 * Check if a handler is already registered for a channel.
 * Useful for avoiding duplicate registration errors.
 */
export function isHandlerRegistered(channel: IPCChannel): boolean {
    // @ts-ignore - accessing internal Electron property
    return ipcMain._events && channel in ipcMain._events;
}
