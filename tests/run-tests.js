/* Minimal test runner for RealTime CodeAi */
const assert = require("assert");

function log(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (e) {
    console.error(`FAIL: ${name}`);
    console.error(e && e.stack ? e.stack : e);
    process.exitCode = 1;
  }
}

// Unit-like tests (DocDiffer)
log("DocDiffer.getDocsForChroma returns object", () => {
  const DocDiffer = require("../doc-differ");
  const path = require("path");
  const fs = require("fs");
  const tmp = path.join(__dirname, "tmp-docs.json");
  // seed
  fs.writeFileSync(
    tmp,
    JSON.stringify(
      {
        "nextjs:Getting Started": {
          title: "Getting Started",
          content: "Intro",
          type: "nextjs",
        },
        "tailwind:Install": {
          title: "Install",
          content: "How to install",
          type: "tailwind",
        },
      },
      null,
      2
    )
  );
  const dd = new DocDiffer(tmp);
  const out = dd.getDocsForChroma();
  assert.strictEqual(typeof out, "object");
  assert.ok(out["NEXTJS: Getting Started"]);
  assert.ok(out["TAILWIND: Install"]);
  fs.unlinkSync(tmp);
});

// Basic end
