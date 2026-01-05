
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TopicDiscoveryService } from '../topic-discovery.service';

// Mock dependencies
vi.mock('../../storage', () => ({
    getRepositories: vi.fn(() => ({
        windowSwitches: {
            searchByTitle: vi.fn(() => []),
        }
    }))
}));

vi.mock('../../storage/vector-storage', () => ({
    vectorStorage: {
        search: vi.fn(() => Promise.resolve([])),
    }
}));

describe('TopicDiscoveryService', () => {
    let service: TopicDiscoveryService;

    beforeEach(() => {
        service = new TopicDiscoveryService();
    });

    describe('extractProjectName', () => {
        it('should extract simple project name from VS Code title', () => {
            // "project-name - VS Code" or "file.ts - project-name - Visual Studio Code"
            expect(service.extractProjectName('Code', 'my-project - Visual Studio Code')).toBe('my-project');
            expect(service.extractProjectName('Code', 'server.ts - backend-api - Visual Studio Code')).toBe('backend-api');
        });

        it('should extract from Cursor', () => {
            expect(service.extractProjectName('Cursor', 'utils.py - ai-engine - Cursor')).toBe('ai-engine');
        });

        it('should return null if not an IDE or format not matched', () => {
            expect(service.extractProjectName('Chrome', 'GitHub - my-project')).toBe(null);
            expect(service.extractProjectName('Code', 'Welcome - Visual Studio Code')).toBe('Welcome'); // or null?
        });
    });

    describe('groupContexts', () => {
        it('should group IDE windows by project', () => {
            const contexts = [
                { app: 'Code', title: 'a.ts - ProjectA - Visual Studio Code' },
                { app: 'Code', title: 'b.ts - ProjectA - Visual Studio Code' },
                { app: 'Code', title: 'main.py - ProjectB - Visual Studio Code' },
            ];

            const groups = service.groupContexts(contexts);
            expect(groups.length).toBe(2);

            const groupA = groups.find(g => g.entity.includes('ProjectA'));
            expect(groupA).toBeDefined();
            expect(groupA?.contexts.length).toBe(2);
            expect(groupA?.type).toBe('project');

            const groupB = groups.find(g => g.entity.includes('ProjectB'));
            expect(groupB).toBeDefined();
            expect(groupB?.contexts.length).toBe(1);
        });

        it('should group browser tabs by domain/smart name', () => {
            const contexts = [
                { app: 'Chrome', title: 'Issue #1 - GitHub' },
                { app: 'Chrome', title: 'PR #2 - GitHub' },
                { app: 'Chrome', title: 'Dashboard - Linear' },
            ];

            const groups = service.groupContexts(contexts);
            // GitHub (2), Linear (1)

            // Note: The specific output depends on extractDomainOrTopic logic which we test indirectly here
            const githubGroup = groups.find(g => g.entity.includes('GitHub'));
            expect(githubGroup).toBeDefined();
            expect(githubGroup?.contexts.length).toBe(2);
            expect(githubGroup?.type).toBe('app_group');
        });
    });
});
