const vscode = require("vscode");
const path = require("path");
const ContextExtractor = require("./context-extractor");
const DocDiffer = require("./doc-differ");
const TelemetryService = require("./telemetry-service");
const marked = require("marked");
const hljs = require("highlight.js");

class WebviewPanel {
  constructor(context, contextExtractor, docDiffer) {
    this.context = context;
    this.panel = null;
    this.disposables = [];
    this.contextExtractor = contextExtractor || new ContextExtractor();
    this.docDiffer =
      docDiffer || new DocDiffer(context.asAbsolutePath("nextjs-docs.json"));
    this.messageHistory = [];
    this.isProcessing = false;
    this.telemetryService = new TelemetryService(context);

    // Configure marked with syntax highlighting
    marked.setOptions({
      highlight: function (code, lang) {
        if (lang && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
      },
    });
  }

  createOrShow() {
    const columnToShowIn = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it
    if (this.panel) {
      this.panel.reveal(columnToShowIn);
      return;
    }

    // Otherwise, create a new panel
    this.panel = vscode.window.createWebviewPanel(
      "realtimeAiEditor",
      "RealTime AI Editor",
      columnToShowIn || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(this.context.extensionPath, "media")),
          vscode.Uri.file(
            path.join(this.context.extensionPath, "node_modules")
          ),
        ],
      }
    );

    // Set the webview's initial html content
    this.panel.webview.html = this._getHtmlForWebview();

    // Listen for when the panel is disposed
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Handle messages from the webview
    this.panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case "askAi":
            this.handleAiQuery(message.text);
            return;
          case "refreshDocs":
            this.handleRefreshDocs();
            return;
          case "saveSettings":
            this.saveSettings(message.settings);
            return;
          case "openSettings":
            this.showSettingsPage();
            return;
        }
      },
      null,
      this.disposables
    );
  }

  async handleAiQuery(query, providedContext = null, providedDocs = null) {
    if (this.isProcessing) {
      this.panel.webview.postMessage({
        command: "aiResponse",
        text: "I'm still processing your previous request. Please wait a moment...",
        status: "info",
        isMarkdown: false,
      });
      return;
    }

    this.isProcessing = true;

    // Store the query in message history
    this.messageHistory.push({ role: "user", content: query });

    // Send processing message
    this.panel.webview.postMessage({
      command: "aiResponse",
      text: "Processing your query...",
      status: "processing",
      isMarkdown: false,
    });

    // No need to check for special commands here as they're handled in the message event listener

    try {
      // Use provided context and docs if available, otherwise fetch them
      const context =
        providedContext ||
        (await this.contextExtractor.extractActiveEditorContext());
      let relevantDocs = providedDocs || [];

      // If docs weren't provided, fetch them
      if (!providedDocs && context) {
        relevantDocs = await this.contextExtractor.findRelevantDocs(context, 5);
      }

      // Check collection status
      const collectionStatus =
        await this.contextExtractor.getCollectionStatus();

      // Determine the type of query and generate appropriate response
      let response = "";
      let isMarkdown = true;
      const queryLower = query.toLowerCase();

      if (
        queryLower.includes("explain") ||
        queryLower.includes("what does") ||
        queryLower.includes("how does")
      ) {
        // Code explanation
        response = this._generateCodeExplanation(context, relevantDocs);
      } else if (
        queryLower.includes("improve") ||
        queryLower.includes("optimize") ||
        queryLower.includes("better")
      ) {
        // Code improvement suggestions
        response = this._generateCodeImprovements(context, relevantDocs);
      } else if (
        queryLower.includes("debug") ||
        queryLower.includes("fix") ||
        queryLower.includes("error") ||
        queryLower.includes("issue")
      ) {
        // Debugging help
        response = this._generateDebuggingHelp(context, relevantDocs);
      } else if (
        queryLower.includes("example") ||
        queryLower.includes("sample") ||
        queryLower.includes("how to")
      ) {
        // Code examples
        response = this._generateCodeExamples(context, relevantDocs);
      } else {
        // General response
        response = this._generateGeneralResponse(
          query,
          context,
          relevantDocs,
          collectionStatus
        );
      }

      // Store the response in message history
      this.messageHistory.push({ role: "assistant", content: response });

      // Send the response back to the webview
      this.panel.webview.postMessage({
        command: "aiResponse",
        text: response,
        status: "complete",
        isMarkdown: true,
      });
    } catch (error) {
      console.error("Error processing AI query:", error);
      this.panel.webview.postMessage({
        command: "aiResponse",
        text: `I encountered an error while processing your request: ${error.message}. Please try again.`,
        status: "error",
        isMarkdown: false,
      });
    } finally {
      this.isProcessing = false;
    }
  }

  async handleRefreshDocs() {
    if (this.isProcessing) {
      this.panel.webview.postMessage({
        command: "refreshStatus",
        status: "error",
        message: "Already processing a request. Please wait.",
      });
      return;
    }

    this.isProcessing = true;

    this.panel.webview.postMessage({
      command: "refreshStatus",
      status: "Refreshing documentation...",
      isRefreshing: true,
    });

    try {
      // Process the documentation
      const processResult = await this.docDiffer.processDocs();
      if (!processResult.success) {
        throw new Error(
          processResult.error || "Failed to process documentation"
        );
      }

      // Update the vector database with latest docs
      const docsForChroma = this.docDiffer.getDocsForChroma();
      const updateResult = await this.contextExtractor.updateCollection(
        docsForChroma
      );
      if (!updateResult.success) {
        throw new Error(
          updateResult.error || "Failed to update vector database"
        );
      }

      const { differences } = processResult;

      // Send success message with summary
      this.panel.webview.postMessage({
        command: "refreshStatus",
        status: `Documentation refreshed! New: ${differences.newCount}, Updated: ${differences.updatedCount}, Removed: ${differences.removedCount}`,
        isRefreshing: false,
        summary: {
          totalNewDocs: differences.newCount,
          totalUpdatedDocs: differences.updatedCount,
          totalRemovedDocs: differences.removedCount,
        },
      });

      // Also send a message to the chat
      this.panel.webview.postMessage({
        command: "aiResponse",
        text: `## Documentation Updated

I've refreshed the documentation database:
- ${differences.newCount} new documents added
- ${differences.updatedCount} documents updated
- ${differences.removedCount} documents removed

You now have access to the latest Next.js and Tailwind CSS documentation!`,
        status: "info",
        isMarkdown: true,
      });
    } catch (error) {
      console.error("Error refreshing docs:", error);
      this.panel.webview.postMessage({
        command: "refreshStatus",
        status: `Error: ${error.message}`,
        isRefreshing: false,
      });

      this.panel.webview.postMessage({
        command: "aiResponse",
        text: `I encountered an error while refreshing the documentation: ${error.message}. Please try again later.`,
        status: "error",
        isMarkdown: false,
      });
    } finally {
      this.isProcessing = false;
    }
  }

  _getHtmlForWebview() {
    // Get path to media resources
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, "media", "main.js"))
    );
    const styleUri = this.panel.webview.asWebviewUri(
      vscode.Uri.file(
        path.join(this.context.extensionPath, "media", "style.css")
      )
    );
    const codiconsUri = this.panel.webview.asWebviewUri(
      vscode.Uri.file(
        path.join(
          this.context.extensionPath,
          "node_modules",
          "@vscode/codicons",
          "dist",
          "codicon.css"
        )
      )
    );
    const markedUri = this.panel.webview.asWebviewUri(
      vscode.Uri.file(
        path.join(
          this.context.extensionPath,
          "node_modules",
          "marked",
          "marked.min.js"
        )
      )
    );
    const highlightJsUri = this.panel.webview.asWebviewUri(
      vscode.Uri.file(
        path.join(
          this.context.extensionPath,
          "node_modules",
          "highlight.js",
          "highlight.min.js"
        )
      )
    );
    const highlightCssUri = this.panel.webview.asWebviewUri(
      vscode.Uri.file(
        path.join(
          this.context.extensionPath,
          "node_modules",
          "highlight.js",
          "styles",
          "github.css"
        )
      )
    );

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${this.panel.webview.cspSource} https:; script-src ${this.panel.webview.cspSource}; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; font-src ${this.panel.webview.cspSource};">
        <title>RealTime AI Editor</title>
        <link href="${codiconsUri}" rel="stylesheet" />
        <link href="${highlightCssUri}" rel="stylesheet" />
        <script src="${markedUri}"></script>
        <script src="${highlightJsUri}"></script>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
            padding: 0;
            margin: 0;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            height: 100vh;
            overflow: hidden;
          }
          .container {
            display: grid;
            grid-template-rows: auto 1fr auto;
            height: 100vh;
            width: 100%;
          }
          header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 20px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background-color: var(--vscode-editor-background);
          }
          .header-left {
            display: flex;
            align-items: center;
          }
          .header-right {
            display: flex;
            align-items: center;
          }
          h1 {
            font-size: 1.2em;
            margin: 0;
            color: var(--vscode-editor-foreground);
            display: flex;
            align-items: center;
          }
          h1 .codicon {
            margin-right: 8px;
            color: var(--vscode-terminal-ansiBlue);
          }
          .chat-container {
            overflow-y: auto;
            padding: 20px;
            scroll-behavior: smooth;
            display: flex;
            flex-direction: column;
          }
          .message {
            margin-bottom: 16px;
            max-width: 85%;
            animation: fadeIn 0.3s ease-in-out;
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .message-content {
            padding: 12px 16px;
            border-radius: 8px;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
          }
          .user-message {
            align-self: flex-end;
          }
          .user-message .message-content {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-bottom-right-radius: 2px;
          }
          .ai-message {
            align-self: flex-start;
          }
          .ai-message .message-content {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            color: var(--vscode-editor-foreground);
            border-bottom-left-radius: 2px;
          }
          .message-info {
            align-self: center;
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.8em;
            margin: 8px 0;
          }
          .message-error {
            align-self: center;
            background-color: var(--vscode-errorForeground);
            color: var(--vscode-editor-background);
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.8em;
            margin: 8px 0;
          }
          .input-container {
            display: flex;
            padding: 16px 20px;
            border-top: 1px solid var(--vscode-panel-border);
            background-color: var(--vscode-editor-background);
          }
          .input-wrapper {
            flex: 1;
            position: relative;
            display: flex;
            align-items: center;
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
          }
          #user-input {
            flex: 1;
            padding: 10px 12px;
            border: none;
            background-color: transparent;
            color: var(--vscode-input-foreground);
            font-family: inherit;
            font-size: 14px;
            resize: none;
            max-height: 120px;
            min-height: 20px;
            outline: none;
          }
          .input-actions {
            display: flex;
            align-items: center;
            padding-right: 8px;
          }
          button {
            display: flex;
            align-items: center;
            justify-content: center;
            margin-left: 8px;
            padding: 8px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            transition: background-color 0.2s;
          }
          button:hover {
            background-color: var(--vscode-button-hoverBackground);
          }
          button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          button .codicon {
            font-size: 16px;
          }
          .send-button {
            padding: 8px 16px;
          }
          .status-bar {
            display: flex;
            align-items: center;
            font-size: 0.8em;
            color: var(--vscode-descriptionForeground);
            margin-left: 16px;
          }
          .refresh-button {
            background-color: transparent;
            border: 1px solid var(--vscode-button-background);
            color: var(--vscode-button-background);
            display: flex;
            align-items: center;
            padding: 4px 8px;
            font-size: 12px;
          }
          .refresh-button:hover {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
          }
          .refresh-button .codicon {
            margin-right: 4px;
          }
          .doc-status-indicator {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background-color: var(--vscode-terminal-ansiGreen);
            margin-right: 6px;
          }
          .doc-status-refreshing {
            background-color: var(--vscode-terminal-ansiYellow);
            animation: pulse 1.5s infinite;
          }
          @keyframes pulse {
            0% { opacity: 0.5; }
            50% { opacity: 1; }
            100% { opacity: 0.5; }
          }
          .toolbar {
            display: flex;
            padding: 8px 20px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background-color: var(--vscode-editor-background);
            overflow-x: auto;
            white-space: nowrap;
          }
          .toolbar-button {
            background-color: transparent;
            border: none;
            color: var(--vscode-foreground);
            padding: 4px 8px;
            margin-right: 8px;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
          }
          .toolbar-button:hover {
            background-color: var(--vscode-list-hoverBackground);
          }
          .toolbar-button .codicon {
            margin-right: 4px;
          }
          .typing-indicator {
            display: flex;
            align-items: center;
            padding: 8px 12px;
            font-style: italic;
            color: var(--vscode-descriptionForeground);
          }
          .typing-indicator span {
            width: 4px;
            height: 4px;
            margin: 0 1px;
            background-color: var(--vscode-descriptionForeground);
            border-radius: 50%;
            display: inline-block;
            animation: typing 1.4s infinite both;
          }
          .typing-indicator span:nth-child(2) {
            animation-delay: 0.2s;
          }
          .typing-indicator span:nth-child(3) {
            animation-delay: 0.4s;
          }
          @keyframes typing {
            0% { opacity: 0.4; transform: translateY(0); }
            50% { opacity: 1; transform: translateY(-4px); }
            100% { opacity: 0.4; transform: translateY(0); }
          }
          /* Markdown Styling */
          .markdown-body h1, .markdown-body h2, .markdown-body h3 {
            margin-top: 16px;
            margin-bottom: 8px;
            color: var(--vscode-editor-foreground);
          }
          .markdown-body h1 {
            font-size: 1.5em;
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 4px;
          }
          .markdown-body h2 {
            font-size: 1.3em;
          }
          .markdown-body h3 {
            font-size: 1.1em;
          }
          .markdown-body p {
            margin: 8px 0;
          }
          .markdown-body ul, .markdown-body ol {
            padding-left: 20px;
          }
          .markdown-body code {
            font-family: 'Courier New', Courier, monospace;
            background-color: var(--vscode-textCodeBlock-background);
            padding: 2px 4px;
            border-radius: 3px;
            font-size: 0.9em;
          }
          .markdown-body pre {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 12px;
            border-radius: 5px;
            overflow-x: auto;
            margin: 12px 0;
          }
          .markdown-body pre code {
            background-color: transparent;
            padding: 0;
            border-radius: 0;
          }
          .markdown-body blockquote {
            border-left: 3px solid var(--vscode-activityBar-background);
            margin: 8px 0;
            padding-left: 12px;
            color: var(--vscode-descriptionForeground);
          }
          .markdown-body table {
            border-collapse: collapse;
            width: 100%;
            margin: 12px 0;
          }
          .markdown-body th, .markdown-body td {
            border: 1px solid var(--vscode-panel-border);
            padding: 6px 12px;
            text-align: left;
          }
          .markdown-body th {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
          }
          .markdown-body img {
            max-width: 100%;
          }
          .markdown-body hr {
            border: none;
            border-top: 1px solid var(--vscode-panel-border);
            margin: 16px 0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <header>
            <div class="header-left">
              <h1><i class="codicon codicon-symbol-keyword"></i> RealTime AI Editor</h1>
            </div>
            <div class="header-right">
              <div class="status-bar">
                <div id="doc-status-indicator" class="doc-status-indicator"></div>
                <span id="doc-status">Documentation: Up to date</span>
                <button id="refresh-docs" class="refresh-button">
                  <i class="codicon codicon-refresh"></i> Refresh Docs
                </button>
              </div>
            </div>
          </header>
          
          <div class="toolbar">
            <button class="toolbar-button" id="clear-chat">
              <i class="codicon codicon-clear-all"></i> Clear Chat
            </button>
            <button class="toolbar-button" id="get-context">
              <i class="codicon codicon-symbol-file"></i> Get Current Context
            </button>
            <button class="toolbar-button" id="code-suggestions">
              <i class="codicon codicon-lightbulb"></i> Code Suggestions
            </button>
            <button class="toolbar-button" id="docs-search">
              <i class="codicon codicon-book"></i> Search Docs
            </button>
            <button class="toolbar-button" id="settings-button">
              <i class="codicon codicon-gear"></i> Settings
            </button>
          </div>
          
          <div class="chat-container" id="chat-container">
            <div class="message ai-message">
              <div class="message-content markdown-body">
                <h2>Welcome to RealTime AI Editor!</h2>
                <p>I'm your AI coding assistant with access to the latest Next.js and Tailwind CSS documentation. I can help you with:</p>
                <ul>
                  <li>Code suggestions and improvements</li>
                  <li>Documentation lookups</li>
                  <li>Best practices and patterns</li>
                  <li>Debugging and troubleshooting</li>
                </ul>
                <p>How can I assist you with your project today?</p>
              </div>
            </div>
          </div>
          
          <div class="input-container">
            <div class="input-wrapper">
              <textarea id="user-input" placeholder="Ask me anything about your code or Next.js/Tailwind..." rows="1"></textarea>
              <div class="input-actions">
                <button id="clear-input" title="Clear input">
                  <i class="codicon codicon-close"></i>
                </button>
              </div>
            </div>
            <button id="send-button" class="send-button">
              <i class="codicon codicon-send"></i> Send
            </button>
          </div>
        </div>
        
        <script src="${scriptUri}"></script>
      </body>
      </html>
    `;
  }

  /**
   * Send context information to the webview
   * @param {Object} context - The context information
   */
  sendContextInfo(context) {
    if (!this.panel) return;

    const fileName = context.fileName.split(/[\\/]/).pop();

    this.panel.webview.postMessage({
      command: "aiResponse",
      text: `## Current Context

File: \`${fileName}\`  
Language: ${context.language}

\`\`\`${context.language}
${context.selectedText || context.surroundingCode}
\`\`\`

This context will be used for AI responses. You can ask questions about this code or request suggestions for improvements.`,
      status: "info",
      isMarkdown: true,
    });
  }

  /**
   * Send code suggestions to the webview
   * @param {Object} context - The context information
   */
  sendCodeSuggestions(context) {
    if (!this.panel) return;

    const fileName = context.fileName.split(/[\\/]/).pop();

    this.panel.webview.postMessage({
      command: "aiResponse",
      text: `## Code Suggestions

After analyzing your code in \`${fileName}\`, here are some suggestions:

\`\`\`${context.language}
${
  context.selectedText ||
  context.surroundingCode.substring(0, 200) +
    (context.surroundingCode.length > 200 ? "..." : "")
}
\`\`\`

### Suggestions

1. Consider using more descriptive variable names
2. Add proper error handling for asynchronous operations
3. Implement proper type checking for function parameters
4. Consider breaking down complex functions into smaller, more manageable pieces

Would you like me to help implement any of these suggestions?`,
      status: "complete",
      isMarkdown: true,
    });
  }

  /**
   * Send documentation search results to the webview
   * @param {string} query - The search query
   * @param {Array} results - The search results
   */
  sendDocsSearchResults(query, results) {
    if (!this.panel) return;

    let responseText = `## Documentation Search Results

Query: "${query}"

`;

    if (results && results.length > 0) {
      responseText += "### Results\n\n";

      results.forEach((doc, index) => {
        responseText += `**${index + 1}. ${
          doc.split("\n")[0] || "Untitled Document"
        }**\n\n`;
        responseText += `${doc.split("\n").slice(1).join("\n")}\n\n`;
      });
    } else {
      responseText +=
        "No documentation found matching your query. Try refreshing the documentation or using different search terms.";
    }

    this.panel.webview.postMessage({
      command: "aiResponse",
      text: responseText,
      status: "complete",
      isMarkdown: true,
    });
  }

  /**
   * Show settings page in the webview
   */
  showSettingsPage() {
    if (!this.panel) return;

    // Get current settings
    const config = vscode.workspace.getConfiguration("realtimeAiEditor");
    const telemetryEnabled = config.get("telemetryEnabled", true);
    const contextDepth = config.get("contextDepth", "file");

    // Send settings to webview
    this.panel.webview.postMessage({
      command: "showSettings",
      settings: {
        telemetryEnabled,
        contextDepth,
      },
    });
  }

  /**
   * Save settings from the webview
   * @param {Object} settings - The settings to save
   */
  async saveSettings(settings) {
    // Update VS Code configuration
    const config = vscode.workspace.getConfiguration("realtimeAiEditor");

    // Update telemetry setting
    if (settings.telemetryEnabled !== undefined) {
      await config.update(
        "telemetryEnabled",
        settings.telemetryEnabled,
        vscode.ConfigurationTarget.Global
      );
    }

    // Update context depth setting
    if (settings.contextDepth !== undefined) {
      await config.update(
        "contextDepth",
        settings.contextDepth,
        vscode.ConfigurationTarget.Global
      );
    }

    // Notify webview that settings were saved
    this.panel.webview.postMessage({
      command: "settingsSaved",
    });

    // Log settings update
    if (this.telemetryService) {
      this.telemetryService.logFeatureUsage("save_settings");
    }
  }

  /**
   * Generate code explanation response
   * @param {Object} context - The context information
   * @param {Array} docs - The relevant documentation
   * @returns {string} - Markdown formatted explanation
   */
  _generateCodeExplanation(context, docs) {
    if (!context)
      return "I need an active code file to provide an explanation.";

    const fileName = path.basename(context.fileName);
    let explanation = `## Code Explanation: ${fileName}

`;

    // Add explanation based on the code context
    explanation += `### Overview
This code appears to be written in ${context.language}. `;

    // Add language-specific explanations
    switch (context.language) {
      case "javascript":
      case "typescript":
        explanation +=
          "It seems to be implementing JavaScript/TypeScript functionality. ";
        if (
          context.surroundingCode.includes("import ") ||
          context.surroundingCode.includes("require(")
        ) {
          explanation += "The code imports dependencies and ";
        }
        if (
          context.surroundingCode.includes("function ") ||
          context.surroundingCode.includes("=>")
        ) {
          explanation += "defines functions or methods. ";
        }
        if (context.surroundingCode.includes("class ")) {
          explanation += "implements a class-based structure. ";
        }
        break;

      case "html":
      case "jsx":
      case "tsx":
        explanation += "It appears to be defining UI components or markup. ";
        break;

      case "css":
      case "scss":
        explanation += "It contains styling rules and properties. ";
        break;
    }

    // Add code breakdown
    explanation += `

### Code Breakdown
\`\`\`${context.language}
${context.selectedText || context.surroundingCode}
\`\`\`

This code ${
      context.selectedText ? "selection" : "section"
    } is doing the following:

1. Defining the structure and behavior of the component
2. Handling data processing and state management
3. Implementing business logic and user interactions
`;

    // Add relevant documentation if available
    if (docs && docs.length > 0) {
      explanation += `

### Relevant Documentation

`;
      docs.slice(0, 2).forEach((doc, index) => {
        explanation += `#### Reference ${index + 1}
${doc.substring(0, 300)}...

`;
      });
    }

    return explanation;
  }

  /**
   * Generate code improvement suggestions
   * @param {Object} context - The context information
   * @param {Array} docs - The relevant documentation
   * @returns {string} - Markdown formatted suggestions
   */
  _generateCodeImprovements(context, docs) {
    if (!context)
      return "I need an active code file to provide improvement suggestions.";

    const fileName = path.basename(context.fileName);
    let improvements = `## Code Improvement Suggestions: ${fileName}

`;

    // Add language-specific suggestions
    switch (context.language) {
      case "javascript":
      case "typescript":
        improvements += this._generateJavaScriptSuggestions(context);
        break;
      case "html":
      case "jsx":
      case "tsx":
        improvements += this._generateMarkupSuggestions(context);
        break;
      case "css":
      case "scss":
        improvements += this._generateStyleSuggestions(context);
        break;
      default:
        improvements += this._generateGenericSuggestions(context);
    }

    // Add code examples
    improvements += `

### Example Improvement
\`\`\`${context.language}
// Before
${
  context.selectedText ||
  context.surroundingCode.split("\n").slice(0, 5).join("\n")
}

// After (improved version)
${this._generateImprovedCodeExample(context)}
\`\`\`
`;

    return improvements;
  }

  /**
   * Generate debugging help
   * @param {Object} context - The context information
   * @param {Array} docs - The relevant documentation
   * @returns {string} - Markdown formatted debugging help
   */
  _generateDebuggingHelp(context, docs) {
    if (!context)
      return "I need an active code file to provide debugging help.";

    const fileName = path.basename(context.fileName);
    let debugging = `## Debugging Analysis: ${fileName}

`;

    // Add potential issues based on language
    debugging += `### Potential Issues

`;

    switch (context.language) {
      case "javascript":
      case "typescript":
        debugging += `1. **Asynchronous Code Issues**
   - Check for missing await keywords
   - Ensure promises are properly handled
   - Look for race conditions in async operations

2. **Type Errors**
   - Verify variable types match their usage
   - Check for undefined or null values
   - Ensure proper type conversions

3. **Logic Errors**
   - Validate conditional statements
   - Check loop boundaries and termination conditions
   - Verify the order of operations
`;
        break;

      case "html":
      case "jsx":
      case "tsx":
        debugging += `1. **Rendering Issues**
   - Check for missing key props in lists
   - Verify component lifecycle methods
   - Look for state update issues

2. **Markup Errors**
   - Ensure tags are properly closed
   - Check for invalid nesting of elements
   - Verify attribute values are properly formatted

3. **Event Handling**
   - Ensure event handlers are properly bound
   - Check for event propagation issues
   - Verify event handler logic
`;
        break;

      default:
        debugging += `1. **Syntax Errors**
   - Check for missing semicolons, brackets, or parentheses
   - Verify proper indentation and formatting
   - Look for typos in variable or function names

2. **Logic Errors**
   - Validate conditional statements
   - Check loop boundaries and termination conditions
   - Verify the order of operations

3. **Runtime Errors**
   - Check for undefined or null values
   - Verify function parameters
   - Look for out-of-bounds array access
`;
    }

    // Add debugging steps
    debugging += `

### Debugging Steps

1. **Add Console Logs**
   Add strategic console.log statements to track variable values and execution flow.

2. **Use Breakpoints**
   Set breakpoints in your code to pause execution and inspect the state.

3. **Check Browser Console**
   Look for error messages in the browser console that might indicate the issue.

4. **Isolate the Problem**
   Comment out sections of code to isolate where the issue is occurring.

5. **Review Recent Changes**
   If the issue appeared after recent changes, review those changes carefully.
`;

    return debugging;
  }

  /**
   * Generate code examples
   * @param {Object} context - The context information
   * @param {Array} docs - The relevant documentation
   * @returns {string} - Markdown formatted code examples
   */
  _generateCodeExamples(context, docs) {
    if (!context) return "I need an active code file to provide code examples.";

    const fileName = path.basename(context.fileName);
    let examples = `## Code Examples: ${fileName}

`;

    // Add language-specific examples
    switch (context.language) {
      case "javascript":
      case "typescript":
        examples += `### JavaScript/TypeScript Examples

#### Async/Await Example
\`\`\`javascript
async function fetchData() {
  try {
    const response = await fetch('https://api.example.com/data');
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching data:', error);
    return null;
  }
}
\`\`\`

#### React Component Example
\`\`\`jsx
import React, { useState, useEffect } from 'react';

function DataDisplay() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    async function loadData() {
      const result = await fetchData();
      setData(result);
      setLoading(false);
    }
    
    loadData();
  }, []);
  
  if (loading) return <div>Loading...</div>;
  if (!data) return <div>No data available</div>;
  
  return (
    <div className="data-container">
      <h2>{data.title}</h2>
      <p>{data.description}</p>
    </div>
  );
}
\`\`\`
`;
        break;

      case "html":
      case "jsx":
      case "tsx":
        examples += `### HTML/JSX Examples

#### Responsive Layout Example
\`\`\`html
<div class="container">
  <header class="header">
    <h1>My Website</h1>
    <nav>
      <ul>
        <li><a href="#">Home</a></li>
        <li><a href="#">About</a></li>
        <li><a href="#">Services</a></li>
        <li><a href="#">Contact</a></li>
      </ul>
    </nav>
  </header>
  
  <main class="content">
    <section class="hero">
      <h2>Welcome to My Website</h2>
      <p>This is a sample responsive layout.</p>
      <button class="cta">Learn More</button>
    </section>
    
    <section class="features">
      <div class="feature">
        <h3>Feature 1</h3>
        <p>Description of feature 1.</p>
      </div>
      <div class="feature">
        <h3>Feature 2</h3>
        <p>Description of feature 2.</p>
      </div>
      <div class="feature">
        <h3>Feature 3</h3>
        <p>Description of feature 3.</p>
      </div>
    </section>
  </main>
  
  <footer class="footer">
    <p>&copy; 2023 My Website. All rights reserved.</p>
  </footer>
</div>
\`\`\`
`;
        break;

      case "css":
      case "scss":
        examples += `### CSS/SCSS Examples

#### Responsive Grid Layout
\`\`\`css
.container {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  grid-gap: 20px;
  padding: 20px;
}

.item {
  background-color: #f5f5f5;
  border-radius: 5px;
  padding: 20px;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
  transition: transform 0.3s ease;
}

.item:hover {
  transform: translateY(-5px);
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
}

@media (max-width: 768px) {
  .container {
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    grid-gap: 15px;
  }
  
  .item {
    padding: 15px;
  }
}
\`\`\`
`;
        break;

      default:
        examples += `### General Code Examples

#### Basic Function Example
\`\`\`
function processData(data) {
  // Validate input
  if (!data) return null;
  
  // Process the data
  const result = data.map(item => {
    return {
      id: item.id,
      name: item.name,
      value: item.value * 2
    };
  });
  
  // Filter out invalid items
  return result.filter(item => item.value > 0);
}
\`\`\`
`;
    }

    // Add relevant documentation if available
    if (docs && docs.length > 0) {
      examples += `

### Documentation Examples

`;
      docs.slice(0, 2).forEach((doc, index) => {
        examples += `#### Example from Documentation ${index + 1}
${doc.substring(0, 300)}...

`;
      });
    }

    return examples;
  }

  /**
   * Generate general response
   * @param {string} query - The user query
   * @param {Object} context - The context information
   * @param {Array} docs - The relevant documentation
   * @param {Object} collectionStatus - The collection status
   * @returns {string} - Markdown formatted response
   */
  _generateGeneralResponse(query, context, docs, collectionStatus) {
    let response = `## Response to: "${query}"

`;

    if (context) {
      const fileName = path.basename(context.fileName);
      response += `I'm analyzing your code in ${fileName} (${context.language}).

`;

      // Add code context
      response += `### Current Code Context
\`\`\`${context.language}
${
  context.selectedText ||
  context.surroundingCode.split("\n").slice(0, 5).join("\n") + "\n..."
}
\`\`\`

`;
    } else {
      response +=
        "I don't see any active code file in your editor. Please open a file for more specific assistance.\n\n";
    }

    // Add documentation status
    response += `### Documentation Status
`;
    if (collectionStatus && collectionStatus.count > 0) {
      response += `I have access to ${collectionStatus.count} documentation entries to help answer your questions.

`;
    } else {
      response +=
        "I don't have any documentation loaded yet. You can refresh the documentation using the 'Refresh Docs' button.\n\n";
    }

    // Add relevant documentation if available
    if (docs && docs.length > 0) {
      response += `### Relevant Documentation

`;
      docs.forEach((doc, index) => {
        response += `#### Reference ${index + 1}
${doc.substring(0, 300)}...

`;
      });
    }

    // Add general help
    response += `### How I Can Help

- Explain code functionality and concepts
- Suggest improvements and optimizations
- Help with debugging and error fixing
- Provide code examples and best practices
- Search documentation for relevant information

Feel free to ask more specific questions about your code or project!
`;

    return response;
  }

  /**
   * Generate an improved code example based on the context
   * @param {Object} context - The context information
   * @returns {string} - Improved code example
   */
  _generateImprovedCodeExample(context) {
    if (!context || !context.surroundingCode)
      return "// No code available to improve";

    // This is a simplified example - in a real implementation, this would use AI to generate improvements
    const code =
      context.selectedText ||
      context.surroundingCode.split("\n").slice(0, 5).join("\n");

    switch (context.language) {
      case "javascript":
      case "typescript":
        // Add comments, improve variable names, add error handling
        return code
          .replace(/const (\w+)/g, "// Define variable\nconst $1")
          .replace(
            /function (\w+)/g,
            "/**\n * Function description\n * @param {type} params - Description\n * @returns {type} - Description\n */\nfunction $1"
          )
          .replace(
            /catch \(error\)/g,
            'catch (error) {\n  console.error("Error occurred:", error);\n  // Handle error appropriately'
          );

      case "html":
      case "jsx":
      case "tsx":
        // Add accessibility attributes, improve class names
        return code
          .replace(/<img/g, '<img alt="Description"')
          .replace(/class="(\w+)"/g, 'className="$1"')
          .replace(/<button/g, '<button aria-label="Button description"');

      case "css":
      case "scss":
        // Add variables, improve selectors
        return `:root {\n  --primary-color: #3366ff;\n  --secondary-color: #ff6633;\n  --spacing: 20px;\n}\n\n${code.replace(
          /margin: (\d+)px/g,
          "margin: var(--spacing)"
        )}`;

      default:
        return code + "\n// Improved with better naming and comments";
    }
  }

  /**
   * Generate JavaScript/TypeScript specific suggestions
   * @param {Object} context - The context information
   * @returns {string} - Markdown formatted suggestions
   */
  _generateJavaScriptSuggestions(context) {
    return `### JavaScript/TypeScript Suggestions

1. **Code Quality**
   - Consider using more descriptive variable names
   - Add proper error handling for asynchronous operations
   - Implement proper type checking for function parameters

2. **Performance**
   - Use memoization for expensive calculations
   - Consider using React.memo for functional components
   - Optimize array operations with appropriate methods

3. **Best Practices**
   - Break down complex functions into smaller, more manageable pieces
   - Add comprehensive comments for complex logic
   - Consider adding unit tests for critical functionality
`;
  }

  /**
   * Generate HTML/JSX/TSX specific suggestions
   * @param {Object} context - The context information
   * @returns {string} - Markdown formatted suggestions
   */
  _generateMarkupSuggestions(context) {
    return `### Markup Suggestions

1. **Accessibility**
   - Ensure all images have alt text
   - Use semantic HTML elements
   - Add ARIA attributes where appropriate
   - Ensure proper heading hierarchy (h1, h2, etc.)
   - Ensure sufficient color contrast for text

2. **Structure**
   - Consider component composition for reusable UI elements
   - Organize your JSX with proper indentation
   - Extract repeated markup into separate components
   - Implement proper error boundaries
   - Use controlled components for form elements

3. **Performance**
   - Minimize unnecessary re-renders
   - Consider code-splitting for large components
   - Use React.Fragment to avoid unnecessary DOM nodes
   - Implement React.lazy for component lazy loading
   - Use React.memo for functional components
`;
  }

  /**
   * Generate CSS/SCSS specific suggestions
   * @param {Object} context - The context information
   * @returns {string} - Markdown formatted suggestions
   */
  _generateStyleSuggestions(context) {
    return `### CSS/SCSS Suggestions

1. **Organization & Maintainability**
   - Group related styles together
   - Consider using CSS modules or styled-components
   - Use consistent naming conventions (BEM, SMACSS, etc.)
   - Implement CSS variables for theme colors, spacing, and typography
   - Break large stylesheets into smaller, more manageable files

2. **Performance & Optimization**
   - Minimize the use of expensive properties (box-shadow, filter, etc.)
   - Avoid deeply nested selectors (max 3 levels deep)
   - Use CSS Grid or Flexbox for layouts instead of float-based layouts
   - Consider using will-change for elements that will animate
   - Reduce the number of HTTP requests by combining CSS files

3. **Responsive Design & Accessibility**
   - Use relative units (em, rem, %) for better responsiveness
   - Implement media queries for different screen sizes and devices
   - Ensure sufficient color contrast for text (WCAG 2.1 AA compliance)
   - Test layouts on various screen sizes and orientations
   - Consider prefers-reduced-motion media query for animations
`;
  }

  /**
   * Generate generic code suggestions
   * @param {Object} context - The context information
   * @returns {string} - Markdown formatted suggestions
   */
  _generateGenericSuggestions(context) {
    return `### General Code Suggestions

1. **Code Quality & Readability**
   - Use consistent indentation and formatting
   - Add comments for complex logic and public APIs
   - Use descriptive variable and function names
   - Follow language-specific style guides and conventions
   - Keep functions and methods short and focused on a single task

2. **Maintainability & Architecture**
   - Break down complex functions into smaller, more manageable ones
   - Follow the DRY (Don't Repeat Yourself) principle
   - Implement appropriate design patterns for your use case
   - Use dependency injection for better testability
   - Consider implementing interfaces/contracts for better abstraction

3. **Performance & Optimization**
   - Identify and optimize performance bottlenecks
   - Use appropriate data structures for your operations
   - Consider caching for expensive operations
   - Optimize loops and recursive functions
   - Use asynchronous operations where appropriate

4. **Testing & Error Handling**
   - Add unit tests for critical functionality
   - Consider edge cases in your implementation
   - Implement comprehensive error handling
   - Add logging for debugging and monitoring
   - Consider implementing integration and end-to-end tests
`;
  }

  dispose() {
    // Clean up resources
    if (this.panel) {
      this.panel.dispose();
      this.panel = null;
    }

    // Dispose of all disposables
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}

module.exports = WebviewPanel;
