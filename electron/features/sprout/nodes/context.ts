import { vectorStorage } from "../../../storage/vector-storage";
import { AutoExpertState } from "../schema";

export async function contextRetrievalNode(state: AutoExpertState) {
    const { seed } = state;
    console.log(`[AutoExpert] Retrieving context for seed: "${seed.substring(0, 50)}..."`);

    try {
        // 1. Vector Search for relevant activities/notes
        const relevantActivities = await vectorStorage.search(seed, 5);

        // Formulate a summary string
        const contextSummary = relevantActivities.map(a =>
            `- [${new Date(a.start_ts * 1000).toLocaleDateString()}] ${a.title}: ${a.summary}`
        ).join('\n');

        return {
            context_summary: contextSummary
        };
    } catch (error) {
        console.error("[AutoExpert] Context retrieval failed:", error);
        return { context_summary: "" };
    }
}
