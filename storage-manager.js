const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

class StorageManager {
  constructor(context) {
    this.context = context;
    this.globalState = context.globalState;
    this.extensionPath = context.extensionPath;
    this.userDataPath = path.join(this.extensionPath, 'user-data.json');
    this.initializeStorage();
  }

  initializeStorage() {
    try {
      if (!fs.existsSync(this.userDataPath)) {
        const initialData = {
          plan: 'free',
          usage: {
            lastResetDate: new Date().toISOString().split('T')[0],
            completions: 0,
            docRefreshes: 0,
            contextDepth: 'file'
          }
        };
        fs.writeFileSync(this.userDataPath, JSON.stringify(initialData, null, 2));
      }
    } catch (error) {
      console.error('Failed to initialize storage:', error);
    }
  }

  async getUserData() {
    try {
      const data = fs.readFileSync(this.userDataPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Failed to read user data:', error);
      return {
        plan: 'free',
        usage: {
          lastResetDate: new Date().toISOString().split('T')[0],
          completions: 0,
          docRefreshes: 0,
          contextDepth: 'file'
        }
      };
    }
  }

  async saveUserData(userData) {
    try {
      fs.writeFileSync(this.userDataPath, JSON.stringify(userData, null, 2));
    } catch (error) {
      console.error('Failed to save user data:', error);
    }
  }

  async getUserPlan() {
    const userData = await this.getUserData();
    return userData.plan;
  }

  async setUserPlan(plan) {
    const userData = await this.getUserData();
    userData.plan = plan;
    await this.saveUserData(userData);
  }

  async getDailyUsage() {
    const userData = await this.getUserData();
    const today = new Date().toISOString().split('T')[0];
    
    // Reset usage if it's a new day
    if (userData.usage.lastResetDate !== today) {
      userData.usage = {
        lastResetDate: today,
        completions: 0,
        docRefreshes: 0,
        contextDepth: userData.usage.contextDepth
      };
      await this.saveUserData(userData);
    }
    
    return userData.usage;
  }

  async incrementDailyUsage(feature) {
    const userData = await this.getUserData();
    const usage = await this.getDailyUsage();
    
    if (feature === 'completions') {
      usage.completions += 1;
    } else if (feature === 'docRefreshes') {
      usage.docRefreshes += 1;
    }
    
    userData.usage = usage;
    await this.saveUserData(userData);
    
    return usage;
  }

  async setContextDepth(depth) {
    const userData = await this.getUserData();
    userData.usage.contextDepth = depth;
    await this.saveUserData(userData);
  }
}

module.exports = StorageManager;