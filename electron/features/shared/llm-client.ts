import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { getLLMConfigForMain } from "../../config_manager";

type ChatModel = {
    invoke(messages: BaseMessage[]): Promise<BaseMessage>;
};

export class SharedLLMClient {
    public static async getClient(roleName: 'PULSE_AGENT' | 'DEEP_THINKING' = 'PULSE_AGENT'): Promise<ChatModel> {
        const config = getLLMConfigForMain();

        const toTextContent = (content: any) => {
            if (typeof content === 'string') return content;
            try {
                return JSON.stringify(content);
            } catch {
                return String(content);
            }
        };

        const toPrompt = (messages: BaseMessage[]) => {
            return messages
                .map(m => {
                    const content = toTextContent((m as any).content);
                    if (m instanceof SystemMessage) return `System: ${content}`;
                    if (m instanceof HumanMessage) return `User: ${content}`;
                    return `Assistant: ${content}`;
                })
                .join('\n\n');
        };

        const createGeminiNativeModel = (opts: { apiKey: string; model: string; temperature: number }): ChatModel => {
            const apiKey = opts.apiKey;
            const model = opts.model;
            const temperature = opts.temperature;

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

            return {
                async invoke(messages: BaseMessage[]) {
                    const prompt = toPrompt(messages);
                    // Use v1beta for now as in original code
                    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

                    const payload = {
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature }
                    };

                    let lastError: any;
                    const MAX_RETRIES = 3;

                    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                        try {
                            const controller = new AbortController();
                            const timeoutId = setTimeout(() => controller.abort(), 60000);

                            const response = await fetch(url, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(payload),
                                signal: controller.signal
                            });

                            clearTimeout(timeoutId);

                            if (!response.ok) {
                                const errText = await response.text();

                                if (response.status === 429) {
                                    const retryAfterHeader = response.headers.get('retry-after');
                                    const retryAfterHeaderMs = retryAfterHeader ? Math.ceil(Number(retryAfterHeader) * 1000) : null;
                                    const retryAfterMs = retryAfterHeaderMs ?? parseRetryAfterMs(errText) ?? (1000 * (attempt + 1));
                                    await sleep(retryAfterMs);
                                    continue;
                                }

                                throw new Error(`Gemini API Error ${response.status}: ${errText}`);
                            }

                            const data = await response.json();
                            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                            if (typeof text !== 'string') {
                                throw new Error('Unexpected Gemini response format');
                            }

                            return new AIMessage(text);
                        } catch (err: any) {
                            lastError = err;
                            const msg = String(err?.message || err);
                            if (msg.startsWith('Gemini API Error')) throw err;
                            await sleep(1000 * (attempt + 1));
                        }
                    }

                    throw lastError;
                }
            };
        };

        const pickFirstModel = (provider: any): string | undefined => {
            const models = provider?.models ? Object.keys(provider.models) : [];
            return models.length > 0 ? models[0] : undefined;
        };

        const resolveModel = (providerName: string, requested: string | undefined): string => {
            const provider = (config.providers as any)?.[providerName];
            const fallback = pickFirstModel(provider) || 'gpt-4o';
            if (!requested) return fallback;
            if (provider?.models && !provider.models[requested]) {
                console.warn(
                    `[SharedLLMClient] Model "${requested}" not found in provider "${providerName}". Falling back to "${fallback}".`
                );
                return fallback;
            }
            return requested;
        };

        let selectedProviderName: string | undefined;
        let apiKey: string | undefined;
        let baseURL: string | undefined;
        let modelName: string | undefined;
        let temperature = 0.5;

        let geminiNative: ChatModel | undefined;

        const tryRole = (rName: string): boolean => {
            const role = (config.roleConfigs as any)?.[rName];
            if (!role) return false;
            const provider = (config.providers as any)?.[role.provider];
            if (!provider?.apiKey) {
                if (rName === roleName) {
                    throw new Error(`LLM_API_KEY_MISSING:${roleName}:${role.provider}`);
                }
                return false;
            }

            if (role.provider === 'Google') {
                selectedProviderName = role.provider;
                console.log(
                    `[SharedLLMClient] Using provider=Google (native) model=${role.model} env=${provider.apiKeyEnv} envPresent=${Boolean(process.env[provider.apiKeyEnv])}`
                );
                geminiNative = createGeminiNativeModel({
                    apiKey: provider.apiKey,
                    model: role.model,
                    temperature: typeof role.temperature === 'number' ? role.temperature : temperature
                });
                return true;
            }

            if (!provider.openaiCompatible) {
                if (rName === roleName) {
                    throw new Error(`LLM_PROVIDER_UNSUPPORTED:${roleName}:${role.provider}`);
                }
                console.warn(`[SharedLLMClient] Provider "${role.provider}" for role "${rName}" is not supported; skipping.`);
                return false;
            }

            selectedProviderName = role.provider;
            apiKey = provider.apiKey;
            baseURL = provider.apiBaseUrl;
            modelName = resolveModel(role.provider, role.model);
            temperature = typeof role.temperature === 'number' ? role.temperature : temperature;

            let host = '';
            try {
                host = baseURL ? new URL(baseURL).host : '';
            } catch {
                host = '';
            }
            console.log(
                `[SharedLLMClient] Using provider=${selectedProviderName} model=${modelName} baseURLHost=${host} env=${provider.apiKeyEnv} envPresent=${Boolean(process.env[provider.apiKeyEnv])}`
            );
            return true;
        };

        // Try the requested role first
        if (config.roleConfigs && (config.roleConfigs as any)[roleName]) {
            tryRole(roleName);
        } else {
            // Fallback to PULSE_AGENT or DEEP_THINKING if specific role not found/requested?
            // Actually original code tried PULSE_AGENT then DEEP_THINKING.
            if (tryRole('PULSE_AGENT')) {
                // success
            } else {
                tryRole('DEEP_THINKING');
            }
        }

        if (geminiNative) {
            return geminiNative;
        }

        // Fallback to OpenAI provider
        if (!apiKey) {
            const providerName = 'OpenAI';
            const provider = (config.providers as any)?.[providerName];
            if (provider?.apiKey && provider.openaiCompatible) {
                selectedProviderName = providerName;
                apiKey = provider.apiKey;
                baseURL = provider.apiBaseUrl;
                modelName = provider.models?.['gpt-4o'] ? 'gpt-4o' : resolveModel(providerName, undefined);
            }
        }

        // Fallback to any openaiCompatible provider
        if (!apiKey) {
            for (const [name, provider] of Object.entries(config.providers || {})) {
                const anyProvider: any = provider;
                if (anyProvider.openaiCompatible && anyProvider.apiKey) {
                    selectedProviderName = name;
                    apiKey = anyProvider.apiKey;
                    baseURL = anyProvider.apiBaseUrl;
                    modelName = resolveModel(name, undefined);
                    break;
                }
            }
        }

        if (!apiKey) {
            throw new Error('LLM_API_KEY_MISSING');
        }

        if (!selectedProviderName) {
            selectedProviderName = 'Unknown';
        }

        if (!modelName) {
            modelName = 'gpt-4o';
        }

        return new ChatOpenAI({
            apiKey,
            configuration: { baseURL },
            modelName,
            temperature
        });
    }
}
