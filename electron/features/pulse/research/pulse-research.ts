import { getLLMProvider } from '../../../llm/providers';
import { getPulseCardById, getPulseCards, getTimelineCards, savePulseCard, updatePulseCard } from '../../../storage';
import { searchDuckDuckGoInstantAnswer, WebSearchResult } from './web-search';

export type ResearchMode = 'auto' | 'fast' | 'deep';

export interface ResearchProposalContent {
    schema: 'pulse_research_proposal_v1';
    status: 'proposed' | 'dismissed' | 'running' | 'completed' | 'failed';
    question: string;
    evidence: string[];
    selected_mode?: ResearchMode;
    decided_mode?: Exclude<ResearchMode, 'auto'>;
    decision_reason?: string;
    started_at?: number;
    completed_at?: number;
    error?: string;
    deliverable_card_ids?: string[];
}

export interface ResearchDeliverables {
    report: {
        title: string;
        body: string;
        citations: { title: string; url: string }[];
        uncertainty: string[];
        budget_limited: boolean;
    };
    learning_path: {
        title: string;
        body: string;
        citations: { title: string; url: string }[];
        budget_limited: boolean;
    };
}

function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
}

function safeParseJson<T>(text: string): T | null {
    try {
        return JSON.parse(text) as T;
    } catch {
        return null;
    }
}

function formatSearchResults(results: WebSearchResult[]): string {
    return results
        .map((r, idx) => {
            const snippet = r.snippet ? `\nSnippet: ${r.snippet}` : '';
            return `${idx + 1}. ${r.title}\nURL: ${r.url}${snippet}`;
        })
        .join('\n\n');
}

function pickCitations(results: WebSearchResult[], max: number): { title: string; url: string }[] {
    const citations: { title: string; url: string }[] = [];
    const seen = new Set<string>();
    for (const r of results) {
        if (citations.length >= max) break;
        if (!r.url || seen.has(r.url)) continue;
        seen.add(r.url);
        citations.push({ title: r.title, url: r.url });
    }
    return citations;
}

export async function generateResearchProposalCard(): Promise<{ cardId: string } | { error: string }> {
    const recentPulse = getPulseCards(8);
    const recentTimeline = getTimelineCards(10, 0);

    const contextLines: string[] = [];

    if (recentPulse.length > 0) {
        contextLines.push('Recent Pulse Cards:');
        for (const c of recentPulse) {
            contextLines.push(`- [${c.type}] ${c.title}: ${c.content}`);
        }
    }

    if (recentTimeline.length > 0) {
        contextLines.push('Recent Timeline Cards:');
        for (const c of recentTimeline as any[]) {
            contextLines.push(`- ${c.title}: ${c.summary}`);
        }
    }

    const context = contextLines.join('\n');
    if (!context.trim()) {
        return { error: 'No recent activity context available.' };
    }

    const provider = getLLMProvider('PULSE_AGENT');

    const prompt = `You are generating a research proposal based on recent user activity context.

Return ONLY valid JSON with this shape:
{
  "title": string,
  "question": string,
  "evidence": string[]
}

Constraints:
- The question must be actionable and researchable.
- Evidence must be 3-5 short bullets grounded in the provided context.
- Do not include markdown, code fences, or extra keys.

Context:
${context}`;

    const raw = await provider.generateContent({ prompt });
    const parsed = safeParseJson<{ title: string; question: string; evidence: string[] }>(raw);

    if (!parsed?.title || !parsed?.question || !Array.isArray(parsed.evidence) || parsed.evidence.length === 0) {
        return { error: 'Invalid LLM proposal output.' };
    }

    const cardId = `research-proposal-${Date.now()}`;
    const content: ResearchProposalContent = {
        schema: 'pulse_research_proposal_v1',
        status: 'proposed',
        question: String(parsed.question).trim(),
        evidence: parsed.evidence.map(x => String(x).trim()).filter(Boolean).slice(0, 6)
    };

    savePulseCard({
        id: cardId,
        type: 'research_proposal',
        title: String(parsed.title).trim(),
        content: JSON.stringify(content),
        suggested_actions: ['Start', 'Dismiss'],
        created_at: nowSeconds()
    });

    return { cardId };
}

export async function dismissResearchProposal(cardId: string): Promise<{ ok: true } | { error: string }> {
    const existing = getPulseCardById(cardId);
    if (!existing) return { error: 'Proposal not found.' };
    if (existing.type !== 'research_proposal') return { error: 'Not a research proposal.' };

    const parsed = safeParseJson<ResearchProposalContent>(existing.content);
    if (!parsed || parsed.schema !== 'pulse_research_proposal_v1') return { error: 'Invalid proposal content.' };

    if (parsed.status === 'dismissed') return { ok: true };

    parsed.status = 'dismissed';
    updatePulseCard({
        id: cardId,
        content: JSON.stringify(parsed),
        suggested_actions: []
    });

    return { ok: true };
}

export function computeScopeScore(question: string): { score: number; keywordCount: number; comparisonCount: number; timeRangeDays: number; questionCount: number } {
    const words = question.toLowerCase().split(/\s+/).filter(Boolean);
    const keywords = new Set(words.filter(w => w.length > 3));
    const keywordCount = keywords.size;

    // v1 heuristic: count comparison patterns
    const comparisonPatterns = question.match(/\bvs\.?\b|\bversus\b|\bcompare\b|\bcompared\b|\bdifference\b/gi) || [];
    const comparisonCount = comparisonPatterns.length;

    // v1 heuristic: detect time range requests
    let timeRangeDays = 0;
    if (/\b(year|annual|yearly)\b/i.test(question)) timeRangeDays = Math.max(timeRangeDays, 365);
    if (/\b(decade|10 years?)\b/i.test(question)) timeRangeDays = Math.max(timeRangeDays, 3650);
    if (/\b(history|historical|over time|evolution)\b/i.test(question)) timeRangeDays = Math.max(timeRangeDays, 1825);

    // v1 heuristic: single question supported
    const questionCount = 1;

    let score = 0;
    if (keywordCount >= 6) score += 1;
    if (keywordCount >= 12) score += 2;
    if (comparisonCount >= 2) score += 2;
    if (comparisonCount >= 4) score += 3;
    if (timeRangeDays >= 365) score += 2;
    if (timeRangeDays >= 1825) score += 3;

    return { score, keywordCount, comparisonCount, timeRangeDays, questionCount };
}

const DEEP_THRESHOLD = 6; // v1 configurable threshold

export async function startResearchFromProposal(cardId: string, requestedMode: ResearchMode): Promise<{ ok: true; deliverableCardIds: string[] } | { error: string }> {
    const existing = getPulseCardById(cardId);
    if (!existing) return { error: 'Proposal not found.' };
    if (existing.type !== 'research_proposal') return { error: 'Not a research proposal.' };

    const parsed = safeParseJson<ResearchProposalContent>(existing.content);
    if (!parsed || parsed.schema !== 'pulse_research_proposal_v1') return { error: 'Invalid proposal content.' };
    if (parsed.status === 'dismissed') return { error: 'Proposal is dismissed.' };
    if (parsed.status === 'running') return { error: 'Proposal is already running.' };
    if (parsed.status === 'completed') return { error: 'Proposal is already completed.' };

    const selectedMode: ResearchMode = requestedMode || 'auto';
    let decidedMode: Exclude<ResearchMode, 'auto'>;
    let decisionReason: string;

    if (selectedMode === 'deep') {
        // Deep service not implemented in v1; fallback to Fast
        decidedMode = 'fast';
        decisionReason = 'Deep mode is not configured; falling back to Fast.';
    } else if (selectedMode === 'fast') {
        decidedMode = 'fast';
        decisionReason = 'Fast selected by user.';
    } else {
        // Auto: compute scopeScore
        const { score, keywordCount, comparisonCount, timeRangeDays } = computeScopeScore(parsed.question);
        if (score >= DEEP_THRESHOLD) {
            // Would choose Deep but service unavailable in v1
            decidedMode = 'fast';
            decisionReason = `Auto would select Deep (scopeScore=${score}, kw=${keywordCount}, cmp=${comparisonCount}, days=${timeRangeDays}) but Deep service unavailable; falling back to Fast.`;
        } else {
            decidedMode = 'fast';
            decisionReason = `Auto selected Fast (scopeScore=${score}, kw=${keywordCount}, cmp=${comparisonCount}, days=${timeRangeDays}).`;
        }
    }

    parsed.status = 'running';
    parsed.selected_mode = selectedMode;
    parsed.decided_mode = decidedMode;
    parsed.decision_reason = decisionReason;
    parsed.started_at = nowSeconds();
    parsed.error = undefined;

    updatePulseCard({
        id: cardId,
        content: JSON.stringify(parsed),
        suggested_actions: []
    });

    try {
        const deliverables = await runFastResearch(parsed.question, {
            maxSearchQueries: 2,
            maxResultsPerQuery: 6,
            minCitations: 3
        });

        const reportCardId = `research-report-${Date.now()}`;
        const learningCardId = `learning-path-${Date.now() + 1}`;

        // Store deliverables with pending_save status (Save Gate)
        savePulseCard({
            id: reportCardId,
            type: 'research_report',
            title: deliverables.report.title,
            content: JSON.stringify({
                schema: 'pulse_research_deliverable_v1',
                save_status: 'pending_save',
                body: deliverables.report.body,
                citations: deliverables.report.citations,
                uncertainty: deliverables.report.uncertainty,
                budget_limited: deliverables.report.budget_limited
            }),
            suggested_actions: ['Save', 'Discard'],
            created_at: nowSeconds()
        });

        savePulseCard({
            id: learningCardId,
            type: 'learning_path',
            title: deliverables.learning_path.title,
            content: JSON.stringify({
                schema: 'pulse_research_deliverable_v1',
                save_status: 'pending_save',
                body: deliverables.learning_path.body,
                citations: deliverables.learning_path.citations,
                budget_limited: deliverables.learning_path.budget_limited
            }),
            suggested_actions: ['Save', 'Discard'],
            created_at: nowSeconds()
        });

        parsed.status = 'completed';
        parsed.completed_at = nowSeconds();
        parsed.deliverable_card_ids = [reportCardId, learningCardId];
        updatePulseCard({
            id: cardId,
            content: JSON.stringify(parsed),
            suggested_actions: []
        });

        return { ok: true, deliverableCardIds: [reportCardId, learningCardId] };

    } catch (e: any) {
        parsed.status = 'failed';
        parsed.completed_at = nowSeconds();
        parsed.error = String(e?.message || e);
        updatePulseCard({
            id: cardId,
            content: JSON.stringify(parsed),
            suggested_actions: []
        });
        return { error: parsed.error };
    }
}

export function generateQueryVariants(question: string, maxVariants: number): string[] {
    const base = question.trim();
    if (!base) return [];
    const variants = [base];
    if (maxVariants >= 2) {
        // Add a reformulated query: prepend "What is"
        if (!/^what\s+is/i.test(base)) {
            variants.push(`What is ${base}`);
        } else {
            variants.push(base.replace(/^what\s+is\s*/i, '').trim());
        }
    }
    if (maxVariants >= 3) {
        // Add a keyword-only variant
        const keywords = base.split(/\s+/).filter(w => w.length > 3).slice(0, 5).join(' ');
        if (keywords && keywords !== base) variants.push(keywords);
    }
    return variants.slice(0, maxVariants);
}

export async function runFastResearch(question: string, opts: { maxSearchQueries: number; maxResultsPerQuery: number; minCitations: number; maxWallClockSeconds?: number }): Promise<ResearchDeliverables> {
    const q = String(question || '').trim();
    if (!q) throw new Error('Empty question.');

    const timeoutMs = (opts.maxWallClockSeconds || 120) * 1000; // Default 120s
    const startTime = Date.now();

    const checkTimeout = () => {
        if (Date.now() - startTime > timeoutMs) {
            throw new Error(`Research timed out after ${opts.maxWallClockSeconds || 120} seconds.`);
        }
    };

    const queries = generateQueryVariants(q, opts.maxSearchQueries);
    const allResults: WebSearchResult[] = [];

    for (const query of queries) {
        checkTimeout();
        try {
            const res = await searchDuckDuckGoInstantAnswer(query, { maxResults: opts.maxResultsPerQuery });
            allResults.push(...res);
        } catch (err) {
            console.error(`Search failed for query "${query}":`, err);
            // Continue with other queries
        }
    }

    checkTimeout();

    const citations = pickCitations(allResults, Math.max(opts.minCitations, 2));
    if (citations.length < opts.minCitations) {
        throw new Error(`Insufficient citations: found ${citations.length}, need at least ${opts.minCitations}. Try a more specific question.`);
    }

    const provider = getLLMProvider('PULSE_AGENT');

    const prompt = `You are doing fast web research.

Input question:
${q}

Search results (may be partial):
${formatSearchResults(allResults)}

Return ONLY valid JSON with this shape:
{
  "report": {
    "title": string,
    "body": string,
    "uncertainty": string[]
  },
  "learning_path": {
    "title": string,
    "body": string
  }
}

Constraints:
- Use plain text only (no markdown).
- Include an "Uncertainty" section inside report.body.
- Keep both bodies concise but useful.
- Do not include extra keys.
`;

    let raw: string | null = null;
    let parsed: any = null;
    let attempts = 0;
    const maxRetries = 2;

    while (attempts <= maxRetries) {
        checkTimeout();
        try {
            raw = await provider.generateContent({ prompt });
            parsed = safeParseJson<any>(raw);
            if (parsed?.report?.body && parsed?.learning_path?.body) {
                break; // Success
            }
        } catch (err) {
            console.error(`LLM generation failed (attempt ${attempts + 1}):`, err);
        }
        attempts++;
        if (attempts <= maxRetries) {
            await new Promise(r => setTimeout(r, 1000)); // Backoff
        }
    }

    if (!parsed) {
        throw new Error('Failed to generate valid research content after retries.');
    }

    const reportTitle = String(parsed?.report?.title || 'Research Report').trim();
    const reportBody = String(parsed?.report?.body || '').trim();
    const reportUncertainty = Array.isArray(parsed?.report?.uncertainty) ? parsed.report.uncertainty.map((x: any) => String(x).trim()).filter(Boolean) : [];

    const lpTitle = String(parsed?.learning_path?.title || 'Learning Path').trim();
    const lpBody = String(parsed?.learning_path?.body || '').trim();

    const budgetLimited = allResults.length === 0;

    const citationLines = citations.length > 0
        ? `\n\nSources:\n${citations.map((c, i) => `${i + 1}. ${c.title} - ${c.url}`).join('\n')}`
        : '\n\nSources:\nNone';

    const reportFinalBody = `${reportBody}${citationLines}`.trim();
    const lpFinalBody = `${lpBody}${citationLines}`.trim();

    return {
        report: {
            title: reportTitle,
            body: reportFinalBody,
            citations,
            uncertainty: reportUncertainty,
            budget_limited: budgetLimited
        },
        learning_path: {
            title: lpTitle,
            body: lpFinalBody,
            citations,
            budget_limited: budgetLimited
        }
    };
}

// Save Gate: finalize or discard a deliverable card

export interface DeliverableContent {
    schema: 'pulse_research_deliverable_v1';
    save_status: 'pending_save' | 'saved' | 'discarded';
    body: string;
    citations: { title: string; url: string }[];
    uncertainty?: string[];
    budget_limited: boolean;
}

export async function saveDeliverable(cardId: string): Promise<{ ok: true } | { error: string }> {
    const existing = getPulseCardById(cardId);
    if (!existing) return { error: 'Deliverable not found.' };
    if (existing.type !== 'research_report' && existing.type !== 'learning_path') {
        return { error: 'Not a deliverable card.' };
    }

    const parsed = safeParseJson<DeliverableContent>(existing.content);
    if (!parsed || parsed.schema !== 'pulse_research_deliverable_v1') {
        return { error: 'Invalid deliverable content.' };
    }
    if (parsed.save_status === 'saved') return { ok: true };
    if (parsed.save_status === 'discarded') return { error: 'Deliverable was already discarded.' };

    parsed.save_status = 'saved';
    updatePulseCard({
        id: cardId,
        content: JSON.stringify(parsed),
        suggested_actions: []
    });

    return { ok: true };
}

export async function discardDeliverable(cardId: string): Promise<{ ok: true } | { error: string }> {
    const existing = getPulseCardById(cardId);
    if (!existing) return { error: 'Deliverable not found.' };
    if (existing.type !== 'research_report' && existing.type !== 'learning_path') {
        return { error: 'Not a deliverable card.' };
    }

    const parsed = safeParseJson<DeliverableContent>(existing.content);
    if (!parsed || parsed.schema !== 'pulse_research_deliverable_v1') {
        return { error: 'Invalid deliverable content.' };
    }
    if (parsed.save_status === 'discarded') return { ok: true };

    parsed.save_status = 'discarded';
    updatePulseCard({
        id: cardId,
        content: JSON.stringify(parsed),
        suggested_actions: []
    });

    return { ok: true };
}
