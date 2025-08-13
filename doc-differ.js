const axios = require("axios");
const cheerio = require("cheerio"); // Already in your dependencies

// DocDiffer class implementation
const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

class DocDiffer {
  constructor(docsPath) {
    this.docsPath = docsPath || path.join(__dirname, "data", "docs.json");
    this.docSources = [
      {
        name: "Next.js Documentation",
        url: "https://nextjs.org/docs",
        selector: '[data-testid="subheading"]',
        contentSelector: "p",
        type: "nextjs",
      },
      {
        name: "Tailwind CSS Documentation",
        url: "https://tailwindcss.com/docs",
        selector: "h2",
        contentSelector: "p",
        type: "tailwind",
      },
    ];
    this.ensureDirectoryExists();
    this.previousDocs = this.loadPreviousDocs();
  }
  ensureDirectoryExists() {
    const directory = path.dirname(this.docsPath);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
  }

  loadPreviousDocs() {
    try {
      return JSON.parse(fs.readFileSync(this.docsPath, "utf8"));
    } catch (error) {
      return {};
    }
  }

  async fetchLatestDocs(source) {
    try {
      const { data } = await axios.get(source.url);
      const $ = cheerio.load(data);

      const latestDocs = {};
      $(source.selector).each((i, el) => {
        const title = $(el).text().trim();
        let content;

        if (source.contentSelector === "p") {
          // Get all paragraphs following the heading until the next heading
          content = [];
          let nextEl = $(el).next();
          while (nextEl.length && !nextEl.is(source.selector)) {
            if (nextEl.is("p")) {
              content.push(nextEl.text().trim());
            }
            nextEl = nextEl.next();
          }
          content = content.join("\n\n");
        } else {
          content = $(el).next(source.contentSelector).text().trim();
        }

        if (title && content) {
          latestDocs[`${source.type}:${title}`] = {
            title,
            content,
            source: source.name,
            type: source.type,
            url: source.url,
            timestamp: new Date().toISOString(),
          };
        }
      });

      return latestDocs;
    } catch (error) {
      console.error(`Error fetching docs from ${source.name}:`, error);
      return {};
    }
  }

  findDifferences(latestDocs) {
    const newDocs = {};
    const updatedDocs = {};
    const removedDocs = {};

    // Find new and updated docs
    Object.entries(latestDocs).forEach(([key, latestDoc]) => {
      const existingDoc = this.previousDocs[key];

      if (!existingDoc) {
        newDocs[key] = latestDoc;
      } else if (existingDoc.content !== latestDoc.content) {
        updatedDocs[key] = {
          ...latestDoc,
          previousContent: existingDoc.content,
        };
      }
    });

    // Find removed docs
    Object.entries(this.previousDocs).forEach(([key, prevDoc]) => {
      if (!latestDocs[key]) {
        removedDocs[key] = prevDoc;
      }
    });

    return {
      newDocs,
      updatedDocs,
      removedDocs,
      newCount: Object.keys(newDocs).length,
      updatedCount: Object.keys(updatedDocs).length,
      removedCount: Object.keys(removedDocs).length,
    };
  }

  async processDocs(sourceTypes = []) {
    try {
      // If no specific source types are provided, process all sources
      const sourcesToProcess =
        sourceTypes.length > 0
          ? this.docSources.filter((source) =>
              sourceTypes.includes(source.type)
            )
          : this.docSources;

      if (sourcesToProcess.length === 0) {
        return {
          success: false,
          error: "No valid documentation sources specified",
        };
      }

      // Show progress notification
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Refreshing documentation...",
          cancellable: false,
        },
        async (progress) => {
          const step = 100 / sourcesToProcess.length;

          for (let i = 0; i < sourcesToProcess.length; i++) {
            progress.report({
              message: `Fetching ${sourcesToProcess[i].name} (${i + 1}/${
                sourcesToProcess.length
              })`,
              increment: step,
            });
            await new Promise((resolve) => setTimeout(resolve, 500)); // Small delay for UI feedback
          }
        }
      );

      // Fetch all docs in parallel
      const fetchPromises = sourcesToProcess.map((source) =>
        this.fetchLatestDocs(source)
      );
      const docResults = await Promise.all(fetchPromises);

      // Merge all results
      let latestDocs = {};
      docResults.forEach((result) => {
        latestDocs = { ...latestDocs, ...result };
      });

      const differences = this.findDifferences(latestDocs);

      // Merge with existing docs that weren't updated
      const mergedDocs = { ...this.previousDocs };

      // Remove docs that were removed
      Object.keys(differences.removedDocs).forEach((key) => {
        delete mergedDocs[key];
      });

      // Add new and updated docs
      Object.entries(latestDocs).forEach(([key, doc]) => {
        mergedDocs[key] = doc;
      });

      // Save the merged docs
      fs.writeFileSync(this.docsPath, JSON.stringify(mergedDocs, null, 2));

      // Update in-memory previous docs so subsequent calls use the latest
      this.previousDocs = mergedDocs;

      return {
        success: true,
        latestDocs: mergedDocs,
        differences,
        processedSources: sourcesToProcess.map((s) => s.name),
      };
    } catch (error) {
      console.error("Error processing docs:", error);
      return {
        success: false,
        error: error.message || "Unknown error processing documentation",
      };
    }
  }

  /**
   * Gets the documentation in a format suitable for ChromaDB
   * @returns {Object} - Documentation formatted for ChromaDB
   */
  getDocsForChroma() {
    const formattedDocs = {};

    Object.entries(this.previousDocs).forEach(([key, doc]) => {
      // Format the title and content for ChromaDB
      const formattedTitle = `${doc.type.toUpperCase()}: ${doc.title}`;
      formattedDocs[formattedTitle] = doc.content;
    });

    return formattedDocs;
  }
}

module.exports = DocDiffer;
