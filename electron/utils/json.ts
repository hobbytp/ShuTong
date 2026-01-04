import { jsonrepair } from 'jsonrepair';

/**
 * Safely parses a JSON string, handling common LLM output issues.
 * 
 * Features:
 * 1. Extracts JSON from Markdown code blocks.
 * 2. Extracts JSON hidden within text.
 * 3. Repairs common syntax errors (trailing commas, single quotes, comments, etc.) using `jsonrepair`.
 * 
 * @param input The string containing JSON
 * @returns The parsed object or null if parsing failed
 */
export function safeParseJSON<T = any>(input: string): T | null {
    if (!input || typeof input !== 'string') {
        return null;
    }

    // 1. Extract potential JSON content
    let candidate = input;

    // Try to find the outer-most JSON object or array
    // We look for the first '{' or '[' and the last '}' or ']'
    const firstOpenBrace = input.indexOf('{');
    const firstOpenBracket = input.indexOf('[');
    
    let startIndex = -1;
    let endIndex = -1;

    // Determine if it's an object or array starting first
    if (firstOpenBrace !== -1 && (firstOpenBracket === -1 || firstOpenBrace < firstOpenBracket)) {
        startIndex = firstOpenBrace;
        endIndex = input.lastIndexOf('}') + 1;
    } else if (firstOpenBracket !== -1) {
        startIndex = firstOpenBracket;
        endIndex = input.lastIndexOf(']') + 1;
    }

    if (startIndex !== -1 && endIndex > startIndex) {
        candidate = input.substring(startIndex, endIndex);
    }

    // 2. Try standard parsing first (fast path)
    try {
        return JSON.parse(candidate);
    } catch (e) {
        // Fallthrough to repair
    }

    // 3. Try repairing
    try {
        const repaired = jsonrepair(candidate);
        // jsonrepair might return the string itself if it thinks it's a string literal, 
        // or something that parses but isn't an object/array if input was just text.
        const result = JSON.parse(repaired);
        
        // If we expect an object or array, but got a string that equals the input (or candidate),
        // it means parsing effectively failed to find structure.
        // e.g. jsonrepair("Not a JSON") -> "\"Not a JSON\"" -> "Not a JSON"
        if (typeof result === 'string' && (result === candidate || result === input)) {
             return null;
        }
        return result;
    } catch (e) {
        // ... existing fallback logic ...
        if (candidate !== input) {
            try {
                const repairedFull = jsonrepair(input);
                const result = JSON.parse(repairedFull);
                if (typeof result === 'string' && result === input) return null;
                return result;
            } catch (e2) {
                return null;
            }
        }
        return null;
    }
}
