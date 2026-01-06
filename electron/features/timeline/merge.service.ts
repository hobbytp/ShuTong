
import { LLMService } from '../../llm/service';
import { defaultRepository } from './analysis.repository';

interface TimelineCard {
    id: number;
    title: string;
    summary: string;
    start_ts: number;
    end_ts: number;
    batch_id: number;
    category: string;
}

interface MergeGroup {
    cards: TimelineCard[];
    startTs: number;
    endTs: number;
}

export class SessionMerger {
    private llmService: LLMService;
    private repository = defaultRepository;
    private isProcessing = false;

    constructor() {
        this.llmService = new LLMService();
    }

    async run() {
        if (this.isProcessing) return;
        this.isProcessing = true;
        try {
            // 1. Fetch recent cards (last 2 hours)
            const twoHoursAgo = Math.floor(Date.now() / 1000) - (2 * 60 * 60);
            const cards = this.repository.getRecentCards(100, twoHoursAgo); // Fetch enough logic history

            if (cards.length < 2) return;

            // 2. Identify candidates for merge
            const groups = this.identifyMergeGroups(cards);

            // 3. Process merges
            for (const group of groups) {
                await this.processGroup(group);
            }

        } catch (err) {
            console.error('[SessionMerger] Error running merge job:', err);
        } finally {
            this.isProcessing = false;
        }
    }

    private identifyMergeGroups(cards: TimelineCard[]): MergeGroup[] {
        const groups: MergeGroup[] = [];
        let currentGroup: TimelineCard[] = [];

        for (const card of cards) {
            if (currentGroup.length === 0) {
                currentGroup.push(card);
                continue;
            }

            const last = currentGroup[currentGroup.length - 1];

            // Criteria: 
            // 1. Gap < 2 mins (120s)
            // 2. Duration < 5 mins (Fragmented) OR Same Category
            const gap = card.start_ts - last.end_ts;
            const isGapSmall = gap < 120;
            // P0: Only merge if gap is small
            if (isGapSmall) {
                // If it's a fragment OR same category, group it
                // We are lenient here, letting LLM decide the semantic match
                currentGroup.push(card);
            } else {
                // Close group
                if (currentGroup.length > 1) {
                    groups.push({
                        cards: [...currentGroup],
                        startTs: currentGroup[0].start_ts,
                        endTs: currentGroup[currentGroup.length - 1].end_ts
                    });
                }
                currentGroup = [card];
            }
        }

        // Leftover
        if (currentGroup.length > 1) {
            groups.push({
                cards: [...currentGroup],
                startTs: currentGroup[0].start_ts,
                endTs: currentGroup[currentGroup.length - 1].end_ts
            });
        }

        return groups;
    }

    private async processGroup(group: MergeGroup) {
        // Skip if group is too simple/small (optimization?)
        // For now process all candidates > 1 card

        console.log(`[SessionMerger] Evaluating group of ${group.cards.length} cards...`);

        // Ask LLM
        const merged = await this.llmService.mergeCards(group.cards);

        if (merged) {
            console.log(`[SessionMerger] Merging ${group.cards.length} cards into: ${merged.title}`);

            // 1. Save new card
            const newCardId = this.repository.saveTimelineCard({
                startTs: group.startTs,
                endTs: group.endTs,
                category: merged.category,
                subcategory: merged.subcategory,
                title: merged.title,
                summary: merged.summary,
                // Associate with first batch_id for now (or null? DB foreign key might require valid batch_id)
                // If batch_id is purely for lookup, assume first one. 
                // BUT: Detail view uses batch_id to find observations.
                // PROBLEM: The new card spans multiple batches.
                // SOLUTION: We need to link ALL batches. But DB columns is `batch_id` (single).
                // WORKAROUND: For this version, link to the *most prominent* batch, or rely on start/end ts for observation lookup (which we just fixed!).
                // Since we fixed `getCardDetails` to use time-range, `batch_id` is less critical for observation filtering, 
                // but strictly speaking, `observations.batch_id` needs to match.
                // Actually, if we link to Batch A, `getCardDetails` will look for obs with batch_id=A AND time in A..Z.
                // Only observations for Batch A will be returned. Observations for Batch B will be invalid.
                // FIT: We must NOT rely on `batch_id` for observation lookup in merged cards.
                // The query fix `WHERE batch_id = ?` RESTRICTS it. 
                // We need to UPDATE `getCardDetails` to support Multi-Batch lookup or purely Time-based lookup for merged cards.
                // For now, let's just pick the first batch_id to satisfy FK constraint. 
                // Note: This means Detail View might only show observations from the FIRST chunk.
                // TODO: Enhance `timeline_cards` to support `is_merged` flag and `getCardDetails` to query by range only.
                batchId: group.cards[0].batch_id,
                isMerged: true
            });

            // 2. Delete old cards
            if (newCardId) {
                this.repository.deleteCards(group.cards.map(c => c.id));
            }
        }
    }
}

export const sessionMerger = new SessionMerger();
