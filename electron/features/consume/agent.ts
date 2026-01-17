// Context Agent - StateGraph Assembly

import { StateGraph } from '@langchain/langgraph';
import { AgentState, AgentStateType } from './models/state';
import { intentNode, intentRouter } from './nodes/intent';
import { contextPlanNode, contextExecNode, contextRouter } from './nodes/context';
import { executorNode } from './nodes/executor';
import { reflectionNode, reflectionRouter } from './nodes/reflection';
import { WorkflowStage } from './models/enums';

/**
 * Create the Context Agent graph
 */
export function createContextAgent() {
    // Build the graph
    const workflow = new StateGraph(AgentState)
        // Add nodes (using different names from state attributes to avoid conflicts)
        .addNode('intentNode', intentNode)
        .addNode('contextPlan', contextPlanNode)
        .addNode('contextExec', contextExecNode)
        .addNode('executorNode', executorNode)
        .addNode('reflectionNode', reflectionNode)

        // Entry point
        .addEdge('__start__', 'intentNode')

        // Intent node routing (simple_chat -> END, complex -> context)
        // Router returns: 'contextPlan' or '__end__'
        .addConditionalEdges('intentNode', intentRouter)

        // Context plan -> Context exec
        .addEdge('contextPlan', 'contextExec')

        // Context exec routing (sufficient -> executorNode, else -> contextPlan)
        // Router returns: 'executorNode' or 'contextPlan'
        .addConditionalEdges('contextExec', contextRouter)

        // Executor -> Reflection
        .addEdge('executorNode', 'reflectionNode')

        // Reflection routing (retry -> contextPlan, done -> END)
        // Router returns: 'contextPlan' or '__end__'
        .addConditionalEdges('reflectionNode', reflectionRouter);

    // Compile the graph
    return workflow.compile();
}



/**
 * Process a query through the context agent
 */
export async function processQuery(
    query: string,
    options?: {
        documentId?: string;
        streaming?: boolean;
    }
): Promise<{
    success: boolean;
    content: string;
    stage: WorkflowStage;
    reflection?: any;
}> {
    const agent = createContextAgent();

    const result = await agent.invoke({
        query,
        documentId: options?.documentId || null,
    });

    return {
        success: result.stage === WorkflowStage.COMPLETED,
        content: result.finalContent,
        stage: result.stage,
        reflection: result.reflection,
    };
}

/**
 * Stream query processing
 */
export async function* processQueryStream(
    query: string,
    options?: {
        documentId?: string;
    }
): AsyncGenerator<{ node: string; state: Partial<AgentStateType> }> {
    const agent = createContextAgent();

    const stream = await agent.stream({
        query,
        documentId: options?.documentId || null,
    });

    for await (const chunk of stream) {
        // chunk is { nodeName: stateUpdate }
        for (const [node, state] of Object.entries(chunk)) {
            yield { node, state: state as Partial<AgentStateType> };
        }
    }
}
