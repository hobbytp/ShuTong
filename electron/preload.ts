import { contextBridge, ipcRenderer } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    const subscription = (event: any, ...args: any[]) => listener(event, ...args)
    ipcRenderer.on(channel, subscription)

    return () => {
      ipcRenderer.removeListener(channel, subscription)
    }
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  platform: process.platform
})

contextBridge.exposeInMainWorld('videoAPI', {
  saveVideo: async (buffer: ArrayBuffer, filePath: string) => {
    return ipcRenderer.invoke('video:save', buffer, filePath);
  },
  openStream: (filePath: string) => ipcRenderer.invoke('video:open-stream', filePath),
  writeChunk: (streamId: string, chunk: ArrayBuffer) => ipcRenderer.invoke('video:write-chunk', streamId, chunk),
  closeStream: (streamId: string) => ipcRenderer.invoke('video:close-stream', streamId),
})
