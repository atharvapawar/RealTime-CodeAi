// RealTime AI Editor - Main JavaScript

(function() {
  // Initialize VS Code API
  const vscode = acquireVsCodeApi();
  
  // Store state
  let state = {
    messages: [],
    isProcessing: false,
    docStatus: 'Up to date'
  };
  
  // Try to get state from storage
  const previousState = vscode.getState();
  if (previousState) {
    state = previousState;
  }
  
  // DOM Elements
  const chatContainer = document.getElementById('chat-container');
  const userInput = document.getElementById('user-input');
  const sendButton = document.getElementById('send-button');
  const clearInputButton = document.getElementById('clear-input');
  const refreshDocsButton = document.getElementById('refresh-docs');
  const docStatus = document.getElementById('doc-status');
  const docStatusIndicator = document.getElementById('doc-status-indicator');
  const clearChatButton = document.getElementById('clear-chat');
  const getContextButton = document.getElementById('get-context');
  const codeSuggestionsButton = document.getElementById('code-suggestions');
  const docsSearchButton = document.getElementById('docs-search');
  const settingsButton = document.getElementById('settings-button');
  
  // Auto-resize textarea
  userInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
    // Limit max height
    if (this.scrollHeight > 120) {
      this.style.overflowY = 'auto';
    } else {
      this.style.overflowY = 'hidden';
    }
  });
  
  // Handle sending messages
  function sendMessage() {
    const text = userInput.value.trim();
    if (text && !state.isProcessing) {
      state.isProcessing = true;
      
      // Add user message to state
      state.messages.push({
        role: 'user',
        content: text
      });
      
      // Update VS Code state
      vscode.setState(state);
      
      // Add user message to chat
      const messageDiv = document.createElement('div');
      messageDiv.className = 'message user-message';
      
      const contentDiv = document.createElement('div');
      contentDiv.className = 'message-content';
      contentDiv.textContent = text;
      messageDiv.appendChild(contentDiv);
      
      chatContainer.appendChild(messageDiv);
      
      // Add typing indicator
      const typingDiv = document.createElement('div');
      typingDiv.className = 'message ai-message typing-indicator';
      typingDiv.innerHTML = 'Thinking<span></span><span></span><span></span>';
      chatContainer.appendChild(typingDiv);
      
      // Clear input and reset height
      userInput.value = '';
      userInput.style.height = 'auto';
      
      // Scroll to bottom
      chatContainer.scrollTop = chatContainer.scrollHeight;
      
      // Send message to extension
      vscode.postMessage({
        command: 'askAi',
        text: text
      });
      
      // Disable send button while processing
      sendButton.disabled = true;
    }
  }
  
  // Clear chat history
  function clearChat() {
    // Keep only the welcome message
    while (chatContainer.childNodes.length > 1) {
      chatContainer.removeChild(chatContainer.lastChild);
    }
    
    // Clear state
    state.messages = [];
    vscode.setState(state);
  }
  
  // Get current context
  function getContext() {
    if (!state.isProcessing) {
      state.isProcessing = true;
      
      const contextQuery = 'Analyze my current code context and provide suggestions.';
      
      // Add to state
      state.messages.push({
        role: 'user',
        content: contextQuery
      });
      
      // Update VS Code state
      vscode.setState(state);
      
      // Add user message to chat
      const messageDiv = document.createElement('div');
      messageDiv.className = 'message user-message';
      
      const contentDiv = document.createElement('div');
      contentDiv.className = 'message-content';
      contentDiv.textContent = contextQuery;
      messageDiv.appendChild(contentDiv);
      
      chatContainer.appendChild(messageDiv);
      
      // Add typing indicator
      const typingDiv = document.createElement('div');
      typingDiv.className = 'message ai-message typing-indicator';
      typingDiv.innerHTML = 'Thinking<span></span><span></span><span></span>';
      chatContainer.appendChild(typingDiv);
      
      // Scroll to bottom
      chatContainer.scrollTop = chatContainer.scrollHeight;
      
      // Send message to extension
      vscode.postMessage({
        command: 'askAi',
        text: contextQuery
      });
      
      // Disable buttons while processing
      sendButton.disabled = true;
      getContextButton.disabled = true;
      codeSuggestionsButton.disabled = true;
      docsSearchButton.disabled = true;
    }
  }
  
  // Get code suggestions
  function getCodeSuggestions() {
    if (!state.isProcessing) {
      state.isProcessing = true;
      
      const suggestionsQuery = 'Suggest improvements for my current code.';
      
      // Add to state
      state.messages.push({
        role: 'user',
        content: suggestionsQuery
      });
      
      // Update VS Code state
      vscode.setState(state);
      
      // Add user message to chat
      const messageDiv = document.createElement('div');
      messageDiv.className = 'message user-message';
      
      const contentDiv = document.createElement('div');
      contentDiv.className = 'message-content';
      contentDiv.textContent = suggestionsQuery;
      messageDiv.appendChild(contentDiv);
      
      chatContainer.appendChild(messageDiv);
      
      // Add typing indicator
      const typingDiv = document.createElement('div');
      typingDiv.className = 'message ai-message typing-indicator';
      typingDiv.innerHTML = 'Thinking<span></span><span></span><span></span>';
      chatContainer.appendChild(typingDiv);
      
      // Scroll to bottom
      chatContainer.scrollTop = chatContainer.scrollHeight;
      
      // Send message to extension
      vscode.postMessage({
        command: 'askAi',
        text: suggestionsQuery
      });
      
      // Disable buttons while processing
      sendButton.disabled = true;
      getContextButton.disabled = true;
      codeSuggestionsButton.disabled = true;
      docsSearchButton.disabled = true;
    }
  }
  
  // Search docs
  function searchDocs() {
    if (!state.isProcessing) {
      // Prompt user for search term
      const searchTerm = prompt('What would you like to search for in the documentation?');
      if (searchTerm) {
        state.isProcessing = true;
        
        const searchQuery = `Search the documentation for: ${searchTerm}`;
        
        // Add to state
        state.messages.push({
          role: 'user',
          content: searchQuery
        });
        
        // Update VS Code state
        vscode.setState(state);
        
        // Add user message to chat
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message user-message';
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.textContent = searchQuery;
        messageDiv.appendChild(contentDiv);
        
        chatContainer.appendChild(messageDiv);
        
        // Add typing indicator
        const typingDiv = document.createElement('div');
        typingDiv.className = 'message ai-message typing-indicator';
        typingDiv.innerHTML = 'Thinking<span></span><span></span><span></span>';
        chatContainer.appendChild(typingDiv);
        
        // Scroll to bottom
        chatContainer.scrollTop = chatContainer.scrollHeight;
        
        // Send message to extension
        vscode.postMessage({
          command: 'askAi',
          text: searchQuery
        });
        
        // Disable buttons while processing
        sendButton.disabled = true;
        getContextButton.disabled = true;
        codeSuggestionsButton.disabled = true;
        docsSearchButton.disabled = true;
      }
    }
  }
  
  // Show settings page
  function showSettingsPage(settings) {
    // Clear chat container
    while (chatContainer.firstChild) {
      chatContainer.removeChild(chatContainer.firstChild);
    }
    
    // Create settings container
    const settingsContainer = document.createElement('div');
    settingsContainer.className = 'settings-container';
    
    // Add settings header
    const settingsHeader = document.createElement('h2');
    settingsHeader.textContent = 'RealTime AI Editor Settings';
    settingsContainer.appendChild(settingsHeader);
    
    // Add telemetry setting
    const telemetryContainer = document.createElement('div');
    telemetryContainer.className = 'setting-item';
    
    const telemetryLabel = document.createElement('label');
    telemetryLabel.htmlFor = 'telemetry-enabled';
    telemetryLabel.textContent = 'Enable Telemetry';
    
    const telemetryCheckbox = document.createElement('input');
    telemetryCheckbox.type = 'checkbox';
    telemetryCheckbox.id = 'telemetry-enabled';
    telemetryCheckbox.checked = settings.telemetryEnabled;
    
    telemetryContainer.appendChild(telemetryLabel);
    telemetryContainer.appendChild(telemetryCheckbox);
    
    // Add context depth setting
    const contextContainer = document.createElement('div');
    contextContainer.className = 'setting-item';
    
    const contextLabel = document.createElement('label');
    contextLabel.htmlFor = 'context-depth';
    contextLabel.textContent = 'Context Depth';
    
    const contextSelect = document.createElement('select');
    contextSelect.id = 'context-depth';
    
    const fileOption = document.createElement('option');
    fileOption.value = 'file';
    fileOption.textContent = 'File';
    
    const projectOption = document.createElement('option');
    projectOption.value = 'project';
    projectOption.textContent = 'Project';
    
    const workspaceOption = document.createElement('option');
    workspaceOption.value = 'workspace';
    workspaceOption.textContent = 'Workspace';
    
    contextSelect.appendChild(fileOption);
    contextSelect.appendChild(projectOption);
    contextSelect.appendChild(workspaceOption);
    
    contextSelect.value = settings.contextDepth;
    
    contextContainer.appendChild(contextLabel);
    contextContainer.appendChild(contextSelect);
    
    // Add save button
    const saveButton = document.createElement('button');
    saveButton.className = 'settings-save-button';
    saveButton.textContent = 'Save Settings';
    saveButton.addEventListener('click', () => {
      // Save settings
      vscode.postMessage({
        command: 'saveSettings',
        settings: {
          telemetryEnabled: telemetryCheckbox.checked,
          contextDepth: contextSelect.value
        }
      });
      
      // Show confirmation message
      const confirmationMessage = document.createElement('div');
      confirmationMessage.className = 'settings-confirmation';
      confirmationMessage.textContent = 'Settings saved successfully!';
      settingsContainer.appendChild(confirmationMessage);
      
      // Remove confirmation message after 3 seconds
      setTimeout(() => {
        settingsContainer.removeChild(confirmationMessage);
      }, 3000);
    });
    
    // Add back button
    const backButton = document.createElement('button');
    backButton.className = 'settings-back-button';
    backButton.textContent = 'Back to Chat';
    backButton.addEventListener('click', () => {
      // Remove settings container
      chatContainer.removeChild(settingsContainer);
      
      // Restore chat messages
      restoreMessages();
    });
    
    // Add buttons to container
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'settings-button-container';
    buttonContainer.appendChild(saveButton);
    buttonContainer.appendChild(backButton);
    
    // Add all elements to settings container
    settingsContainer.appendChild(telemetryContainer);
    settingsContainer.appendChild(contextContainer);
    settingsContainer.appendChild(buttonContainer);
    
    // Add settings container to chat container
    chatContainer.appendChild(settingsContainer);
  }
  
  // Restore chat messages
  function restoreMessages() {
    // Clear chat container
    while (chatContainer.firstChild) {
      chatContainer.removeChild(chatContainer.firstChild);
    }
    
    // Add welcome message
    const welcomeDiv = document.createElement('div');
    welcomeDiv.className = 'message ai-message';
    
    const welcomeContent = document.createElement('div');
    welcomeContent.className = 'message-content';
    welcomeContent.innerHTML = marked.parse('## Welcome to RealTime AI Editor\n\nI can help you with your code and documentation. Ask me anything!');
    
    welcomeDiv.appendChild(welcomeContent);
    chatContainer.appendChild(welcomeDiv);
    
    // Add stored messages
    state.messages.forEach(message => {
      const messageDiv = document.createElement('div');
      messageDiv.className = `message ${message.role === 'user' ? 'user-message' : 'ai-message'}`;
      
      const contentDiv = document.createElement('div');
      contentDiv.className = 'message-content';
      
      if (message.role === 'assistant') {
        contentDiv.innerHTML = marked.parse(message.content);
        contentDiv.className += ' markdown-body';
        
        // Apply syntax highlighting to code blocks
        contentDiv.querySelectorAll('pre code').forEach((block) => {
          hljs.highlightElement(block);
        });
      } else {
        contentDiv.textContent = message.content;
      }
      
      messageDiv.appendChild(contentDiv);
      chatContainer.appendChild(messageDiv);
    });
    
    // Scroll to bottom
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
  
  // Event listeners
  sendButton.addEventListener('click', sendMessage);
  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  
  clearInputButton.addEventListener('click', () => {
    userInput.value = '';
    userInput.style.height = 'auto';
    userInput.focus();
  });
  
  refreshDocsButton.addEventListener('click', () => {
    vscode.postMessage({
      command: 'refreshDocs'
    });
    
    // Update UI immediately
    docStatusIndicator.classList.add('doc-status-refreshing');
    docStatus.textContent = 'Documentation: Refreshing...';
    refreshDocsButton.disabled = true;
  });
  
  clearChatButton.addEventListener('click', clearChat);
  getContextButton.addEventListener('click', getContext);
  codeSuggestionsButton.addEventListener('click', getCodeSuggestions);
  docsSearchButton.addEventListener('click', searchDocs);
  settingsButton.addEventListener('click', () => {
    vscode.postMessage({ command: 'openSettings' });
  });
  
  // Handle messages from the extension
  window.addEventListener('message', event => {
    const message = event.data;
    
    switch (message.command) {
      case 'aiResponse':
        // Remove typing indicator if present
        const typingIndicators = document.getElementsByClassName('typing-indicator');
        if (typingIndicators.length > 0) {
          chatContainer.removeChild(typingIndicators[0]);
        }
        
        // Add AI response to state
        if (message.status === 'complete' || message.status === 'info') {
          state.messages.push({
            role: 'assistant',
            content: message.text
          });
          
          // Update VS Code state
          vscode.setState(state);
        }
        
        // Add AI response to chat
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message ai-message';
        
        const contentDiv = document.createElement('div');
        
        if (message.status === 'error') {
          contentDiv.className = 'message-error';
          contentDiv.textContent = message.text;
        } else if (message.status === 'info') {
          contentDiv.className = 'message-info';
          contentDiv.textContent = message.text;
        } else {
          contentDiv.className = 'message-content markdown-body';
          
          // Process markdown if needed
          if (message.isMarkdown) {
            // Use marked.js to render markdown
            contentDiv.innerHTML = marked.parse(message.text);
            
            // Apply syntax highlighting to code blocks
            document.querySelectorAll('pre code').forEach((block) => {
              hljs.highlightElement(block);
            });
          } else {
            contentDiv.textContent = message.text;
          }
        }
        
        messageDiv.appendChild(contentDiv);
        chatContainer.appendChild(messageDiv);
        
        // Scroll to bottom
        chatContainer.scrollTop = chatContainer.scrollHeight;
        
        // Reset processing state
        state.isProcessing = false;
        
        // Re-enable buttons
        sendButton.disabled = false;
        getContextButton.disabled = false;
        codeSuggestionsButton.disabled = false;
        docsSearchButton.disabled = false;
        break;
        
      case 'showSettings':
        // Show settings page
        showSettingsPage(message.settings);
        break;
        
      case 'settingsSaved':
        // Settings were saved successfully
        // This is handled by the save button click handler in showSettingsPage
        // but we could add additional feedback here if needed
        break;
        
      case 'refreshStatus':
        docStatus.textContent = 'Documentation: ' + message.status;
        refreshDocsButton.disabled = message.isRefreshing;
        
        // Update state
        state.docStatus = message.status;
        vscode.setState(state);
        
        if (message.isRefreshing) {
          docStatusIndicator.classList.add('doc-status-refreshing');
        } else {
          docStatusIndicator.classList.remove('doc-status-refreshing');
        }
        break;
    }
  });
  
  // Restore chat history from state
  function restoreChat() {
    // Clear existing chat except welcome message
    while (chatContainer.childNodes.length > 1) {
      chatContainer.removeChild(chatContainer.lastChild);
    }
    
    // Restore messages
    if (state.messages && state.messages.length > 0) {
      state.messages.forEach(msg => {
        const messageDiv = document.createElement('div');
        messageDiv.className = msg.role === 'user' ? 'message user-message' : 'message ai-message';
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        
        if (msg.role === 'assistant') {
          contentDiv.className += ' markdown-body';
          contentDiv.innerHTML = marked.parse(msg.content);
          
          // Apply syntax highlighting to code blocks
          setTimeout(() => {
            messageDiv.querySelectorAll('pre code').forEach((block) => {
              hljs.highlightElement(block);
            });
          }, 0);
        } else {
          contentDiv.textContent = msg.content;
        }
        
        messageDiv.appendChild(contentDiv);
        chatContainer.appendChild(messageDiv);
      });
      
      // Scroll to bottom
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  }
  
  // Initialize
  function init() {
    // Restore chat if there's history
    if (state.messages && state.messages.length > 0) {
      restoreChat();
    }
    
    // Update doc status
    if (state.docStatus) {
      docStatus.textContent = 'Documentation: ' + state.docStatus;
    }
    
    // Focus input on load
    userInput.focus();
  }
  
  // Run initialization
  init();
}());