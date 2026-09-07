const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..', 'vault');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const source = read('复习/系统/自适应复习控件/view.js');
const fixture = read('复习/示例卡片/示例 - 主动回忆.md');
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const api = vm.runInNewContext(source.slice(0,source.indexOf('const page = dv.current();')) + '\n({calculateSchedule,fmt,frontmatterValue,upsertFrontmatter,appendHistory});',{require:()=>({Notice:class {}}), Date});
const today = new Date(2026,0,31);
const schedule = (score,stage='D0',streak=0) => api.calculateSchedule({score,stage,streak,round:2,today});

test('score 1 restarts tomorrow and preserves the incremented round',()=>{
 const r=schedule(1,'D30',3); assert.equal(r.stage,'D0'); assert.equal(r.round,3); assert.equal(r.streak,0); assert.equal(api.fmt(r.nextDate),'2026-02-01'); assert.equal(r.mode,'完整复习');
});
test('score 2 holds stage and schedules a two-day full review',()=>{
 const r=schedule(2,'D14',3); assert.equal(r.stage,'D14'); assert.equal(r.round,2); assert.equal(r.streak,0); assert.equal(api.fmt(r.nextDate),'2026-02-02'); assert.equal(r.mode,'完整复习');
});
for(const [i,stage] of ['D0','D1','D3','D7','D14','D30'].entries()) {
 test(`score 3 advances ${stage} with the documented interval`,()=>{
  const r=schedule(3,stage,3); const expected=new Date(today); expected.setDate(today.getDate()+[1,2,4,7,16,30][i]);
  assert.equal(api.fmt(r.nextDate),api.fmt(expected)); assert.equal(r.stage,['D1','D3','D7','D14','D30','D60'][i]); assert.equal(r.streak,0);
 });
}
test('consecutive 4s extend without skipping a stage',()=>{
 assert.equal(api.fmt(schedule(4,'D3',0).nextDate),'2026-02-04');
 const r=schedule(4,'D3',1); assert.equal(api.fmt(r.nextDate),'2026-02-05'); assert.equal(r.stage,'D7'); assert.equal(r.mode,'完整复习');
});
test('last stage only completes on 3 or 4',()=>{
 for(const score of [3,4]) { const r=schedule(score,'D60'); assert.equal(r.status,'已完成'); assert.equal(r.nextDate,null); }
 for(const score of [1,2]) assert.equal(schedule(score,'D60').status,'进行中');
});
test('calendar arithmetic crosses DST without shifting the local date',()=>{
 const r=api.calculateSchedule({score:3,stage:'D1',round:1,streak:0,today:new Date(2026,2,7)});
 assert.equal(api.fmt(r.nextDate),'2026-03-09'); assert.equal(r.nextDate.getHours(),0);
});
test('frontmatter edit retains body and existing history for LF and CRLF',()=>{
 for(const ending of ['\n','\r\n']) {
  const s=fixture.replaceAll('\n',ending); const changed=api.upsertFrontmatter(s,'当前阶段','D3');
  assert.equal(api.frontmatterValue(changed,'当前阶段'),'D3'); assert.ok(changed.includes('A6')); assert.ok(changed.includes('REVIEW_HISTORY_END'));
 }
});

class Element {
 constructor(tag,options={}) { this.tag=tag; this.children=[]; this.style={}; this.classList={add(){}}; this.textContent=options.text??''; this.disabled=false; }
 appendChild(e){this.children.push(e); return e;}
 createEl(tag,options){return this.appendChild(new Element(tag,options));}
 createDiv(options){return this.createEl('div',options);}
 createSpan(options){return this.createEl('span',options);}
 addClass(){}
 replaceChildren(){this.children=[];}
 setText(s){this.textContent=s;}
 addEventListener(name,fn){this['on'+name]=fn;}
 setAttr(){}
 querySelectorAll(){return [];}
 remove(){}
 empty(){this.children=[];}
}
function dataArray(items) {items.where=fn=>dataArray(items.filter(fn)); return items;}
function pageOf(text) {
 const props={}; for(const line of text.split('---')[1].split('\n')) {const m=line.match(/^([^ :]+):\s*(.*)$/); if(m)props[m[1]]=m[2];}
 return {...props,file:{path:'复习/示例卡片/示例 - 主动回忆.md',name:'示例 - 主动回忆',folder:'复习/示例卡片',tags:['#复习/待复习'],link:'示例',etags:['#复习/待复习']}};
}
function environment(initial=fixture,confirmed=true) {
 let text=initial; const prompts=[]; const notices=[]; const tables=[];
 const dv={current:()=>pageOf(text),page:()=>pageOf(text),pages:()=>dataArray([]),table:(h,r)=>tables.push([h,r]),paragraph(){},header(){},container:new Element('main'),io:{load:async()=>text}};
 const app={vault:{getAbstractFileByPath:p=>({path:p}),read:async()=>text,modify:async(f,s)=>{text=s;}}};
 const document={createElement:tag=>new Element(tag)};
 return {dv,app,document,prompts,notices,tables,text:()=>text,confirm:s=>(prompts.push(s),confirmed),require:()=>({Notice:class{constructor(s){notices.push(s);}}})};
}
async function runScore(e,score){await new AsyncFunction('dv','app','document','require','confirm',source)(e.dv,e.app,e.document,e.require,e.confirm);const controls=e.dv.container.children[0];await controls.children[score-1].onclick();}
test('real score handler writes state, appends history and clears reflection inputs',async()=>{
 const e=environment(fixture.replace('本轮最大漏洞：\n','本轮最大漏洞：混淆熟悉感\n').replace('一句话纠正：\n','一句话纠正：先合上书\n'));
 await runScore(e,3); assert.equal(api.frontmatterValue(e.text(),'当前阶段'),'D1');
 assert.match(e.text(),/- 本轮最大漏洞：混淆熟悉感/); assert.match(e.text(),/- 一句话纠正：先合上书/);
 assert.match(e.text(),/^本轮最大漏洞：$/m); assert.match(e.text(),/^一句话纠正：$/m); assert.equal((e.text().match(/评分 3/g)||[]).length,1);
 assert.ok(e.text().indexOf('评分 3')<e.text().indexOf('<!-- REVIEW_HISTORY_END -->')); assert.ok(e.notices[0].includes('已保存'));
});
test('cancelling confirmation never writes',async()=>{
 const e=environment(fixture,false); await runScore(e,1); assert.equal(e.text(),fixture);
});
test('same-day scoring warns before appending a second record',async()=>{
 const e=environment(); await runScore(e,3); const second=environment(e.text()); await runScore(second,3);
 assert.ok(second.prompts[0].includes('今天已经评分过一次')); assert.equal((second.text().match(/· 评分 3/g)||[]).length,2);
});
test('vault write failure reports failure and restores enabled buttons',async()=>{
 const e=environment(); e.app.vault.modify=async()=>{throw Error('test write failure');};
 await runScore(e,3); assert.equal(e.text(),fixture); assert.ok(e.notices[0].includes('失败')); assert.ok(e.dv.container.children[0].children.every(b=>!b.disabled));
});
test('archive restart preserves history and increments round',async()=>{
 const completed=api.upsertFrontmatter(api.upsertFrontmatter(fixture,'状态','已完成'),'当前阶段','已完成').replace('<!-- REVIEW_HISTORY_END -->','### 2026-01-01 · 第 1 轮 · 阶段 7 · 评分 3\n\n- 本轮最大漏洞：保留证据\n\n<!-- REVIEW_HISTORY_END -->');
 const e=environment(completed); const archive=read('复习/复习完成归档.md').match(/```dataviewjs\n([\s\S]*?)```/)[1];
 const restart=await new AsyncFunction('dv','app','document','require','confirm',archive+'\nreturn restartAdaptive;')(e.dv,e.app,e.document,e.require,e.confirm);
 await restart(pageOf(completed),new Element('button')); assert.equal(api.frontmatterValue(e.text(),'复习轮次'),'2'); assert.equal(api.frontmatterValue(e.text(),'当前阶段'),'D0'); assert.ok(e.text().includes('保留证据')); assert.ok(e.text().includes('手动重新开始'));
});
test('future preview reads pure dates locally and supports ordinary legacy checkboxes',async()=>{
 const s=read('复习/系统/未来复习预览/view.js');
 const prefix=s.slice(0,s.indexOf('const pages ='))+'\nreturn {toDate,fmt};'; const e=environment();
 const f=await new AsyncFunction('dv',prefix)(e.dv); assert.equal(f.fmt(f.toDate('2026-01-01')),'2026-01-01');
 const p=pageOf(fixture); delete p.下次复习日; delete p.调度类型; p.复习起始日='2099-01-01';
 e.dv.pages=()=>dataArray([p]); e.dv.io.load=async()=>'- [x] D0\n- [ ] D1\n- [ ] D7\n- [ ] D14\n- [ ] D30\n- [ ] D60';
 const items=await new AsyncFunction('dv',s.slice(0,s.indexOf('function render('))+'\nreturn items;')(e.dv);
 assert.equal(items.length,1); assert.equal(items[0].stage,'节点 D1'); assert.equal(f.fmt(items[0].due),'2099-01-02');
});
test('optional grammar scanning is off by default and explicit when enabled',async()=>{
 const s=read('复习/系统/复习诊断面板/view.js'); const prefix=s.slice(0,s.indexOf('const cards ='))+'\nreturn pageArray;';
 const e=environment(); const p=pageOf(fixture); p.file.path='复习/英语语法复习/测试.md';p.file.tags=[];e.dv.pages=()=>dataArray([p]);
 const run=new AsyncFunction('dv','input',prefix); assert.equal((await run(e.dv,undefined)).length,0); assert.equal((await run(e.dv,{grammarPrefix:'复习/英语语法复习/'})).length,1);
});
test('diagnostics renders a generic subject with its subcategory and no integrity errors',async()=>{
 const e=environment(); const p=pageOf(fixture); e.dv.pages=()=>dataArray([p]);
 const s=read('复习/系统/复习诊断面板/view.js');
 const result=await new AsyncFunction('dv','input',s+'\nreturn {cards,integrityItems,analysisPanel};')(e.dv,undefined);
 assert.equal(result.cards.length,1); assert.equal(result.cards[0].category,'记忆策略'); assert.equal(result.integrityItems.length,0);
 const all=el=>[el,...el.children.flatMap(all)]; assert.ok(all(result.analysisPanel).some(el=>el.textContent==='记忆策略'));
});
test('empty diagnostics and future preview render without cards',async()=>{
 const e=environment(); for(const file of ['复习诊断面板','未来复习预览'])await new AsyncFunction('dv','input',read(`复习/系统/${file}/view.js`))(e.dv,undefined);
});
