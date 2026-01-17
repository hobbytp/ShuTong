// Context Agent Entry Point

import 'dotenv/config';
import { processQuery, processQueryStream } from './agent';

async function main() {
    const args = process.argv.slice(2);
    const streaming = args.includes('--stream');
    const query = args.filter((a) => !a.startsWith('--')).join(' ') ||
        'What were the main AI developments last week?';

    console.log('='.repeat(60));
    console.log('Context Agent - TypeScript + LangGraph');
    console.log('='.repeat(60));
    console.log(`Query: ${query}`);
    console.log(`Mode: ${streaming ? 'Streaming' : 'Blocking'}`);
    console.log('='.repeat(60));

    try {
        if (streaming) {
            // Streaming mode
            console.log('\n[Streaming Output]\n');
            for await (const { node, state } of processQueryStream(query)) {
                console.log(`[${node}] Stage: ${state.stage || 'unknown'}`);
                if (state.finalContent) {
                    console.log(`Content preview: ${state.finalContent.substring(0, 100)}...`);
                }
            }
        } else {
            // Blocking mode
            console.log('\n[Processing...]\n');
            const result = await processQuery(query);

            console.log('='.repeat(60));
            console.log('Result:');
            console.log('='.repeat(60));
            console.log(`Success: ${result.success}`);
            console.log(`Stage: ${result.stage}`);
            console.log('\nContent:');
            console.log(result.content || '(No content generated)');

            if (result.reflection) {
                console.log('\nReflection:');
                console.log(`  Type: ${result.reflection.reflectionType}`);
                console.log(`  Summary: ${result.reflection.summary}`);
            }
        }
    } catch (error) {
        console.error('Error running agent:', error);
        process.exit(1);
    }
}

main();
