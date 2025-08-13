const vscode = require('vscode');

class PaywallManager {
  constructor(storageManager, telemetryService) {
    this.storageManager = storageManager;
    this.telemetryService = telemetryService;
    this.usageQuotas = {
      free: {
        completionsPerDay: 50,
        docRefreshesPerDay: 1,
        contextDepth: 'file' // 'file', 'project', or 'workspace'
      },
      pro: {
        completionsPerDay: Infinity,
        docRefreshesPerDay: 24, // hourly
        contextDepth: 'project'
      },
      team: {
        completionsPerDay: Infinity,
        docRefreshesPerDay: 24,
        contextDepth: 'workspace'
      }
    };
  }

  async checkAndIncrementUsage(feature) {
    const userPlan = await this.storageManager.getUserPlan();
    const dailyUsage = await this.storageManager.getDailyUsage();
    
    // Check if user has exceeded their quota
    if (feature === 'completion') {
      if (dailyUsage.completions >= this.usageQuotas[userPlan].completionsPerDay) {
        return {
          allowed: false,
          message: 'You\'ve reached your daily AI completions limit. Upgrade to Pro for unlimited completions!'
        };
      }
      
      // Increment usage
      await this.storageManager.incrementDailyUsage('completions');
    } else if (feature === 'docRefresh') {
      if (dailyUsage.docRefreshes >= this.usageQuotas[userPlan].docRefreshesPerDay) {
        return {
          allowed: false,
          message: 'You\'ve reached your daily documentation refresh limit. Upgrade to Pro for real-time updates!'
        };
      }
      
      // Increment usage
      await this.storageManager.incrementDailyUsage('docRefreshes');
    } else if (feature === 'contextDepth') {
      if (this.usageQuotas[userPlan].contextDepth === 'file' && (dailyUsage.contextDepth === 'project' || dailyUsage.contextDepth === 'workspace')) {
        return {
          allowed: false,
          message: 'Project-wide context is a Pro feature. Upgrade to access more context!'
        };
      }
    }
    
    return { allowed: true };
  }

  getUpgradeMessage(feature) {
    const messages = {
      realTimeUpdates: 'Upgrade to Pro for real-time documentation updates!',
      projectContext: 'Upgrade to Pro for project-wide context awareness!',
      teamSharing: 'Upgrade to Team plan to share custom documentation with your team!'
    };
    
    return messages[feature] || 'Upgrade to unlock more features!';
  }

  showUpgradePrompt(feature) {
    const message = this.getUpgradeMessage(feature);
    
    // Log that upgrade prompt was shown
    if (this.telemetryService) {
      this.telemetryService.logUpgradePromptShown(feature);
    }
    
    return vscode.window.showInformationMessage(
      message,
      'Upgrade Now',
      'Maybe Later'
    ).then(selection => {
      if (selection === 'Upgrade Now') {
        // Log that user clicked upgrade
        if (this.telemetryService) {
          this.telemetryService.logUpgradePromptClicked();
        }
        
        vscode.env.openExternal(vscode.Uri.parse('https://marketplace.visualstudio.com/items?itemName=AtharvPawar.realtime-ai-editor'));
      }
      return selection === 'Upgrade Now';
    });
  }
}

module.exports = PaywallManager;