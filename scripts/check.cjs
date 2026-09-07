const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const files=walk(path.join(root,'vault'));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
let blocks=0,views=0,links=0;
for(const p of files){
 const rel=path.relative(root,p).replaceAll('\\','/'); const s=fs.readFileSync(p,'utf8');
 assert.ok(!s.startsWith('\uFEFF'),`BOM: ${rel}`);
 assert.ok(!/C:[\\/]Users[\\/]|iCloudDrive|sk-[a-zA-Z0-9]{20,}|gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|BEGIN .*PRIVATE KEY/.test(s),`Unexpected private content: ${rel}`);
 assert.ok(!/(^|\/)(plugins|workspace\.json|workspace-mobile\.json|\.trash)(\/|$)/.test(rel),`Unexpected configuration: ${rel}`);
 if(p.endsWith('.js'))new AsyncFunction('dv','input',s);
 if(p.endsWith('.md')){
  assert.ok(/^---\n[\s\S]*?\n---\n/.test(s),`Missing frontmatter: ${rel}`);
  for(const m of s.matchAll(/```dataviewjs\n([\s\S]*?)```/g)){new AsyncFunction('dv',m[1]);blocks++;}
  for(const m of s.matchAll(/dv\.view\(["']([^"']+)["']/g)){assert.ok(fs.existsSync(path.join(root,'vault',m[1],'view.js')),`Missing view ${m[1]}`);views++;}
  const prose=s.replace(/```[\s\S]*?```/g,'');
  for(const m of prose.matchAll(/\[\[([^\]|#]+)(?:[^\]]*)\]\]/g)){assert.ok(files.some(f=>path.basename(f,'.md')===m[1]||path.relative(path.join(root,'vault'),f).replaceAll('\\','/')===m[1]+'.md'),`Missing link ${m[1]}`);links++;}
 }
}
const cards=files.filter(p=>p.endsWith('.md')&&fs.readFileSync(p,'utf8').includes('  - 复习/待复习'));
assert.equal(cards.length,2,'Expected only the blank template and one synthetic card');
const template=fs.readFileSync(path.join(root,'vault/模板/间隔复习模板.md'),'utf8');
assert.equal((template.match(/<% tp.date.now\("YYYY-MM-DD"\) %>/g)||[]).length,3);
assert.equal((template.match(/^### Q[1-6]：/gm)||[]).length,6);
const snippets=JSON.parse(fs.readFileSync(path.join(root,'vault/.obsidian/appearance.json'),'utf8')).enabledCssSnippets;
for(const name of snippets)assert.ok(fs.existsSync(path.join(root,'vault/.obsidian/snippets',name+'.css')));
const readme=fs.readFileSync(path.join(root,'README.md'),'utf8');
for(const m of readme.matchAll(/\]\(([^)]+)\)/g))if(!/^https?:/.test(m[1]))assert.ok(fs.existsSync(path.join(root,m[1])),`README link missing ${m[1]}`);
console.log(JSON.stringify({vaultFiles:files.length,dataviewBlocks:blocks,viewReferences:views,wikilinks:links,reviewDocuments:cards.length,cssSnippets:snippets.length,status:'PASS'},null,2));
