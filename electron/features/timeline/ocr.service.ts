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
import { getMergedLLMConfig } from '../../config_manager';
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

// --- Tesseract.js Provider (Placeholder for future implementation) ---

class TesseractOCRProvider implements IOCRProvider {
    name = 'Tesseract';

    async extract(_imagePath: string, _options?: OCROptions): Promise<OCRResult> {
        // TODO: Implement tesseract.js integration
        // const Tesseract = require('tesseract.js');
        // const result = await Tesseract.recognize(imagePath, 'chi_sim+eng');
        throw new Error('Tesseract OCR not yet implemented. Please use Cloud LLM provider.');
    }
}

// --- PaddleOCR Provider (Placeholder for future implementation) ---

class PaddleOCRProvider implements IOCRProvider {
    name = 'PaddleOCR';

    async extract(_imagePath: string, _options?: OCROptions): Promise<OCRResult> {
        // TODO: Implement PaddleOCR via ONNX Runtime
        // Requires: onnxruntime-node, paddle-ocr models
        throw new Error('PaddleOCR not yet implemented. Please use Cloud LLM provider.');
    }
}

// --- OCR Service (Facade) ---

class OCRService {
    private providers: Map<string, IOCRProvider> = new Map();
    private enabled: boolean = true;

    constructor() {
        // Register providers
        this.providers.set('cloud', new CloudLLMOCRProvider());
        this.providers.set('tesseract', new TesseractOCRProvider());
        this.providers.set('paddle', new PaddleOCRProvider());

        // Load enabled state from settings
        this.loadSettings();
    }

    private loadSettings() {
        const enabledSetting = getSetting('ocr_enabled');
        // Default to true if not set
        this.enabled = enabledSetting === null || enabledSetting === 'true';
    }

    /**
     * Check if OCR is enabled (checks latest setting from storage)
     */
    isEnabled(): boolean {
        const val = getSetting('ocr_enabled');
        // Update local cache while we're at it
        this.enabled = val === null || val === 'true';
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
     * Get the currently active provider based on OCR_SCANNER role configuration
     */
    private getActiveProvider(): IOCRProvider {
        const config = getMergedLLMConfig();
        const roleConfig = config.roleConfigs?.['OCR_SCANNER'];

        if (!roleConfig) {
            console.warn('[OCRService] OCR_SCANNER role not configured, using CloudLLM');
            return this.providers.get('cloud')!;
        }

        const model = roleConfig.model?.toLowerCase() || '';

        // Check if model indicates local OCR
        if (model.includes('paddle') || model.includes('local-paddle')) {
            const paddleProvider = this.providers.get('paddle');
            if (paddleProvider) return paddleProvider;
        }

        if (model.includes('tesseract') || model.includes('local-tesseract')) {
            const tesseractProvider = this.providers.get('tesseract');
            if (tesseractProvider) return tesseractProvider;
        }

        // Default to cloud LLM
        return this.providers.get('cloud')!;
    }

    /**
     * Extract text from a screenshot image
     * @param imagePath Absolute path to the image file
     * @param options OCR options
     * @returns Extracted text and metadata
     */
    async extractText(imagePath: string, options?: OCROptions): Promise<OCRResult | null> {
        if (!this.enabled) {
            console.log('[OCRService] OCR is disabled, skipping extraction');
            return null;
        }

        // Get provider (forced or auto-selected)
        let provider: IOCRProvider;
        if (options?.forceProvider) {
            provider = this.providers.get(options.forceProvider) || this.getActiveProvider();
        } else {
            provider = this.getActiveProvider();
        }

        console.log(`[OCRService] Extracting text using ${provider.name} from: ${imagePath}`);

        try {
            const result = await provider.extract(imagePath, options);
            console.log(`[OCRService] Extracted ${result.text.length} chars in ${result.processingTimeMs}ms`);
            return result;
        } catch (err) {
            console.error('[OCRService] Extraction failed:', err);
            return null;
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
}

// Singleton instance
export const ocrService = new OCRService();
