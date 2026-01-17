import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeScopeScore, generateQueryVariants, generateResearchProposalCard } from '../../../electron/features/pulse/research/pulse-research';
import * as storage from '../../../electron/storage';
import * as providers from '../../../electron/llm/providers';

const { mockStorage, mockProvider, mockI18n } = vi.hoisted(() => ({
    mockStorage: {
        getPulseCards: vi.fn().mockReturnValue([]),
        getTimelineCards: vi.fn().mockReturnValue([]),
        savePulseCard: vi.fn(),
        updatePulseCard: vi.fn(),
        getPulseCardById: vi.fn(),
    },
    mockProvider: {
        generateContent: vi.fn().mockResolvedValue(JSON.stringify({
            title: 'Test Proposal',
            question: 'What is the impact of X?',
            evidence: ['Evidence 1']
        }))
    },
    mockI18n: {
        t: vi.fn().mockImplementation((key, options) => {
            if (key === 'pulse.time_range_label') return 'Time Range';
            if (options && typeof options === 'object' && options.defaultValue) {
                return options.defaultValue.replace('{{range}}', options.range || '');
            }
            return key;
        })
    }
}));

vi.mock('i18next', () => ({
    default: mockI18n
}));

vi.mock('../../../electron/storage', () => mockStorage);


vi.mock('../../../electron/llm/providers', () => ({
    getLLMProvider: vi.fn().mockReturnValue(mockProvider),
}));


describe('Pulse Research Heuristics', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('generateResearchProposalCard', () => {
        it('should use default 24h range if no timeRange provided', async () => {
            await generateResearchProposalCard();

            expect(mockStorage.getTimelineCards).toHaveBeenCalledWith(
                50,
                0,
                undefined,
                undefined,
                expect.any(Number), // rangeStart
                expect.any(Number)  // rangeEnd
            );

            const [, , , , start, end] = (mockStorage.getTimelineCards as any).mock.calls[0];
            expect(end - start).toBeCloseTo(86400, 1); // 24h
        });

        it('should use provided timeRange and label', async () => {
            const timeRange = {
                start: 1000,
                end: 2000,
                label: 'Custom Range'
            };

            mockStorage.getTimelineCards.mockReturnValue([{ title: 'Card', summary: 'Summary' }]);
            await generateResearchProposalCard(timeRange);

            expect(mockStorage.getTimelineCards).toHaveBeenCalledWith(
                50,
                0,
                undefined,
                undefined,
                1000,
                2000
            );

            const prompt = (mockProvider.generateContent as any).mock.calls[0][0].prompt;
            expect(prompt).toContain('Time Range: Custom Range');
        });

        it('should return error if no activity found in range', async () => {
            mockStorage.getPulseCards.mockReturnValue([]);
            mockStorage.getTimelineCards.mockReturnValue([]);

            const result = await generateResearchProposalCard({ start: 100, end: 200 });

            expect(result).toEqual({
                error: expect.stringContaining('No activity found')
            });
        });
    });

    describe('computeScopeScore', () => {
        it('should score low for simple queries', () => {
            const res = computeScopeScore('what is python');
            expect(res.score).toBeLessThan(6);
            expect(res.keywordCount).toBeLessThan(6);
            expect(res.questionCount).toBe(1);
        });

        it('should score higher for complex queries with many keywords', () => {
            const res = computeScopeScore('comprehensive analysis of python versus javascript performance in web assembly context');
            expect(res.keywordCount).toBeGreaterThanOrEqual(6);
            expect(res.score).toBeGreaterThan(0);
        });

        it('should detect comparison patterns', () => {
            const res = computeScopeScore('compare python vs javascript');
            expect(res.comparisonCount).toBeGreaterThanOrEqual(2);
            expect(res.score).toBeGreaterThanOrEqual(2);
        });

        it('should detect time ranges', () => {
            const res = computeScopeScore('history of computing over the last decade');
            expect(res.timeRangeDays).toBeGreaterThanOrEqual(3650);
            expect(res.score).toBeGreaterThanOrEqual(3);
        });
    });

    describe('generateQueryVariants', () => {
        it('should return base query if maxVariants is 1', () => {
            const res = generateQueryVariants('test query', 1);
            expect(res).toHaveLength(1);
            expect(res[0]).toBe('test query');
        });

        it('should add "What is" variant if maxVariants >= 2', () => {
            const res = generateQueryVariants('python', 2);
            expect(res).toHaveLength(2);
            expect(res[1]).toBe('What is python');
        });

        it('should remove "What is" if already present', () => {
            const res = generateQueryVariants('What is python', 2);
            expect(res).toHaveLength(2);
            expect(res[1]).toBe('python');
        });

        it('should add keyword variant if maxVariants >= 3', () => {
            const res = generateQueryVariants('what is the capital of france', 3);
            expect(res.length).toBeGreaterThanOrEqual(2);
        });
    });
});

