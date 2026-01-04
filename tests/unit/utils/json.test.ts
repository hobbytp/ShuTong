import { describe, expect, it } from 'vitest';
import { safeParseJSON } from '../../../electron/utils/json';

describe('safeParseJSON', () => {
    it('should parse valid JSON', () => {
        const input = '{"key": "value", "num": 123}';
        expect(safeParseJSON(input)).toEqual({ key: 'value', num: 123 });
    });

    it('should parse JSON wrapped in markdown code blocks', () => {
        const input = 'Here is the response:\n```json\n{"key": "value"}\n```';
        expect(safeParseJSON(input)).toEqual({ key: 'value' });
    });

    it('should parse JSON wrapped in markdown without language identifier', () => {
        const input = '```\n{"key": "value"}\n```';
        expect(safeParseJSON(input)).toEqual({ key: 'value' });
    });

    it('should parse JSON hidden in text', () => {
        const input = 'Sure, here is the data: {"id": 1, "name": "Test"} hope this helps.';
        expect(safeParseJSON(input)).toEqual({ id: 1, name: 'Test' });
    });

    it('should repair JSON with trailing commas', () => {
        const input = '{"arr": [1, 2, ], "obj": {"a": 1, }}';
        expect(safeParseJSON(input)).toEqual({ arr: [1, 2], obj: { a: 1 } });
    });

    it('should repair JSON with single quotes', () => {
        const input = "{'key': 'value'}";
        expect(safeParseJSON(input)).toEqual({ key: 'value' });
    });

    it('should repair JSON with unquoted keys', () => {
        const input = '{key: "value", num: 123}';
        expect(safeParseJSON(input)).toEqual({ key: 'value', num: 123 });
    });

    it('should repair JSON with comments', () => {
        const input = `
        {
            "key": "value", // This is a comment
            /* Another comment */
            "num": 123
        }`;
        expect(safeParseJSON(input)).toEqual({ key: 'value', num: 123 });
    });

    it('should return null for invalid input', () => {
        expect(safeParseJSON('Not a JSON')).toBeNull();
        expect(safeParseJSON('')).toBeNull();
        // jsonrepair is actually very good at fixing "{"incomplete": ", it turns it into {"incomplete": null} or similar.
        // So we should expect it to potentially SUCCEED with a best-effort fix, OR fail. 
        // For the purpose of this test, let's test a truly unrecoverable string.
        expect(safeParseJSON(':::')).toBeNull(); 
    });

    it('should handle arrays', () => {
        const input = '[1, 2, 3]';
        expect(safeParseJSON(input)).toEqual([1, 2, 3]);
    });

    it('should handle nested structures', () => {
        const input = '{"a": {"b": [1, 2]}}';
        expect(safeParseJSON(input)).toEqual({ a: { b: [1, 2] } });
    });
    
    // Edge case often seen with LLMs: escaped newlines in strings
    it('should handle escaped newlines correctly', () => {
        const input = '{"text": "Line 1\\nLine 2"}';
        expect(safeParseJSON(input)).toEqual({ text: 'Line 1\nLine 2' });
    });
});
