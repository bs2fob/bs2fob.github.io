// scrawl.js
// 관리자 전용 낙서장. day_log 메모 체계를 옮겨 비공개 저장소 bs2fob/scrawl 과 동기화한다
(function(){
const REPO='https://api.github.com/repos/bs2fob/scrawl';
const SHARD_DIR='log_data';
const RAW_DIR='raw';
const ADMIN='bs2fob-admin';
const LS={logs:'bs2fob-scrawl-logs',tombs:'bs2fob-scrawl-tombs',dirty:'bs2fob-scrawl-dirty',draft:'bs2fob-scrawl-draft',sub:'bs2fob-scrawl-sub'};
const SUBS=[['write','작성'],['weeks','주차'],['search','검색'],['pin','비망']];
const CHARS=['✶','✦','✧','⛧','◅','▻','➢'];

let root=null;
let sub=lsGet(LS.sub)||'write';
let memos=cacheLoad()||[];
let shardSha={},shardSaved={},loaded=new Set(),allLoaded=false;
let saving=false;
let pending=[],editPending=[];
let weeksShown=1;
let openWeek=null;
let query='';
let sync={state:'',text:''};
const blobs=new Map();

function lsGet(k){try{return localStorage.getItem(k);}catch(e){return null;}}
function lsSet(k,v){try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v);}catch(e){}}
function token(){return lsGet('bs2fob-admin-off')?'':lsGet(ADMIN)||'';}
function live(){return !!root&&document.body.contains(root);}
function $(sel){return root.querySelector(sel);}

// qcode 는 그 해 1월 1일 이전 마지막 일요일 기준이므로 달력 날짜를 되계산할 수 있다
function getFirstSunday(y){
  const j=new Date(y,0,1);const d=j.getDay();
  const s=new Date(j);s.setDate(j.getDate()-d);return s;
}
function buildQcode(d){
  const yy=String(d.getFullYear()).slice(-2);
  const ww=String(Math.floor((d-getFirstSunday(d.getFullYear()))/86400000/7)+1).padStart(2,'0');
  return `${yy}w${ww}${d.getDay()}v${String(d.getHours()).padStart(2,'0')}${Math.floor(d.getMinutes()/10)}`;
}
const DAYS=['일','월','화','수','목','금','토'];
function qcodeLabel(qc){
  const m=qc.match(/^(\d{2})w(\d{2})(\d)v(\d{2})(\d)$/);
  if(!m)return qc;
  return `20${m[1]}년 ${+m[2]}주차 ${DAYS[+m[3]]}요일 ${m[4]}:${m[5]}0`;
}
function qcodeToDate(qc){
  const m=qc.match(/^(\d{2})w(\d{2})(\d)/);
  if(!m)return null;
  const d=getFirstSunday(2000+ +m[1]);
  d.setDate(d.getDate()+(+m[2]-1)*7+ +m[3]);
  return d;
}
function dayKey(qc){return qc.slice(0,6);}
function dayLabel(qc){
  const d=qcodeToDate(qc);
  const dow=DAYS[+qc[5]]||'';
  if(!d)return dow+'요일';
  return `${d.getMonth()+1}월 ${d.getDate()}일<span class="sc-dow">${dow}</span>`;
}
function weekKey(qc){const m=qc.match(/^(\d{2}w\d{2})/);return m?m[1]:'';}
function weekLabel(wk){
  const m=wk.match(/^(\d{2})w(\d{2})$/);
  return m?`20${m[1]}년 ${+m[2]}주차`:wk;
}

function gh(path,opt){
  opt=opt||{};
  opt.headers=Object.assign({Authorization:`Bearer ${token()}`,Accept:'application/vnd.github+json'},opt.headers||{});
  return fetch(REPO+path,opt);
}
function put(path,body){
  return gh(path,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
}
function b64dec(s){return decodeURIComponent(escape(atob(s.replace(/\n/g,''))));}
function b64enc(s){return btoa(unescape(encodeURIComponent(s)));}

// 주차 10개가 한 덩어리이며 41 블록만 그 해 마지막 주차까지 품는다
function shardOf(qc){
  const m=qc.match(/^(\d{2})w(\d{2})/);
  if(!m)return '';
  const w=+m[2];
  const b=w<=10?1:w<=20?11:w<=30?21:w<=40?31:41;
  return `${m[1]}w${String(b).padStart(2,'0')}`;
}
function currentShard(){return shardOf(buildQcode(new Date()));}
function shardPath(sh){return `/contents/${SHARD_DIR}/${sh}.nfo`;}

function cacheSave(){lsSet(LS.logs,JSON.stringify(memos));}
function cacheLoad(){
  try{const v=JSON.parse(lsGet(LS.logs)||'null');return Array.isArray(v)?v:null;}catch(e){return null;}
}
function readTombs(){
  try{const v=JSON.parse(lsGet(LS.tombs)||'[]');return Array.isArray(v)?v:[];}catch(e){return [];}
}
function writeTombs(list){lsSet(LS.tombs,JSON.stringify(list));}
function addTomb(id,sh){
  const t=readTombs();
  if(!t.some(x=>x.id===id)){t.push({id,sh:sh||currentShard()});writeTombs(t);}
}
function absorbTombs(remote){
  const t=readTombs();let changed=false;
  for(const e of (remote||[]))if(e&&!t.some(x=>x.id===e.id)){t.push(e);changed=true;}
  if(changed)writeTombs(t);
}
function setDirty(v){lsSet(LS.dirty,v?'1':null);}
function isDirty(){return lsGet(LS.dirty)==='1';}

function parseStore(v){
  if(v&&typeof v==='object')return {logs:Array.isArray(v.logs)?v.logs:[],tombs:Array.isArray(v.tombs)?v.tombs:[]};
  return {logs:[],tombs:[]};
}
function partitionLogs(){
  const map=new Map();
  for(const m of memos){
    const sh=shardOf(m.qc);
    if(!sh)continue;
    if(!map.has(sh))map.set(sh,[]);
    map.get(sh).push(m);
  }
  return map;
}
function serializeShard(sh,logs){
  return JSON.stringify({v:3,wk:sh,logs,tombs:readTombs().filter(t=>t.sh===sh)});
}

// 같은 id 는 mt 가 최신인 쪽을 쓰고 동률이면 원격이 이긴다. 묘비의 id 는 뺀다
function mergeLogs(remote,local){
  const dead=new Set(readTombs().map(t=>t.id));
  const map=new Map();
  for(const m of (remote||[]))map.set(m.id,m);
  for(const m of (local||[])){
    const r=map.get(m.id);
    if(!r||(m.mt||0)>(r.mt||0))map.set(m.id,m);
  }
  return [...map.values()].filter(m=>!dead.has(m.id))
    .sort((a,b)=>a.qc<b.qc?1:a.qc>b.qc?-1:b.id-a.id);
}

function setSync(state,text){
  sync={state,text};
  if(!live())return;
  const dot=$('.sc-dot');
  dot.className='sc-dot'+(state?' '+state:'');
  $('.sc-stat').textContent=text;
}

async function fetchShard(sh){
  const res=await gh(shardPath(sh));
  if(res.status===404){shardSha[sh]=null;return {logs:[],tombs:[]};}
  if(!res.ok)throw new Error(`HTTP ${res.status}`);
  const d=await res.json();
  shardSha[sh]=d.sha;
  const st=parseStore(JSON.parse(b64dec(d.content)));
  absorbTombs(st.tombs);
  shardSaved[sh]=serializeShard(sh,st.logs);
  return st;
}

let repoChecked=false;
async function checkRepo(){
  if(repoChecked)return;
  const r=await gh('');
  if(!r.ok)throw new Error(r.status===404
    ?'scrawl 저장소에 닿지 못했습니다. 관리자 토큰에 bs2fob/scrawl 저장소의 Contents 읽기·쓰기 권한을 더하세요.'
    :`저장소 접근 실패 (${r.status})`);
  repoChecked=true;
}

async function loadMemos(){
  if(!token())return;
  setSync('busy','불러오는 중...');
  try{
    await checkRepo();
    const cur=currentShard();
    const st=await fetchShard(cur);
    memos=mergeLogs(st.logs,memos);
    loaded.add(cur);
    cacheSave();
    renderAll();
    if(live())$('.sc-note').textContent='';
    setSync('ok',`불러옴 ${new Date().toLocaleTimeString()}`);
    if(isDirty()||shardSaved[cur]!==serializeShard(cur,partitionLogs().get(cur)||[]))await saveMemos({quiet:true});
    if(sub!=='write')loadAllShards();
  }catch(e){
    setSync('err','불러오기 실패 · 로컬 표시');
    if(live())$('.sc-note').textContent=e.message;
  }
}

// 주차·검색은 전체를 훑으므로 과거 덩어리를 모두 받는다
async function loadAllShards(){
  if(allLoaded||!token()||!repoChecked)return;
  setSync('busy','과거 기록 불러오는 중...');
  try{
    const res=await gh(`/contents/${SHARD_DIR}`);
    if(res.ok){
      for(const f of await res.json()){
        const sh=f.name.replace(/\.nfo$/,'');
        if(!/^\d{2}w\d{2}$/.test(sh)||loaded.has(sh))continue;
        const st=await fetchShard(sh);
        memos=mergeLogs(st.logs,memos);
        loaded.add(sh);
      }
    }else if(res.status!==404)throw new Error(`HTTP ${res.status}`);
    allLoaded=true;
    cacheSave();
    renderAll();
    setSync('ok',`불러옴 ${new Date().toLocaleTimeString()}`);
  }catch(e){
    setSync('err','과거 기록 불러오기 실패');
  }
}

// 덩어리 하나를 올린다. 충돌하면 다시 읽어 병합한 뒤 한 번 더 시도한다
async function putShard(sh){
  let c=serializeShard(sh,partitionLogs().get(sh)||[]);
  if(shardSaved[sh]===c)return;
  const body=()=>{
    const b={message:`scrawl ${sh} ${buildQcode(new Date())}`,content:b64enc(c)};
    if(shardSha[sh])b.sha=shardSha[sh];
    return b;
  };
  let res=await put(shardPath(sh),body());
  if(res.status===409||res.status===422){
    const st=await fetchShard(sh);
    memos=mergeLogs(st.logs,memos);
    cacheSave();renderAll();
    c=serializeShard(sh,partitionLogs().get(sh)||[]);
    res=await put(shardPath(sh),body());
  }
  if(!res.ok)throw new Error(`HTTP ${res.status}`);
  shardSha[sh]=(await res.json()).content.sha;
  shardSaved[sh]=c;
}

// 로컬에 먼저 남기고 원격을 읽어 병합한 뒤 올린다
async function saveMemos({quiet=false}={}){
  cacheSave();
  setDirty(true);
  if(!token()||saving)return;
  saving=true;
  setSync('busy','저장 중...');
  try{
    await checkRepo();
    const targets=new Set(partitionLogs().keys());
    for(const t of readTombs())targets.add(t.sh);
    targets.add(currentShard());
    for(const sh of targets){
      if(loaded.has(sh))continue;
      const st=await fetchShard(sh);
      memos=mergeLogs(st.logs,memos);
      loaded.add(sh);
    }
    cacheSave();renderAll();
    for(const sh of targets)await putShard(sh);
    setDirty(false);
    setSync('ok',`저장됨 ${new Date().toLocaleTimeString()}`);
  }catch(e){
    setSync('err','저장 대기 · 로컬 보관');
    if(!quiet)alert(`저장 실패\n내용은 이 기기에 남아 있고 자동으로 다시 시도합니다.\n${e.message}`);
  }finally{
    saving=false;
  }
}

// ── 첨부 ──
function fileExt(name){const m=name.match(/\.([^.]+)$/);return m?m[1].toLowerCase():'bin';}
const MIME={webp:'image/webp',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',
  mp3:'audio/mpeg',m4a:'audio/mp4',pdf:'application/pdf'};

// 이미지는 WebP 90 으로 바꾸고, 인코딩을 못 하는 브라우저는 JPEG 로 물러선다
function encodeImage(file){
  return new Promise((res,rej)=>{
    const img=new Image();
    const url=URL.createObjectURL(file);
    img.onload=()=>{
      const cv=document.createElement('canvas');
      cv.width=img.naturalWidth;cv.height=img.naturalHeight;
      const ctx=cv.getContext('2d');
      const emit=(blob,ext)=>{
        const r=new FileReader();
        r.onload=()=>{URL.revokeObjectURL(url);res({b64:r.result.split(',')[1],ext});};
        r.onerror=rej;
        r.readAsDataURL(blob);
      };
      ctx.drawImage(img,0,0);
      cv.toBlob(b=>{
        if(b&&b.type==='image/webp'){emit(b,'webp');return;}
        ctx.fillStyle='#ffffff';ctx.fillRect(0,0,cv.width,cv.height);ctx.drawImage(img,0,0);
        cv.toBlob(j=>{
          if(!j){URL.revokeObjectURL(url);rej(new Error('이미지 변환 실패'));return;}
          emit(j,'jpg');
        },'image/jpeg',0.91);
      },'image/webp',0.90);
    };
    img.onerror=()=>{URL.revokeObjectURL(url);rej(new Error('이미지 로드 실패'));};
    img.src=url;
  });
}
function fileToBase64(file){
  return new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=()=>res(r.result.split(',')[1]);
    r.onerror=rej;
    r.readAsDataURL(file);
  });
}
async function existingRaw(qc){
  try{
    const r=await gh(`/contents/${RAW_DIR}`);
    if(!r.ok)return new Set();
    return new Set((await r.json()).map(f=>f.name).filter(n=>n.startsWith(qc)));
  }catch(e){return new Set();}
}
function resolveName(qc,ext,taken){
  for(let n=1;n<=99;n++){
    const c=`${qc}_${String(n).padStart(2,'0')}.${ext}`;
    if(!taken.has(c)){taken.add(c);return c;}
  }
  throw new Error('파일 번호가 99를 초과합니다.');
}

// 비공개 저장소라 공개 주소가 없으므로 토큰으로 받아 객체 주소로 띄운다
function blobUrl(fn){
  if(!blobs.has(fn)){
    blobs.set(fn,gh(`/contents/${RAW_DIR}/${encodeURIComponent(fn)}`,{headers:{Accept:'application/vnd.github.raw'}})
      .then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.blob();})
      .then(b=>URL.createObjectURL(new Blob([b],{type:MIME[fileExt(fn)]||b.type})))
      .catch(e=>{blobs.delete(fn);throw e;}));
  }
  return blobs.get(fn);
}
function hydrate(){
  if(!live())return;
  root.querySelectorAll('[data-fn]:not([data-got])').forEach(el=>{
    el.dataset.got='1';
    if(el.tagName!=='IMG'&&el.tagName!=='AUDIO')return;
    blobUrl(el.dataset.fn).then(u=>{el.src=u;}).catch(()=>{
      const w=el.closest('.sc-img-wrap')||el;
      w.outerHTML=`<div class="sc-broken">불러올 수 없는 첨부 <code>${esc(el.dataset.fn)}</code></div>`;
    });
  });
}

// 지운 로그가 가리키던 raw/ 파일을 지운다. 남은 로그가 같은 파일을 쓰면 남긴다
async function deleteRaw(names){
  const alive=new Set();
  for(const m of memos)for(const a of (m.attachments||[]))alive.add(a.filename);
  for(const fn of new Set(names)){
    if(alive.has(fn))continue;
    try{
      const p=`/contents/${RAW_DIR}/${encodeURIComponent(fn)}`;
      const meta=await gh(p);
      if(!meta.ok)continue;
      const d=await meta.json();
      await gh(p,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:`raw drop ${fn}`,sha:d.sha})});
      blobs.delete(fn);
    }catch(e){}
  }
}

// ── 화면 ──
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function highlight(text,kw){
  if(!kw)return esc(text);
  const re=new RegExp(esc(kw).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi');
  return esc(text).replace(re,m=>`<mark>${m}</mark>`);
}

function attachHtml(list,id,kw){
  if(!list||!list.length)return '';
  return '<div class="sc-attach">'+list.map((a,i)=>{
    const del=`<button class="sc-x" data-act="del-att" data-id="${id}" data-i="${i}" title="첨부 삭제">✕</button>`;
    if(a.type==='image')return `<div class="sc-img-wrap"><img class="sc-img" data-fn="${esc(a.filename)}" alt="${esc(a.filename)}" data-act="zoom">${del}</div>`;
    const name=highlight(a.origName||a.filename,kw);
    if(a.type==='audio')return `<div class="sc-media"><audio controls data-fn="${esc(a.filename)}"></audio><div class="sc-fname">${name}${del}</div></div>`;
    if(a.type==='pdf')return `<div class="sc-fname"><button class="sc-pdf" data-act="pdf" data-fn="${esc(a.filename)}">PDF</button>${name}${del}</div>`;
    return '';
  }).join('')+'</div>';
}

function entryHtml(m,kw,ctx){
  const tailOk=!!((m.attachments&&m.attachments.length)||m.tail);
  return `<div class="sc-entry">
    <div class="sc-qc">${esc(m.qc)}<span>${esc(qcodeLabel(m.qc))}</span>${m.pin?'<b class="sc-pin-tag">비망</b>':''}</div>
    <div class="sc-body-wrap" id="sc-${ctx}-${m.id}">${m.body?`<div class="sc-body">${highlight(m.body,kw)}</div>`:''}</div>
    ${attachHtml(m.attachments,m.id,kw)}
    ${tailOk?`<div class="sc-body-wrap sc-tail" id="sc-${ctx}-${m.id}-tail">${m.tail?`<div class="sc-body">${highlight(m.tail,kw)}</div>`:''}</div>`:''}
    <div class="sc-acts">
      <button data-act="edit" data-id="${m.id}" data-ctx="${ctx}">수정</button>
      ${tailOk?`<button data-act="edit" data-field="tail" data-id="${m.id}" data-ctx="${ctx}">추가작성</button>`:''}
      <button class="del" data-act="del" data-id="${m.id}">삭제</button>
    </div>
  </div>`;
}

function groupByWeek(list){
  const map=new Map();
  for(const m of list){
    const wk=weekKey(m.qc);
    if(!map.has(wk))map.set(wk,[]);
    map.get(wk).push(m);
  }
  for(const arr of map.values())arr.sort((a,b)=>a.qc<b.qc?1:a.qc>b.qc?-1:b.id-a.id);
  return map;
}
function weekKeysDesc(){return [...new Set(memos.map(m=>weekKey(m.qc)))].sort().reverse();}

function scrollHtml(items,ctx,kw){
  let last=null;
  return '<div class="sc-scroll">'+items.map(m=>{
    const dk=dayKey(m.qc);
    const sep=dk===last?'':`<div class="sc-day"><span>${dayLabel(m.qc)}</span></div>`;
    last=dk;
    return sep+entryHtml(m,kw,ctx);
  }).join('')+'</div>';
}
function weekHtml(wk,items,ctx,kw){
  return `<div class="sc-week">
    <div class="sc-week-head" data-act="fold"><span class="sc-wk">${weekLabel(wk)}</span><span class="sc-wc">${items.length}건 · ${wk}</span></div>
    <div class="sc-week-body">${items.length?scrollHtml(items,ctx,kw):'<div class="sc-empty">이 주차 기록이 없습니다.</div>'}</div>
  </div>`;
}

function renderWrite(){
  const groups=groupByWeek(memos);
  const keys=weekKeysDesc();
  const cur=weekKey(buildQcode(new Date()));
  if(!keys.includes(cur))keys.unshift(cur);
  if(weeksShown>keys.length)weeksShown=keys.length;
  $('.sc-cur').innerHTML=keys.slice(0,weeksShown).map(wk=>weekHtml(wk,groups.get(wk)||[],'c','')).join('')
    +(weeksShown<keys.length?'<div class="sc-more"><button class="sc-btn ghost" data-act="more">이전 주차 더보기</button></div>':'');
}

function renderWeeks(){
  const el=$('.sc-page[data-page=weeks]');
  if(openWeek){
    el.innerHTML='<button class="sc-back" data-act="weeks-back">← 주차 목록</button>'
      +weekHtml(openWeek,groupByWeek(memos).get(openWeek)||[],'w','');
    return;
  }
  const groups=groupByWeek(memos);
  const keys=weekKeysDesc();
  el.innerHTML=keys.length?keys.map(wk=>`<div class="sc-wrow" data-act="week" data-wk="${wk}">
      <div><div class="sc-wrow-label">${weekLabel(wk)}</div><div class="sc-wrow-meta">${wk} · ${groups.get(wk).length}건</div></div><span>›</span>
    </div>`).join(''):'<div class="sc-empty">기록된 주차가 없습니다.</div>';
}

function renderSearch(){
  const kw=query.trim();
  const label=$('.sc-label'),out=$('.sc-results');
  if(!kw){label.textContent='';out.innerHTML='';return;}
  const qcOnly=/^\d{2}w\d{2}\d?$/.test(kw);
  const hits=qcOnly?memos.filter(m=>m.qc.startsWith(kw)):memos.filter(m=>
    (m.body&&m.body.includes(kw))||(m.tail&&m.tail.includes(kw))||m.qc.includes(kw)||
    (m.attachments||[]).some(a=>(a.origName||'').includes(kw)||(a.filename||'').includes(kw)));
  const groups=groupByWeek(hits);
  const keys=[...groups.keys()].sort().reverse();
  label.textContent=`${hits.length}개 결과 · ${keys.length}개 주차`;
  out.innerHTML=hits.length?keys.map(wk=>weekHtml(wk,groups.get(wk),'s',qcOnly?'':kw)).join(''):'<div class="sc-empty">결과 없음</div>';
}

function renderPin(){
  const list=memos.filter(m=>m.pin);
  $('.sc-page[data-page=pin]').innerHTML=list.length
    ?`<div class="sc-label">비망 ${list.length}건</div>${scrollHtml(list,'p','')}`
    :'<div class="sc-empty">비망 메모가 없습니다.</div>';
}

function renderAll(){
  if(!live())return;
  if(sub==='write')renderWrite();
  if(sub==='weeks')renderWeeks();
  if(sub==='search')renderSearch();
  if(sub==='pin')renderPin();
  hydrate();
}

function showSub(name){
  sub=name;
  lsSet(LS.sub,name);
  root.querySelectorAll('.sc-sub').forEach(b=>b.classList.toggle('on',b.dataset.sub===name));
  root.querySelectorAll('.sc-page').forEach(p=>{p.hidden=p.dataset.page!==name;});
  renderAll();
  if(name!=='write')loadAllShards();
  if(name==='search')$('.sc-search').focus();
}

function renderPreview(){
  $('.sc-card .sc-preview').innerHTML=previewHtml(pending,'unpend');
  const ed=root.querySelector('.sc-edctl .sc-preview');
  if(ed)ed.innerHTML=previewHtml(editPending,'unpend-edit');
}
function previewHtml(list,act){
  return list.map((a,i)=>`<div class="sc-pv">
    ${a.type==='image'?`<img src="${a.url}" alt="">`:`<span class="sc-pv-ic">${a.type==='pdf'?'PDF':'♪'}</span>`}
    <div class="sc-pv-info"><div>${esc(a.file.name)}</div><small>${(a.file.size/1024).toFixed(0)}KB</small></div>
    <button class="sc-x" data-act="${act}" data-i="${i}">✕</button>
  </div>`).join('');
}
function dropEditPending(){
  editPending.forEach(a=>URL.revokeObjectURL(a.url));
  editPending=[];
}

function updateQnow(){
  if(!live())return;
  const qc=buildQcode(new Date());
  $('.sc-q').textContent=qc;
  if(!$('.sc-input').value&&!pending.length)$('.sc-stamp').textContent=qc;
}

function clearWrite(){
  $('.sc-input').value='';
  $('.sc-card .sc-pin input').checked=false;
  lsSet(LS.draft,null);
  pending.forEach(a=>URL.revokeObjectURL(a.url));
  pending=[];
  renderPreview();
  $('.sc-stamp').textContent=buildQcode(new Date());
  $('.sc-prog').hidden=true;
}

// 대기 첨부를 raw/ 에 올리고 메모에 붙일 첨부 목록을 돌려준다
async function uploadAll(qc,list,prog){
  const out=[];
  if(!list.length)return out;
  prog.hidden=false;
  prog.textContent='기존 파일 확인 중...';
  try{
    const taken=await existingRaw(qc);
    for(let i=0;i<list.length;i++){
      const a=list[i];
      const enc=a.type==='image'?await encodeImage(a.file):null;
      const fn=resolveName(qc,enc?enc.ext:fileExt(a.file.name),taken);
      prog.textContent=`업로드 중 (${i+1}/${list.length}) ${fn}`;
      const r=await put(`/contents/${RAW_DIR}/${encodeURIComponent(fn)}`,{message:`raw ${fn}`,content:enc?enc.b64:await fileToBase64(a.file)});
      if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.message||r.status);}
      out.push(a.type==='image'?{type:a.type,filename:fn}:{type:a.type,filename:fn,origName:a.file.name});
    }
  }finally{prog.hidden=true;}
  return out;
}

async function saveMemo(){
  const body=$('.sc-input').value.trim();
  if(!body&&!pending.length)return;
  const btn=$('[data-act=save]');
  const prog=$('.sc-prog');
  btn.disabled=true;
  const qc=buildQcode(new Date());
  const pin=$('.sc-card .sc-pin input').checked;
  let attachments;
  try{attachments=await uploadAll(qc,pending,prog);}
  catch(e){btn.disabled=false;alert(`파일 업로드 실패: ${e.message}`);return;}
  const now=Date.now();
  const memo={id:now,qc,body,attachments,mt:now};
  if(pin)memo.pin=true;
  memos.unshift(memo);
  clearWrite();
  renderAll();
  btn.disabled=false;
  await saveMemos();
}

function findMemo(id){return memos.find(m=>m.id===+id);}

async function onClick(e){
  const b=e.target.closest('[data-act]');
  if(!b||!root.contains(b))return;
  const act=b.dataset.act;
  if(act==='sub')return showSub(b.dataset.sub);
  if(act==='char'){
    const ta=b.closest('.sc-card, .sc-body-wrap').querySelector('textarea'),s=ta.selectionStart,t=b.textContent;
    ta.value=ta.value.slice(0,s)+t+ta.value.slice(ta.selectionEnd);
    ta.selectionStart=ta.selectionEnd=s+t.length;ta.focus();
    if(!ta.classList.contains('sc-edit'))lsSet(LS.draft,ta.value);
    return;
  }
  if(act==='save')return saveMemo();
  if(act==='clear')return clearWrite();
  if(act==='unpend-edit'){
    URL.revokeObjectURL(editPending[b.dataset.i].url);
    editPending.splice(+b.dataset.i,1);
    return renderPreview();
  }
  if(act==='unpend'){
    URL.revokeObjectURL(pending[b.dataset.i].url);
    pending.splice(+b.dataset.i,1);
    return renderPreview();
  }
  if(act==='more'){weeksShown++;renderAll();return loadAllShards();}
  if(act==='fold')return b.nextElementSibling.classList.toggle('folded');
  if(act==='week'){openWeek=b.dataset.wk;return renderAll();}
  if(act==='weeks-back'){openWeek=null;return renderAll();}
  if(act==='zoom'){
    if(!b.src)return;
    $('.sc-lightbox img').src=b.src;
    $('.sc-lightbox').hidden=false;
    return;
  }
  if(act==='lightbox'){$('.sc-lightbox').hidden=true;return;}
  if(act==='pdf'){
    const w=window.open('','_blank');
    try{w.location.href=await blobUrl(b.dataset.fn);}
    catch(err){if(w)w.close();alert(`PDF 열기 실패: ${err.message}`);}
    return;
  }
  const m=findMemo(b.dataset.id);
  if(!m)return;
  if(act==='edit'){
    const field=b.dataset.field||'body';
    const wrap=document.getElementById(`sc-${b.dataset.ctx}-${m.id}${field==='tail'?'-tail':''}`);
    if(!wrap||root.querySelector('.sc-entry.editing'))return;
    const entry=wrap.closest('.sc-entry');
    entry.classList.add('editing');
    dropEditPending();
    wrap.innerHTML=`${charsHtml()}<textarea class="sc-input sc-edit">${esc(m[field]||'')}</textarea>`;
    entry.querySelector('.sc-acts').insertAdjacentHTML('beforebegin',`<div class="sc-edctl">${attachBarHtml()}
      <div class="sc-preview"></div><div class="sc-prog" hidden></div>
      <div class="sc-row"><button class="sc-btn" data-act="commit" data-field="${field}" data-id="${m.id}">저장</button><button class="sc-btn ghost" data-act="cancel">취소</button>${pinHtml(m.pin)}</div></div>`);
    const ta=wrap.querySelector('textarea');
    ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);
    return;
  }
  if(act==='commit'){
    const entry=b.closest('.sc-entry'),ctl=b.closest('.sc-edctl');
    b.disabled=true;
    let added;
    try{added=await uploadAll(m.qc,editPending,ctl.querySelector('.sc-prog'));}
    catch(e){b.disabled=false;alert(`파일 업로드 실패: ${e.message}`);return;}
    dropEditPending();
    const v=entry.querySelector('.sc-edit').value.trim();
    if(b.dataset.field==='tail'){if(v)m.tail=v;else delete m.tail;}
    else m.body=v;
    if(added.length)m.attachments=(m.attachments||[]).concat(added);
    if(ctl.querySelector('.sc-pin input').checked)m.pin=true;
    else delete m.pin;
    m.mt=Date.now();
    renderAll();
    return saveMemos();
  }
  if(act==='del'){
    const files=(m.attachments||[]).map(a=>a.filename);
    if(!confirm(files.length?`이 로그와 첨부 ${files.length}개를 함께 삭제합니까?\n되돌릴 수 없습니다.`:'이 로그를 삭제합니까?'))return;
    addTomb(m.id,shardOf(m.qc));
    memos=memos.filter(x=>x!==m);
    renderAll();
    await saveMemos();
    return deleteRaw(files);
  }
  if(act==='del-att'){
    const a=m.attachments[+b.dataset.i];
    if(!a||!confirm(`첨부 ${a.origName||a.filename} 을 삭제합니까?`))return;
    m.attachments.splice(+b.dataset.i,1);
    m.mt=Date.now();
    const entry=b.closest('.sc-entry.editing');
    if(entry)entry.querySelector('.sc-attach').outerHTML=attachHtml(m.attachments,m.id,'')||'<div class="sc-attach"></div>';
    else renderAll();
    await saveMemos();
    return deleteRaw([a.filename]);
  }
}
function onCancel(e){
  if(!e.target.closest('[data-act=cancel]'))return;
  dropEditPending();
  renderAll();
}

function pinHtml(on){
  return `<label class="sc-pin"><input type="checkbox"${on?' checked':''}>비망</label>`;
}

function attachBarHtml(){
  return `<div class="sc-attach-bar">
    <label class="sc-btn ghost">이미지<input type="file" accept="image/*" multiple data-type="image"></label>
    <label class="sc-btn ghost">오디오<input type="file" accept=".mp3,.m4a,audio/mpeg,audio/mp4,audio/x-m4a" multiple data-type="audio"></label>
    <label class="sc-btn ghost">PDF<input type="file" accept="application/pdf" multiple data-type="pdf"></label>
  </div>`;
}

function charsHtml(){
  return `<div class="sc-chars">${CHARS.map(c=>`<button class="sc-char" data-act="char">${c}</button>`).join('')}</div>`;
}

function mount(el){
  root=document.createElement('div');
  root.className='sc';
  root.innerHTML=`<div class="sc-bar">
      <div class="sc-subs">${SUBS.map(s=>`<button class="sc-sub" data-act="sub" data-sub="${s[0]}">${s[1]}</button>`).join('')}</div>
      <div class="sc-sync"><span class="sc-dot">●</span><span class="sc-stat"></span><span class="sc-q"></span></div>
    </div>
    <div class="sc-note"></div>
    <div class="sc-page" data-page="write">
      <div class="sc-card">
        <div class="sc-stamp"></div>
        ${charsHtml()}
        <textarea class="sc-input" placeholder="낙서..."></textarea>
        ${attachBarHtml()}
        <div class="sc-preview"></div>
        <div class="sc-prog" hidden></div>
        <div class="sc-row"><button class="sc-btn" data-act="save">저장</button><button class="sc-btn ghost" data-act="clear">지우기</button>${pinHtml(false)}</div>
      </div>
      <div class="sc-cur"></div>
    </div>
    <div class="sc-page" data-page="weeks"></div>
    <div class="sc-page" data-page="search">
      <input class="sc-search" type="text" placeholder="검색어, 또는 qcode(26w27 / 26w271)...">
      <div class="sc-label"></div>
      <div class="sc-results"></div>
    </div>
    <div class="sc-page" data-page="pin"></div>
    <div class="sc-lightbox" data-act="lightbox" hidden><img alt=""></div>`;
  el.innerHTML='';
  el.appendChild(root);
  root.addEventListener('click',onClick);
  root.addEventListener('click',onCancel);
  const ta=$('.sc-input');
  ta.value=lsGet(LS.draft)||'';
  ta.addEventListener('input',()=>lsSet(LS.draft,ta.value));
  root.addEventListener('change',e=>{
    const inp=e.target;
    if(!inp.matches('input[type=file]'))return;
    const list=inp.closest('.sc-edctl')?editPending:pending,skip=[];
    for(const f of inp.files){
      if(inp.dataset.type==='audio'&&!/^(mp3|m4a)$/.test(fileExt(f.name))){skip.push(f.name);continue;}
      list.push({file:f,type:inp.dataset.type,url:URL.createObjectURL(f)});
    }
    if(skip.length)alert(`오디오는 mp3·m4a 만 받습니다.\n${skip.join('\n')}`);
    inp.value='';
    renderPreview();
  });
  const s=$('.sc-search');
  s.value=query;
  s.addEventListener('input',()=>{query=s.value;renderSearch();hydrate();});
  renderPreview();
  updateQnow();
  setSync(sync.state,sync.text);
  showSub(SUBS.some(x=>x[0]===sub)?sub:'write');
  loadMemos();
}

setInterval(updateQnow,10000);
setInterval(()=>{if(token()&&isDirty())saveMemos({quiet:true});},60000);
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'&&live())loadMemos();
});
window.addEventListener('beforeunload',e=>{
  if(!isDirty()&&!pending.length&&!editPending.length)return;
  e.preventDefault();
  e.returnValue='';
});

window.Scrawl={mount};
})();
