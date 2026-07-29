import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'acorn';

const root = process.cwd();
const srcRoot = path.join(root, 'src');
const entries = (await readdir(srcRoot, { recursive: true })).filter(name => name.endsWith('.js')).sort();
const patterns = {
  addEventListener: /\.addEventListener\s*\(/g,
  removeEventListener: /\.removeEventListener\s*\(/g,
  setTimeout: /\bsetTimeout\s*\(/g,
  clearTimeout: /\bclearTimeout\s*\(/g,
  setInterval: /\bsetInterval\s*\(/g,
  clearInterval: /\bclearInterval\s*\(/g,
  abortController: /\bnew\s+AbortController\s*\(/g,
  abort: /\.abort\s*\(/g,
};
const totals = Object.fromEntries(Object.keys(patterns).map(key => [key, 0]));
const files = [];
for (const name of entries) {
  const code = await readFile(path.join(srcRoot, name), 'utf8');
  parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true });
  const counts = {};
  for (const [key, pattern] of Object.entries(patterns)) {
    counts[key] = [...code.matchAll(pattern)].length;
    totals[key] += counts[key];
  }
  if (Object.values(counts).some(Boolean)) files.push({ name, ...counts });
}
console.log(JSON.stringify({ mode: 'baseline-only', totals, files }, null, 2));
console.error('Lifecycle baseline collected; static counts do not prove resources are released.');
