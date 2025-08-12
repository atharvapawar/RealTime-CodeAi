const vscode = require('vscode');
function activate(context) {
  console.log('RealTime AI Editor activated!');
  let disposable = vscode.commands.registerCommand(
    'realtime-ai-editor.activate', 
    () => vscode.window.showInformationMessage('AI Assistant launched!')
  );
  context.subscriptions.push(disposable);
}
module.exports = { activate };