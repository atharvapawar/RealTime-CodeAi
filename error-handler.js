const vscode = require('vscode');

class ErrorHandler {
  constructor(telemetryService) {
    this.telemetryService = telemetryService;
  }

  async handleError(error, context) {
    console.error(`Error in ${context}:`, error);
    
    // Log error for telemetry if user has opted in
    if (this.telemetryService && this.telemetryService.isEnabled()) {
      await this.telemetryService.logError(error, context);
    }
    
    // Determine user-friendly message
    let userMessage = 'An error occurred. Please try again.';
    
    if (error.code === 'NETWORK_ERROR') {
      userMessage = 'Network error. Please check your connection and try again.';
    } else if (error.code === 'API_LIMIT_EXCEEDED') {
      userMessage = 'You\'ve reached your API usage limit. Please try again later or upgrade your plan.';
    } else if (error.code === 'INVALID_DOCUMENT') {
      userMessage = 'The document format is not supported. Please try with a different file.';
    }
    
    return {
      userMessage,
      shouldRetry: ['NETWORK_ERROR', 'TEMPORARY_FAILURE'].includes(error.code),
      isFatal: ['CRITICAL_ERROR', 'EXTENSION_FAILURE'].includes(error.code)
    };
  }

  createErrorBoundary(fn, context) {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        const { userMessage, shouldRetry, isFatal } = await this.handleError(error, context);
        
        if (isFatal) {
          vscode.window.showErrorMessage(`${userMessage} The extension needs to be reloaded.`);
          // Offer to reload the window
          const reload = 'Reload Window';
          const choice = await vscode.window.showWarningMessage(userMessage, reload);
          if (choice === reload) {
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
        } else {
          vscode.window.showErrorMessage(userMessage);
          
          if (shouldRetry) {
            const retry = 'Retry';
            const choice = await vscode.window.showWarningMessage(userMessage, retry);
            if (choice === retry) {
              return this.createErrorBoundary(fn, context)(...args);
            }
          }
        }
        
        return null;
      }
    };
  }
}

module.exports = ErrorHandler;