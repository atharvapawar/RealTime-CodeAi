# RealTime AI Editor

An AI-powered VS Code extension that provides contextual coding assistance with daily-updated Next.js and Tailwind CSS documentation.

## Features

### 🔄 Real-Time Documentation Updates
- Daily-updated Next.js and Tailwind CSS documentation
- Smart diffing to highlight what's new or changed
- Customizable refresh schedule (Pro feature)

### 🧠 Context-Aware AI Assistant
- Understands your code context
- Provides relevant documentation snippets
- Multi-step validation approach inspired by Trae AI

### 💡 Intelligent Code Suggestions
- Inline code completions
- Project-wide context awareness (Pro feature)
- Tailored to your coding style

### 🚀 Freemium Model

#### Free Tier
- 50 AI completions per day
- Daily documentation updates
- File-level context awareness

#### Pro Tier ($9.99/month)
- Unlimited AI completions
- Hourly documentation updates
- Project-wide context awareness

#### Team Tier ($19.99/user/month)
- All Pro features
- Workspace-wide context awareness
- Team documentation sharing

## Getting Started

1. Install the extension from the VS Code Marketplace
2. Open a Next.js or Tailwind CSS project
3. Use the keyboard shortcut `Ctrl+Shift+L` (or `Cmd+Shift+L` on Mac) to open the AI Assistant
4. Use `Ctrl+Shift+H` (or `Cmd+Shift+H` on Mac) to get contextual help

## Commands

- `RealTime AI Editor: Open AI Assistant` - Opens the AI assistant panel
- `RealTime AI Editor: Refresh Documentation` - Manually refresh the documentation
- `RealTime AI Editor: Get Contextual AI Help` - Get AI help based on your current code context

## Requirements

- VS Code 1.89.0 or higher

## Extension Settings

This extension contributes the following settings:

* `realtimeAiEditor.telemetry.enabled`: Enable/disable telemetry
* `realtimeAiEditor.contextDepth`: Set the context depth (file, project, workspace)

## Known Issues

- The extension is currently in beta and may have some stability issues
- Some features are placeholders and will be fully implemented in future updates

## Release Notes

### 0.0.1

- Initial release with basic functionality

---

## Development

### Building the Extension

```bash
npm install
npm run package
```

### Publishing the Extension

```bash
npm run publish
```

## License

MIT