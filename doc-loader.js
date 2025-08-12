const { ChromaClient } = require('chromadb');
const docs = require('./nextjs-docs.json');

async function loadDocs() {
  const client = new ChromaClient();
  const collection = await client.createCollection('nextjs_docs');
  
  await collection.add({
    ids: docs.map((d, i) => `doc${i}`),
    documents: docs.map(d => `${d.title}: ${d.content}`),
    metadatas: docs.map(d => ({ source: 'nextjs' }))
  });
}
loadDocs();