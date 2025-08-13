const vscode = require('vscode');
const { ChromaClient, EmbeddingFunction } = require('chromadb');
const path = require('path');
const fs = require('fs');

class ContextExtractor {
  constructor() {
    this.client = new ChromaClient();
    this.collection = null;
    this.cache = {
      relevantDocs: new Map(), // Cache for query results
      contextQueries: new Map(), // Cache for context extraction
      lastUpdated: null
    };
    this.initializeCollection();
  }

  async initializeCollection() {
    try {
      try {
        this.collection = await this.client.getCollection('nextjs_docs');
      } catch (error) {
        // If collection doesn't exist, create it
        this.collection = await this.client.createCollection({
          name: 'nextjs_docs',
          metadata: { description: 'Next.js documentation for RealTime CodeAi' }
        });
      }
    } catch (error) {
      console.error('Failed to initialize collection:', error);
    }
  }

  async extractActiveEditorContext() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;

    const document = editor.document;
    const fileName = document.fileName;
    const selection = editor.selection;
    
    // Create a cache key based on file path, selection, and document version
    const cacheKey = `${fileName}:${selection.start.line},${selection.start.character}-${selection.end.line},${selection.end.character}:${document.version}`;
    
    // Check if we have a cached result
    if (this.cache.contextQueries.has(cacheKey)) {
      return this.cache.contextQueries.get(cacheKey);
    }
    
    // If not in cache, extract the context
    const text = document.getText();
    const fileExtension = fileName.split('.').pop();
    const selectedText = document.getText(selection);

    // Get surrounding code context (10 lines before and after selection)
    const startLine = Math.max(0, selection.start.line - 10);
    const endLine = Math.min(document.lineCount - 1, selection.end.line + 10);
    const contextRange = new vscode.Range(
      new vscode.Position(startLine, 0),
      new vscode.Position(endLine, document.lineAt(endLine).text.length)
    );
    const surroundingCode = document.getText(contextRange);

    const result = {
      fileName,
      fileExtension,
      selectedText,
      surroundingCode,
      fullText: text,
      language: document.languageId
    };
    
    // Store in cache (limit cache size to prevent memory issues)
    if (this.cache.contextQueries.size > 50) {
      // Remove oldest entry if cache is too large
      const oldestKey = this.cache.contextQueries.keys().next().value;
      this.cache.contextQueries.delete(oldestKey);
    }
    this.cache.contextQueries.set(cacheKey, result);
    
    return result;
  }

  async findRelevantDocs(context, maxResults = 5) {
    if (!this.collection) await this.initializeCollection();
    if (!this.collection) return [];

    // Create a query from the context
    const query = context.selectedText || context.surroundingCode.substring(0, 500);
    
    // Create a cache key
    const cacheKey = `${query.substring(0, 100)}:${maxResults}`;
    
    // Check if we have a cached result that's not too old (5 minutes)
    const now = Date.now();
    if (this.cache.relevantDocs.has(cacheKey) && 
        this.cache.lastUpdated && 
        (now - this.cache.lastUpdated < 5 * 60 * 1000)) {
      return this.cache.relevantDocs.get(cacheKey);
    }
    
    try {
      // Query the vector database
      const results = await this.collection.query({
        queryTexts: [query],
        nResults: maxResults
      });
      
      const documents = results.documents[0] || [];
      
      // Store in cache (limit cache size)
      if (this.cache.relevantDocs.size > 30) {
        // Remove oldest entry
        const oldestKey = this.cache.relevantDocs.keys().next().value;
        this.cache.relevantDocs.delete(oldestKey);
      }
      this.cache.relevantDocs.set(cacheKey, documents);
      
      return documents;
    } catch (error) {
      console.error('Error querying vector database:', error);
      // If there's an error, return cached result if available, otherwise empty array
      return this.cache.relevantDocs.get(cacheKey) || [];
    }
  }

  async buildPrompt(userQuery) {
    const context = await this.extractActiveEditorContext();
    const relevantDocs = await this.findRelevantDocs(context);

    // Trae-style multi-step validation approach
    return {
      systemPrompt: `You are an AI assistant helping with coding in ${context.language}. ` +
                   `Analyze the following context and documentation before responding.`,
      contextBlocks: [
        { type: 'code', content: context.surroundingCode, language: context.language },
        { type: 'documentation', content: relevantDocs.join('\n\n') }
      ],
      userQuery,
      validationSteps: [
        'Understand the user query and code context',
        'Identify relevant documentation',
        'Plan the implementation approach',
        'Generate or modify code',
        'Validate the solution'
      ]
    };
  }
}

  /**
   * Updates the ChromaDB collection with new documentation
   * @param {Object} docsData - The documentation data to update
   * @returns {Promise<Object>} - Result of the update operation
   */
  async updateCollection(docsData) {
    if (!this.collection) await this.initializeCollection();
    if (!this.collection) return { success: false, error: 'Collection not initialized' };
    
    try {
      // First, clear the existing collection
      await this.collection.delete();
      
      // Recreate the collection
      await this.initializeCollection();
      
      // Clear all caches when collection is updated
      this.cache.relevantDocs.clear();
      this.cache.contextQueries.clear();
      this.cache.lastUpdated = Date.now();
      
      // Prepare documents for embedding
      const documents = [];
      const metadatas = [];
      const ids = [];
      
      // Process each document in batches to prevent memory issues
      const batchSize = 100;
      const entries = Object.entries(docsData);
      
      for (let i = 0; i < entries.length; i += batchSize) {
        const batch = entries.slice(i, i + batchSize);
        
        const batchDocuments = [];
        const batchMetadatas = [];
        const batchIds = [];
        
        batch.forEach(([title, content], batchIndex) => {
          const index = i + batchIndex;
          batchDocuments.push(content);
          batchMetadatas.push({ 
            title, 
            source: 'nextjs_docs',
            updated_at: new Date().toISOString() 
          });
          batchIds.push(`doc_${index}`);
        });
        
        // Add batch to collection
        if (batchDocuments.length > 0) {
          await this.collection.add({
            ids: batchIds,
            documents: batchDocuments,
            metadatas: batchMetadatas
          });
        }
        
        // Add to total counts
        documents.push(...batchDocuments);
        ids.push(...batchIds);
        metadatas.push(...batchMetadatas);
      }
      
      return { 
        success: true, 
        count: documents.length,
        message: `Updated collection with ${documents.length} documents`
      };
    } catch (error) {
      console.error('Error updating collection:', error);
      return { 
        success: false, 
        error: error.message || 'Unknown error updating collection'
      };
    }
  }
  
  /**
   * Gets the current status of the ChromaDB collection
   * @returns {Promise<Object>} - Collection status
   */
  async getCollectionStatus() {
    if (!this.collection) await this.initializeCollection();
    if (!this.collection) return { count: 0, status: 'not_initialized' };
    
    try {
      const count = await this.collection.count();
      return {
        count,
        status: count > 0 ? 'ready' : 'empty',
        cacheStatus: {
          docsCache: this.cache.relevantDocs.size,
          contextCache: this.cache.contextQueries.size,
          lastUpdated: this.cache.lastUpdated
        }
      };
    } catch (error) {
      return { count: 0, status: 'error', error: error.message };
    }
  }
  
  /**
   * Optimized method to get context and relevant docs in one call
   * @param {number} maxResults - Maximum number of relevant docs to return
   * @returns {Promise<Object>} - Context and relevant docs
   */
  async getContextAndDocs(maxResults = 5) {
    const context = await this.extractActiveEditorContext();
    if (!context) return { context: null, docs: [] };
    
    // Create a combined cache key
    const query = context.selectedText || context.surroundingCode.substring(0, 500);
    const cacheKey = `combined:${query.substring(0, 100)}:${maxResults}`;
    
    // Check if we have a cached result that's not too old (5 minutes)
    const now = Date.now();
    if (this.cache.relevantDocs.has(cacheKey) && 
        this.cache.lastUpdated && 
        (now - this.cache.lastUpdated < 5 * 60 * 1000)) {
      return this.cache.relevantDocs.get(cacheKey);
    }
    
    // Get relevant docs
    const docs = await this.findRelevantDocs(context, maxResults);
    
    // Create combined result
    const result = { context, docs };
    
    // Cache the combined result
    if (this.cache.relevantDocs.size > 30) {
      const oldestKey = this.cache.relevantDocs.keys().next().value;
      this.cache.relevantDocs.delete(oldestKey);
    }
    this.cache.relevantDocs.set(cacheKey, result);
    
    return result;
  }
}

module.exports = ContextExtractor;