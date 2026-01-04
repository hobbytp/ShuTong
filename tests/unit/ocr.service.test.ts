
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OCRService } from '../../electron/features/timeline/ocr.service';
import { metrics } from '../../electron/infrastructure/monitoring/metrics.service';
import * as storage from '../../electron/storage';

// Mock dependencies
vi.mock('../../electron/infrastructure/monitoring/metrics.service', () => ({
    metrics: {
        getRecent: vi.fn(() => []),
        recordDuration: vi.fn(),
        gauge: vi.fn(),
        incrementCounter: vi.fn(),
    },
    measure: vi.fn((name, fn) => fn())
}));

vi.mock('../../electron/config_manager', () => ({
    getMergedLLMConfig: vi.fn()
}));

vi.mock('../../electron/storage', () => ({
    getSetting: vi.fn(),
    setSetting: vi.fn()
}));

vi.mock('../../electron/features/timeline/paddle-window/window', () => ({
    PaddleOCRWindow: {
        getInstance: vi.fn(() => ({
            extract: vi.fn(),
            terminate: vi.fn(),
            isReady: false,
            initPromise: null
        }))
    }
}));

describe('OCRService', () => {
    let ocrService: OCRService;

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset singleton if needed or create new instance logic
        // Since OCRService exports a singleton `ocrService`, we might need to access the class if possible
        // or just test the exported instance. The actual file exports the class too.
        ocrService = new OCRService();
    });

    it('should initialize with default settings', () => {
        // Mock getSetting to return defaults
        (storage.getSetting as any).mockReturnValue(null);
        // Re-check settings manually since constructor ran before mock
        (ocrService as any).checkSettings();

        expect(ocrService.isEnabled()).toBe(true);
        const status = ocrService.getStatus();
        expect(status.engine).toBe('cloud');
    });

    it('getStatus should return correct structure', () => {
        (metrics.getRecent as any).mockReturnValue([
            { value: 100, tags: { success: true } },
            { value: 200, tags: { success: true } }
        ]);

        const status = ocrService.getStatus();

        expect(status).toHaveProperty('engine');
        expect(status).toHaveProperty('isEnabled');
        expect(status).toHaveProperty('isReady');
        expect(status.avgInferenceMs).toBe(150);
        expect(status.recentSuccessRate).toBe(1);
    });

    it('should correctly calculate failure rate and open circuit breaker', async () => {
        // Force local engine
        (ocrService as any).currentEngine = 'tesseract';

        // Mock provider failure 3 times
        const mockProvider = {
            name: 'Tesseract',
            extract: vi.fn().mockRejectedValue(new Error('Fail')),
            terminate: vi.fn().mockResolvedValue(undefined)
        };
        (ocrService as any).providers.set('tesseract', mockProvider);

        // Fail 1
        await ocrService.extractText('test.png');
        expect((ocrService as any).consecutiveFailures).toBe(1);
        expect((ocrService as any).isCircuitOpen()).toBe(false);

        // Fail 2
        await ocrService.extractText('test.png');
        expect((ocrService as any).consecutiveFailures).toBe(2);

        // Fail 3 -> Circuit Open
        await ocrService.extractText('test.png');

        const status = ocrService.getStatus();
        expect(status.isCircuitOpen).toBe(true);

        // Verify fallback to cloud
        // (Accessing private method or inferring from behavior if we tried to extract again)
        const activeProvider = (ocrService as any).getActiveProvider();
        expect(activeProvider.name).toBe('CloudLLM');
    });
});
