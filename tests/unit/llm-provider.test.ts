import { beforeEach, describe, expect, it, vi } from 'vitest';

// 1. Hoist Mocks
const mocks = vi.hoisted(() => ({
    mockGetMergedLLMConfig: vi.fn()
}));

// 2. Mock Dependencies
vi.mock('../../electron/config_manager', () => ({
    getMergedLLMConfig: mocks.mockGetMergedLLMConfig
}));

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// 3. Import SUT
import { createLLMProviderFromConfig, getLLMProvider } from '../../electron/llm/providers';

describe('LLM Provider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch.mockReset();
    });

    describe('getLLMProvider Factory', () => {
        it('should return MockProvider if role is not configured', () => {
            mocks.mockGetMergedLLMConfig.mockReturnValue({
                roleConfigs: {},
                providers: {}
            });

            const provider = getLLMProvider('UNKNOWN_ROLE');
            expect(provider.constructor.name).toBe('MockProvider');
        });

        it('should return MockProvider if provider is missing in config', () => {
            mocks.mockGetMergedLLMConfig.mockReturnValue({
                roleConfigs: {
                    TEST_ROLE: { provider: 'missing-provider', model: 'gpt-4' }
                },
                providers: {}
            });

            const provider = getLLMProvider('TEST_ROLE');
            expect(provider.constructor.name).toBe('MockProvider');
        });

        it('should return MockProvider if API key is missing', () => {
            mocks.mockGetMergedLLMConfig.mockReturnValue({
                roleConfigs: {
                    TEST_ROLE: { provider: 'openai', model: 'gpt-4' }
                },
                providers: {
                    openai: { apiKey: '', apiBaseUrl: 'https://api.openai.com/v1' }
                }
            });

            const provider = getLLMProvider('TEST_ROLE');
            expect(provider.constructor.name).toBe('MockProvider');
        });

        it('should return OpenAIProvider when correctly configured', () => {
            mocks.mockGetMergedLLMConfig.mockReturnValue({
                roleConfigs: {
                    TEST_ROLE: { provider: 'openai', model: 'gpt-4' }
                },
                providers: {
                    openai: { apiKey: 'sk-test', apiBaseUrl: 'https://api.openai.com/v1' }
                }
            });

            const provider = getLLMProvider('TEST_ROLE');
            expect(provider.constructor.name).toBe('OpenAIProvider');
        });
    });

    describe('OpenAIProvider', () => {
        it('should make correct API call', async () => {
            const provider = createLLMProviderFromConfig('openai', 'sk-test', 'https://api.test', 'gpt-test');

            // Mock successful response
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    choices: [{ message: { content: 'Hello World' } }]
                })
            });

            const result = await provider.generateContent({ prompt: 'Hi' });

            expect(result).toBe('Hello World');
            expect(mockFetch).toHaveBeenCalledWith(
                'https://api.test/chat/completions',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'Authorization': 'Bearer sk-test',
                        'Content-Type': 'application/json'
                    }),
                    body: expect.stringContaining('"model":"gpt-test"')
                })
            );
        });

        it('should retry on 500 error', async () => {
            const provider = createLLMProviderFromConfig('openai', 'sk-test', 'https://api.test', 'gpt-test');

            // Fail twice, then succeed
            mockFetch
                .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'Server Error' })
                .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'Server Error' })
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ choices: [{ message: { content: 'Success' } }] })
                });

            const result = await provider.generateContent({ prompt: 'Hi' });

            expect(result).toBe('Success');
            expect(mockFetch).toHaveBeenCalledTimes(3);
        });

        it('should throw on 400 Client Error (no retry)', async () => {
            const provider = createLLMProviderFromConfig('openai', 'sk-test', 'https://api.test', 'gpt-test');

            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                text: async () => 'Unauthorized'
            });

            await expect(provider.generateContent({ prompt: 'Hi' }))
                .rejects.toThrow('OpenAI API Error 401: Unauthorized');

            expect(mockFetch).toHaveBeenCalledTimes(1);
        });
    });
});
