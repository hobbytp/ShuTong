
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
}


// Simple factory for now
import { getMergedLLMConfig } from '../config_manager';

// Factory for role-based provider selection
export function getLLMProvider(role: string): LLMProvider {
    const config = getMergedLLMConfig();

    // 1. Get Role Config
    const roleConfig = config.roleConfigs[role];
    if (!roleConfig) {
        console.warn(`[LLM] Role "${role}" not configured. Using Mock.`);
        return new MockProvider();
    }

    // 2. Get Provider Config
    const providerName = roleConfig.provider;
    const providerCfg = config.providers[providerName];
    if (!providerCfg) {
        console.warn(`[LLM] Provider "${providerName}" not found for role "${role}". Using Mock.`);
        return new MockProvider();
    }

    // 3. Resolve API Key (User Override > Env Var)
    const apiKey = providerCfg.apiKey || process.env[providerCfg.apiKeyEnv] || '';

    if (!apiKey) {
        console.warn(`[LLM] No API key found for ${providerName}. Using Mock.`);
        return new MockProvider();
    }

    // 4. Instantiate Provider
    if (providerName === 'Google') {
        return new GeminiProvider(apiKey, roleConfig.model);
    }

    // Default to OpenAI Compatible
    return new OpenAIProvider(apiKey, providerCfg.apiBaseUrl, roleConfig.model, providerName);
}

export function createLLMProviderFromConfig(providerName: string, apiKey: string, baseUrl: string, model: string = 'gpt-3.5-turbo'): LLMProvider {
    if (providerName === 'Google') {
        return new GeminiProvider(apiKey, model);
    }
    return new OpenAIProvider(apiKey, baseUrl, model, providerName);
}

class MockProvider implements LLMProvider {
    async generateContent(request: LLMRequest): Promise<string> {
        await new Promise(r => setTimeout(r, 1000)); // Simulate latency

        // Return valid JSON based on prompt detection (crude but effective for mock)
        if (request.prompt.includes('"observations": [')) {
            // Transcription mock
            return JSON.stringify({
                observations: [
                    { start_index: 0, end_index: 0, text: "User is checking email in Outlook" },
                    { start_index: 0, end_index: 0, text: "User switched to VS Code" }
                ]
            });
        } else if (request.prompt.includes('"cards": [')) {
            // Card mock
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
}

class OpenAIProvider implements LLMProvider {
    private apiKey: string;
    private baseUrl: string;
    private model: string;
    private providerName: string;

    constructor(apiKey: string, baseUrl: string, model: string, providerName: string = 'OpenAI') {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
        this.model = model;
        this.providerName = providerName;
    }

    async generateContent(request: LLMRequest): Promise<string> {
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
                    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

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
                        // Check for JSON mode error specifically or generic 400
                        if (useJsonMode && response.status === 400) {
                            throw new Error(`JSON_MODE_ERROR: ${errText}`);
                        }
                        // Don't retry 4xx errors (client faults), except maybe 429
                        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                            throw new Error(`${this.providerName} API Error ${response.status}: ${errText}`);
                        }
                        // Retry 5xx or 429
                        throw new Error(`Server Error ${response.status}: ${errText}`);
                    }

                    const data = await response.json();
                    return data.choices[0].message.content;

                } catch (err: any) {
                    lastError = err;
                    // If strictly JSON mode error, abort retry loop to switch strategies
                    if (err.message.includes('JSON_MODE_ERROR')) {
                        throw err;
                    }
                    // If client error (not 429), abort
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
            // Try with JSON mode first
            return await makeRequest(true);
        } catch (err: any) {
            if (err.message.includes('JSON_MODE_ERROR') || err.message.includes('Json mode is not supported')) {
                console.warn(`[${this.providerName}] JSON mode not supported, retrying without it...`);
                return await makeRequest(false);
            }
            throw err;
        }
    }
}

class GeminiProvider implements LLMProvider {
    private apiKey: string;
    private model: string;

    constructor(apiKey: string, model: string) {
        this.apiKey = apiKey;
        this.model = model;
    }

    async generateContent(request: LLMRequest): Promise<string> {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

        const contents: any[] = [{
            parts: [{ text: request.prompt }]
        }];

        if (request.images && request.images.length > 0) {
            // Gemini expects inline data for images
            // In a real app we might upload or just send base64
            // Since this runs in Electron (Node), we can read files
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
                response_mime_type: "application/json" // Force JSON
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Gemini API Error ${response.status}: ${err}`);
        }

        const data = await response.json();
        try {
            return data.candidates[0].content.parts[0].text;
        } catch (e) {
            throw new Error("Unexpected Gemini response format");
        }
    }
}
