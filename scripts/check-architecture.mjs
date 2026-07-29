import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'acorn';

const root = process.cwd();
const srcRoot = path.join(root, 'src');
const entries = (await readdir(srcRoot, { recursive: true })).filter(name => name.endsWith('.js')).sort();
const modules = [];
const globals = new Map();
const storageAccess = [];
for (const name of entries) {
  const code = await readFile(path.join(srcRoot, name), 'utf8');
  parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true });
  const imports = [...code.matchAll(/from\s+['"](.+?)['"]/g)].map(match => match[1]);
  const installers = [...code.matchAll(/\binstall[A-Z][A-Za-z0-9_]*\s*\(/g)].map(match => match[0].replace(/\s*\($/, ''));
  for (const match of code.matchAll(/(?:window|globalThis\.window)\.__pm[A-Za-z0-9_]+/g)) {
    const key = match[0].replace(/^globalThis\./, '');
    if (!globals.has(key)) globals.set(key, new Set());
    globals.get(key).add(name);
  }
  if (/\blocalStorage\.|\bindexedDB\b|\bpmIDB(?:Get|Set|Del|Keys|ReadEntry)\b/.test(code)) storageAccess.push(name);
  modules.push({ name, imports, installers });
}
const main = modules.find(module => module.name === 'main.js');
if (!main) throw new Error('src/main.js missing');
const report = {
  mode: 'baseline-only',
  sourceModules: modules.length,
  mainImports: main.imports,
  mainInstallerReferences: main.installers,
  publicGlobalCount: globals.size,
  publicGlobals: [...globals].sort(([a], [b]) => a.localeCompare(b)).map(([name, files]) => ({ name, files: [...files].sort() })),
  directStorageModules: storageAccess,
};
console.log(JSON.stringify(report, null, 2));
console.error('Architecture baseline collected; findings are not migration-pass claims.');
