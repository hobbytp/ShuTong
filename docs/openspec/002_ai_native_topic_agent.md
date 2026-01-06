# Change: AI-Native Topic Agent & Chat Interface

## Why
To enable a truly "AI-Native" experience, users should be able to define Timeline Topics using natural language (e.g., "Show me my ShuTong development work") rather than manually configuring rigid rules. The current system needs to support this fluid interaction by "grounding" user intent into historical activity data via a conversational agent. Additionally, we need to move away from rigid database schemas (project_name columns) to a flexible, vector-based or semantic search approach.

## What Changes

### 1. Schema Reversion & Flexibility
*   **Revert**: Remove the recently added `project_name` and `domain` columns from the `screenshots` table to simplify the schema.
*   **Revert**: Remove `topics` and `topic_rules` tables.
*   **New Strategy**: Rely on `window_title`, `app_name`, and Vector Search (OpenMemory) to dynamically identify relevant activities.

### 2. Topic Agent (Backend)
*   **New Agent**: `TopicAgent` (in `electron/features/topic/topic-agent.ts`).
*   **Capabilities**:
    *   **Intent Recognition**: Parse user queries to understand what they are looking for (e.g., "Coding in VS Code").
    *   **Context Discovery**: Query the `window_switches` table and Vector DB to find historical windows that match the intent.
    *   **Dialogue Management**: Engage in multi-turn conversation to clarify and confirm the scope of the topic.
    *   **Persistence**: Save the finalized topic definition (as a flexible JSON or query pattern) for future use.

### 3. Shared Chatbot UI (Frontend)
*   **Refactor**: Extract the chat interface from `PulsePage` into a reusable `<AgentChat />` component.
*   **Integration**:
    *   Add a **Floating Action Button (FAB)** to the bottom-right of the Timeline View.
    *   Clicking the FAB opens a popover containing the `<AgentChat agentId="topic" />` interface.

## Interaction Example

1.  **User**: "ShuTong dev"
2.  **Agent**: "Do you mean coding in VS Code? I found these windows: ['VS Code - ShuTong', 'VS Code - MiniContext']. Any others?"
3.  **User**: "Add MyProject doc."
4.  **Agent**: (Searches DB for 'MyProject'...) "Found 'Word - MyProject.docx'. Updated list: ['VS Code - ShuTong', 'VS Code - MiniContext', 'Word - MyProject.docx']. Confirmed?"
5.  **User**: "Yes."
6.  **Agent**: Saves Topic "ShuTong dev" with these window rules.

## Impact
*   **User Experience**: significantly improved by allowing natural language configuration.
*   **Architecture**: Decoupled from rigid SQL schemas; more reliant on AI capabilities.
*   **Codebase**: Introduces reusable Chat components and a new Agent pattern.
