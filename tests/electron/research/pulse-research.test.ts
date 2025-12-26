import { describe, it, expect } from 'vitest';
import { computeScopeScore, generateQueryVariants } from '../../../electron/research/pulse-research';

describe('Pulse Research Heuristics', () => {
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
