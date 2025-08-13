const vscode = require("vscode");

class TelemetryService {
  constructor(context) {
    this.context = context;
    this.telemetryEnabled = this.getTelemetrySettings();
  }

  getTelemetrySettings() {
    // Check extension's telemetry settings
    const config = vscode.workspace.getConfiguration("realtimeAiEditor");
    return config.get("telemetryEnabled", true);
  }

  isEnabled() {
    // Refresh the setting each time to ensure we have the latest value
    this.telemetryEnabled = this.getTelemetrySettings();
    return this.telemetryEnabled;
  }

  async logError(error, context) {
    if (!this.isEnabled()) return;

    // In a real implementation, this would send the error to a telemetry service
    // For now, we'll just log it to the console
    console.error(`[Telemetry] Error in ${context}:`, {
      message: error.message,
      stack: error.stack,
      code: error.code || "UNKNOWN_ERROR",
      timestamp: new Date().toISOString(),
    });
  }

  async logEvent(eventName, properties = {}) {
    if (!this.isEnabled()) return;

    // In a real implementation, this would send the event to a telemetry service
    // For now, we'll just log it to the console
    console.log(`[Telemetry] Event: ${eventName}`, properties);
  }

  async logFeatureUsage(featureName, properties = {}) {
    return this.logEvent("feature_used", {
      feature: featureName,
      ...properties,
    });
  }

  async logUpgradePromptShown(feature) {
    return this.logEvent("upgrade_prompt_shown", { feature });
  }

  async logUpgradePromptClicked() {
    return this.logEvent("upgrade_prompt_clicked");
  }
}

module.exports = TelemetryService;
