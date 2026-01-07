/**
 * OCR Service - Extracts text from screenshots
 * 
 * Supports multiple OCR providers:
 * - Cloud LLM (via OCR_SCANNER role): Uses configured LLM for text extraction
 * - Local Tesseract (future): tesseract.js for offline processing
 * - Local PaddleOCR (future): ONNX-based high accuracy Chinese OCR
 * 
 * The provider is configured via Settings > AI Model > Role Assignment > OCR_SCANNER
 */

import { existsSync } from 'fs';
import { createWorker, Worker } from 'tesseract.js';
import { getMergedLLMConfig } from '../../config_manager';
import { metrics } from '../../infrastructure/monitoring/metrics-collector';
import { consumeStreamWithIdleTimeout, getLLMProvider } from '../../llm/providers';
import { getSetting, setSetting } from '../../storage';

// --- Interfaces ---

export interface OCRResult {
    /** Extracted text from the image */
    text: string;
    /** Confidence score (0-1) if available */
    confidence?: number;
    /** Processing time in ms */
    processingTimeMs: number;
    /** Provider used for extraction */
    provider: string;
}

export interface OCROptions {
    /** Language hint for OCR (e.g., 'chi_sim+eng' for Tesseract) */
    language?: string;
    /** Force a specific provider instead of using configured one */
    forceProvider?: 'cloud' | 'tesseract' | 'paddle';
}

export type OCREngine = 'cloud' | 'tesseract' | 'paddle';

// --- OCR Provider Interface (Strategy Pattern) ---

interface IOCRProvider {
    name: string;
    extract(imagePath: string, options?: OCROptions): Promise<OCRResult>;
}

// Bilingual OCR prompt
const OCR_PROMPT = `
请仔细阅读这张截图中的所有可见文本内容。
提取并返回所有文字，保持原始布局和格式。
如果有代码，保留代码格式。
如果有表格，尝试保持表格结构。
只返回文本内容，不需要任何解释或描述。

[English: Extract ALL visible text from this screenshot. Preserve layout and formatting. For code, keep the code format. For tables, try to maintain table structure. Return only the text content, no explanations.]
`.trim();

// --- Cloud LLM Provider (uses OCR_SCANNER role) ---

class CloudLLMOCRProvider implements IOCRProvider {
    name = 'CloudLLM';

    async extract(imagePath: string, _options?: OCROptions): Promise<OCRResult> {
        const startTime = Date.now();

        // P1 Fix: Validate file exists
        if (!existsSync(imagePath)) {
            throw new Error(`[OCRService] Image file not found: ${imagePath}`);
        }

        // P2 Fix: Detect MIME type from extension
        const mimeType = imagePath.toLowerCase().endsWith('.png')
            ? 'image/png'
            : 'image/jpeg';

        const images = [{
            path: imagePath,
            mimeType
        }];

        try {
            const provider = getLLMProvider('OCR_SCANNER');
            let responseStr: string;

            // Prefer streaming if available
            if (provider.generateContentStream) {
                const config = getMergedLLMConfig();
                const roleConfig = config.roleConfigs['OCR_SCANNER'];
                const providerKey = roleConfig?.provider;
                const providerCfg = providerKey ? config.providers[providerKey] : undefined;
                const idleTimeout = providerCfg?.streamIdleTimeout || 30000;

                try {
                    responseStr = await consumeStreamWithIdleTimeout(
                        provider.generateContentStream({ prompt: OCR_PROMPT, images }),
                        idleTimeout
                    );
                } catch (streamError) {
                    // Fallback to non-streaming
                    console.warn('[OCRService] Streaming failed, falling back:', streamError);
                    responseStr = await provider.generateContent({ prompt: OCR_PROMPT, images });
                }
            } else {
                responseStr = await provider.generateContent({ prompt: OCR_PROMPT, images });
            }

            return {
                text: responseStr.trim(),
                processingTimeMs: Date.now() - startTime,
                provider: this.name
            };

        } catch (err) {
            console.error('[OCRService] Cloud LLM extraction failed:', err);
            throw err;
        }
    }
}

// --- Tesseract.js Provider ---


class TesseractOCRProvider implements IOCRProvider {
    name = 'Tesseract';
    private worker: Worker | null = null;
    private isInitializing = false;

    private async getWorker(): Promise<Worker> {
        // Reuse existing worker
        if (this.worker) return this.worker;

        // Prevent race conditions during async initialization
        if (this.isInitializing) {
            while (this.isInitializing) {
                await new Promise(r => setTimeout(r, 100));
            }
            if (this.worker) return this.worker;
        }

        this.isInitializing = true;
        try {
            console.log('[OCRService] Initializing Tesseract worker...');
            // Initialize with Chinese (Simplified) and English
            // Note: This will download language data on first run (~30MB)
            // Data is cached in default cache folder
            const worker = await createWorker(['chi_sim', 'eng']);
            this.worker = worker;
            console.log('[OCRService] Tesseract worker ready');
            return worker;
        } catch (err) {
            console.error('[OCRService] Failed to initialize Tesseract:', err);
            // If initialization fails, ensure clean state
            this.worker = null;
            throw err;
        } finally {
            this.isInitializing = false;
        }
    }

    async extract(imagePath: string, _options?: OCROptions): Promise<OCRResult> {
        const startTime = Date.now();
        const TIMEOUT_MS = 15000; // 15s hard timeout for local OCR

        try {
            if (!existsSync(imagePath)) {
                throw new Error(`[OCRService] Image file not found: ${imagePath}`);
            }

            // Wrap worker task in a promise for racing
            const workerTask = async () => {
                const worker = await this.getWorker();
                return worker.recognize(imagePath);
            };

            // Race against timeout
            const ret = await Promise.race([
                workerTask(),
                new Promise<any>((_, reject) =>
                    setTimeout(() => reject(new Error('OCR Timeout')), TIMEOUT_MS)
                )
            ]);

            const text = ret.data.text.trim();
            const confidence = ret.data.confidence / 100; // Tesseract returns 0-100

            return {
                text,
                confidence,
                processingTimeMs: Date.now() - startTime,
                provider: this.name
            };
        } catch (err) {
            // Check for timeout to kill stuck worker
            if (err instanceof Error && err.message === 'OCR Timeout') {
                console.warn('[OCRService] Tesseract timed out, terminating worker...');
                await this.terminate().catch(e => console.error('Failed to terminate worker:', e));
            }
            console.error('[OCRService] Tesseract extraction failed:', err);
            throw err;
        }
    }

    async terminate() {
        if (this.worker) {
            await this.worker.terminate();
            this.worker = null;
        }
    }
}

// --- PaddleOCR Local Provider ---
import { PaddleOCRWindow } from './paddle-window/window';

class PaddleOCRProvider implements IOCRProvider {
    name = 'PaddleOCR';

    async extract(imagePath: string, _options?: OCROptions): Promise<OCRResult> {
        const startTime = Date.now();
        // P1 Fix: Increase timeout for initial model download (was 20s)
        const TIMEOUT_MS = 60000;

        if (!existsSync(imagePath)) {
            throw new Error(`[OCRService] Image file not found: ${imagePath}`);
        }

        // Create timeout with proper cleanup
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const timeoutTask = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('OCR Timeout')), TIMEOUT_MS);
        });

        try {
            const paddleWindow = PaddleOCRWindow.getInstance();
            const extractTask = paddleWindow.extract(imagePath);

            const result = await Promise.race([extractTask, timeoutTask]);

            // Clean up timer on success
            if (timeoutId) clearTimeout(timeoutId);

            const text = result.text.join('\n');
            const processingTimeMs = Date.now() - startTime;

            return {
                text,
                confidence: result.confidence || 0.9,
                processingTimeMs,
                provider: this.name
            };
        } catch (error: any) {
            // Clean up timer on failure
            if (timeoutId) clearTimeout(timeoutId);

            console.error('[PaddleOCRProvider] Extraction failed:', error);

            if (error.message === 'OCR Timeout') {
                console.warn('[PaddleOCRProvider] Timeout - Terminating window');
                await this.terminate().catch(e => console.error('Failed to terminate:', e));
            }

            throw error;
        }
    }

    async terminate() {
        await PaddleOCRWindow.getInstance().terminate();
    }
}

// --- OCR Service ---

export class OCRService {
    private providers: Map<OCREngine, IOCRProvider>;
    private enabled: boolean = true;
    private currentEngine: OCREngine = 'cloud';

    // Circuit breaker state
    private consecutiveFailures = 0;
    private readonly MAX_FAILURES = 3;
    private circuitOpenTs = 0;
    private readonly CIRCUIT_RESET_MS = 5 * 60 * 1000; // 5 min

    constructor() {
        this.providers = new Map();
        this.providers.set('cloud', new CloudLLMOCRProvider());
        this.providers.set('tesseract', new TesseractOCRProvider());
        this.providers.set('paddle', new PaddleOCRProvider());

        // Initial load of settings
        this.checkSettings();
    }

    private checkSettings() {
        const enabledSetting = getSetting('ocr_enabled');
        this.enabled = enabledSetting === null || enabledSetting === 'true';

        const engineSetting = getSetting('ocr_engine');
        if (engineSetting && ['cloud', 'tesseract', 'paddle'].includes(engineSetting)) {
            this.currentEngine = engineSetting as OCREngine;
        }
    }

    private isCircuitOpen(): boolean {
        return (Date.now() - this.circuitOpenTs) < this.CIRCUIT_RESET_MS;
    }

    private getActiveProvider(options?: OCROptions): IOCRProvider {
        // 1. Force override
        if (options?.forceProvider) {
            const provider = this.providers.get(options.forceProvider);
            if (provider) return provider;
        }

        // 2. Circuit Breaker for Local
        // If current engine is local AND circuit is open, force Cloud
        if (this.currentEngine !== 'cloud' && this.isCircuitOpen()) {
            console.warn('[OCRService] Circuit open, forcing Cloud fallback.');
            return this.providers.get('cloud')!;
        }

        // 3. Normal Selection
        return this.providers.get(this.currentEngine) || this.providers.get('cloud')!;
    }

    /**
     * Check if OCR is enabled (checks latest setting from storage)
     */
    isEnabled(): boolean {
        this.checkSettings();
        return this.enabled;
    }

    /**
     * Enable or disable OCR
     */
    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        setSetting('ocr_enabled', String(enabled));
    }

    /**
     * Extract text from a screenshot image
     * @param imagePath Absolute path to the image file
     * @param options OCR options
     * @returns Extracted text and metadata
     */
    /**
     * Extract text from a screenshot image
     * @param imagePath Absolute path to the image file
     * @param options OCR options
     * @returns Extracted text and metadata
     */
    async extractText(imagePath: string, options?: OCROptions): Promise<OCRResult | null> {
        if (!this.isEnabled()) {
            console.log('[OCRService] OCR is disabled, skipping extraction');
            return null;
        }

        // Get provider
        const provider = this.getActiveProvider(options);

        console.log(`[OCRService] Extracting text using ${provider.name} from: ${imagePath}`);

        // Start timer and count request
        const timer = metrics.startTimer('ocr.duration_seconds', { provider: provider.name });
        metrics.incCounter('ocr.requests_total', { provider: provider.name });

        try {
            const result = await provider.extract(imagePath, options);
            timer.end(); // Stop timer

            console.log(`[OCRService] Extracted ${result.text.length} chars in ${result.processingTimeMs}ms`);

            // Record detailed stats
            metrics.setGauge('ocr.text_length_chars', result.text.length, { provider: provider.name });

            // Success reset
            if (this.currentEngine !== 'cloud' && provider.name !== 'CloudLLM') {
                this.consecutiveFailures = 0;
                metrics.setGauge('ocr.consecutive_failures', 0, { provider: provider.name });
            }

            return result;
        } catch (err) {
            console.error('[OCRService] Extraction failed:', err);
            metrics.incCounter('ocr.errors_total', { provider: provider.name, error_category: 'extraction_failed' });

            // Handle Failure & Circuit Breaker
            if (this.currentEngine !== 'cloud' && provider.name !== 'CloudLLM') {
                this.consecutiveFailures++;
                metrics.setGauge('ocr.consecutive_failures', this.consecutiveFailures, { provider: provider.name });
                console.warn(`[OCRService] Local OCR failure ${this.consecutiveFailures}/${this.MAX_FAILURES}`);

                // Log memory usage on failure to detect OOM patterns
                const mem = process.memoryUsage();
                console.warn(`[OCRService] Memory at failure: Heap: ${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB, RSS: ${Math.round(mem.rss / 1024 / 1024)}MB`);

                if (this.consecutiveFailures >= this.MAX_FAILURES) {
                    console.error('[OCRService] Too many failures. Opening circuit breaker (fallback to Cloud).');
                    metrics.incCounter('ocr.circuit_breaker_opened_total', { engine: this.currentEngine });
                    metrics.setGauge('ocr.circuit_breaker_state', 1, { engine: this.currentEngine });

                    this.circuitOpenTs = Date.now();
                    this.consecutiveFailures = 0;

                    // Try to clean up local resources
                    if (provider.name === 'Tesseract') {
                        (provider as TesseractOCRProvider).terminate().catch(() => { });
                    }
                    if (provider.name === 'PaddleOCR') {
                        (provider as PaddleOCRProvider).terminate().catch(() => { });
                    }
                }
            }

            return null; // Swallow error for single image
        }
    }

    /**
     * Batch extract text from multiple images
     * @param imagePaths Array of image paths
     * @param options OCR options
     * @returns Map of image path to OCR result
     */
    async extractTextBatch(imagePaths: string[], options?: OCROptions): Promise<Map<string, OCRResult | null>> {
        const results = new Map<string, OCRResult | null>();
        const RATE_LIMIT_DELAY_MS = 500; // P1 Fix: Rate limiting to prevent API throttling

        // Process sequentially with rate limiting
        for (let i = 0; i < imagePaths.length; i++) {
            const path = imagePaths[i];
            const result = await this.extractText(path, options);
            results.set(path, result);

            // Add delay between calls (except after last one)
            if (i < imagePaths.length - 1) {
                await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
            }
        }

        return results;
    }

    /**
     * Warmup local OCR (preload model). Call at app startup.
     * Only warms up if local OCR is enabled.
     * This is a background operation - failures are non-fatal.
     */
    async warmup(): Promise<void> {
        this.checkSettings();
        if (!this.enabled) {
            console.log('[OCRService] OCR disabled, skipping warmup');
            return;
        }

        if (this.currentEngine === 'paddle') {
            console.log('[OCRService] Warming up PaddleOCR...');
            try {
                await PaddleOCRWindow.getInstance().init();
                console.log('[OCRService] PaddleOCR warmup complete');
            } catch (err) {
                console.warn('[OCRService] PaddleOCR warmup failed:', err);
                // Non-fatal: first request will retry
            }
        } else if (this.currentEngine === 'tesseract') {
            console.log('[OCRService] Warming up Tesseract...');
            try {
                const tesseract = this.providers.get('tesseract') as TesseractOCRProvider;
                // Trigger worker initialization by calling private method
                // @ts-ignore - accessing private for warmup
                if (tesseract['getWorker']) {
                    await tesseract['getWorker']();
                }
                console.log('[OCRService] Tesseract warmup complete');
            } catch (err) {
                console.warn('[OCRService] Tesseract warmup failed:', err);
            }
        } else {
            console.log('[OCRService] Cloud OCR selected, no warmup needed');
        }
    }

    /**
     * Gracefully shutdown services (terminate workers)
     */
    async shutdown() {
        console.log('[OCRService] Shutting down...');
        const tesseract = this.providers.get('tesseract') as TesseractOCRProvider;
        if (tesseract) {
            await tesseract.terminate();
        }
        const paddle = this.providers.get('paddle') as PaddleOCRProvider;
        if (paddle) {
            await paddle.terminate();
        }
    }

    /**
     * Get current OCR status for UI display
     */
    getStatus(): OCRStatusInfo {
        const snapshot = metrics.getSnapshot();
        const providerName = this.getActiveProvider().name;

        // Attempt to get average duration for current provider
        // Note: Key construction matches MetricsCollector logic (labels sorted alpha)
        const histKey = `ocr.duration_seconds{provider="${providerName}"}`;
        const avgDuration = snapshot.histograms[histKey]?.avgMs || 0;

        // Success rate can be derived from ocr.errors_total / ocr.requests_total if needed


        // Determine provider readiness
        let isReady = true;
        let isLoading = false;
        let initDurationMs = 0;

        if (this.currentEngine === 'paddle') {
            const paddleWindow = PaddleOCRWindow.getInstance();
            // @ts-ignore - accessing private for status
            isReady = paddleWindow['isReady'] || false;
            // @ts-ignore
            isLoading = !!paddleWindow['initPromise'] && !isReady;

            const startTs = paddleWindow.getInitStartTime();
            if (startTs) {
                initDurationMs = Date.now() - startTs;
            }
        }

        return {
            engine: this.currentEngine,
            isEnabled: this.enabled,
            isReady,
            isLoading,
            initDurationMs,
            isCircuitOpen: this.isCircuitOpen(),
            consecutiveFailures: this.consecutiveFailures,
            recentSuccessRate: 1, // Placeholder
            avgInferenceMs: Math.round(avgDuration)
        };
    }
}

// Status info for UI
export interface OCRStatusInfo {
    engine: OCREngine;
    isEnabled: boolean;
    isReady: boolean;
    isLoading: boolean;
    initDurationMs?: number;
    isCircuitOpen: boolean;
    consecutiveFailures: number;
    recentSuccessRate: number;
    avgInferenceMs: number;
}

// Singleton instance
export const ocrService = new OCRService();

