#!/usr/bin/env node
const fs = require("fs");
const { validatePrDescription } = require("./pr-description-rules");

function fail(messages) {
  const list = Array.isArray(messages) ? messages : [messages];
  console.error("[pr-body-verify] FAIL");
  list.forEach((msg) => {
    console.error(`- ${msg}`);
  });
  process.exit(1);
}

const file = process.argv[2] || "/tmp/pr.md";
if (!fs.existsSync(file)) fail(`missing file: ${file}`);
const body = fs.readFileSync(file, "utf8");
const { errors } = validatePrDescription(body);

if (errors.length) fail(errors);

console.log("[pr-body-verify] OK");
