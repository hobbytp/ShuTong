# ShuTong

**ShuTong** is an intelligent, AI-powered screen time tracker that helps you understand how you spend your digital life. Built with Electron, React, and local AI capabilities, it records your activity and provides insightful analysis without compromising privacy.

## ✨ Features

- **🔍 AI-Powered Analysis**: Automatically categorizes your activities and generates summaries using advanced LLMs (OpenAI, Gemini, etc.).
- **🎥 Screen Recording & Timelapse**: Captures your day in the background and lets you review it with a high-performance timelapse player.
- **🤖 MCP Support**: Built-in support for the Model Context Protocol (MCP) to extend capabilities with external tools.
- **🔒 Privacy First**: All data is stored locally on your device. You own your data.
- **⚡ Automation Ready**: Control recording via deep links (`shutong://`), perfect for integration with Raycast, Alfred, or Shortcuts.

## 🚀 Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn

### Installation

1.  **Clone the repository**
    ```bash
    git clone https://github.com/hobbytp/ShuTong.git
    cd ShuTong
    ```

2.  **Install dependencies**
    ```bash
    npm install
    # or
    yarn install
    ```

3.  **Run in development mode**
    ```bash
    npm run dev
    ```

### Building for Production

To create a distributable installer for your OS (Windows recommended for now):

```bash
# On Windows (Git Bash recommended)
npm run build
```

The output files will be in the `release/` directory.

## 🔗 Automation (Deep Links)

ShuTong supports the `shutong://` protocol, allowing you to control recording from external applications or scripts.

### Supported Commands

- `shutong://start-recording` - Start screen recording
- `shutong://stop-recording` - Stop screen recording

### Examples

**Windows (CMD/PowerShell)**
```batch
start shutong://start-recording
start shutong://stop-recording
```

**macOS (Terminal)**
```bash
open shutong://start-recording
open shutong://stop-recording
```

## 🛠 Tech Stack

- **Frontend**: React, TypeScript, TailwindCSS, Vite
- **Backend / Desktop**: Electron
- **Database**: Better-SQLite3
- **AI Integration**: OpenAI SDK, Google Generative AI

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

[MIT](LICENSE) © RayTan