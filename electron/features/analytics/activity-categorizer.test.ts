import { describe, it, expect } from 'vitest';
import { ActivityCategorizer } from './activity-categorizer';

describe('ActivityCategorizer', () => {
    it('should categorize known productive apps correctly', () => {
        expect(ActivityCategorizer.categorize('Visual Studio Code')).toBe('productive');
        expect(ActivityCategorizer.categorize('VS Code')).toBe('productive');
        expect(ActivityCategorizer.categorize('Cursor')).toBe('productive');
        expect(ActivityCategorizer.categorize('Notion')).toBe('productive');
        expect(ActivityCategorizer.categorize('Windows Terminal')).toBe('productive');
    });

    it('should categorize known distraction apps correctly', () => {
        expect(ActivityCategorizer.categorize('YouTube')).toBe('distraction');
        expect(ActivityCategorizer.categorize('Steam')).toBe('distraction');
        expect(ActivityCategorizer.categorize('Discord')).toBe('distraction');
    });

    it('should categorize web browsers as neutral (default)', () => {
        expect(ActivityCategorizer.categorize('Google Chrome')).toBe('neutral');
        expect(ActivityCategorizer.categorize('Microsoft Edge')).toBe('neutral');
    });

    it('should categorize unknown apps as neutral', () => {
        expect(ActivityCategorizer.categorize('UnknownApp123')).toBe('neutral');
        expect(ActivityCategorizer.categorize('')).toBe('neutral');
    });

    it('should perform case-insensitive matching', () => {
        expect(ActivityCategorizer.categorize('vscode')).toBe('productive');
        expect(ActivityCategorizer.categorize('youtube')).toBe('distraction');
    });
});
