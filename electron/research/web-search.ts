import { net } from 'electron';

export interface WebSearchResult {
    title: string;
    url: string;
    snippet?: string;
    source: 'duckduckgo' | 'tavily';
}

function safeText(input: unknown): string {
    if (typeof input !== 'string') return '';
    return input.trim();
}

function extractTitleFromText(text: string): string {
    const cleaned = safeText(text);
    if (!cleaned) return '';
    const dashIdx = cleaned.indexOf(' - ');
    if (dashIdx > 0) return cleaned.slice(0, dashIdx).trim();
    return cleaned;
}

function collectFromRelatedTopics(relatedTopics: any[], results: WebSearchResult[], maxResults: number) {
    for (const item of relatedTopics || []) {
        if (results.length >= maxResults) return;

        if (item && Array.isArray(item.Topics)) {
            collectFromRelatedTopics(item.Topics, results, maxResults);
            continue;
        }

        const text = safeText(item?.Text);
        const url = safeText(item?.FirstURL);
        if (!url) continue;

        const title = extractTitleFromText(text) || url;
        results.push({
            title,
            url,
            snippet: text || undefined,
            source: 'duckduckgo'
        });

        if (results.length >= maxResults) return;
    }
}

export async function searchDuckDuckGoInstantAnswer(query: string, opts?: { maxResults?: number; timeoutMs?: number }): Promise<WebSearchResult[]> {
    const maxResults = opts?.maxResults ?? 8;
    const timeoutMs = opts?.timeoutMs ?? 15000;

    const q = safeText(query);
    if (!q) return [];

    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_redirect=1&no_html=1`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await net.fetch(url, {
            method: 'GET',
            signal: controller.signal,
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`DDG_HTTP_${response.status}: ${text.slice(0, 200)}`);
        }

        const data: any = await response.json();

        const results: WebSearchResult[] = [];

        const abstractUrl = safeText(data?.AbstractURL);
        const abstractText = safeText(data?.AbstractText);
        if (abstractUrl) {
            results.push({
                title: extractTitleFromText(abstractText) || safeText(data?.Heading) || abstractUrl,
                url: abstractUrl,
                snippet: abstractText || undefined,
                source: 'duckduckgo'
            });
        }

        for (const item of data?.Results || []) {
            if (results.length >= maxResults) break;
            const firstUrl = safeText(item?.FirstURL);
            if (!firstUrl) continue;
            const text = safeText(item?.Text);
            results.push({
                title: extractTitleFromText(text) || firstUrl,
                url: firstUrl,
                snippet: text || undefined,
                source: 'duckduckgo'
            });
        }

        if (results.length < maxResults) {
            collectFromRelatedTopics(data?.RelatedTopics || [], results, maxResults);
        }

        const seen = new Set<string>();
        return results.filter(r => {
            const key = r.url;
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });

    } catch (e: any) {
        // Graceful degradation: log and return empty to allow fallback
        console.warn('[DDG] Search failed:', e.message);
        return [];
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Tavily Search API - More powerful than DuckDuckGo, supports Chinese and complex queries
 * Requires TAVILY_API_KEY environment variable
 */
export async function searchTavily(query: string, opts?: { maxResults?: number; timeoutMs?: number }): Promise<WebSearchResult[]> {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
        console.warn('[Tavily] TAVILY_API_KEY not set, skipping Tavily search');
        return [];
    }

    const maxResults = opts?.maxResults ?? 5;
    const timeoutMs = opts?.timeoutMs ?? 30000;

    const q = safeText(query);
    if (!q) return [];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await net.fetch('https://api.tavily.com/search', {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                api_key: apiKey,
                query: q,
                max_results: maxResults,
                search_depth: 'basic',
                include_answer: false,
                include_raw_content: false
            })
        });

        if (!response.ok) {
            const text = await response.text();
            console.error(`[Tavily] HTTP ${response.status}: ${text.slice(0, 200)}`);
            return [];
        }

        const data: any = await response.json();
        const results: WebSearchResult[] = [];

        for (const item of data?.results || []) {
            results.push({
                title: safeText(item?.title) || safeText(item?.url),
                url: safeText(item?.url),
                snippet: safeText(item?.content),
                source: 'tavily'
            });
        }

        return results;

    } catch (e: any) {
        console.error('[Tavily] Search failed:', e.message);
        return [];
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Combined search function: Try DuckDuckGo first, fallback to Tavily if empty
 */
export async function searchWeb(query: string, opts?: { maxResults?: number }): Promise<WebSearchResult[]> {
    const maxResults = opts?.maxResults ?? 5;

    // Try DuckDuckGo first (faster, no API key needed)
    let results = await searchDuckDuckGoInstantAnswer(query, { maxResults });

    if (results.length === 0) {
        console.log('[WebSearch] DuckDuckGo returned empty, trying Tavily...');
        results = await searchTavily(query, { maxResults });
    }

    // Log final result source
    if (results.length > 0) {
        console.log(`[WebSearch] Got ${results.length} results from ${results[0].source}`);
    } else {
        console.log('[WebSearch] No results from any provider for query:', query);
    }

    return results;
}

