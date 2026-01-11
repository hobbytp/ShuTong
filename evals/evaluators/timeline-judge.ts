import { z } from 'zod';
import OpenAI from 'openai';

// Initialize OpenAI client for Judging
const openai = new OpenAI({
    apiKey: process.env.SILICONFLOW_API_KEY,
    baseURL: process.env.SILICONFLOW_BASE_URL,
});

const TimelineJudgeResultSchema = z.object({
    score: z.number().min(0).max(1),
    reason: z.string(),
});

const JUDGE_RUBRIC = `
You are an expert evaluator for a Multimodal Screen Analysis system.
Your task is to compare the "Generated Description" against the "Expected Activity".

Score 1.0:
- Accurately identifies the main application and activity.
- Captures specific details (e.g., file names, context) mentioned in expectation.
- No hallucinations (inventing details not present/expected).

Score 0.5:
- Identifies the correct application but misses specific details.
- Or description is too vague.

Score 0.0:
- Wrong application or activity.
- Hallucinated details.
- Empty or invalid output.

Output JSON: { "score": number, "reason": string }
`;

export default async function (output: string, context: any) {
    try {
        // Parse the LLM output (ShuTong returns JSON string with observations)
        let generatedText = '';
        try {
            const cleanOutput = output.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(cleanOutput);
            if (parsed.observations && parsed.observations.length > 0) {
                generatedText = parsed.observations.map((o: any) => o.text).join('\n');
            } else if (parsed.items) {
                generatedText = parsed.items.map((i: any) => i.summary || i.title).join('\n');
            } else {
                return { pass: false, score: 0, reason: "Output missing 'observations' or 'items'" };
            }
        } catch (e) {
            // Fallback: if output is just text (model failed JSON instruction), evaluate the text directly
            // but penalize slightly? For MVP let's accept text if JSON parsing fails.
            generatedText = output;
        }

        const expectedActivity = context.vars.expected_activity;

        const response = await openai.chat.completions.create({
            model: 'deepseek-ai/DeepSeek-V3', // Judge model
            messages: [
                { role: 'system', content: JUDGE_RUBRIC },
                {
                    role: 'user', content: `
            Expected Activity: ${expectedActivity}
            Generated Description: ${generatedText}
            
            Provide your evaluation as JSON.
          `},
            ],
            response_format: { type: 'json_object' },
            temperature: 0,
        });

        const content = response.choices[0].message.content;
        if (!content) throw new Error("Judge returned empty content");

        const result = TimelineJudgeResultSchema.parse(JSON.parse(content));

        return {
            pass: result.score >= 0.9,
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
