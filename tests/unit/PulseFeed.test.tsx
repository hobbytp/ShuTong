
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PulseFeed } from '../../src/pages/PulseFeed';

// Mock ipcRenderer
const mockInvoke = vi.fn();
window.ipcRenderer = {
    invoke: mockInvoke
};

describe('PulseFeed Chat Markdown Rendering', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default mock for get-pulse-cards to avoid errors on mount
        mockInvoke.mockImplementation((channel) => {
            if (channel === 'get-pulse-cards') return Promise.resolve({ success: true, cards: [] });
            return Promise.resolve({ success: true });
        });
    });

    it('renders markdown in chat messages', async () => {
        render(<PulseFeed />);

        // Open chat
        const chatButton = screen.getByText('Ask Pulse');
        fireEvent.click(chatButton);

        // Find input and send message
        const input = screen.getByPlaceholderText('Type a message...');
        fireEvent.change(input, { target: { value: 'Hello' } });

        const sendButton = screen.getByText('Send');

        // Mock the response with markdown
        mockInvoke.mockImplementation(async (channel, ...args) => {
            if (channel === 'get-pulse-cards') return { success: true, cards: [] };
            if (channel === 'ask-pulse') {
                return {
                    success: true,
                    response: '**Bold Text** and *Italic Text* and [Link](https://example.com)'
                };
            }
            return { success: true };
        });

        fireEvent.click(sendButton);

        // Wait for response using simple text match first to be sure it arrived
        await waitFor(() => {
            expect(screen.getByText(/Bold Text/)).toBeDefined();
        });

        // Check if markdown is actually rendered
        // "**Bold Text**" should become a strong element with text "Bold Text"
        const boldElement = screen.getByText('Bold Text');
        expect(boldElement.tagName).toBe('STRONG');

        // "*Italic Text*" should become an em element with text "Italic Text"
        const italicElement = screen.getByText('Italic Text');
        expect(italicElement.tagName).toBe('EM');

        // "[Link](...)" should become an anchor
        const linkElement = screen.getByRole('link', { name: 'Link' });
        expect(linkElement).toHaveAttribute('href', 'https://example.com');
    });
});
