import { ipcMain } from 'electron';
import { autoExpertAgent } from './agent';
import { SproutService } from './service';
import { AutoExpertConfig, SproutReport } from './schema';

export function setupSproutIPC() {
    ipcMain.handle('sprout:history', async () => {
        return SproutService.getHistory();
    });

    ipcMain.handle('sprout:load', async (_, id: string) => {
        return SproutService.getSproutDetails(id);
    });

    ipcMain.handle('sprout:delete', async (_, id: string) => {
        return SproutService.deleteSprout(id);
    });

    ipcMain.on('sprout:start', async (event, { seed, threadId, config }: { seed: string, threadId?: string, config?: Partial<AutoExpertConfig> }) => {
        const reply = (channel: string, data: any) => {
            if (!event.sender.isDestroyed()) {
                event.sender.send(channel, data);
            }
        };

        try {
            // 1. Create/Get DB Session
            let sproutId = threadId;
            if (!sproutId) {
                const session = SproutService.createSprout(seed);
                sproutId = session.id;
                // Notify frontend of the new ID immediately
                reply('sprout:created', { id: sproutId, topic: seed });
            }

            // 2. Stream execution
            const stream = autoExpertAgent.streamSession(seed, sproutId!, config);

            for await (const chunk of stream) {
                // Determine what changed in this chunk
                // LangGraph stream returns partial state updates

                for (const [nodeName, nodeUpdate] of Object.entries(chunk)) {
                    const update = nodeUpdate as any;
                    if (update && typeof update === 'object') {
                        if (update.messages) {
                            const msgs = Array.isArray(update.messages) ? update.messages : [update.messages];
                            for (const msg of msgs) {
                                // Save to DB
                                const savedMsg = SproutService.addMessage(
                                    sproutId!,
                                    msg.getType() === 'human' ? 'user' : (msg.name ? 'assistant' : 'system'), // Basic mapping
                                    msg.content as string,
                                    msg.name || nodeName // Fallback to node name if expert name missing
                                );

                                // Send to frontend
                                reply(`sprout:update:${sproutId}`, {
                                    type: 'message',
                                    data: savedMsg
                                });
                            }
                        }

                        // Check for Report
                        if (update.report) {
                            SproutService.completeSprout(sproutId!, update.report as SproutReport);
                            reply(`sprout:update:${sproutId}`, {
                                type: 'report',
                                data: update.report
                            });
                        }
                    }
                }
            }

            reply(`sprout:update:${sproutId}`, { type: 'status', data: 'completed' });

        } catch (error: any) {
            console.error('[Sprout IPC] Error:', error);
            reply('sprout:error', error.message);
        }
    });
}
