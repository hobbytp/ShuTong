import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryProcessor } from '../../electron/features/pulse/agent/memory-processor';

describe('MemoryProcessor', () => {
    let mockStore: any;
    let mockModel: any;
    let processor: MemoryProcessor;

    beforeEach(() => {
        mockStore = {
            search: vi.fn(),
            put: vi.fn(),
            delete: vi.fn(),
        };
        mockModel = {
            invoke: vi.fn(),
            withStructuredOutput: vi.fn(),
        };
        processor = new MemoryProcessor({ store: mockStore, model: mockModel });
    });

    describe('extractFacts', () => {
        it('should return empty array if facts are empty', async () => {
            mockModel.withStructuredOutput.mockReturnValue({
                invoke: vi.fn().mockResolvedValue({ facts: [] })
            });
            const result = await processor.extractFacts('Hello');
            expect(result).toEqual([]);
        });

        it('should extract facts from valid model response', async () => {
            mockModel.withStructuredOutput.mockReturnValue({
                invoke: vi.fn().mockResolvedValue({ facts: ['Fact 1', 'Fact 2'] })
            });
            const result = await processor.extractFacts('Conversation data');
            expect(result).toEqual(['Fact 1', 'Fact 2']);
        });

        it('should fallback to manual parsing if withStructuredOutput fails', async () => {
            mockModel.withStructuredOutput = undefined; // Simulate model without structured output
            mockModel.invoke.mockResolvedValue({
                content: '{"facts": ["Manual Fact"]}'
            });
            const result = await processor.extractFacts('Conversation data');
            expect(result).toEqual(['Manual Fact']);
        });
    });

    describe('processFacts', () => {
        it('should handle ADD event correctly', async () => {
            mockStore.search.mockResolvedValue([]); // No existing memories
            mockModel.withStructuredOutput.mockReturnValue({
                invoke: vi.fn().mockResolvedValue({
                    memory: [{ id: 'new-id', text: 'New Fact', event: 'ADD' }]
                })
            });

            await processor.processFacts('user-1', ['New Fact']);
            expect(mockStore.put).toHaveBeenCalledWith(
                ['user-1', 'memories'],
                expect.any(String),
                expect.objectContaining({ content: 'New Fact' })
            );
        });

        it('should handle UPDATE event correctly', async () => {
            mockStore.search.mockResolvedValue([{ key: 'old-id', value: { content: 'Old Fact' } }]);
            mockModel.withStructuredOutput.mockReturnValue({
                invoke: vi.fn().mockResolvedValue({
                    memory: [{ id: 'old-id', text: 'Updated Fact', event: 'UPDATE' }]
                })
            });

            await processor.processFacts('user-1', ['Updated Fact']);
            expect(mockStore.put).toHaveBeenCalledWith(
                ['user-1', 'memories'],
                'old-id',
                expect.objectContaining({ content: 'Updated Fact' })
            );
        });

        it('should handle DELETE event correctly', async () => {
            mockStore.search.mockResolvedValue([{ key: 'deleted-id', value: { content: 'To Delete' } }]);
            mockModel.withStructuredOutput.mockReturnValue({
                invoke: vi.fn().mockResolvedValue({
                    memory: [{ id: 'deleted-id', text: 'To Delete', event: 'DELETE' }]
                })
            });

            await processor.processFacts('user-1', ['Delete this']);
            expect(mockStore.delete).toHaveBeenCalledWith(['user-1', 'memories'], 'deleted-id');
        });
    });
});
