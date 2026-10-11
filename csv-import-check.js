#!/usr/bin/env node

import { createRequire } from "module";
const require = createRequire(import.meta.url);

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const targetArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const TARGET_PATH = targetArg ? path.resolve(process.cwd(), targetArg) : ROOT;
const EXCLUDED_DIRS = new Set([".git", "node_modules", ".playwright-mcp", "event-creator-app", "dist", "dist-electron", "release"]);
const FIX_BOM = process.argv.includes("--fix-bom");
const CLEAN_PAST = process.argv.includes("--clean-past");
const SPLIT_CHUNKS = process.argv.includes("--split-chunks");
const VALIDATE_CATEGORIES = !process.argv.includes("--no-validate-categories");
const VALIDATE_DATE = !process.argv.includes("--no-validate-date");
const MAX_ENTRIES_PER_FILE = 50;

const VALID_CATEGORIES = new Set([
  "Musik & Nightlife",
  "Familie & Kinder",
  "Workshops & PopUps",
  "Märkte & Messen",
  "Show & Performance",
  "Kultur",
  "Sport & Fitness",
  "",
]);

function getTodayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMinStartString() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const year = tomorrow.getFullYear();
  const month = String(tomorrow.getMonth() + 1).padStart(2, "0");
  const day = String(tomorrow.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const TODAY_STR = getTodayString();
const MIN_START_STR = getMinStartString();

function walkCsvFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkCsvFiles(fullPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".csv")) {
      out.push(fullPath);
    }
  }
  return out;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let inQuotes = false;

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    if (c === "\r") {
      if (text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }

    field += c;
    i += 1;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

function serializeCsv(rows) {
  return (
    rows
      .map((row) =>
        row
          .map((val) => {
            const str = String(val == null ? "" : val);
            if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          })
          .join(",")
      )
      .join("\n") + "\n"
  );
}

function splitFileIntoChunks(filePath, rows, maxEntries) {
  const header = rows[0];
  const dataRows = rows.slice(1);
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath, ".csv");
  const cleanBase = baseName.replace(/-\d+$/, "");

  const chunksCreated = [];
  let chunkIdx = 1;

  for (let i = 0; i < dataRows.length; i += maxEntries) {
    const chunkRows = [header, ...dataRows.slice(i, i + maxEntries)];
    const outName = chunkIdx === 1 ? `${cleanBase}.csv` : `${cleanBase}-${chunkIdx}.csv`;
    const outPath = path.join(dir, outName);
    fs.writeFileSync(outPath, serializeCsv(chunkRows), "utf8");
    chunksCreated.push({ outPath, count: chunkRows.length - 1 });
    chunkIdx += 1;
  }

  return chunksCreated;
}

function checkFile(filePath) {
  let text = fs.readFileSync(filePath, "utf8");
  let bomFixed = false;
  let pastCleanedCount = 0;
  let splitDone = false;

  if (FIX_BOM && text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
    fs.writeFileSync(filePath, text, "utf8");
    bomFixed = true;
  }

  let rows = parseCsv(text);
  if (rows.length === 0) return { filePath, rows: 0, issues: [], bomFixed, pastCleanedCount, splitDone };

  const header = rows[0];
  const expectedCols = header.length;
  const hasBom = text.charCodeAt(0) === 0xfeff || /^\uFEFF/.test(header[0] || "");
  const issues = [];

  if (hasBom) issues.push("Header contains BOM (Titel must be plain ASCII)");
  if ((header[0] || "").replace(/^\uFEFF/, "") !== "Titel") {
    issues.push(`First header column is "${header[0] || ""}" instead of "Titel"`);
  }

  const categoryCol = header.findIndex((h) => (h || "").replace(/^\uFEFF/, "") === "Kategorien");
  const startDateCol = header.findIndex((h) => (h || "").replace(/^\uFEFF/, "") === "Startdatum");

  if (CLEAN_PAST && startDateCol >= 0) {
    const initialDataCount = rows.length - 1;
    const keptRows = [header];
    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i];
      const startDate = (row[startDateCol] || "").trim();
      if (!startDate || startDate >= MIN_START_STR) {
        keptRows.push(row);
      }
    }
    pastCleanedCount = initialDataCount - (keptRows.length - 1);
    if (pastCleanedCount > 0) {
      rows = keptRows;
      fs.writeFileSync(filePath, serializeCsv(rows), "utf8");
    }
  }

  let dataRowCount = rows.length - 1;

  if (SPLIT_CHUNKS && dataRowCount > MAX_ENTRIES_PER_FILE) {
    const created = splitFileIntoChunks(filePath, rows, MAX_ENTRIES_PER_FILE);
    splitDone = true;
    rows = parseCsv(fs.readFileSync(filePath, "utf8"));
    dataRowCount = rows.length - 1;
  }

  if (dataRowCount > MAX_ENTRIES_PER_FILE) {
    issues.push(
      `File contains ${dataRowCount} entries (maximum allowed is ${MAX_ENTRIES_PER_FILE} entries per CSV)`
    );
  }

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.length !== expectedCols) {
      issues.push(`Line ${i + 1}: ${row.length} columns (expected ${expectedCols})`);
    }
    const title = (row[0] || "").replace(/^\uFEFF/, "").trim();
    if (!title) {
      issues.push(`Line ${i + 1}: Titel is empty`);
    }
    if (VALIDATE_CATEGORIES && categoryCol >= 0) {
      const category = (row[categoryCol] || "").trim();
      if (!VALID_CATEGORIES.has(category)) {
        issues.push(`Line ${i + 1}: invalid Kategorien "${category}"`);
      }
    }
    if (VALIDATE_DATE && startDateCol >= 0) {
      const startDate = (row[startDateCol] || "").trim();
      if (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
        if (startDate < MIN_START_STR) {
          issues.push(
            `Line ${i + 1}: Startdatum "${startDate}" is before the earliest allowed date (tomorrow = ${MIN_START_STR})`
          );
        }
      }
    }
  }

  return { filePath, rows: rows.length, dataRows: dataRowCount, issues, bomFixed, pastCleanedCount, splitDone };
}

function getFilesToCheck(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return [];
  }
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    return targetPath.toLowerCase().endsWith(".csv") ? [targetPath] : [];
  }
  return walkCsvFiles(targetPath);
}

let files = getFilesToCheck(TARGET_PATH);
let results = files.map(checkFile);

if (results.some((r) => r.splitDone)) {
  files = getFilesToCheck(TARGET_PATH);
  results = files.map(checkFile);
}

const failed = results.filter((r) => r.issues.length > 0);
const fixedBomCount = results.filter((r) => r.bomFixed).length;
const totalPastCleaned = results.reduce((acc, r) => acc + (r.pastCleanedCount || 0), 0);
const totalSplitCount = results.filter((r) => r.splitDone).length;

if (fixedBomCount > 0) {
  console.log(`BOM removed in ${fixedBomCount} file(s).`);
}
if (totalPastCleaned > 0) {
  console.log(`Removed ${totalPastCleaned} past event(s) across files (--clean-past).`);
}
if (totalSplitCount > 0) {
  console.log(`Split ${totalSplitCount} oversized CSV file(s) into max ${MAX_ENTRIES_PER_FILE} chunks (--split-chunks).`);
}

if (failed.length === 0) {
  console.log(`OK: ${files.length} CSV file(s) passed (max ${MAX_ENTRIES_PER_FILE} entries/file, no past events).`);
  process.exit(0);
}

console.log(`FAIL: ${failed.length}/${files.length} CSV file(s) have issues.`);
for (const item of failed) {
  const rel = path.relative(ROOT, item.filePath);
  console.log(`\n- ${rel} (${item.dataRows} entries)`);
  for (const issue of item.issues.slice(0, 15)) {
    console.log(`  * ${issue}`);
  }
  if (item.issues.length > 15) {
    console.log(`  * ... ${item.issues.length - 15} more issue(s)`);
  }
}
process.exit(1);
