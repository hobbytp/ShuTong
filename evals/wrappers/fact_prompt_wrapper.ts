import { getFactRetrievalMessages } from '../../electron/features/pulse/agent/prompts';

export default function (context: any) {
    const input = context.vars.input;

    // getFactRetrievalMessages returns [systemPrompt, userPrompt]
    const [systemContent, userContent] = getFactRetrievalMessages(input);

    return [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent }
    ];
}
