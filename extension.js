const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const DocDiffer = require("./doc-differ");
const ContextExtractor = require("./context-extractor");
const WebviewPanel = require("./webview-panel");
const StorageManager = require("./storage-manager");
const PaywallManager = require("./paywall-manager");
const ErrorHandler = require("./error-handler");
const TelemetryService = require("./telemetry-service");

// Create data directory if it doesn't exist
const ensureDataDirectory = () => {
  const dataDir = path.join(__dirname, "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
};

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
  console.log("RealTime AI Editor activated!");

  // Ensure data directory exists
  const dataDir = ensureDataDirectory();

  // Initialize components
  const storageManager = new StorageManager(context);
  const telemetryService = new TelemetryService(context);
  const paywallManager = new PaywallManager(storageManager, telemetryService);
  const errorHandler = new ErrorHandler(telemetryService);
  const docDiffer = new DocDiffer(path.join(dataDir, "docs.json"));
  const contextExtractor = new ContextExtractor();
  // Create a status bar item
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.text = "AI: Ready";
  statusBarItem.command = "realtime-ai-editor.openAssistant";
  statusBarItem.tooltip = "Open RealTime AI Editor";
  statusBarItem.show();

  const updateStatusBar = (info) => {
    if (!info) return;
    if (info.error) {
      statusBarItem.text = "AI: Error";
      statusBarItem.tooltip = info.text || "Error refreshing docs";
      return;
    }
    if (info.isRefreshing) {
      statusBarItem.text = "AI: Refreshing…";
      statusBarItem.tooltip = info.text || "Refreshing documentation...";
    } else if (typeof info.text === "string") {
      statusBarItem.text = `AI: ${info.text}`;
      statusBarItem.tooltip = "Documentation status";
    } else {
      statusBarItem.text = "AI: Ready";
      statusBarItem.tooltip = "Open RealTime AI Editor";
    }
  };

  const webviewPanel = new WebviewPanel(
    context,
    contextExtractor,
    docDiffer,
    updateStatusBar
  );

  // Initialize collection status
  contextExtractor.getCollectionStatus().then((status) => {
    console.log(
      `ChromaDB collection status: ${status.status}, documents: ${status.count}`
    );
    if (status.count === 0) {
      // If collection is empty, initialize it with existing docs
      const docsForChroma = docDiffer.getDocsForChroma();
      if (Object.keys(docsForChroma).length > 0) {
        contextExtractor
          .updateCollection(docsForChroma)
          .then((result) =>
            console.log("Initialized ChromaDB collection:", result)
          )
          .catch((err) =>
            console.error("Failed to initialize ChromaDB collection:", err)
          );
      }
    }
  });

  // Register commands
  let openAiAssistant = vscode.commands.registerCommand(
    "realtime-ai-editor.openAssistant",
    errorHandler.createErrorBoundary(() => {
      webviewPanel.createOrShow();
      telemetryService.logFeatureUsage("open_assistant");
    }, "openAssistant")
  );

  let lookupDocs = vscode.commands.registerCommand(
    "realtime-ai-editor.lookupDocs",
    errorHandler.createErrorBoundary(async (query, type) => {
      // Open the webview panel if not already open
      webviewPanel.createOrShow();

      // Log feature usage
      telemetryService.logFeatureUsage("lookup_docs");

      // Send the documentation query to the webview panel
      if (query) {
        webviewPanel.handleDocumentationQuery(query, type);
      }
    }, "lookupDocs")
  );

  let refreshDocs = vscode.commands.registerCommand(
    "realtime-ai-editor.refreshDocs",
    errorHandler.createErrorBoundary(async () => {
      // Check if user has permission to refresh docs
      const checkResult = await paywallManager.checkAndIncrementUsage(
        "docRefresh"
      );
      if (!checkResult.allowed) {
        vscode.window.showWarningMessage(checkResult.message);
        paywallManager.showUpgradePrompt("realTimeUpdates");
        return;
      }

      // Log feature usage
      telemetryService.logFeatureUsage("refresh_docs");

      // Perform the refresh
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Refreshing documentation...",
          cancellable: false,
        },
        async (progress) => {
          try {
            // Process the documentation
            progress.report({
              increment: 0,
              message: "Starting documentation refresh...",
            });

            // Fetch and process the latest docs
            const processResult = await docDiffer.processDocs();

            if (!processResult.success) {
              throw new Error(
                processResult.error || "Failed to process documentation"
              );
            }

            progress.report({
              increment: 70,
              message: "Updating vector database...",
            });

            // Update the ChromaDB collection with the latest docs
            const docsForChroma = docDiffer.getDocsForChroma();
            const updateResult = await contextExtractor.updateCollection(
              docsForChroma
            );

            if (!updateResult.success) {
              throw new Error(
                updateResult.error || "Failed to update vector database"
              );
            }

            progress.report({ increment: 30, message: "Finalizing..." });

            // If webview is open, send the refresh result
            webviewPanel.sendRefreshResult(processResult);

            const { differences } = processResult;
            vscode.window.showInformationMessage(
              `Documentation refreshed! New: ${differences.newCount}, Updated: ${differences.updatedCount}, Removed: ${differences.removedCount}`
            );

            return processResult;
          } catch (error) {
            vscode.window.showErrorMessage(
              `Failed to refresh docs: ${error.message}`
            );
            // If webview is open, send the error
            webviewPanel.sendRefreshError(error.message);
            throw error;
          }
        }
      );

      return result;
    }, "refreshDocs")
  );

  let getContextualHelp = vscode.commands.registerCommand(
    "realtime-ai-editor.getContextualHelp",
    errorHandler.createErrorBoundary(async () => {
      // Check if user has permission to use completions
      const checkResult = await paywallManager.checkAndIncrementUsage(
        "completion"
      );
      if (!checkResult.allowed) {
        vscode.window.showWarningMessage(checkResult.message);
        paywallManager.showUpgradePrompt("projectContext");
        return;
      }

      // Get user query
      const query = await vscode.window.showInputBox({
        placeHolder: "What do you need help with?",
        prompt: "Ask about your code or Next.js/Tailwind documentation",
      });

      if (!query) return;

      // Open the webview panel if not already open
      webviewPanel.createOrShow();

      // Log feature usage
      telemetryService.logFeatureUsage("contextual_help");

      // Use optimized method to get context and docs in one call
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: "Processing your query...",
          cancellable: false,
        },
        async (progress) => {
          progress.report({
            increment: 0,
            message: "Analyzing code context...",
          });

          // Get context and relevant docs in one optimized call
          const { context, docs } = await contextExtractor.getContextAndDocs(5);

          progress.report({ increment: 50, message: "Generating response..." });

          // Send the query to the webview panel with context and docs
          webviewPanel.handleAiQuery(query, context, docs);

          progress.report({ increment: 50, message: "Done!" });
        }
      );
    }, "getContextualHelp")
  );

  // Register command to get current context
  let getCurrentContext = vscode.commands.registerCommand(
    "realtime-ai-editor.getCurrentContext",
    errorHandler.createErrorBoundary(async () => {
      const context = await contextExtractor.extractActiveEditorContext();
      if (!context) {
        vscode.window.showInformationMessage("No active editor found.");
        return;
      }

      // Open the webview panel if not already open
      webviewPanel.createOrShow();

      // Send the context to the webview
      webviewPanel.sendContextInfo(context);

      // Log feature usage
      telemetryService.logFeatureUsage("get_context");
    }, "getCurrentContext")
  );

  // Register inline code suggestion provider
  const inlineProvider = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: "**" },
    {
      provideInlineCompletionItems: async (
        document,
        position,
        context,
        token
      ) => {
        try {
          // Check if user has permission to use completions
          const checkResult = await paywallManager.checkAndIncrementUsage(
            "completion"
          );
          if (!checkResult.allowed) {
            // Don't show warning here to avoid disrupting the user
            return { items: [] };
          }

          // Log feature usage
          telemetryService.logFeatureUsage("inline_completion");

          // Get the current line text up to the cursor position
          const linePrefix = document
            .lineAt(position.line)
            .text.substring(0, position.character);

          // Skip if line is empty or just whitespace
          if (!linePrefix.trim()) {
            return { items: [] };
          }

          // Get file context
          const fileContext = {
            fileName: document.fileName,
            fileExtension: document.fileName.split(".").pop(),
            language: document.languageId,
            linePrefix,
          };

          // Get surrounding code (10 lines before and after)
          const startLine = Math.max(0, position.line - 10);
          const endLine = Math.min(document.lineCount - 1, position.line + 10);
          const contextRange = new vscode.Range(
            new vscode.Position(startLine, 0),
            new vscode.Position(endLine, document.lineAt(endLine).text.length)
          );
          const surroundingCode = document.getText(contextRange);

          // In a real implementation, this would call an AI service
          // For now, we'll generate some contextual suggestions based on the language

          let suggestions = [];

          // Generate language-specific suggestions
          switch (document.languageId) {
            case "javascript":
            case "typescript":
              if (
                linePrefix.includes("function") ||
                linePrefix.includes("=>")
              ) {
                suggestions.push("(params) => { /* implementation */ }");
              } else if (linePrefix.includes("if")) {
                suggestions.push("(condition) { /* implementation */ }");
              } else if (
                linePrefix.includes("const") ||
                linePrefix.includes("let")
              ) {
                suggestions.push(" = /* value */;");
              } else if (linePrefix.includes("import")) {
                suggestions.push(' { Component } from "react";');
              } else if (linePrefix.includes("console.")) {
                suggestions.push('log("Debug information");');
              } else {
                suggestions.push("// Add your code here");
              }
              break;

            case "html":
            case "jsx":
            case "tsx":
              if (linePrefix.includes("<div")) {
                suggestions.push(' className="container">Content</div>');
              } else if (linePrefix.includes("<")) {
                suggestions.push('div className="wrapper">Content</div>');
              } else {
                suggestions.push('<div className="container">Content</div>');
              }
              break;

            case "css":
            case "scss":
              if (linePrefix.includes("margin")) {
                suggestions.push(": 10px;");
              } else if (linePrefix.includes("padding")) {
                suggestions.push(": 15px;");
              } else if (linePrefix.includes("color")) {
                suggestions.push(": #3366ff;");
              } else if (linePrefix.includes(".")) {
                suggestions.push(" { /* styles */ }");
              } else {
                suggestions.push("property: value;");
              }
              break;

            default:
              suggestions.push("// Smart suggestion based on context");
          }

          // Create completion items
          return {
            items: suggestions.map((text) => ({
              insertText: text,
              range: new vscode.Range(position, position),
            })),
          };
        } catch (error) {
          errorHandler.handleError(error, "inlineCompletion");
          return { items: [] };
        }
      },
    }
  );

  // Register code suggestions command
  let getCodeSuggestions = vscode.commands.registerCommand(
    "realtime-ai-editor.getCodeSuggestions",
    errorHandler.createErrorBoundary(async () => {
      // Check if user has permission to use completions
      const checkResult = await paywallManager.checkAndIncrementUsage(
        "completion"
      );
      if (!checkResult.allowed) {
        vscode.window.showWarningMessage(checkResult.message);
        paywallManager.showUpgradePrompt("projectContext");
        return;
      }

      // Show progress indicator
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: "Generating code suggestions...",
          cancellable: false,
        },
        async (progress) => {
          progress.report({
            increment: 0,
            message: "Analyzing code context...",
          });

          // Use optimized method to get context and docs in one call
          const { context, docs } = await contextExtractor.getContextAndDocs(3);

          progress.report({
            increment: 70,
            message: "Generating suggestions...",
          });

          // Open the webview panel if not already open
          webviewPanel.createOrShow();

          // Send code suggestions to the webview
          webviewPanel.sendCodeSuggestions(context, docs);

          progress.report({ increment: 30, message: "Done!" });
        }
      );

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage("No active editor found.");
        return;
      }

      // Get context from the current file
      const context = await contextExtractor.extractActiveEditorContext();

      // Open the webview panel if not already open
      webviewPanel.createOrShow();

      // Send code suggestions request to the webview
      webviewPanel.sendCodeSuggestions(context);

      // Log feature usage
      telemetryService.logFeatureUsage("code_suggestions");
    }, "getCodeSuggestions")
  );

  // Register search docs command
  let searchDocs = vscode.commands.registerCommand(
    "realtime-ai-editor.searchDocs",
    errorHandler.createErrorBoundary(async () => {
      // Get user query
      const query = await vscode.window.showInputBox({
        placeHolder: "Search documentation",
        prompt:
          "Enter keywords to search in Next.js and Tailwind documentation",
      });

      if (!query) return;

      // Open the webview panel if not already open
      webviewPanel.createOrShow();

      // Find relevant docs
      const relevantDocs = await contextExtractor.findRelevantDocs(
        { surroundingCode: query },
        5
      );

      // Send the search results to the webview
      webviewPanel.sendDocsSearchResults(query, relevantDocs);

      // Log feature usage
      telemetryService.logFeatureUsage("search_docs");
    }, "searchDocs")
  );

  // Register settings command
  let openSettings = vscode.commands.registerCommand(
    "realtime-ai-editor.openSettings",
    errorHandler.createErrorBoundary(async () => {
      // Open the webview panel if not already open
      webviewPanel.createOrShow();

      // Send command to show settings page
      webviewPanel.showSettingsPage();

      // Log feature usage
      telemetryService.logFeatureUsage("open_settings");
    }, "openSettings")
  );

  // First-run telemetry opt-in prompt
  const telemetryKey = "realtimeAiEditor.telemetryOptInShown";
  const alreadyShown = context.globalState.get(telemetryKey, false);
  const config = vscode.workspace.getConfiguration("realtimeAiEditor");
  if (!alreadyShown) {
    const choice = await vscode.window.showInformationMessage(
      "Help improve RealTime AI Editor by allowing anonymous telemetry (feature usage and errors)?",
      "Enable",
      "Disable"
    );
    if (choice === "Enable") {
      await config.update(
        "telemetryEnabled",
        true,
        vscode.ConfigurationTarget.Global
      );
    } else if (choice === "Disable") {
      await config.update(
        "telemetryEnabled",
        false,
        vscode.ConfigurationTarget.Global
      );
    }
    await context.globalState.update(telemetryKey, true);
  }

  // Add all disposables to context
  context.subscriptions.push(
    statusBarItem,
    openAiAssistant,
    lookupDocs,
    refreshDocs,
    getContextualHelp,
    getCurrentContext,
    getCodeSuggestions,
    searchDocs,
    inlineProvider,
    webviewPanel
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
