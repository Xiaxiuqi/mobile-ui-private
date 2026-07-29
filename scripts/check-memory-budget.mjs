import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'acorn';

const root = process.cwd();
const srcRoot = path.join(root, 'src');
const entries = (await readdir(srcRoot, { recursive: true })).filter(name => name.endsWith('.js')).sort();
const files = [];
let sourceBytes = 0;
const totals = { maps: 0, sets: 0, jsonDeepClones: 0, objectUrls: 0 };
for (const name of entries) {
  const code = await readFile(path.join(srcRoot, name), 'utf8');
  parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true });
  const bytes = Buffer.byteLength(code);
  sourceBytes += bytes;
  const counts = {
    maps: [...code.matchAll(/\bnew\s+Map\s*\(/g)].length,
    sets: [...code.matchAll(/\bnew\s+Set\s*\(/g)].length,
    jsonDeepClones: [...code.matchAll(/JSON\.parse\s*\(\s*JSON\.stringify\s*\(/g)].length,
    objectUrls: [...code.matchAll(/URL\.(?:createObjectURL|revokeObjectURL)\s*\(/g)].length,
  };
  for (const key of Object.keys(totals)) totals[key] += counts[key];
  if (Object.values(counts).some(Boolean)) files.push({ name, bytes, ...counts });
}
const bundleBytes = (await stat(path.join(root, 'index.js'))).size;
const knownWorkingSets = [
  'calendar.js:viewByStorage', 'calendar.js:statusByStorage', 'calendar.js:statusTimerByStorage',
  'runtime.js:automaticTasks', 'runtime.js:pendingMessages', 'storage.js:branchLineageRevisions',
];
console.log(JSON.stringify({ mode: 'baseline-only', sourceModules: entries.length, sourceBytes, bundleBytes, totals, knownWorkingSets, files }, null, 2));
console.error('Memory baseline collected; heap and retained-object budgets require browser profiling.');
