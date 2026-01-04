import { describe, it, expect } from 'vitest';
import { parseWindowContext, setContextRules, ContextRule } from '../../electron/features/timeline/context-parser';

describe('ContextParser', () => {
    it('should parse VS Code title using default rules', () => {
        // Updated test case to match actual parser logic
        const result = parseWindowContext('Code', 'context-parser.ts — ShuTong — Visual Studio Code');
        // The regex captures "context-parser.ts" correctly
        expect(result.activityType).toBe('coding');
        expect(result.file).toBe('context-parser.ts');
        expect(result.project).toBe('ShuTong');
    });

    it('should parse Browser title using default rules', () => {
        // Fix test case: Include domain in title to verify extraction
        const result = parseWindowContext('Chrome', 'GitHub - hobbytp/ShuTong - github.com - Google Chrome');
        expect(result.activityType).toBe('coding');
        expect(result.domain).toBe('github.com');
    });

    it('should support dynamic rules injection', () => {
        const customRules: ContextRule[] = [
            {
                appPattern: 'notepad',
                activityType: 'productivity',
                parse: (title) => ({ file: title.replace(' - Notepad', '') })
            }
        ];

        setContextRules(customRules);

        const result = parseWindowContext('Notepad', 'notes.txt - Notepad');
        expect(result.activityType).toBe('productivity');
        expect(result.file).toBe('notes.txt');
    });

    it('should fallback to default behavior if no rule matches', () => {
        setContextRules([]); // Clear rules
        const result = parseWindowContext('UnknownApp', 'Some Title');
        expect(result.activityType).toBe('other');
        expect(result.app).toBe('UnknownApp');
    });
});
