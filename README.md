# ShuTong (书童)

**ShuTong** is an intelligent, AI-powered screen time tracker / personal context assistant that captures, analyzes, and organizes your digital life. It refers to [Dayflow](https://github.com/JerryZLiu/Dayflow), [MineContext](https://github.com/volcengine/MineContext) and ChatGPT Pulse ideas.

ShuTong is built with Electron, React, and local/remote AI capabilities, it records your activity and provides insightful analysis without compromising privacy (with local LLM only if you configured).

This project is still under development.

## Features

- **AI-Powered Analysis**: Automatically categorizes your activities and generates summaries using LLMs (OpenAI-compatible providers, Gemini, etc.).
- **Smart Timeline (Timeline 2.0)**:
    - **Semantic Segmentation**: Replaces time-based chunks with event-based smart batching. Segments activity by actual context (App/Project/File).
    - **OCR Context**: "Reads" the text on your screen (code, logs, docs) to give the AI visual + textual understanding.
- **Pulse Agent**: A LangGraph-powered reasoning engine that provides:
    - **Briefing**: Daily summaries of your activities.
    - **Action**: Proactive suggestions based on your current context.
    - **Sprouting**: Connecting related ideas and activities.
    - **Challenge**: Reflective questions to help you grow.
- **Semantic Search**: Powered by vector database **LanceDB**, allowing you to search your history using natural language.
- **Screen Recording & Timelapse**: Captures your day in the background and lets you review it with a high-performance timelapse player.
- **Global i18n**: Full support for multiple languages (English & Chinese).
- **MCP Support(TBD)**: Built-in support for the Model Context Protocol (MCP) to extend capabilities with external tools. 
- **Privacy First**: All data, including screenshots and vector embeddings, is stored locally on your device.
- **Automation Ready**: Control recording via deep links (`shutong://`), perfect for integration with Raycast, Alfred, or Shortcuts.

> 📚 **Detailed Documentation**:
> - [Architecture Design](docs/designs/enhance-timeline-insights.md)
> - [Timeline Functions](docs/functions/timeline_enh.md)

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- FFmpeg (optional; required for generating activity videos)

### Installation

1.  **Clone the repository**
    ```bash
    git clone https://github.com/hobbytp/ShuTong.git
    cd ShuTong
    ```

2.  **Install dependencies**
    ```bash
    npm install
    ```

3.  **Run in development mode**
    ```bash
    npm run dev
    ```

### LLM Configuration

- Configure providers and per-role routing in `llm_config.json` or via the in-app settings.
- Common roles include `PULSE_AGENT`, `SCREEN_ANALYZE`, `TEXT_SUMMARY`, and `DEEP_THINKING`.

### Building for Production

To create a distributable installer for your OS (Windows recommended for now):

```bash
npm run build
```

The output files will be in the `release/` directory.

## Automation (Deep Links)

ShuTong supports the `shutong://` protocol, allowing you to control recording from external applications or scripts.

### Supported Commands

- `shutong://start-recording` - Start screen recording
- `shutong://stop-recording` - Stop screen recording

### Examples

Windows (CMD/PowerShell):

```bat
start shutong://start-recording
start shutong://stop-recording
```

macOS (Terminal):

```bash
open shutong://start-recording
open shutong://stop-recording
```

Linux (Terminal):

```bash
xdg-open shutong://start-recording
xdg-open shutong://stop-recording
```

## Tech Stack

- **Frontend**: React, TypeScript, TailwindCSS, Vite
- **Backend / Desktop**: Electron
- **Database**: Better-SQLite3 (Settings & Activity), LanceDB (Vector Storage)
- **AI Integration**: LangChain, LangGraph, OpenAI SDK, Google Generative AI (Native Gemini)
- **Video Processing**: FFmpeg

## Troubleshooting

- If native modules (e.g. `better-sqlite3`) fail to load/build, try: `npm run rebuild`.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

[MIT](LICENSE) © Peng Tan
