import { getRepositories } from '../../storage';
import { vectorStorage } from '../../storage/vector-storage';

export interface TopicContext {
    app: string;
    title: string;
}

export interface EnhancedContext extends TopicContext {
    timestamp: number;
    summary?: string;
    original_vector_data?: any;
}

export interface TopicGroup {
    entity: string; // "Project: ShuTong" or "Chrome: Doubao"
    type: 'project' | 'app_group';
    count: number;
    contexts: EnhancedContext[];
}

export class TopicDiscoveryService {
    // Removed unused llmService
    // private llmService: LLMService;

    constructor() {
        // this.llmService = new LLMService();
    }

    /**
     * Discovers potential topic contexts based on a user's natural language query.
     * 1. Uses LLM to extract keywords/intent.
     * 2. Searches WindowSwitch history for matches.
     * 3. Searches VectorDB for semantic matches.
     */
    async findMatchingWindows(userQuery: string): Promise<EnhancedContext[]> {
        console.log(`[TopicDiscovery] Finding windows for query: "${userQuery}"`);

        // Step 1: Extract keywords using heuristic or simple LLM extraction
        // For now, we'll use a simple heuristic + direct search, but we could ask LLM
        // "Extract key application names and project terms from: ${userQuery}"

        // Simple keyword extraction (split by space, filter small words)
        const keywords = userQuery.split(/\s+/).filter(w => w.length > 2);

        const candidates = new Map<string, EnhancedContext>();

        // Step 2: Search Window Switches (Recent History)
        const repos = getRepositories();
        if (repos) {
            // Search by full query
            const exactMatches = repos.windowSwitches.searchByTitle(userQuery);
            exactMatches.forEach(m => {
                const key = `${m.app}:${m.title}`;
                // Keep the most recent timestamp if duplicate
                if (!candidates.has(key) || (m as any).start_time > candidates.get(key)!.timestamp) {
                    candidates.set(key, {
                        app: m.app,
                        title: m.title,
                        timestamp: (m as any).start_time * 1000 || Date.now(), // Assume start_time is unix timestamp (seconds or ms?) usually seconds in existing code
                        summary: `Window switch: ${m.title}`
                    });
                }
            });

            // Search by keywords
            for (const keyword of keywords) {
                const matches = repos.windowSwitches.searchByTitle(keyword);
                matches.forEach(m => {
                    const key = `${m.app}:${m.title}`;
                    if (!candidates.has(key) || (m as any).start_time > candidates.get(key)!.timestamp) {
                        candidates.set(key, {
                            app: m.app,
                            title: m.title,
                            timestamp: (m as any).start_time * 1000 || Date.now(),
                            summary: `Window switch: ${m.title}`
                        });
                    }
                });
            }
        }

        // Step 3: Semantic Search (Vector DB)
        // This finds *activities* that match, from which we can extract app/title
        try {
            const semanticMatches = await vectorStorage.search(userQuery, 20);
            for (const match of semanticMatches) {
                if (match.app_name) {
                    const app = match.app_name as string;
                    const title = (match.window_title as string) || '';
                    const key = `${app}:${title}`;

                    // Always prefer vector data as it has summary
                    candidates.set(key, {
                        app,
                        title,
                        timestamp: match.start_ts ? match.start_ts * 1000 : Date.now(),
                        summary: match.summary || match.text || title,
                        original_vector_data: match
                    });
                }
            }
        } catch (err) {
            console.warn('[TopicDiscovery] Vector search failed:', err);
        }

        return Array.from(candidates.values()).sort((a, b) => b.timestamp - a.timestamp);
    }

    /**
     * Groups raw contexts into semantic entities (Projects vs App Groups).
     */
    groupContexts(contexts: EnhancedContext[]): TopicGroup[] {
        const groups = new Map<string, TopicGroup>();

        for (const ctx of contexts) {
            const projectName = this.extractProjectName(ctx.app, ctx.title);

            let groupKey: string;
            let groupType: 'project' | 'app_group';

            if (projectName) {
                groupKey = `Project: ${projectName}`;
                groupType = 'project';
            } else {
                // Determine a "Domain" or "Topic" for browsers, otherwise just App
                const domain = this.extractDomainOrTopic(ctx.app, ctx.title);
                groupKey = domain ? `${ctx.app}: ${domain}` : ctx.app;
                groupType = 'app_group';
            }

            if (!groups.has(groupKey)) {
                groups.set(groupKey, {
                    entity: groupKey,
                    type: groupType,
                    count: 0,
                    contexts: []
                });
            }

            const group = groups.get(groupKey)!;
            group.contexts.push(ctx);
            group.count++;
        }

        return Array.from(groups.values()).sort((a, b) => b.count - a.count);
    }

    /**
     * Helper to extract project name from window titles (VS Code, Cursor, JetBrains).
     * Made public for testing.
     */
    public extractProjectName(app: string, title: string): string | null {
        // VS Code: "filename.ts - ProjectName - Visual Studio Code"
        // Also support "Code" short name
        if (app.includes('Visual Studio Code') || app === 'Code' || app.includes('Cursor') || app.includes('Trae')) {
            // Remove app suffix
            let cleanTitle = title
                .replace(/ - Visual Studio Code/g, '')
                .replace(/ - Cursor/g, '')
                .replace(/ - Trae/g, '');

            // Usually the last segment is the project name: "file - project"
            const parts = cleanTitle.split(' - ');
            if (parts.length >= 2) {
                return parts[parts.length - 1].trim();
            }
            // If strictly one part, it might be the project workspace itself
            return cleanTitle.trim();
        }

        // JetBrains: "file.ts – [ProjectName] ..." or similar? 
        return null;
    }

    /**
     * Helper to extract a "Topic" or "Domain" from browser titles.
     * Made public for testing.
     */
    public extractDomainOrTopic(app: string, title: string): string | null {
        const browsers = ['Google Chrome', 'Microsoft Edge', 'Firefox', 'Doubao', 'Chrome', 'Edge'];
        if (!browsers.some(b => app.includes(b))) {
            return null;
        }

        // Common pattern: "Page Title - Site Name"
        // "Issue #123 · owner/repo - GitHub"
        // "Dashboard - Linear"

        const separators = [' - ', ' | ', ' · '];
        for (const sep of separators) {
            const parts = title.split(sep);
            if (parts.length > 1) {
                // Return the last part as the site name/domain
                return parts[parts.length - 1].trim();
            }
        }

        return null;
    }
}

export const topicDiscoveryService = new TopicDiscoveryService();
