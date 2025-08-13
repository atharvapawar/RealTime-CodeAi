const axios = require('axios');
const cheerio = require('cheerio');

class DocumentationService {
  constructor() {
    this.cache = {};
    this.cacheTTL = 3600000; // 1 hour in milliseconds
    this.pendingRequests = {}; // Track in-flight requests to prevent duplicates
  }

  async getDocumentation(query, type) {
    if (!query || query.trim() === '') {
      return { error: 'Query cannot be empty' };
    }
    
    // Normalize query to prevent duplicate cache entries
    query = query.trim();
    type = type || 'auto';
    
    // Check cache first
    const cacheKey = `${type}:${query}`;
    if (this.cache[cacheKey] && Date.now() - this.cache[cacheKey].timestamp < this.cacheTTL) {
      return this.cache[cacheKey].data;
    }
    
    // Check if there's already a pending request for this query
    if (this.pendingRequests[cacheKey]) {
      return this.pendingRequests[cacheKey];
    }
    
    // Create a promise for this request
    this.pendingRequests[cacheKey] = (async () => {
      try {
        let result;
        switch(type) {
          case 'github':
            result = await this.fetchFromGitHub(query);
            break;
          case 'mdn':
            result = await this.fetchFromMDN(query);
            break;
          case 'npm':
            result = await this.fetchFromNpm(query);
            break;
          case 'pypi':
            result = await this.fetchFromPyPI(query);
            break;
          case 'stackoverflow':
            result = await this.fetchFromStackOverflow(query);
            break;
          case 'readthedocs':
            result = await this.fetchFromReadTheDocs(query);
            break;
          default:
            // Try to determine the best source based on query
            result = await this.smartFetch(query);
        }

        // Cache the result
        this.cache[cacheKey] = {
          data: result,
          timestamp: Date.now()
        };
        
        return result;
      } finally {
        // Clean up the pending request
        delete this.pendingRequests[cacheKey];
      }
    })();
    
    return this.pendingRequests[cacheKey];
  }

  async fetchFromGitHub(query) {
    try {
      // Parse query to extract repo owner and name
      const parts = query.split('/');
      if (parts.length < 2) {
        return {
          source: 'GitHub',
          error: 'Invalid GitHub repository format. Use owner/repo/path format.'
        };
      }
      
      const owner = parts[0];
      const repo = parts[1];
      const path = parts.slice(2).join('/');
      
      const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path || ''}`;
      
      const response = await axios.get(url, {
        headers: {
          'Accept': 'application/vnd.github.v3+json'
        },
        timeout: 5000 // 5 second timeout
      });
      
      // Process and return the content
      return {
        source: 'GitHub',
        url,
        title: `${owner}/${repo}${path ? `/${path}` : ''}`,
        content: response.data,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error fetching from GitHub:', error.message);
      return {
        source: 'GitHub',
        error: error.response?.status === 404 
          ? 'Repository or file not found on GitHub' 
          : `Could not fetch documentation from GitHub: ${error.message}`
      };
    }
  }

  async fetchFromMDN(query) {
    try {
      // Use MDN API to search for documentation
      const url = `https://developer.mozilla.org/api/v1/search?q=${encodeURIComponent(query)}&locale=en-US`;
      const response = await axios.get(url, { timeout: 5000 });
      
      if (!response.data || !response.data.documents || response.data.documents.length === 0) {
        return {
          source: 'MDN Web Docs',
          error: 'No documentation found on MDN for this query'
        };
      }
      
      const topResult = response.data.documents[0];
      const contentUrl = `https://developer.mozilla.org${topResult.mdn_url}`;
      
      // Fetch the actual content
      const contentResponse = await axios.get(contentUrl, { timeout: 5000 });
      const $ = cheerio.load(contentResponse.data);
      
      // Extract the main content more effectively
      const content = $('#content .main-page-content').html() || $('#content').html();
      const processedContent = content ? this.cleanHtml($, content) : '';
      
      // Extract code examples if available
      const codeExamples = [];
      $('.example-code').each((i, el) => {
        codeExamples.push($(el).html());
      });
      
      // Extract syntax if available
      const syntax = $('.syntaxbox').html() || $('.syntax').html() || '';
      
      if (processedContent) {
        return {
          source: 'MDN Web Docs',
          url: contentUrl,
          title: topResult.title,
          summary: topResult.summary,
          syntax: syntax,
          codeExamples: codeExamples.length > 0 ? codeExamples : undefined,
          content: processedContent,
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        source: 'MDN Web Docs',
        error: 'No documentation found'
      };
    } catch (error) {
      console.error('Error fetching from MDN:', error);
      return {
        source: 'MDN Web Docs',
        error: 'Could not fetch documentation from MDN'
      };
    }
  }

  async fetchFromNpm(query) {
    try {
      // Clean up the query
      const packageName = query.replace(/npm/gi, '').trim();
      
      if (!packageName) {
        return {
          source: 'npm',
          error: 'Package name is required'
        };
      }
      
      // Fetch package data from npm registry
      const url = `https://registry.npmjs.org/${packageName}`;
      const response = await axios.get(url, { timeout: 5000 });
      
      if (!response.data) {
        return {
          source: 'npm',
          error: 'Package not found'
        };
      }
      
      const packageData = response.data;
      const latestVersion = packageData['dist-tags']?.latest;
      const latestVersionData = latestVersion ? packageData.versions?.[latestVersion] : null;
      
      // Combine data from latest version and root package data
      const combinedData = {
        ...packageData,
        ...latestVersionData
      };
      
      return {
        source: 'npm',
        url: `https://www.npmjs.com/package/${packageName}`,
        title: combinedData.name,
        description: combinedData.description,
        version: latestVersion || combinedData.version,
        author: combinedData.author,
        homepage: combinedData.homepage,
        repository: combinedData.repository,
        keywords: combinedData.keywords,
        license: combinedData.license,
        dependencies: combinedData.dependencies,
        content: combinedData.readme || packageData.readme,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error fetching from npm:', error.message);
      return {
        source: 'npm',
        error: error.response?.status === 404 
          ? 'Package not found on npm registry' 
          : `Could not fetch documentation from npm: ${error.message}`
      };
    }
  }

  async fetchFromPyPI(query) {
    try {
      // Clean up the query
      const packageName = query.replace(/python|pip/gi, '').trim();
      
      if (!packageName) {
        return {
          source: 'PyPI',
          error: 'Package name is required'
        };
      }
      
      // Fetch package data from PyPI
      const url = `https://pypi.org/pypi/${packageName}/json`;
      const response = await axios.get(url, { timeout: 5000 });
      
      if (!response.data || !response.data.info) {
        return {
          source: 'PyPI',
          error: 'Package not found or invalid data returned'
        };
      }
      
      const packageData = response.data;
      const info = packageData.info;
      
      // Extract documentation URL
      let documentationUrl = info.project_urls?.Documentation || 
                            info.project_urls?.['Documentation'] || 
                            info.docs_url || 
                            info.home_page;
      
      // Format content as markdown if it's in restructuredText format
      let formattedContent = info.description;
      if (info.description_content_type && 
          (info.description_content_type.includes('x-rst') || 
           info.description_content_type.includes('restructuredtext'))) {
        // Simple conversion of common rst elements to markdown
        formattedContent = formattedContent
          .replace(/\.\.\s+code-block::\s+([^\n]+)\n/g, '```$1\n')
          .replace(/\.\.\s+code::\s+([^\n]+)\n/g, '```$1\n')
          .replace(/``([^`]+)``/g, '`$1`')
          .replace(/\*\*([^*]+)\*\*/g, '**$1**')
          .replace(/\*([^*]+)\*/g, '*$1*');
      }
      
      return {
        source: 'PyPI',
        url: `https://pypi.org/project/${packageName}`,
        title: info.name,
        description: info.summary,
        version: info.version,
        author: info.author,
        authorEmail: info.author_email,
        homepage: info.home_page,
        documentation: documentationUrl,
        license: info.license,
        keywords: info.keywords?.split(',').map(k => k.trim()) || [],
        requires: info.requires_dist || [],
        content: formattedContent,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error fetching from PyPI:', error.message);
      return {
        source: 'PyPI',
        error: error.response?.status === 404 
          ? 'Package not found on PyPI' 
          : `Could not fetch documentation from PyPI: ${error.message}`
      };
    }
  }

  async fetchFromStackOverflow(query) {
    try {
      if (!query || query.trim() === '') {
        return {
          source: 'Stack Overflow',
          error: 'Search query is required'
        };
      }
      
      // Use Stack Exchange API to search for questions
      const url = `https://api.stackexchange.com/2.3/search?order=desc&sort=relevance&intitle=${encodeURIComponent(query)}&site=stackoverflow&filter=withbody`;
      const response = await axios.get(url, { timeout: 5000 });
      
      if (!response.data || !response.data.items || response.data.items.length === 0) {
        return {
          source: 'Stack Overflow',
          error: 'No relevant questions found on Stack Overflow'
        };
      }
      
      // Get top 3 questions with their details already included
      const topQuestions = response.data.items.slice(0, 3);
      
      // Fetch answers for each question
      const questionsWithAnswers = await Promise.allSettled(topQuestions.map(async (question) => {
        try {
          const answersUrl = `https://api.stackexchange.com/2.3/questions/${question.question_id}/answers?order=desc&sort=votes&site=stackoverflow&filter=withbody`;
          const answersResponse = await axios.get(answersUrl, { timeout: 5000 });
          
          if (answersResponse.data && answersResponse.data.items && answersResponse.data.items.length > 0) {
            // Get top voted answers
            const answers = answersResponse.data.items
              .filter(answer => answer.score > 0)
              .slice(0, 2);
              
            return {
              ...question,
              answers
            };
          }
          
          return question;
        } catch (error) {
          console.error(`Error fetching answers for question ${question.question_id}:`, error.message);
          return question;
        }
      }));
      
      // Extract results from fulfilled promises
      const validQuestions = questionsWithAnswers
        .filter(result => result.status === 'fulfilled')
        .map(result => result.value);
      
      if (validQuestions.length === 0) {
        return {
          source: 'Stack Overflow',
          error: 'Could not fetch question details'
        };
      }
      
      // Format the results
      const formattedQuestions = validQuestions.map(question => {
        // Convert HTML to markdown for better readability
        const $ = cheerio.load(question.body);
        
        // Remove unnecessary elements
        $('script, style').remove();
        
        // Process code blocks
        $('pre code').each((i, el) => {
          const codeContent = $(el).text();
          $(el).parent().replaceWith(`\n\n\`\`\`\n${codeContent}\n\`\`\`\n\n`);
        });
        
        // Process inline code
        $('code').each((i, el) => {
          if ($(el).parent().is('pre')) return; // Skip if already in a pre block
          const codeContent = $(el).text();
          $(el).replaceWith(`\`${codeContent}\``);
        });
        
        // Format answers if available
        const formattedAnswers = question.answers ? question.answers.map(answer => {
          const $answer = cheerio.load(answer.body);
          $answer('script, style').remove();
          
          // Process code blocks in answers
          $answer('pre code').each((i, el) => {
            const codeContent = $answer(el).text();
            $answer(el).parent().replaceWith(`\n\n\`\`\`\n${codeContent}\n\`\`\`\n\n`);
          });
          
          // Process inline code in answers
          $answer('code').each((i, el) => {
            if ($answer(el).parent().is('pre')) return;
            const codeContent = $answer(el).text();
            $answer(el).replaceWith(`\`${codeContent}\``);
          });
          
          return {
            body: $answer.text(),
            score: answer.score,
            isAccepted: answer.is_accepted
          };
        }) : [];
        
        return {
          title: question.title,
          link: question.link,
          score: question.score,
          tags: question.tags,
          body: $.text(),
          answered: question.is_answered,
          answerCount: question.answer_count,
          viewCount: question.view_count,
          answers: formattedAnswers
        };
      });
      
      return {
        source: 'Stack Overflow',
        url: `https://stackoverflow.com/search?q=${encodeURIComponent(query)}`,
        results: formattedQuestions,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error fetching from Stack Overflow:', error.message);
      return {
        source: 'Stack Overflow',
        error: `Could not fetch documentation from Stack Overflow: ${error.message}`
      };
    }
  }

  async fetchFromReadTheDocs(query) {
    try {
      if (!query || query.trim() === '') {
        return {
          source: 'Read the Docs',
          error: 'Search query is required'
        };
      }
      
      // Search for projects on Read the Docs
      const searchUrl = `https://readthedocs.org/api/v3/search/?q=${encodeURIComponent(query)}`;
      const searchResponse = await axios.get(searchUrl, { timeout: 5000 });
      
      if (!searchResponse.data || !searchResponse.data.results || searchResponse.data.results.length === 0) {
        return {
          source: 'Read the Docs',
          error: 'No documentation found on Read the Docs'
        };
      }
      
      const topProject = searchResponse.data.results[0];
      
      // Get project details
      const projectUrl = `https://readthedocs.org/api/v3/projects/${topProject.project.slug}/`;
      const projectResponse = await axios.get(projectUrl, { timeout: 5000 });
      
      if (!projectResponse.data) {
        return {
          source: 'Read the Docs',
          error: 'Could not fetch project details'
        };
      }
      
      const projectData = projectResponse.data;
      
      // Get documentation URL
      const docsUrl = projectData.urls.documentation;
      
      // Fetch documentation content
      const docsResponse = await axios.get(docsUrl, { timeout: 8000 });
      const $ = cheerio.load(docsResponse.data);
      
      // Extract main content more effectively
      const content = $('.document').html() || $('.rst-content').html() || $('.content').html();
      const processedContent = content ? this.cleanHtml($, content) : '';
      
      // Extract table of contents if available
      const toc = [];
      $('.toctree-l1').each((i, el) => {
        const item = $(el).text().trim();
        if (item) toc.push(item);
      });
      
      return {
        source: 'Read the Docs',
        url: docsUrl,
        title: projectData.name,
        description: projectData.description,
        homepage: projectData.homepage,
        language: projectData.language?.name,
        programming_language: projectData.programming_language?.name,
        toc: toc.length > 0 ? toc : undefined,
        content: processedContent,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error fetching from Read the Docs:', error.message);
      return {
        source: 'Read the Docs',
        error: `Could not fetch documentation from Read the Docs: ${error.message}`
      };
    }
  }

  // Helper method to clean HTML content
  cleanHtml($, html) {
    if (!html) return '';
    
    // Create a new cheerio instance with the HTML
    const $content = cheerio.load(html);
    
    // Remove unnecessary elements
    $content('script, style, .sidebar, .nav, .header, .footer, .ad, .advertisement').remove();
    
    // Return the cleaned HTML
    return $content.html();
  }

  async smartFetch(query) {
    // Try to determine the best source based on query content
    if (query.includes('github.com')) {
      const githubPath = query.split('github.com/')[1];
      return this.fetchFromGitHub(githubPath);
    } else if (query.match(/^(https?:\/\/)?([\w.-]+)\.([a-z]{2,})(\/.*)?$/i)) {
      // It's a URL, try to fetch directly
      return this.fetchFromUrl(query);
    } else if (query.includes('mdn') || /html|css|javascript|js|dom|web api/i.test(query)) {
      return this.fetchFromMDN(query);
    } else if (query.includes('npm') || query.startsWith('@') || /^[a-zA-Z0-9-_]+$/.test(query)) {
      // Try npm first for simple package names
      const npmResult = await this.fetchFromNpm(query.replace(/npm/gi, '').trim());
      if (!npmResult.error) return npmResult;
    } else if (/python|pip|django|flask/i.test(query)) {
      return this.fetchFromPyPI(query.replace(/python|pip/gi, '').trim());
    }
    
    // If we couldn't determine a specific source, try a combined approach
    return this.combinedSearch(query);
  }

  async fetchFromUrl(url) {
    try {
      // Ensure URL has protocol
      if (!url.startsWith('http')) {
        url = 'https://' + url;
      }
      
      const response = await axios.get(url, { timeout: 5000 });
      const $ = cheerio.load(response.data);
      
      // Extract title
      const title = $('title').text() || url;
      
      // Extract main content
      const content = $('main').html() || $('article').html() || $('body').html();
      const processedContent = content ? this.cleanHtml($, content) : '';
      
      return {
        source: 'Web',
        url,
        title,
        content: processedContent,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error fetching from URL:', error.message);
      return {
        source: 'Web',
        error: `Could not fetch content from URL: ${error.message}`
      };
    }
  }

  async combinedSearch(query) {
    // Try multiple sources in parallel and return the best result
    const sources = [
      this.fetchFromMDN(query),
      this.fetchFromNpm(query),
      this.fetchFromPyPI(query),
      this.fetchFromStackOverflow(query)
    ];
    
    const results = await Promise.allSettled(sources);
    
    // Filter out rejected promises and extract values from fulfilled ones
    const validResults = results
      .filter(result => result.status === 'fulfilled' && result.value && !result.value.error)
      .map(result => result.value);
    
    if (validResults.length > 0) {
      // Return the first valid result
      return {
        source: 'Combined Search',
        query,
        results: validResults,
        timestamp: new Date().toISOString()
      };
    }
    
    return {
      source: 'Combined Search',
      error: 'No documentation found across all sources',
      query
    };
  }
}

module.exports = DocumentationService;