const cheerio = require('cheerio');
const axios = require('axios');
const fs = require('fs');

async function scrapeNextJSDocs() {
  const url = 'https://nextjs.org/docs';
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);
  
  const updates = [];
  $('[data-testid="subheading"]').each((i, el) => {
    const title = $(el).text().trim();
    const content = $(el).next('p').text().trim();
    updates.push({ title, content });
  });

  fs.writeFileSync('nextjs-docs.json', JSON.stringify(updates));
  console.log(`Scraped ${updates.length} updates!`);
}

scrapeNextJSDocs();