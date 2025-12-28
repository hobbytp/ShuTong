
import { getLLMMetrics } from './metrics';

export interface LLMResponse {
    text?: string;
    json?: any;
    usage?: {
        promptTokens: number;
        completionTokens: number;
    };
}

export interface LLMRequest {
    prompt: string;
    images?: {
        path: string;
        mimeType: string;
    }[];
    schema?: any; // Optional JSON schema for structured output
}

export interface LLMProvider {
    generateContent(request: LLMRequest): Promise<string>;
    embedQuery?(text: string): Promise<number[]>;
}

function normalizeProviderDisplayName(providerKey: string): string {
    if (providerKey.toLowerCase() === 'openai') return 'OpenAI';
    return providerKey;
}

// Factory for role-based provider selection
import { getMergedLLMConfig } from '../config_manager';

export function getLLMProvider(role: string): LLMProvider {
    const config = getMergedLLMConfig();

    // 1. Get Role Config
    const roleConfig = config.roleConfigs[role];
    if (!roleConfig) {
        console.warn(`[LLM] Role "${role}" not configured. Using Mock.`);
        return new MockProvider();
    }

    // 2. Get Provider Config
    const providerKey = roleConfig.provider;
    const providerCfg = config.providers[providerKey];
    if (!providerCfg) {
        console.warn(`[LLM] Provider "${providerKey}" not found for role "${role}". Using Mock.`);
        return new MockProvider();
    }

    // 3. Resolve API Key (User Override > Env Var)
    const apiKey = providerCfg.apiKey || process.env[providerCfg.apiKeyEnv] || '';

    if (!apiKey) {
        console.warn(`[LLM] No API key found for ${providerKey}. Using Mock.`);
        return new MockProvider();
    }

    // 4. Instantiate Provider
    const timeout = providerCfg.timeout || 60000;

    if (providerKey === 'Google') {
        return new GeminiProvider(apiKey, roleConfig.model, timeout);
    }

    // Default to OpenAI Compatible
    return new OpenAIProvider(apiKey, providerCfg.apiBaseUrl, roleConfig.model, normalizeProviderDisplayName(providerKey), timeout);
}

export function createLLMProviderFromConfig(providerName: string, apiKey: string, baseUrl: string, model: string = 'gpt-3.5-turbo'): LLMProvider {
    if (providerName === 'Google') {
        return new GeminiProvider(apiKey, model);
    }
    return new OpenAIProvider(apiKey, baseUrl, model, normalizeProviderDisplayName(providerName));
}

class MockProvider implements LLMProvider {
    async generateContent(request: LLMRequest): Promise<string> {
        // ... (existing mock implementation)
        await new Promise(r => setTimeout(r, 1000));
        if (request.prompt.includes('"observations": [')) {
            return JSON.stringify({
                observations: [
                    { start_index: 0, end_index: 0, text: "User is checking email in Outlook" },
                    { start_index: 0, end_index: 0, text: "User switched to VS Code" }
                ]
            });
        } else if (request.prompt.includes('"cards": [')) {
            return JSON.stringify({
                cards: [
                    {
                        title: "Coding",
                        summary: "Working on ShuTong project",
                        category: "Work",
                        confidence: 0.95,
                        start_index: 0,
                        end_index: 1
                    }
                ]
            });
        }
        return JSON.stringify({ message: "Mock response" });
    }

    async embedQuery(text: string): Promise<number[]> {
        void text;
        return new Array(1536).fill(0.1); // Mock embedding
    }
}

class OpenAIProvider implements LLMProvider {
    private apiKey: string;
    private baseUrl: string;
    private model: string;
    private providerName: string;
    private timeout: number;

    constructor(apiKey: string, baseUrl: string, model: string, providerName: string = 'OpenAI', timeout: number = 60000) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
        this.model = model;
        this.providerName = providerName;
        this.timeout = timeout;
    }

    async generateContent(request: LLMRequest): Promise<string> {
        const startTime = Date.now();
        const metrics = getLLMMetrics();

        try {
            const result = await this._doGenerateContent(request);
            metrics.recordRequest({
                timestamp: startTime,
                durationMs: Date.now() - startTime,
                provider: this.providerName,
                model: this.model,
                success: true
            });
            return result;
        } catch (error) {
            metrics.recordRequest({
                timestamp: startTime,
                durationMs: Date.now() - startTime,
                provider: this.providerName,
                model: this.model,
                success: false,
                errorCategory: metrics.categorizeError(error)
            });
            throw error;
        }
    }

    private async _doGenerateContent(request: LLMRequest): Promise<string> {
        const url = `${this.baseUrl}/chat/completions`;

        const content: any[] = [
            { type: "text", text: request.prompt }
        ];

        if (request.images && request.images.length > 0) {
            const fs = await import('fs/promises');
            for (const img of request.images) {
                try {
                    const b64 = await fs.readFile(img.path, { encoding: 'base64' });
                    content.push({
                        type: "image_url",
                        image_url: {
                            url: `data:${img.mimeType};base64,${b64}`
                        }
                    });
                } catch (e) {
                    console.error(`[${this.providerName}] Failed to read image ${img.path}`, e);
                }
            }
        }

        const basePayload = {
            model: this.model,
            messages: [
                {
                    role: "user",
                    content: content
                }
            ],
            temperature: 0.2
        };

        const makeRequest = async (useJsonMode: boolean) => {
            const payload = {
                ...basePayload,
                response_format: useJsonMode ? { type: "json_object" } : undefined
            };

            let lastError: any;
            const MAX_RETRIES = 3;

            for (let i = 0; i < MAX_RETRIES; i++) {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

                    const response = await fetch(url, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.apiKey}`
                        },
                        body: JSON.stringify(payload),
                        signal: controller.signal
                    });

                    clearTimeout(timeoutId);

                    if (!response.ok) {
                        const errText = await response.text();
                        if (useJsonMode && response.status === 400) {
                            throw new Error(`JSON_MODE_ERROR: ${errText}`);
                        }
                        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                            throw new Error(`${this.providerName} API Error ${response.status}: ${errText}`);
                        }
                        throw new Error(`Server Error ${response.status}: ${errText}`);
                    }

                    const data = await response.json();
                    return data.choices[0].message.content;

                } catch (err: any) {
                    lastError = err;
                    if (err.message.includes('JSON_MODE_ERROR')) {
                        throw err;
                    }
                    if (err.message.includes(`${this.providerName} API Error`)) {
                        throw err;
                    }

                    console.warn(`[${this.providerName}] Attempt ${i + 1} failed: ${err.message}. Retrying in ${1000 * (i + 1)}ms...`);
                    await new Promise(r => setTimeout(r, 1000 * (i + 1)));
                }
            }
            throw lastError;
        };

        try {
            return await makeRequest(true);
        } catch (err: any) {
            if (err.message.includes('JSON_MODE_ERROR') || err.message.includes('Json mode is not supported')) {
                console.warn(`[${this.providerName}] JSON mode not supported, retrying without it...`);
                return await makeRequest(false);
            }
            throw err;
        }
    }

    async embedQuery(text: string): Promise<number[]> {
        const url = `${this.baseUrl}/embeddings`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    input: text,
                    model: this.model
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`${this.providerName} Embedding Error ${response.status}: ${errText}`);
            }

            const data = await response.json();
            if (data.data && data.data.length > 0) {
                return data.data[0].embedding;
            }
            throw new Error("Invalid embedding response format");
        } catch (error: any) {
            console.error(`[${this.providerName}] Embed query failed:`, error);
            throw error;
        }
    }
}

class GeminiProvider implements LLMProvider {
    private apiKey: string;
    private model: string;
    private timeout: number;

    constructor(apiKey: string, model: string, timeout: number = 60000) {
        this.apiKey = apiKey;
        this.model = model;
        this.timeout = timeout;
    }

    async generateContent(request: LLMRequest): Promise<string> {
        const startTime = Date.now();
        const metrics = getLLMMetrics();

        try {
            const result = await this._doGenerateContent(request);
            metrics.recordRequest({
                timestamp: startTime,
                durationMs: Date.now() - startTime,
                provider: 'Gemini',
                model: this.model,
                success: true
            });
            return result;
        } catch (error) {
            metrics.recordRequest({
                timestamp: startTime,
                durationMs: Date.now() - startTime,
                provider: 'Gemini',
                model: this.model,
                success: false,
                errorCategory: metrics.categorizeError(error)
            });
            throw error;
        }
    }

    private async _doGenerateContent(request: LLMRequest): Promise<string> {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

        const contents: any[] = [{
            parts: [{ text: request.prompt }]
        }];

        if (request.images && request.images.length > 0) {
            const fs = await import('fs/promises');
            for (const img of request.images) {
                try {
                    const b64 = await fs.readFile(img.path, { encoding: 'base64' });
                    contents[0].parts.push({
                        inline_data: {
                            mime_type: img.mimeType,
                            data: b64
                        }
                    });
                } catch (e) {
                    console.error(`[Gemini] Failed to read image ${img.path}`, e);
                }
            }
        }

        const payload = {
            contents,
            generationConfig: {
                temperature: 0.2,
                response_mime_type: "application/json"
            }
        };

        const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

        const parseRetryAfterMs = (errText: string) => {
            try {
                const parsed = JSON.parse(errText);
                const delay = parsed?.error?.details?.find((d: any) => typeof d?.retryDelay === 'string')?.retryDelay;
                if (typeof delay === 'string') {
                    const m = delay.match(/(\d+(?:\.\d+)?)s/);
                    if (m) return Math.ceil(Number(m[1]) * 1000);
                }
            } catch {
                // ignore
            }

            const m1 = errText.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
            if (m1) return Math.ceil(Number(m1[1]) * 1000);

            const m2 = errText.match(/Please retry in\s+(\d+(?:\.\d+)?)s/i);
            if (m2) return Math.ceil(Number(m2[1]) * 1000);

            return null;
        };

        let lastError: any;
        const MAX_RETRIES = 3;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), this.timeout);

                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    const errText = await response.text();

                    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                        throw new Error(`Gemini API Error ${response.status}: ${errText}`);
                    }

                    if (response.status === 429) {
                        const retryAfterHeader = response.headers.get('retry-after');
                        const retryAfterHeaderMs = retryAfterHeader ? Math.ceil(Number(retryAfterHeader) * 1000) : null;
                        const retryAfterMs = retryAfterHeaderMs ?? parseRetryAfterMs(errText) ?? (1000 * (attempt + 1));
                        throw new Error(`GEMINI_RATE_LIMIT:${retryAfterMs}:${errText}`);
                    }

                    throw new Error(`Server Error ${response.status}: ${errText}`);
                }

                const data = await response.json();
                try {
                    return data.candidates[0].content.parts[0].text;
                } catch {
                    throw new Error('Unexpected Gemini response format');
                }
            } catch (err: any) {
                lastError = err;

                const msg = String(err?.message || err);
                if (msg.startsWith('Gemini API Error')) {
                    throw err;
                }

                if (msg.startsWith('GEMINI_RATE_LIMIT:')) {
                    const parts = msg.split(':');
                    const retryMs = Number(parts[1]) || (1000 * (attempt + 1));
                    console.warn(`[Gemini] Attempt ${attempt + 1} rate-limited. Retrying in ${retryMs}ms...`);
                    await sleep(retryMs);
                    continue;
                }

                console.warn(`[Gemini] Attempt ${attempt + 1} failed: ${msg}. Retrying in ${1000 * (attempt + 1)}ms...`);
                await sleep(1000 * (attempt + 1));
            }
        }

        throw lastError;
    }

    // Gemini embedding support could be added here if needed, 
    // but for now leaving as undefined or throwing not supported
    async embedQuery(text: string): Promise<number[]> {
        void text;
        throw new Error("Embedding text is not yet implemented for GeminiProvider in this context");
    }
}
