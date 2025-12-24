import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TimelineSidebar } from '../../src/components/Timeline/TimelineSidebar';
import { ActivityCard } from '../../src/types';

describe('TimelineSidebar', () => {
    const mockCards: ActivityCard[] = [
        {
            id: 1,
            batch_id: 101,
            title: 'Coding Task',
            summary: 'Working on feature A',
            category: 'Work',
            start_ts: 1600000000,
            end_ts: 1600003600,
            created_at: '2020-09-13T12:00:00Z'
        },
        {
            id: 2,
            batch_id: 102,
            title: 'Break',
            summary: 'Coffee break',
            category: 'Personal',
            start_ts: 1600004000,
            end_ts: 1600004600,
            created_at: '2020-09-13T13:00:00Z'
        }
    ];

    it('renders empty state when no cards provided', () => {
        render(
            <TimelineSidebar
                cards={[]}
                selectedCardId={null}
                onSelectCard={() => { }}
                searchQuery=""
                onSearchChange={() => { }}
                onCategorySelect={() => { }}
            />
        );
        expect(screen.getByText('No activities yet.')).toBeDefined();
    });

    it('renders list of cards', () => {
        render(
            <TimelineSidebar
                cards={mockCards}
                selectedCardId={null}
                onSelectCard={() => { }}
                searchQuery=""
                onSearchChange={() => { }}
                onCategorySelect={() => { }}
            />
        );
        expect(screen.getByText('Coding Task')).toBeDefined();
        expect(screen.getByText('Break')).toBeDefined();
        // 'Work' appears in filter chip AND card badge, so getAllByText
        expect(screen.getAllByText('Work').length).toBeGreaterThan(0);
    });

    it('highlights selected card', () => {
        const { container } = render(
            <TimelineSidebar
                cards={mockCards}
                selectedCardId={1}
                onSelectCard={() => { }}
                searchQuery=""
                onSearchChange={() => { }}
                onCategorySelect={() => { }}
            />
        );
        // We look for the selected style
        const selectedItem = screen.getByText('Coding Task').closest('div')?.parentElement;
        expect(selectedItem?.className).toContain('bg-zinc-900/80');
    });

    it('calls onSelectCard when clicked', () => {
        const handleSelect = vi.fn();
        render(
            <TimelineSidebar
                cards={mockCards}
                selectedCardId={null}
                onSelectCard={handleSelect}
                searchQuery=""
                onSearchChange={() => { }}
                onCategorySelect={() => { }}
            />
        );

        fireEvent.click(screen.getByText('Coding Task'));
        expect(handleSelect).toHaveBeenCalledWith(1);
    });
});
