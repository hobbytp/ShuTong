import { app } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock electron app
vi.mock('electron', () => ({
    app: {
        setAsDefaultProtocolClient: vi.fn(),
        on: vi.fn(),
        isReady: vi.fn().mockReturnValue(true),
    }
}));

// Import the module to test (lazy import to allow mocking)
import { setupDeepLinks } from './deeplink';

describe('Deep Link Handler', () => {
    let actions: any;

    beforeEach(() => {
        vi.clearAllMocks();
        actions = {
            onStartRecording: vi.fn(),
            onStopRecording: vi.fn()
        };
    });

    it('registers the shutong protocol client on startup', () => {
        setupDeepLinks(actions);
        expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith('shutong');
    });

    it('handles macOS open-url event for start-recording', () => {
        setupDeepLinks(actions);

        // Find the 'open-url' handler
        const calls = (app.on as any).mock.calls;
        const handler = calls.find((c: any) => c[0] === 'open-url')?.[1];
        expect(handler).toBeDefined();

        // Simulate event
        const mockEvent = { preventDefault: vi.fn() };
        handler(mockEvent, 'shutong://start-recording');

        expect(mockEvent.preventDefault).toHaveBeenCalled();
        expect(actions.onStartRecording).toHaveBeenCalled();
        expect(actions.onStopRecording).not.toHaveBeenCalled();
    });

    it('handles macOS open-url event for stop-recording', () => {
        setupDeepLinks(actions);
        const handler = (app.on as any).mock.calls.find((c: any) => c[0] === 'open-url')[1];

        const mockEvent = { preventDefault: vi.fn() };
        handler(mockEvent, 'shutong://stop-recording');

        expect(actions.onStopRecording).toHaveBeenCalled();
    });

    it('handles Windows second-instance event for start-recording', () => {
        setupDeepLinks(actions);

        // Find 'second-instance' handler
        const handler = (app.on as any).mock.calls.find((c: any) => c[0] === 'second-instance')?.[1];
        expect(handler).toBeDefined();

        // Simulate argv from Windows (exec path, args..., url)
        // Usually deep link is the last argument or passed specifically
        const mockArgv = ['exe', 'shutong://start-recording'];
        handler({}, mockArgv);

        expect(actions.onStartRecording).toHaveBeenCalled();
    });

    it('handles Windows second-instance event with extra arguments', () => {
        setupDeepLinks(actions);
        const handler = (app.on as any).mock.calls.find((c: any) => c[0] === 'second-instance')[1];

        // Sometimes electron adds flags
        const mockArgv = ['exe', '--hidden', 'shutong://stop-recording'];
        handler({}, mockArgv);

        expect(actions.onStopRecording).toHaveBeenCalled();
    });

    it('ignores invalid urls', () => {
        setupDeepLinks(actions);
        const handler = (app.on as any).mock.calls.find((c: any) => c[0] === 'open-url')[1];
        const mockEvent = { preventDefault: vi.fn() };

        handler(mockEvent, 'shutong://unknown-action');

        expect(actions.onStartRecording).not.toHaveBeenCalled();
        expect(actions.onStopRecording).not.toHaveBeenCalled();
    });
});
