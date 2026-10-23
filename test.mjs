import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
const html = fs.readFileSync(new URL('./er-scheduling-offline.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function open(store = new Map(), blocked = false) {
  const elements = new Map(); const downloads = [];
  const element = id => elements.get(id) ?? (elements.set(id, {value:'',innerHTML:'',textContent:'',className:'',disabled:false,files:[]}),elements.get(id));
  const sandbox = {console, Blob, setTimeout:fn=>fn(), confirm:()=>true,
    localStorage:{getItem:key=>store.get(key)??null,setItem:(key,value)=>{if(blocked)throw Error('blocked');store.set(key,value);}},
    document:{getElementById:element,createElement:()=>({click(){downloads.push(this);}})},
    URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{}},window:{print(){}},
  };
  vm.runInNewContext(script,sandbox);
  return {el:element,store,downloads,state:()=>JSON.parse([...store.values()][0] || '{}')};
}
function setup() {
  const a = open(); a.el('people').value = '甲\n乙\n丙'; a.el('applyPeople').onclick(); a.el('addShift').onclick();
  return a;
}
test('single HTML contains no runtime network dependencies',()=>{
  assert(!/<(?:script|link)[^>]+(?:src|href)=/i.test(html));
  assert(!/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/.test(script));
  assert(html.includes("connect-src 'none'"));
});
test('first open is blank; engine respects whole-day vacation and persists after reload',()=>{
  const a=setup(); const initial=a.state(); assert.equal(initial.shifts.length,1);
  const pid=initial.people[0].id; const ym=a.el('month').value; const day=`${ym}-01`;
  a.el('vacations').onclick({target:{closest:()=>({dataset:{person:pid,day},setAttribute(){},textContent:''})}});
  a.el('generate').onclick(); const m=a.state().months[ym]; assert(m.cells); assert(!m.cells[pid][day]);
  assert(!a.el('status').className.includes('error'));
  const b=open(a.store); assert(b.el('schedule').innerHTML.includes('班表')); assert(b.el('people').value.includes('甲'));
});
test('unchecking all shifts excludes person from automatic assignments',()=>{
  const a=setup(); const {people,shifts}=a.state();
  a.el('allowed').onchange({target:{dataset:{person:people[0].id,shift:shifts[0].id},checked:false}});
  a.el('generate').onclick(); assert.deepEqual(a.state().months[a.el('month').value].cells[people[0].id],{});
});
test('manual vacation conflict updates checks and can export CSV and backup',()=>{
  const a=setup(); const {people,shifts}=a.state(); const day=`${a.el('month').value}-01`;
  a.el('vacations').onclick({target:{closest:()=>({dataset:{person:people[0].id,day},setAttribute(){}})}});
  a.el('blank').onclick();
  a.el('schedule').onchange({target:{dataset:{person:people[0].id,day},value:shifts[0].id}});
  assert(a.el('checks').innerHTML.includes('排在預假日'));
  a.el('csv').onclick(); a.el('backup').onclick(); assert.equal(a.downloads.length,2);
});
test('backup validation rejects invalid input without changing current data and accepts valid backup',async()=>{
  const a=setup(); const before=JSON.stringify(a.state());
  a.el('restore').files=[{size:100,text:async()=>'{"version":999}'}];
  await a.el('restore').onchange({target:a.el('restore')}); assert(a.el('status').textContent.includes('匯入失敗')); assert.equal(JSON.stringify(a.state()),before);
  const b=open(); b.el('restore').files=[{size:before.length,text:async()=>before}];
  await b.el('restore').onchange({target:b.el('restore')}); assert.deepEqual(b.state(),a.state());
});
test('month isolation, demand overrides and shortage reporting',()=>{
  const a=setup(); const sid=a.state().shifts[0].id; const current=a.el('month').value; const day=`${current}-01`;
  a.el('requirements').onchange({target:{dataset:{day,shift:sid},value:'10',checkValidity:()=>true}});
  a.el('generate').onclick(); assert(a.el('checks').innerHTML.includes('缺 7 人'));
  a.el('month').value='2027-02'; a.el('month').onchange(); assert(a.el('schedule').innerHTML.includes('尚無班表'));
  a.el('month').value=current; a.el('month').onchange(); assert(a.el('schedule').innerHTML.includes('班表'));
});
test('blocked storage allows in-memory use and warns about backup',()=>{
  const a=open(new Map(),true); a.el('people').value='甲'; a.el('applyPeople').onclick();
  assert(a.el('status').textContent.includes('無法儲存')); assert(a.el('people').value.includes('甲'));
  a.el('backup').onclick(); assert.equal(a.downloads.length,1);
});
test('names containing markup are escaped in rendered tables',()=>{
  const a=open(); a.el('people').value='<img src=x onerror=alert(1)>'; a.el('applyPeople').onclick();
  assert(!a.el('vacations').innerHTML.includes('<img')); assert(a.el('vacations').innerHTML.includes('&lt;img'));
});
