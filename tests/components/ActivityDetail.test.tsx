import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityDetail } from '../../src/components/Timeline/ActivityDetail';

// Mock ipcRenderer
declare global {
    interface Window {
        ipcRenderer: any;
    }
}

const mockInvoke = vi.fn();
window.ipcRenderer = {
    invoke: mockInvoke
};

describe('ActivityDetail', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders placeholder when no card selected', () => {
        render(<ActivityDetail cardId={null} />);
        expect(screen.getByText('Select an activity to view details')).toBeDefined();
    });

    it('fetches and renders card details', async () => {
        const mockCard = {
            id: 1,
            title: 'Refactoring',
            summary: 'Cleaning up code',
            category: 'Work',
            start_ts: 1600000000,
            end_ts: 1600003600,
            observations: [
                { id: 1, observation: 'User typed in editor', start_ts: 1600000000 }
            ]
        };

        const mockScreenshots = [
            { id: 1, file_path: '/tmp/1.jpg' }
        ];

        mockInvoke.mockImplementation((channel) => {
            if (channel === 'get-card-details') return Promise.resolve(mockCard);
            if (channel === 'get-screenshots-for-card') return Promise.resolve(mockScreenshots);
            return Promise.resolve(null);
        });

        render(<ActivityDetail cardId={1} />);

        await waitFor(() => {
            expect(screen.getByText('Refactoring')).toBeDefined();
        });

        expect(screen.getByText('Cleaning up code')).toBeDefined();
        expect(screen.getByText('User typed in editor')).toBeDefined();
        expect(mockInvoke).toHaveBeenCalledWith('get-card-details', 1);
    });

    it('renders video player when video_url is present', async () => {
        const mockCardWithVideo = {
            id: 2,
            title: 'Gaming',
            summary: 'Playing games',
            category: 'Personal',
            start_ts: 1600000000,
            end_ts: 1600003600,
            video_url: 'media:///path/to/video.mp4'
        };

        mockInvoke.mockImplementation((channel) => {
            if (channel === 'get-card-details') return Promise.resolve(mockCardWithVideo);
            if (channel === 'get-screenshots-for-card') return Promise.resolve([]);
            return Promise.resolve(null);
        });

        render(<ActivityDetail cardId={2} />);

        await waitFor(() => {
            const video = screen.getByTestId('activity-video');
            expect(video).toBeDefined();
            expect(video.getAttribute('src')).toBe('media:///path/to/video.mp4');
        });
    });
});
