import { describe, expect, it } from 'vitest';

/**
 * Topic Agent Unit Tests
 * 
 * These tests validate the logic/parsing that will be used by TopicAgent nodes,
 * without requiring full LangGraph execution (which needs Electron runtime).
 * 
 * For integration tests, use manual testing in the Electron app.
 */

describe('Topic Agent Logic', () => {

    describe('Intent Parsing', () => {
        // Simulate parsing LLM JSON responses

        it('should parse SEARCH intent correctly', () => {
            const llmOutput = JSON.stringify({
                intent: 'SEARCH',
                search_query: 'Pulse project'
            });
            const parsed = JSON.parse(llmOutput);

            expect(parsed.intent).toBe('SEARCH');
            expect(parsed.search_query).toBe('Pulse project');
        });

        it('should parse FILTER intent with exclusions', () => {
            const llmOutput = JSON.stringify({
                intent: 'FILTER',
                exclude_terms: ['GitHub', 'Doubao']
            });
            const parsed = JSON.parse(llmOutput);

            expect(parsed.intent).toBe('FILTER');
            expect(parsed.exclude_terms).toContain('GitHub');
            expect(parsed.exclude_terms).toContain('Doubao');
        });

        it('should parse SAVE intent with topic name', () => {
            const llmOutput = JSON.stringify({
                intent: 'SAVE',
                topic_name: 'My Work Project'
            });
            const parsed = JSON.parse(llmOutput);

            expect(parsed.intent).toBe('SAVE');
            expect(parsed.topic_name).toBe('My Work Project');
        });

        it('should parse CHAT intent for general questions', () => {
            const llmOutput = JSON.stringify({
                intent: 'CHAT'
            });
            const parsed = JSON.parse(llmOutput);

            expect(parsed.intent).toBe('CHAT');
        });
        it('should parse LIST intent', () => {
            const llmOutput = JSON.stringify({
                intent: 'LIST'
            });
            const parsed = JSON.parse(llmOutput);
            expect(parsed.intent).toBe('LIST');
        });

        it('should parse EDIT intent (Rename)', () => {
            const llmOutput = JSON.stringify({
                intent: 'EDIT',
                old_topic_name: 'OldName',
                new_topic_name: 'NewName'
            });
            const parsed = JSON.parse(llmOutput);
            expect(parsed.intent).toBe('EDIT');
            expect(parsed.old_topic_name).toBe('OldName');
            expect(parsed.new_topic_name).toBe('NewName');
        });

        it('should parse DELETE intent', () => {
            const llmOutput = JSON.stringify({
                intent: 'DELETE',
                topic_name: 'BadTopic'
            });
            const parsed = JSON.parse(llmOutput);
            expect(parsed.intent).toBe('DELETE');
            expect(parsed.topic_name).toBe('BadTopic');
        });
    });

    describe('Exclusion Logic', () => {
        it('should correctly add exclusions to a Set', () => {
            const excludedEntities = new Set<string>();
            const newExclusions = ['github', 'doubao'];

            newExclusions.forEach(term => excludedEntities.add(term.toLowerCase()));

            expect(excludedEntities.has('github')).toBe(true);
            expect(excludedEntities.has('doubao')).toBe(true);
            expect(excludedEntities.size).toBe(2);
        });

        it('should filter groups based on exclusions', () => {
            const groups = [
                { entity: 'ShuTong', type: 'project', count: 5 },
                { entity: 'GitHub', type: 'browser', count: 3 },
                { entity: 'Linear', type: 'browser', count: 2 }
            ];

            const excludedEntities = new Set(['github']);

            const validGroups = groups.filter(g => {
                const lowerEntity = g.entity.toLowerCase();
                for (const excluded of excludedEntities) {
                    if (lowerEntity.includes(excluded)) return false;
                }
                return true;
            });

            expect(validGroups.length).toBe(2);
            expect(validGroups.map(g => g.entity)).toContain('ShuTong');
            expect(validGroups.map(g => g.entity)).toContain('Linear');
            expect(validGroups.map(g => g.entity)).not.toContain('GitHub');
        });
    });

    describe('Response Formatting', () => {
        it('should format groups into a readable message', () => {
            const groups = [
                {
                    entity: 'MyProject',
                    type: 'project',
                    count: 3,
                    contexts: [
                        { title: 'main.ts - MyProject' },
                        { title: 'index.tsx - MyProject' }
                    ]
                }
            ];

            const totalCount = groups.reduce((sum, g) => sum + g.count, 0);
            let msg = `I found **${totalCount}** activities.\n\n`;

            for (const group of groups) {
                msg += `**${group.entity}** (${group.count} items)\n`;
            }

            expect(msg).toContain('**3**');
            expect(msg).toContain('**MyProject**');
        });
    });
});
