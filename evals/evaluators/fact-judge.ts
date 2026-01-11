import { z } from 'zod';
import OpenAI from 'openai';

// Initialize OpenAI client
// Note: Requires OPENAI_API_KEY in environment variables
const openai = new OpenAI({
    apiKey: process.env.SILICONFLOW_API_KEY, // Promptfoo might inject this or load from .env
    baseURL: process.env.SILICONFLOW_BASE_URL,
});

// 1. Logic Schema
const FactJudgeResultSchema = z.object({
    score: z.number().min(0).max(1),
    reason: z.string(),
    missing_facts: z.array(z.string()).optional(),
    hallucinated_facts: z.array(z.string()).optional(),
});

// 2. Judge Rubric
const JUDGE_RUBRIC = `
You are an expert evaluator for a Fact Retrieval system.
Your task is to compare the "Extracted Facts" against the "Expected Facts" relative to the "Original Input".

Score 1.0: 
- All expected facts are present and semantically correct.
- No hallucinated or irrelevant facts.

Score 0.5: 
- Most facts are correct but some minor details are missing.
- Or there is 1 minor irrelevant fact.

Score 0.0:
- Misses key facts.
- Or extracts completely wrong information (Hallucination).
- Or output is empty when it shouldn't be.

Output JSON format:
{
    "score": number, // 0.0, 0.5, or 1.0
    "reason": string, // brief explanation
    "missing_facts": string[], // optional
    "hallucinated_facts": string[] // optional
}
`;

// 3. Main Eval Function
export async function evaluateFactExtraction(
    extractedFacts: string[],
    expectedFacts: string[],
    originalInput: string,
): Promise<z.infer<typeof FactJudgeResultSchema>> {

    // Quick exact match check only if arrays are identical (order agnostic)
    const sortedExt = [...extractedFacts].sort().join('|');
    const sortedExp = [...expectedFacts].sort().join('|');
    if (sortedExt === sortedExp) {
        return { score: 1, reason: "Exact match." };
    }

    const response = await openai.chat.completions.create({
        model: 'deepseek-ai/DeepSeek-V3', // Use a strong model for judging
        messages: [
            { role: 'system', content: JUDGE_RUBRIC },
            {
                role: 'user', content: `
        Original Input: ${originalInput}
        Expected Facts: ${JSON.stringify(expectedFacts)}
        Extracted Facts: ${JSON.stringify(extractedFacts)}
        
        Provide your evaluation as JSON.
      `},
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
    });

    const content = response.choices[0].message.content;
    if (!content) {
        throw new Error("Judge returned empty content");
    }

    return FactJudgeResultSchema.parse(JSON.parse(content));
}

// 4. Promptfoo Adapter
export default async function (output: string, context: any) {
    try {
        let extractedFacts: string[] = [];
        try {
            // ShuTong output is JSON string: {"facts": [...]}
            // But output might be wrapped in markdown code block sometimes, handle that?
            // The prompt says "Strictly output JSON", but models can be chatty.
            // For now assume clean JSON or basic cleanup.
            const cleanOutput = output.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(cleanOutput);

            if (Array.isArray(parsed.facts)) {
                extractedFacts = parsed.facts;
            } else {
                return { pass: false, score: 0, reason: "Output JSON missing 'facts' array" };
            }
        } catch (e) {
            return { pass: false, score: 0, reason: `Invalid JSON output: ${e}` };
        }

        // Expected facts from CSV are also JSON string: "['Fact 1', ...]"
        // Promptfoo loads CSV columns as strings.
        let expectedFacts: string[] = [];
        try {
            expectedFacts = JSON.parse(context.vars.expected_facts);
        } catch (e) {
            // Maybe it's already an object if promptfoo parsed it?
            if (Array.isArray(context.vars.expected_facts)) {
                expectedFacts = context.vars.expected_facts;
            } else {
                throw new Error(`Invalid expected_facts format in dataset: ${context.vars.expected_facts}`);
            }
        }

        const result = await evaluateFactExtraction(
            extractedFacts,
            expectedFacts,
            context.vars.input,
        );

        return {
            pass: result.score >= 0.9, // Strict pass
            score: result.score,
            reason: result.reason,
        };

    } catch (err: any) {
        return {
            pass: false,
            score: 0,
            reason: `Evaluator error: ${err.message}`
        };
    }
}
