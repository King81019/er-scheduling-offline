'use strict';
(() => {
const $ = id => document.getElementById(id);
const KEY = 'er-scheduling-offline-v1';
const VERSION = 1;
const fresh = () => ({version: VERSION, people: [], shifts: [], months: {}});
let state = fresh();
let ym = Roster.currentYm();
let storageOK = true;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id = prefix => Roster.newId(prefix);
const validMonth = value => /^20\d{2}-(0[1-9]|1[0-2])$/.test(value) || /^2100-(0[1-9]|1[0-2])$/.test(value);
const dates = () => Roster.daysInMonth(ym);
const month = () => state.months[ym] ??= {off: {}, needs: {}, cells: null};
function message(text, error = false) { $('status').textContent = text; $('status').className = error ? 'error' : ''; }
function save(text = '已儲存在此瀏覽器') {
  try { localStorage.setItem(KEY, JSON.stringify(state)); storageOK = true; message(text); }
  catch { storageOK = false; message('瀏覽器無法儲存，資料暫存在記憶體，請在關閉前匯出備份。', true); }
}
const record = x => x && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
function validate(input) {
  const fail = () => { throw new Error('備份格式不正確或版本不支援，原有資料未變更。'); };
  if (!record(input) || input.version !== VERSION || !Array.isArray(input.people) || !Array.isArray(input.shifts) || !record(input.months)) fail();
  if (input.people.length > 200 || input.shifts.length > 20 || Object.keys(input.months).length > 240) fail();
  const ids = new Set(); const names = new Set();
  const text = x => typeof x === 'string' && x.length > 0 && x.length <= 100;
  const safeId = x => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(x) && !['__proto__','constructor','prototype'].includes(x);
  const out = fresh();
  for (const s of input.shifts) {
    if (!record(s) || !safeId(s.id) || ids.has(s.id) || !text(s.label) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.end) || s.start === s.end || !Number.isInteger(s.need) || s.need < 0 || s.need > 200) fail();
    ids.add(s.id); out.shifts.push({id:s.id,label:s.label,start:s.start,end:s.end,need:s.need});
  }
  const shiftIds = new Set(ids); ids.clear();
  for (const p of input.people) {
    if (!record(p) || !safeId(p.id) || ids.has(p.id) || !text(p.name) || names.has(p.name) || !Array.isArray(p.allowed) || p.allowed.some(s => !shiftIds.has(s))) fail();
    ids.add(p.id); names.add(p.name); out.people.push({id:p.id,name:p.name,allowed:[...new Set(p.allowed)]});
  }
  for (const [key,m] of Object.entries(input.months)) {
    if (!validMonth(key) || !record(m) || !record(m.off) || !record(m.needs) || !(m.cells === null || record(m.cells))) fail();
    const daySet = new Set(Roster.daysInMonth(key));
    const clean = {off:{}, needs:{}, cells:m.cells === null ? null : {}};
    for (const [pid,days] of Object.entries(m.off)) {
      if (!ids.has(pid) || !Array.isArray(days) || days.length > 31 || days.some(d => !daySet.has(d))) fail();
      clean.off[pid] = [...new Set(days)];
    }
    for (const [day,needs] of Object.entries(m.needs)) {
      if (!daySet.has(day) || !record(needs)) fail(); clean.needs[day] = {};
      for (const [sid,n] of Object.entries(needs)) {
        if (!shiftIds.has(sid) || !Number.isInteger(n) || n < 0 || n > 200) fail(); clean.needs[day][sid] = n;
      }
    }
    if (m.cells !== null) for (const [pid,row] of Object.entries(m.cells)) {
      if (!ids.has(pid) || !record(row)) fail(); clean.cells[pid] = {};
      for (const [day,sid] of Object.entries(row)) {
        if (!daySet.has(day) || !shiftIds.has(sid)) fail(); clean.cells[pid][day] = sid;
      }
    }
    out.months[key] = clean;
  }
  return out;
}
try {
  const stored = localStorage.getItem(KEY);
  if (stored) state = validate(JSON.parse(stored));
} catch { storageOK = false; message('無法讀取儲存資料，請匯入備份。原有儲存資料尚未覆寫。', true); }
$('month').value = ym;
function dayHeaders() { return dates().map(d => `<th scope="col">${Number(d.slice(-2))}<div class="day">${Roster.WEEKDAY_LABELS[Roster.weekdayOf(d)]}</div></th>`).join(''); }
function renderShifts() {
  $('shifts').innerHTML = state.shifts.map(s => `<tr data-shift="${s.id}"><td><input aria-label="班種名稱" data-field="label" value="${esc(s.label)}" maxlength="100" style="width:110px"></td><td><input aria-label="開始時間" type="time" data-field="start" value="${s.start}"></td><td><input aria-label="結束時間" type="time" data-field="end" value="${s.end}"></td><td><input aria-label="每日需求人數" type="number" data-field="need" min="0" max="200" value="${s.need}"></td><td><button class="danger" data-delete="${s.id}" aria-label="刪除 ${esc(s.label)}">刪除</button></td></tr>`).join('');
}
function renderAllowed() {
  if (!state.people.length || !state.shifts.length) { $('allowed').innerHTML = '<p class="empty">設定人員與班種後，可在這裡調整。</p>'; return; }
  $('allowed').innerHTML = `<table><thead><tr><th>人員</th>${state.shifts.map(s => `<th>${esc(s.label)}</th>`).join('')}</tr></thead><tbody>${state.people.map(p => `<tr><th scope="row">${esc(p.name)}</th>${state.shifts.map(s => `<td><input type="checkbox" aria-label="${esc(p.name)} 可上 ${esc(s.label)}" data-person="${p.id}" data-shift="${s.id}" ${p.allowed.includes(s.id) ? 'checked' : ''}></td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function renderVacations() {
  $('vacations').innerHTML = state.people.length ? `<table><thead><tr><th>人員</th>${dayHeaders()}</tr></thead><tbody>${state.people.map(p => `<tr><th scope="row">${esc(p.name)}</th>${dates().map(d => {const off = (month().off[p.id] ?? []).includes(d); return `<td><button class="vacation" data-person="${p.id}" data-day="${d}" aria-label="${esc(p.name)} ${d} 預假" aria-pressed="${off}">${off ? '休' : '·'}</button></td>`;}).join('')}</tr>`).join('')}</tbody></table>` : '<p class="empty">請先新增人員名單。</p>';
}
function renderNeeds() {
  $('requirements').innerHTML = state.shifts.length ? `<table><thead><tr><th>班種</th>${dayHeaders()}</tr></thead><tbody>${state.shifts.map(s => `<tr><th scope="row">${esc(s.label)}</th>${dates().map(d => `<td><input type="number" min="0" max="200" placeholder="${s.need}" value="${month().needs[d]?.[s.id] ?? ''}" data-day="${d}" data-shift="${s.id}" aria-label="${d} ${esc(s.label)}需求"></td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p class="empty">請先新增班種。</p>';
}
const need = (d,s) => month().needs[d]?.[s.id] ?? s.need;
function summary() {
  const m = month(); const warnings = []; const shortages = []; const counts = {}; const hours = {};
  for (const d of dates()) for (const s of state.shifts) {
    const got = state.people.filter(p => m.cells?.[p.id]?.[d] === s.id).length;
    if (got < need(d,s)) shortages.push(`${d} ${s.label}：缺 ${need(d,s) - got} 人`);
    if (got > need(d,s)) warnings.push(`${d} ${s.label}：超出需求 ${got - need(d,s)} 人`);
  }
  for (const p of state.people) {
    let consecutive = 0; let longest = 0; let end = -Infinity; let overtime = 0; counts[p.id] = 0; hours[p.id] = 0;
    dates().forEach((d,i) => {
      const sid = m.cells?.[p.id]?.[d]; const s = state.shifts.find(s => s.id === sid);
      if (!s) { consecutive = 0; return; }
      counts[p.id]++; hours[p.id] += Roster.shiftHours(s); overtime += Math.max(0, Roster.shiftHours(s) - 10);
      longest = Math.max(longest, ++consecutive);
      const start = i*1440 + Number(s.start.slice(0,2))*60 + Number(s.start.slice(3));
      if (start - end < 660) warnings.push(`${p.name} ${d}：班間休息少於 11 小時`);
      end = start + Roster.shiftHours(s)*60;
      if ((m.off[p.id] ?? []).includes(d)) warnings.push(`${p.name} ${d}：排在預假日`);
      if (!p.allowed.includes(sid)) warnings.push(`${p.name} ${d}：排入未勾選的班種`);
    });
    if (longest > 5) warnings.push(`${p.name}：最多連續上班 ${longest} 天（超過引擎 5 天上限）`);
    if (overtime > 46) warnings.push(`${p.name}：以每日 10 小時以上計的延長工時 ${overtime} 小時，超過引擎 46 小時上限`);
    for (const [span,minOff] of [[14,2],[28,8]]) {
      for (let i=0;i+span<=dates().length;i++) {
        const off = dates().slice(i,i+span).filter(d => !m.cells?.[p.id]?.[d]).length;
        if (off < minOff) { warnings.push(`${p.name}：${dates()[i]} 起 ${span} 天內未排班日少於 ${minOff} 天`); break; }
      }
    }
  }
  return {warnings, shortages, counts, hours};
}
function renderSchedule() {
  const m = month();
  $('csv').disabled = $('print').disabled = !m.cells;
  if (!m.cells) { $('schedule').innerHTML = '<p class="empty">此月份尚無班表。設定完成後，按「自動排班」或「建立空白班表」。</p>'; $('checks').textContent = ''; return; }
  const stats = summary();
  $('schedule').innerHTML = `<table><caption>${esc(ym)} 班表</caption><thead><tr><th>人員</th>${dayHeaders()}<th>班數</th><th>時數</th></tr></thead><tbody>${state.people.map(p => `<tr><th scope="row">${esc(p.name)}</th>${dates().map(d => {const sid = m.cells[p.id]?.[d] ?? ''; return `<td class="${(m.off[p.id] ?? []).includes(d) ? 'off' : ''}"><select aria-label="${esc(p.name)} ${d} 班種" data-person="${p.id}" data-day="${d}"><option value="">休</option>${state.shifts.map(s => `<option value="${s.id}" ${s.id === sid ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select><span class="print-only">${esc(state.shifts.find(s => s.id === sid)?.label ?? '休')}</span></td>`;}).join('')}<td>${stats.counts[p.id]}</td><td>${Number(stats.hours[p.id].toFixed(2))}</td></tr>`).join('')}</tbody></table>`;
  $('checks').innerHTML = `<p>${stats.shortages.length ? `${stats.shortages.length} 個班次有缺額` : '每日需求皆已滿足'} · ${stats.warnings.length} 項排班提示</p>${stats.shortages.length ? `<details><summary>查看缺額</summary><ul>${stats.shortages.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}${stats.warnings.length ? `<details open><summary>查看排班提示</summary><ul>${stats.warnings.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}`;
}
function render() { $('people').value = state.people.map(p => p.name).join('\n'); renderShifts(); renderAllowed(); renderVacations(); renderNeeds(); renderSchedule(); }
function changed() { save('已儲存設定；既有班表可手動調整或重新排班。'); renderAllowed(); renderNeeds(); renderSchedule(); }
$('applyPeople').onclick = () => {
  const names = $('people').value.split('\n').map(n => n.trim()).filter(Boolean);
  if (names.length > 200 || names.some(n => n.length > 100) || new Set(names).size !== names.length) { message('姓名不可重複，每個姓名最多 100 字，名單最多 200 人。',true); return; }
  const removed = state.people.filter(p => !names.includes(p.name));
  if (removed.length && !confirm('移除人員也會移除其各月預假和班表。確定套用？')) return;
  state.people = names.map(name => state.people.find(p => p.name === name) ?? {id:id('p'),name,allowed:state.shifts.map(s=>s.id)});
  for (const m of Object.values(state.months)) for (const p of removed) { delete m.off[p.id]; if (m.cells) delete m.cells[p.id]; }
  save(); render();
};
$('addShift').onclick = () => {
  if (state.shifts.length >= 20) { message('最多設定 20 種班種。',true); return; }
  const sid = id('s'); state.shifts.push({id:sid,label:`班種 ${state.shifts.length+1}`,start:'08:00',end:'16:00',need:1});
  for (const p of state.people) p.allowed.push(sid);
  save(); render();
};
$('shifts').onchange = e => {
  const input = e.target; const row = input.closest('[data-shift]'); if (!row || !input.dataset.field) return;
  const s = state.shifts.find(s => s.id === row.dataset.shift); const field = input.dataset.field;
  if (!input.checkValidity() || !input.value.trim() || (field === 'need' && !Number.isInteger(Number(input.value)))) { message('請填寫有效的班種設定，人數需為 0–200 的整數。',true); renderShifts(); return; }
  const value = field === 'need' ? Number(input.value) : input.value.trim();
  if ((field === 'start' && value === s.end) || (field === 'end' && value === s.start)) { message('開始與結束不可相同。',true); renderShifts(); return; }
  s[field] = value; changed();
};
$('shifts').onclick = e => {
  const sid = e.target.closest('[data-delete]')?.dataset.delete;
  if (!sid || !confirm('刪除此班種也會清除各月份對應班表格與需求。確定刪除？')) return;
  state.shifts = state.shifts.filter(s => s.id !== sid);
  for (const p of state.people) p.allowed = p.allowed.filter(s => s !== sid);
  for (const m of Object.values(state.months)) { for (const n of Object.values(m.needs)) delete n[sid]; if (m.cells) for (const row of Object.values(m.cells)) for (const d of Object.keys(row)) if (row[d] === sid) delete row[d]; }
  save(); render();
};
$('allowed').onchange = e => { const {person,shift} = e.target.dataset; const p = state.people.find(p => p.id === person); if (!p) return; p.allowed = e.target.checked ? [...new Set([...p.allowed,shift])] : p.allowed.filter(s => s !== shift); changed(); };
$('month').onchange = () => { const next = $('month').value; if (!validMonth(next)) { $('month').value = ym; message('請選擇 2000–2100 年的有效月份。',true); return; } ym = next; renderVacations(); renderNeeds(); renderSchedule(); message('已切換月份'); };
$('vacations').onclick = e => { const b = e.target.closest('[data-person]'); if (!b) return; const {person,day} = b.dataset; const off = month().off[person] ?? []; month().off[person] = off.includes(day) ? off.filter(d => d !== day) : [...off,day]; save(); b.setAttribute('aria-pressed',String(month().off[person].includes(day))); b.textContent = month().off[person].includes(day) ? '休' : '·'; renderSchedule(); };
$('requirements').onchange = e => { const {day,shift} = e.target.dataset; if (!day) return; const value = e.target.value; if (!e.target.checkValidity() || (value !== '' && !Number.isInteger(Number(value)))) { message('需求需為 0–200 的整數。',true); renderNeeds(); return; } const needs = month().needs[day] ??= {}; if (value === '') delete needs[shift]; else needs[shift] = Number(value); save(); renderSchedule(); };
function canCreate() { if (!state.people.length || !state.shifts.length) { message('請先設定人員及班種。',true); return false; } return !month().cells || confirm('這會覆寫本月既有班表，建議先匯出備份。確定繼續？'); }
$('generate').onclick = () => {
  if (!canCreate()) return;
  try {
    const config = {...Roster.emptyConfig(), people:state.people.filter(p=>p.allowed.length).map(p=>({id:p.id,empId:p.id,name:p.name,allowedShifts:p.allowed})), shifts:state.shifts, positions:[{id:'general',label:'一般'}], defaultReq:Object.fromEntries(state.shifts.map(s=>[s.id,{general:s.need}])), dailyReq:{}};
    for (const d of dates()) config.dailyReq[d] = Object.fromEntries(state.shifts.map(s=>[s.id,{general:need(d,s)}]));
    const vacation = {ym,group:'offline',people:state.people.map(p=>({empId:p.id,name:p.name,days:Object.fromEntries((month().off[p.id]??[]).map(d=>[d,{raw:'OFF',off:true}]))}))};
    const result = Roster.generateSchedule(config,ym,vacation);
    const cells = Object.fromEntries(state.people.map(p=>[p.id,{}]));
    for (const [d,shifts] of Object.entries(result.assignments)) for (const [sid,positions] of Object.entries(shifts)) for (const pids of Object.values(positions)) for (const pid of pids) cells[pid][d] = sid;
    month().cells = cells; save('已產生並儲存本月班表，請檢查缺額與提示。'); renderSchedule();
  } catch (error) { message(`排班失敗：${error.message}，可嘗試減少人數或需求。`,true); }
};
$('blank').onclick = () => { if (!canCreate()) return; month().cells = {}; save(); renderSchedule(); };
$('schedule').onchange = e => { const {person,day} = e.target.dataset; if (!person) return; const row = month().cells[person] ??= {}; if (e.target.value) row[day] = e.target.value; else delete row[day]; save(); renderSchedule(); };
function download(name,body,type) { const url = URL.createObjectURL(new Blob([body],{type})); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }
$('backup').onclick = () => { download(`排班備份-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(state,null,2),'application/json'); message(storageOK ? '已匯出所有月份與設定的備份。' : '已匯出備份，請確認檔案已下載。'); };
$('import').onclick = () => $('restore').click();
$('restore').onchange = async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    if (file.size > 10*1024*1024) throw new Error('備份檔案過大（上限 10 MB）。');
    const restored = validate(JSON.parse(await file.text()));
    if (!confirm('匯入會取代全部名單、設定及各月份班表，確定繼續？')) return;
    state = restored; save('已匯入備份'); render();
  } catch (error) { message(`匯入失敗：${error.message}`,true); }
  finally { e.target.value = ''; }
};
$('csv').onclick = () => {
  if (!month().cells) return;
  const stats = summary();
  const safeCell = v => { const text = String(v); return '"' + (/^[\s]*[=+@-]/.test(text) ? "'"+text : text).replace(/"/g,'""') + '"'; };
  const rows = [['人員',...dates(),'班數','時數'],...state.people.map(p=>[p.name,...dates().map(d=>state.shifts.find(s=>s.id === month().cells[p.id]?.[d])?.label ?? '休'),stats.counts[p.id],Number(stats.hours[p.id].toFixed(2))])];
  download(`班表-${ym}.csv`,'\uFEFF'+rows.map(row=>row.map(safeCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
};
$('print').onclick = () => window.print();
$('reset').onclick = () => { if (!confirm('將清除這個瀏覽器中的全部人員、設定和班表。請先匯出備份。確定清除？')) return; state = fresh(); save('已清除全部資料'); render(); };
render();
if (storageOK) message('已就緒，變更會自動儲存在此瀏覽器。');
})();
