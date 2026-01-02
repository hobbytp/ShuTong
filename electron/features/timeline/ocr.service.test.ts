import { existsSync } from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OCRService } from './ocr.service';

// Mock dependencies
vi.mock('fs', () => {
    return {
        default: {
            existsSync: vi.fn().mockReturnValue(true),
            promises: {
                unlink: vi.fn()
            }
        },
        existsSync: vi.fn().mockReturnValue(true),
        promises: {
            unlink: vi.fn()
        }
    };
});

vi.mock('../../storage', () => ({
    getSetting: vi.fn(),
    setSetting: vi.fn()
}));

vi.mock('tesseract.js', () => ({
    createWorker: vi.fn()
}));

vi.mock('../../llm/providers', () => ({
    getLLMProvider: vi.fn(),
    consumeStreamWithIdleTimeout: vi.fn()
}));

vi.mock('../../config_manager', () => ({
    getMergedLLMConfig: vi.fn()
}));

// Mock Paddle Window
const mockPaddleExtract = vi.fn();
const mockPaddleTerminate = vi.fn();

vi.mock('./paddle-window/window', () => ({
    PaddleOCRWindow: {
        getInstance: () => ({
            extract: mockPaddleExtract,
            terminate: mockPaddleTerminate
        })
    }
}));

import { createWorker } from 'tesseract.js';
import { getSetting } from '../../storage';

describe('OCRService', () => {
    let ocrService: OCRService;
    let mockWorker: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockPaddleExtract.mockReset();
        mockPaddleTerminate.mockReset();

        // Mock Tesseract worker
        mockWorker = {
            recognize: vi.fn(),
            terminate: vi.fn()
        };
        (createWorker as any).mockResolvedValue(mockWorker);

        // Mock Settings default
        (getSetting as any).mockReturnValue('true');
        (existsSync as any).mockReturnValue(true);

        ocrService = new OCRService();
    });
    // ... (existing tests) ...

    it('should initialize with default settings', () => {
        expect(ocrService.isEnabled()).toBe(true);
    });

    it('should use Tesseract when configured', async () => {
        // Setup
        (getSetting as any).mockImplementation((key: string) => {
            if (key === 'ocr_enabled') return 'true';
            if (key === 'ocr_engine') return 'tesseract';
            return null;
        });

        // Re-init to load settings
        ocrService = new OCRService();

        mockWorker.recognize.mockResolvedValue({
            data: { text: 'Hello World', confidence: 95 }
        });

        const result = await ocrService.extractText('/path/to/image.png');

        expect(createWorker).toHaveBeenCalledWith(['chi_sim', 'eng']);
        expect(mockWorker.recognize).toHaveBeenCalledWith('/path/to/image.png');
        expect(result?.text).toBe('Hello World');
        expect(result?.provider).toBe('Tesseract');
    });

    it('should handle file not found', async () => {
        (existsSync as any).mockReturnValue(false);
        const result = await ocrService.extractText('/fake/path.png');
        expect(result).toBeNull();
    });

    it('should handle Tesseract timeout', async () => {
        // Use fake timers to simulate timeout
        vi.useFakeTimers();

        (getSetting as any).mockImplementation((key: string) => key === 'ocr_engine' ? 'tesseract' : 'true');
        ocrService = new OCRService(); // Reload settings

        // Mock recognize to never resolve immediately (simulate hang)
        mockWorker.recognize.mockImplementation(() => new Promise(() => { }));

        // Start extraction
        const promise = ocrService.extractText('/path/to/image.png');

        // Fast forward time past 15s to trigger timeout in Promise.race
        await vi.advanceTimersByTimeAsync(16000);

        // Wait for the main promise to settle (which catches the timeout error)
        const result = await promise;

        expect(result).toBeNull();
        expect(mockWorker.terminate).toHaveBeenCalled(); // Should kill stuck worker

        vi.useRealTimers();
    });

    it('should trigger circuit breaker after max failures', async () => {
        // Setup Tesseract
        (getSetting as any).mockImplementation((key: string) => key === 'ocr_engine' ? 'tesseract' : 'true');
        ocrService = new OCRService();

        // Fail 3 times
        mockWorker.recognize.mockRejectedValue(new Error('Crash'));

        for (let i = 0; i < 3; i++) {
            await ocrService.extractText('test.png');
        }

        // Let's spy on console.warn to verify circuit breaker Log
        const consolespy = vi.spyOn(console, 'warn');

        await ocrService.extractText('test.png');

        expect(consolespy).toHaveBeenCalledWith(expect.stringContaining('Circuit open'));
    });

    describe('PaddleOCR Integration', () => {
        beforeEach(() => {
            (getSetting as any).mockImplementation((key: string) => {
                if (key === 'ocr_enabled') return 'true';
                if (key === 'ocr_engine') return 'paddle';
                return null;
            });
            ocrService = new OCRService(); // Reload with paddle
        });

        it('should use PaddleOCR when configured', async () => {
            mockPaddleExtract.mockResolvedValue({
                text: ['Line 1', 'Line 2'],
                confidence: 0.95
            });

            const result = await ocrService.extractText('test.png');

            expect(mockPaddleExtract).toHaveBeenCalledWith('test.png');
            expect(result?.text).toBe('Line 1\nLine 2');
            expect(result?.provider).toBe('PaddleOCR');
        });

        it('should handle PaddleOCR timeout', async () => {
            vi.useFakeTimers();

            // hung promise
            mockPaddleExtract.mockImplementation(() => new Promise(() => { }));

            const promise = ocrService.extractText('test.png');

            // Advance past 20s
            await vi.advanceTimersByTimeAsync(21000);

            const result = await promise;

            expect(result).toBeNull();
            expect(mockPaddleTerminate).toHaveBeenCalled();

            vi.useRealTimers();
        });
    });
});
