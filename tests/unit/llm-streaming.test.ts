import { describe, expect, it, vi } from 'vitest';
import { consumeStreamWithIdleTimeout } from '../../electron/llm/providers';

// Mock electron app
vi.mock('electron', () => ({
    app: {
        getAppPath: () => '/mock/app/path',
        getPath: () => '/mock/user/data',
    }
}));

// Mock config manager before importing providers
vi.mock('../../electron/config_manager', () => ({
    getMergedLLMConfig: () => ({
        roleConfigs: {},
        providers: {}
    }),
    normalizeProviderDisplayName: (name: string) => name,
    getLLMProvider: () => ({
        generateContentStream: async function* () {
            yield 'Mock chunk 1';
            yield 'Mock chunk 2';
        }
    })
}));

describe('Streaming Support', () => {
    describe('consumeStreamWithIdleTimeout', () => {
        it('should accumulate chunks from async generator', async () => {
            async function* mockStream() {
                yield 'Hello ';
                yield 'World';
                yield '!';
            }

            const result = await consumeStreamWithIdleTimeout(mockStream(), 5000);
            expect(result).toBe('Hello World!');
        });

        it('should throw on idle timeout', async () => {
            async function* slowStream() {
                yield 'First chunk';
                // Simulate a long delay (longer than timeout)
                await new Promise(r => setTimeout(r, 200));
                yield 'Second chunk';
            }

            // Use a very short timeout to trigger the error
            await expect(
                consumeStreamWithIdleTimeout(slowStream(), 100)
            ).rejects.toThrow('Stream idle timeout');
        });

        it('should handle empty stream', async () => {
            async function* emptyStream() {
                // No yields
            }

            const result = await consumeStreamWithIdleTimeout(emptyStream(), 5000);
            expect(result).toBe('');
        });

        it('should track max idle duration without throwing if within limit', async () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            async function* timedStream() {
                yield 'A';
                await new Promise(r => setTimeout(r, 50));
                yield 'B';
                await new Promise(r => setTimeout(r, 80));
                yield 'C';
            }

            const result = await consumeStreamWithIdleTimeout(timedStream(), 5000);
            expect(result).toBe('ABC');

            // Verify max idle duration was logged
            expect(consoleSpy).toHaveBeenCalledWith(
                '[LLMStream] Max idle duration:',
                expect.any(Number),
                'ms'
            );

            consoleSpy.mockRestore();
        });
    });

    describe('MockProvider.generateContentStream', () => {
        it('should yield chunks of the response', async () => {
            // Import dynamically to avoid circular dependencies
            const { getLLMProvider } = await import('../../electron/llm/providers');

            // The mock above replaces getLLMProvider, so we get the mocked object directly
            const provider = getLLMProvider('NONEXISTENT_ROLE');

            if (!provider.generateContentStream) {
                throw new Error('generateContentStream not available');
            }

            const chunks: string[] = [];
            for await (const chunk of provider.generateContentStream({ prompt: 'test' })) {
                chunks.push(chunk);
            }

            expect(chunks.length).toBeGreaterThan(0);
            // Verify content matches what MockProvider actually returns (defined in providers.ts)
            expect(chunks.join('')).toContain('Mock response');
        });
    });
});
