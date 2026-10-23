import fs from 'node:fs';
import ts from 'typescript';
const root = new URL('./', import.meta.url);
const engineSource = fs.existsSync(new URL('roster.ts', root))
  ? new URL('roster.ts', root) : new URL('../src/lib/roster.ts', root);
const logic = ts.transpileModule(fs.readFileSync(engineSource, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const engine = `(function(){const exports={};\n${logic}\nreturn exports;})()`;
let html = fs.readFileSync(new URL('src/index.html', root), 'utf8');
html = html.replace('/* INLINE_CSS */', fs.readFileSync(new URL('src/style.css', root), 'utf8'));
const app = fs.readFileSync(new URL('src/app.js', root), 'utf8');
html = html.replace('/* INLINE_APP */', () => `const Roster = ${engine};\n${app}`.replace(/<\/script/gi, '<\\/script'));
fs.writeFileSync(new URL('er-scheduling-offline.html', root), html);
console.log('Built offline/er-scheduling-offline.html (no runtime dependencies)');
