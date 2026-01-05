import { ipcMain } from 'electron';
import { TopicContext, topicDiscoveryService } from './topic-discovery.service';

export class TopicAgent {
    constructor() {
        this.setupIPC();
    }

    private setupIPC() {
        ipcMain.handle('topic:discover', async (_, query: string) => {
            return await this.processQuery(query);
        });

        ipcMain.handle('topic:save', async (_, topicName: string, contexts: TopicContext[]) => {
            return await this.saveTopic(topicName, contexts);
        });
    }

    /**
     * Process a user query to find relevant contexts.
     * Returns a structured response that the UI chat can display.
     */
    async processQuery(query: string) {
        try {
            const contexts = await topicDiscoveryService.findMatchingWindows(query);
            
            if (contexts.length === 0) {
                return {
                    message: "I couldn't find any specific windows matching that description. Could you be more specific about the app or file name?",
                    contexts: []
                };
            }

            // Format a nice response
            const groupedByApp = contexts.reduce((acc, ctx) => {
                if (!acc[ctx.app]) acc[ctx.app] = [];
                acc[ctx.app].push(ctx.title);
                return acc;
            }, {} as Record<string, string[]>);

            let msg = "I found these relevant windows. Should I include them in the topic?\n\n";
            for (const [app, titles] of Object.entries(groupedByApp)) {
                msg += `**${app}**:\n`;
                titles.slice(0, 5).forEach(t => msg += `- ${t}\n`);
                if (titles.length > 5) msg += `- ...and ${titles.length - 5} more\n`;
            }

            return {
                message: msg,
                contexts: contexts,
                requiresConfirmation: true
            };

        } catch (err: any) {
            console.error('[TopicAgent] Error processing query:', err);
            return {
                message: "Sorry, I encountered an error while searching. " + err.message,
                contexts: []
            };
        }
    }

    /**
     * Save the finalized topic definition.
     * For AI-Native topics, we might just save a "Smart Query" or a set of examples
     * to the vector DB to bias future searches.
     */
    async saveTopic(name: string, contexts: TopicContext[]) {
        try {
            // In the new "No-Schema" world, a Topic is just a persistent filter.
            // We can save this to a JSON file or a simple key-value store.
            // For now, let's just log it. Real persistence would go to `topics` table (if we kept it)
            // or a JSON config file.
            
            console.log(`[TopicAgent] Saving topic "${name}" with ${contexts.length} contexts.`);
            
            // TODO: Persist this so the Timeline UI can load "Saved Topics"
            // For MVP, we might just return success and let the frontend drive the immediate view.
            
            return { success: true, topicId: Date.now().toString() };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }
}

// Singleton instance
export const topicAgent = new TopicAgent();
