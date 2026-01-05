import { getRepositories } from '../../storage';
import { vectorStorage } from '../../storage/vector-storage';

export interface TopicContext {
    app: string;
    title: string;
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
    async findMatchingWindows(userQuery: string): Promise<TopicContext[]> {
        console.log(`[TopicDiscovery] Finding windows for query: "${userQuery}"`);

        // Step 1: Extract keywords using heuristic or simple LLM extraction
        // For now, we'll use a simple heuristic + direct search, but we could ask LLM
        // "Extract key application names and project terms from: ${userQuery}"
        
        // Simple keyword extraction (split by space, filter small words)
        const keywords = userQuery.split(/\s+/).filter(w => w.length > 2);
        
        const candidates = new Map<string, TopicContext>();

        // Step 2: Search Window Switches (Recent History)
        const repos = getRepositories();
        if (repos) {
            // Search by full query
            const exactMatches = repos.windowSwitches.searchByTitle(userQuery);
            exactMatches.forEach(m => candidates.set(`${m.app}:${m.title}`, m));

            // Search by keywords
            for (const keyword of keywords) {
                const matches = repos.windowSwitches.searchByTitle(keyword);
                matches.forEach(m => candidates.set(`${m.app}:${m.title}`, m));
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
                    if (!candidates.has(key)) {
                        candidates.set(key, {
                            app,
                            title
                        });
                    }
                }
            }
        } catch (err) {
            console.warn('[TopicDiscovery] Vector search failed:', err);
        }

        return Array.from(candidates.values());
    }
}

export const topicDiscoveryService = new TopicDiscoveryService();
