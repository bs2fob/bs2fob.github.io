// tabula.js
// 관리자 전용 서판. day_log 메모 체계를 옮겨 비공개 저장소 bs2fob/tabula 과 동기화한다
(function(){
const REPO='https://api.github.com/repos/bs2fob/tabula';
const SHARD_DIR='log_data';
const RAW_DIR='raw';
const ADMIN='bs2fob-admin';
const LS={logs:'bs2fob-tabula-logs',tombs:'bs2fob-tabula-tombs',dirty:'bs2fob-tabula-dirty',draft:'bs2fob-tabula-draft',sub:'bs2fob-tabula-sub',order:'bs2fob-tabula-topics',keep:'bs2fob-tabula-keep'};
// 옛 scrawl 키로 남은 기기 사본을 새 키로 옮긴다
try{const OLD='bs2fob-scrawl-';Object.keys(localStorage).forEach(k=>{if(k.indexOf(OLD)!==0)return;const n='bs2fob-tabula-'+k.slice(OLD.length);if(localStorage.getItem(n)==null)localStorage.setItem(n,localStorage.getItem(k));localStorage.removeItem(k);});}catch(e){}
const ORDER_PATH=`/contents/${SHARD_DIR}/topics.json`;
const SUBS=[['write','작성'],['weeks','주차'],['search','검색'],['tag','태그']];
const CHARS=['✶','✦','✧','⛧','◅','▻','➢'];

let root=null;
let sub=lsGet(LS.sub)||'write';
if(sub==='pin'||sub==='topic')sub='tag';
let memos=cacheLoad()||[];
let shardSha={},shardSaved={},loaded=new Set(),allLoaded=false;
let saving=false;
let pending=[],editPending=[],ed=null;
let weeksShown=1;
const FOLD={tag:{open:new Map(),keep:readKeep(LS.keep),ls:LS.keep},week:{open:new Map(),keep:new Set()}};
const WEEK_PAGE=10;
let weekPg=0;
let writePg=new Map();
const TAG_PAGE=5;
let tagOrder=readOrder(),orderSha,drag=null,dragClick=false;
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
const DAYS_HJ=['日','月','火','水','木','金','土'];
function qcodeLabel(qc){
  const m=qc.match(/^(\d{2})w(\d{2})(\d)v(\d{2})(\d)$/);
  if(!m)return qc;
  return `${m[1]}년${+m[2]}주${DAYS_HJ[+m[3]]} ${m[4]}:${m[5]}0`;
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
    ?'tabula 저장소에 닿지 못했습니다. 관리자 토큰에 bs2fob/tabula 저장소의 Contents 읽기·쓰기 권한을 더하세요.'
    :`저장소 접근 실패 (${r.status})`);
  repoChecked=true;
}

async function loadMemos(){
  if(!token())return;
  setSync('busy','불러오는 중...');
  try{
    await checkRepo();
    loadOrder();
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
    const b={message:`tabula ${sh} ${buildQcode(new Date())}`,content:b64enc(c)};
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

// 태그 순서는 덩어리와 따로 topics.json 한 파일에 두고 mt 가 최신인 쪽을 쓴다
function readKeep(k){
  try{const v=JSON.parse(lsGet(k)||'[]');return new Set(Array.isArray(v)?v:[]);}catch(e){return new Set();}
}
function readOrder(){
  try{const v=JSON.parse(lsGet(LS.order)||'null');if(v&&Array.isArray(v.order))return v;}catch(e){}
  return {order:[],mt:0};
}
async function fetchOrder(){
  const r=await gh(ORDER_PATH);
  if(r.status===404){orderSha=null;return null;}
  if(!r.ok)throw new Error(`HTTP ${r.status}`);
  const d=await r.json();
  orderSha=d.sha;
  const v=JSON.parse(b64dec(d.content));
  return v&&Array.isArray(v.order)?v:null;
}
async function loadOrder(){
  try{
    const v=await fetchOrder();
    if(v&&(v.mt||0)>(tagOrder.mt||0)){
      tagOrder=v;lsSet(LS.order,JSON.stringify(v));
      if(sub==='tag'&&!drag)renderAll();
    }else if((tagOrder.mt||0)>((v&&v.mt)||0))await saveOrder();
  }catch(e){}
}
async function saveOrder(){
  lsSet(LS.order,JSON.stringify(tagOrder));
  if(!token())return;
  const body=()=>{
    const b={message:`tabula topics ${buildQcode(new Date())}`,content:b64enc(JSON.stringify(tagOrder))};
    if(orderSha)b.sha=orderSha;
    return b;
  };
  try{
    if(orderSha===undefined)await fetchOrder();
    let r=await put(ORDER_PATH,body());
    if(r.status===409||r.status===422){await fetchOrder();r=await put(ORDER_PATH,body());}
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    orderSha=(await r.json()).content.sha;
  }catch(e){setSync('err','태그 순서 저장 대기 · 로컬 보관');}
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

function attItemHtml(a,i,id,kw){
  const del=`<button class="sc-x" data-act="del-att" data-id="${id}" data-i="${i}" title="첨부 삭제">✕</button>`;
  if(a.type==='image')return `<div class="sc-img-wrap"><img class="sc-img" data-fn="${esc(a.filename)}" alt="${esc(a.filename)}" data-act="zoom">${del}</div>`;
  const name=highlight(a.origName||a.filename,kw);
  if(a.type==='audio')return `<div class="sc-media"><audio controls data-fn="${esc(a.filename)}"></audio><div class="sc-fname">${name}${del}</div></div>`;
  if(a.type==='pdf')return `<div class="sc-fname"><button class="sc-pdf" data-act="pdf" data-fn="${esc(a.filename)}">PDF</button>${name}${del}</div>`;
  return '';
}
// 글단락과 첨부를 보이는 순서대로 편다. blocks 가 없는 옛 메모는 본문·첨부·아래 글 순서로 읽는다
function blocksOf(m){
  const at=m.attachments||[];
  if(m.blocks){
    const out=m.blocks.filter(b=>b.t||at.some(a=>a.filename===b.f)).map(b=>({...b}));
    at.forEach(a=>{if(!out.some(b=>b.f===a.filename))out.push({f:a.filename});});
    return out;
  }
  const out=[];
  let body=m.body||'';
  if(m.tail&&!at.length)body=body?body+'\n'+m.tail:m.tail;
  if(body)out.push({t:body});
  at.forEach((a,i)=>{
    out.push({f:a.filename});
    const n=i===0&&m.tail?(a.note?a.note+'\n'+m.tail:m.tail):a.note||'';
    if(n)out.push({t:n});
  });
  return out;
}
function setBlocks(m,blocks){
  m.blocks=blocks;
  m.body='';
  delete m.tail;
  (m.attachments||[]).forEach(a=>{delete a.note;});
}
function blocksHtml(m,kw){
  const at=m.attachments||[];
  return blocksOf(m).map(b=>{
    if(b.t)return `<div class="sc-body">${highlight(b.t,kw)}</div>`;
    const i=at.findIndex(a=>a.filename===b.f);
    return `<div class="sc-attach">${attItemHtml(at[i],i,m.id,kw)}</div>`;
  }).join('');
}

function entryHtml(m,kw,ctx){
  return `<div class="sc-entry">
    <div class="sc-qc">${esc(m.qc)}<span>${esc(qcodeLabel(m.qc))}</span>${tagsOf(m).map(t=>`<b class="sc-pin-tag">${esc(t)}</b>`).join('')}</div>
    <div class="sc-body-wrap" id="sc-${ctx}-${m.id}">${blocksHtml(m,kw)}</div>
    <div class="sc-acts">
      <button data-act="edit" data-id="${m.id}" data-ctx="${ctx}">수정</button>
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
function weekHtml(wk,items,ctx,kw,paged){
  let nav='',shown=items;
  if(paged){
    const pages=Math.ceil(items.length/TAG_PAGE),pg=Math.max(0,Math.min(writePg.get(wk)||0,pages-1));
    writePg.set(wk,pg);
    shown=items.slice(pg*TAG_PAGE,(pg+1)*TAG_PAGE);
    nav=navHtml(pg,pages,`data-act="wr-page" data-wk="${wk}"`);
  }
  return `<div class="sc-week">
    <div class="sc-week-head" data-act="fold"><span class="sc-wk">${weekLabel(wk)}</span><span class="sc-wc">${items.length}건 · ${wk}</span></div>
    <div class="sc-week-body">${nav}${items.length?scrollHtml(shown,ctx,kw):'<div class="sc-empty">이 주차 기록이 없습니다.</div>'}</div>
  </div>`;
}

function renderWrite(){
  const groups=groupByWeek(memos);
  const keys=weekKeysDesc();
  const cur=weekKey(buildQcode(new Date()));
  if(!keys.includes(cur))keys.unshift(cur);
  if(weeksShown>keys.length)weeksShown=keys.length;
  $('.sc-cur').innerHTML=keys.slice(0,weeksShown).map(wk=>weekHtml(wk,groups.get(wk)||[],'c','',true)).join('')
    +(weeksShown<keys.length?'<div class="sc-more"><button class="sc-btn ghost" data-act="more">이전 주차 더보기</button></div>':'');
}

function renderWeeks(){
  const groups=groupByWeek(memos);
  const keys=weekKeysDesc();
  const pages=Math.ceil(keys.length/WEEK_PAGE);
  weekPg=Math.max(0,Math.min(weekPg,pages-1));
  $('.sc-page[data-page=weeks]').innerHTML=keys.length?'<div class="sc-tlist">'+keys.slice(weekPg*WEEK_PAGE,(weekPg+1)*WEEK_PAGE).map((wk,i)=>
    foldHtml('week',wk,weekLabel(wk),`${wk} · ${groups.get(wk).length}건`,groups.get(wk),'w'+i)).join('')+'</div>'
    +navHtml(weekPg,pages,'data-act="wk-page"')
    :'<div class="sc-empty">기록된 주차가 없습니다.</div>';
}

function renderSearch(){
  const kw=query.trim();
  const label=$('.sc-label'),out=$('.sc-results');
  if(!kw){label.textContent='';out.innerHTML='';return;}
  const qcOnly=/^\d{2}w\d{2}\d?$/.test(kw);
  const hits=qcOnly?memos.filter(m=>m.qc.startsWith(kw)):memos.filter(m=>
    blocksOf(m).some(b=>b.t&&b.t.includes(kw))||tagsOf(m).some(t=>t.includes(kw))||m.qc.includes(kw)||
    (m.attachments||[]).some(a=>(a.origName||'').includes(kw)||(a.filename||'').includes(kw)));
  const groups=groupByWeek(hits);
  const keys=[...groups.keys()].sort().reverse();
  label.textContent=`${hits.length}개 결과 · ${keys.length}개 주차`;
  out.innerHTML=hits.length?keys.map(wk=>weekHtml(wk,groups.get(wk),'s',qcOnly?'':kw)).join(''):'<div class="sc-empty">결과 없음</div>';
}

function tagsOf(m){
  if(Array.isArray(m.tags))return m.tags;
  if(m.topic)return [m.topic];
  return m.pin?['비망']:[];
}
function parseTags(s){return [...new Set(s.split(/[,，]/).map(t=>t.trim()).filter(Boolean))];}
function tagGroups(){
  const map=new Map();
  for(const m of memos)for(const t of tagsOf(m)){
    if(!map.has(t))map.set(t,[]);
    map.get(t).push(m);
  }
  const rank=new Map(tagOrder.order.map((t,i)=>[t,i]));
  const keys=[...map.keys()].sort((a,b)=>rank.has(a)&&rank.has(b)?rank.get(a)-rank.get(b):rank.has(a)?-1:rank.has(b)?1:a.localeCompare(b,'ko'));
  return {map,keys};
}
function renderTag(){
  const {map,keys}=tagGroups();
  $('.sc-page[data-page=tag]').innerHTML=keys.length?'<div class="sc-tlist">'+keys.map((t,i)=>{
    const items=map.get(t).sort((a,b)=>a.qc<b.qc?1:a.qc>b.qc?-1:b.id-a.id);
    return foldHtml('tag',t,esc(t),`${items.length}건`,items,'t'+i);
  }).join('')+'</div>':'<div class="sc-empty">태그가 붙은 메모가 없습니다.</div>';
}

// 태그·주차 탭 공통 줄. 누르면 펼치고, 체크하면 탭을 옮겨도 펼침이 남고, 한 쪽 TAG_PAGE 건씩 나눈다
function foldHtml(kind,key,label,meta,items,ctx){
  const f=FOLD[kind],on=f.open.has(key),k=esc(key);
  const pages=Math.ceil(items.length/TAG_PAGE),pg=on?Math.min(f.open.get(key),pages-1):0;
  if(on)f.open.set(key,pg);
  return `<div class="sc-tgrp" data-tp="${k}"><div class="sc-wrow sc-trow${on?' on':''}" data-act="grp" data-kind="${kind}" data-tp="${k}">
      <div><div class="sc-wrow-label">${label}</div><div class="sc-wrow-meta">${meta}</div></div>
      <div class="sc-tright">${kind==='tag'?`<input type="checkbox" class="sc-tkeep" data-act="grp-keep" data-kind="${kind}" data-tp="${k}" title="탭을 옮겨도 펼침 유지"${f.keep.has(key)?' checked':''}>`:''}<span>›</span></div>
    </div>${on?pageNavHtml(kind,key,pg,pages)+`<div class="sc-tbody">${scrollHtml(items.slice(pg*TAG_PAGE,(pg+1)*TAG_PAGE),ctx,'')}</div>`:''}</div>`;
}

// 펼친 태그의 메모가 한 쪽을 넘으면 태그 줄 바로 아래에 이전·쪽 번호·다음을 단다
function pageNavHtml(kind,t,pg,pages){
  return navHtml(pg,pages,`data-act="grp-page" data-kind="${kind}" data-tp="${esc(t)}"`);
}
function navHtml(pg,pages,attrs){
  if(pages<2)return '';
  const btn=(p,label,cls)=>`<button class="sc-pgbtn${cls}" ${attrs} data-pg="${p}"${p<0||p>=pages?' disabled':''}>${label}</button>`;
  return `<div class="sc-pgnav">${btn(pg-1,'이전','')}${Array.from({length:pages},(_,p)=>btn(p,p+1,p===pg?' on':'')).join('')}${btn(pg+1,'다음','')}</div>`;
}

// 마우스는 5px 움직이면, 터치는 0.35초 누르고 있으면 태그 줄을 끌어 순서를 바꾼다
function dragStart(e){
  if(e.button>0||drag)return;
  const row=e.target.closest('.sc-trow');
  let grp=row&&row.dataset.kind==='tag'?row.parentElement:null;
  if(!row&&!e.target.closest('textarea, button, input, audio, label'))grp=e.target.closest('.sc-edblocks .sc-it');
  if(!grp)return;
  drag={grp,y0:e.clientY,on:false,touch:e.pointerType!=='mouse'};
  if(drag.touch)drag.timer=setTimeout(()=>dragBegin(),350);
  window.addEventListener('pointermove',dragMove);
  window.addEventListener('pointerup',dragEnd);
  window.addEventListener('pointercancel',dragEnd);
}
function dragBegin(){
  if(!drag)return;
  drag.on=true;
  drag.grp.classList.add('dragging');
  if(navigator.vibrate)navigator.vibrate(15);
}
function dragMove(e){
  if(!drag)return;
  if(!drag.on){
    if(Math.abs(e.clientY-drag.y0)<(drag.touch?8:5))return;
    if(drag.touch)return dragEnd();
    dragBegin();
  }
  e.preventDefault();
  const list=drag.grp.parentElement;
  const next=[...list.children].find(g=>{
    if(g===drag.grp)return false;
    const r=(g.querySelector('.sc-trow')||g).getBoundingClientRect();
    return e.clientY<r.top+r.height/2;
  })||list.querySelector(':scope > [data-act=blk-add]');
  if(next!==drag.grp.nextElementSibling)list.insertBefore(drag.grp,next||null);
}
function dragEnd(){
  if(!drag)return;
  clearTimeout(drag.timer);
  window.removeEventListener('pointermove',dragMove);
  window.removeEventListener('pointerup',dragEnd);
  window.removeEventListener('pointercancel',dragEnd);
  const d=drag;drag=null;
  if(!d.on)return;
  d.grp.classList.remove('dragging');
  dragClick=true;setTimeout(()=>{dragClick=false;},0);
  if(d.grp.classList.contains('sc-it')){
    const ks=[...d.grp.parentElement.querySelectorAll(':scope > .sc-it')].map(g=>g.dataset.k);
    if(ed)ed.items.sort((a,b)=>ks.indexOf(a.k)-ks.indexOf(b.k));
    return;
  }
  const shown=[...d.grp.parentElement.children].map(g=>g.dataset.tp);
  const order=shown.concat(tagOrder.order.filter(t=>!shown.includes(t)));
  if(JSON.stringify(order)===JSON.stringify(tagOrder.order))return;
  tagOrder={order,mt:Date.now()};
  saveOrder();
}

function renderAll(){
  if(!live())return;
  const playing=[...root.querySelectorAll('audio')].filter(a=>!a.paused);
  if(sub==='write')renderWrite();
  if(sub==='weeks')renderWeeks();
  if(sub==='search')renderSearch();
  if(sub==='tag')renderTag();
  keepPlaying(playing);
  hydrate();
  syncAudioStop();
}

// 다시 그려 떨어져 나간 재생 중 오디오를 새 목록의 같은 파일 자리에 옮겨 끊기지 않게 한다
function keepPlaying(list){
  for(const a of list){
    if(a.isConnected)continue;
    const n=root.querySelector(`audio[data-fn="${CSS.escape(a.dataset.fn)}"]:not([data-got])`);
    if(n)n.replaceWith(a);
  }
}
// 재생 중인 오디오가 숨은 탭에 있을 때만 우측 상단 끄기 버튼을 띄운다
function syncAudioStop(){
  if(!live())return;
  const off=[...root.querySelectorAll('audio')].some(a=>!a.paused&&a.closest('.sc-page').hidden);
  $('.sc-audio-stop').hidden=!off;
}
function onPlay(e){
  if(e.target.tagName!=='AUDIO')return;
  root.querySelectorAll('audio').forEach(a=>{if(a!==e.target&&!a.paused)a.pause();});
  syncAudioStop();
}

function showSub(name){
  if(name!==sub||!root.querySelector('.sc-sub.on')){
    for(const f of Object.values(FOLD))f.open=new Map([...f.keep].map(t=>[t,f.open.get(t)||0]));
    weekPg=0;
    writePg.clear();
  }
  sub=name;
  lsSet(LS.sub,name);
  root.querySelectorAll('.sc-sub').forEach(b=>b.classList.toggle('on',b.dataset.sub===name));
  root.querySelectorAll('.sc-page').forEach(p=>{p.hidden=p.dataset.page!==name;});
  renderAll();
  syncAudioStop();
  if(name!=='write')loadAllShards();
  if(name==='search')$('.sc-search').focus();
  fitAll();
}

// 입력 칸 높이를 글 높이에 한 줄 여유를 더한 값으로 맞춘다. 최소 높이는 서식이 정한다
function fit(ta){
  if(!ta.offsetParent)return;
  const min=ta.style.minHeight;
  ta.style.minHeight='0';ta.style.height='0';
  const h=ta.scrollHeight+parseFloat(getComputedStyle(ta).lineHeight)+ta.offsetHeight-ta.clientHeight;
  ta.style.minHeight=min;ta.style.height=h+'px';
}
function fitAll(){if(live())root.querySelectorAll('textarea.sc-input').forEach(fit);}

function renderPreview(){
  $('.sc-card .sc-preview').innerHTML=previewHtml(pending,'unpend');
  syncTail($('.sc-card'));
  renderEdit();
}

// 수정 창은 글단락과 첨부를 한 줄로 늘어놓는다. 항목을 끌어 순서를 바꾸고 글단락은 글수정·편집완료로 여닫는다
let edSeq=0;
function edItem(o){return {k:'e'+(++edSeq),...o};}
function edFind(k){return ed.items.find(x=>x.k===k);}
function edText(k){const it=edFind(k);return it?it.t||'':'';}
function setEdText(k,v){const it=edFind(k);if(it)it.t=v;}
function blkHtml(it){
  const open=ed.open.has(it.k);
  return `<div class="sc-blk"><button class="sc-btn ghost sc-blkbtn" data-act="blk" data-k="${it.k}">${open?'편집완료':'글수정'}</button>
    ${open?`<div class="sc-ed">${charsHtml()}<textarea class="sc-input sc-edit" data-k="${it.k}">${esc(it.t||'')}</textarea></div>`:`<div class="sc-body">${esc(it.t||'')}</div>`}</div>`;
}
function renderEdit(){
  const entry=root.querySelector('.sc-entry.editing');
  if(!entry||!ed)return;
  const m=findMemo(ed.id),at=m.attachments||[];
  ed.items=ed.items.filter(it=>it.p?editPending.includes(it.p):!it.f||at.some(a=>a.filename===it.f));
  editPending.forEach(p=>{if(!ed.items.some(it=>it.p===p))ed.items.push(edItem({p}));});
  entry.querySelector('.sc-edblocks').innerHTML=ed.items.map(it=>{
    let h;
    if(it.p)h=`<div class="sc-preview">${previewHtml([it.p],'unpend-edit',editPending.indexOf(it.p))}</div>`;
    else if(it.f){const i=at.findIndex(a=>a.filename===it.f);h=`<div class="sc-attach">${attItemHtml(at[i],i,m.id,'')}</div>`;}
    else h=blkHtml(it);
    return `<div class="sc-it" data-k="${it.k}">${h}</div>`;
  }).join('')+'<button class="sc-btn ghost sc-blkbtn" data-act="blk-add">글추가</button>';
  entry.querySelectorAll('.sc-edblocks textarea').forEach(fit);
  hydrate();
}
// 첨부가 있고 추가작성 칸이 아직 없을 때만 추가작성 버튼을 띄운다
function syncTail(scope){
  const btn=scope&&scope.querySelector('[data-act=tail-add]');
  if(!btn)return;
  btn.hidden=!scope.querySelector('.sc-attach > *, .sc-pv')||!!scope.querySelector('.sc-tailin');
}
function tailTaHtml(v,cls){
  return `<div class="sc-ed">${charsHtml()}<textarea class="sc-input ${cls} sc-tailin" placeholder="추가작성...">${esc(v)}</textarea></div>`;
}
function previewHtml(list,act,base=0){
  return list.map((a,i)=>`<div class="sc-pv">
    ${a.type==='image'?`<img src="${a.url}" alt="">`:`<span class="sc-pv-ic">${a.type==='pdf'?'PDF':'♪'}</span>`}
    <div class="sc-pv-info"><div>${esc(a.file.name)}</div><small>${(a.file.size/1024).toFixed(0)}KB</small></div>
    <button class="sc-x" data-act="${act}" data-i="${base+i}">✕</button>
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
  fit($('.sc-input'));
  setTags($('.sc-card .sc-tp'),[]);
  const tl=$('.sc-card .sc-tplist');if(tl)tl.remove();
  lsSet(LS.draft,null);
  pending.forEach(a=>URL.revokeObjectURL(a.url));
  pending=[];
  $('.sc-card .sc-tail').innerHTML='';
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
  const tags=readTags($('.sc-card .sc-tp'));
  const tIn=$('.sc-card .sc-tailin'),tail=tIn?tIn.value.trim():'';
  let attachments;
  try{attachments=await uploadAll(qc,pending,prog);}
  catch(e){btn.disabled=false;alert(`파일 업로드 실패: ${e.message}`);return;}
  const now=Date.now();
  const memo={id:now,qc,body,attachments,mt:now};
  if(tags.length)memo.tags=tags;
  if(tail&&attachments.length)attachments[attachments.length-1].note=tail;
  memos.unshift(memo);
  writePg.delete(weekKey(qc));
  clearWrite();
  renderAll();
  btn.disabled=false;
  await saveMemos();
}

// 클립보드에서 이미지 하나를 받아 파일 선택과 같은 대기열에 넣는다
async function pasteImage(b){
  let items;
  try{
    if(!navigator.clipboard||!navigator.clipboard.read)throw new Error('이 브라우저는 클립보드 읽기를 지원하지 않습니다.');
    items=await navigator.clipboard.read();
  }catch(e){alert(`클립보드를 읽지 못했습니다.
${e.message}`);return;}
  for(const it of items){
    const type=it.types.find(t=>t.startsWith('image/'));
    if(!type)continue;
    const blob=await it.getType(type);
    const file=new File([blob],`clipboard.${type.split('/')[1]||'png'}`,{type});
    (b.closest('.sc-edctl')?editPending:pending).push({file,type:'image',url:URL.createObjectURL(file)});
    renderPreview();
    return;
  }
  alert('클립보드에 이미지가 없습니다.');
}

function findMemo(id){return memos.find(m=>m.id===+id);}

async function onClick(e){
  const b=e.target.closest('[data-act]');
  if(!b||!root.contains(b))return;
  const act=b.dataset.act;
  if(act==='sub')return showSub(b.dataset.sub);
  if(act==='clip')return pasteImage(b);
  if(act==='blk'||act==='blk-add'){
    let k=b.dataset.k;
    if(act==='blk-add'){const it=edItem({t:''});ed.items.push(it);k=it.k;}
    if(ed.open.has(k)){
      ed.open.delete(k);
      const v=edText(k).trim();
      if(v)setEdText(k,v);else ed.items=ed.items.filter(x=>x.k!==k);
    }else ed.open.add(k);
    renderEdit();
    const ta=ed.open.has(k)&&root.querySelector(`.sc-entry.editing textarea[data-k="${k}"]`);
    if(ta){ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);}
    return;
  }
  if(act==='tp-pick'){
    const row=b.closest('.sc-row'),open=row.nextElementSibling;
    if(open&&open.classList.contains('sc-tplist'))return open.remove();
    const keys=tagGroups().keys;
    row.insertAdjacentHTML('afterend',`<div class="sc-tplist">${keys.length
      ?keys.map(t=>`<button class="sc-tpchip" data-act="tp-set" data-tp="${esc(t)}">${esc(t)}</button>`).join('')
      :'<span class="sc-tpnone">등록된 태그가 없습니다.</span>'}</div>`);
    return;
  }
  if(act==='tp-set'){
    const tp=b.closest('.sc-tplist').previousElementSibling.querySelector('.sc-tp');
    const cur=parseTags(tp.querySelector('.sc-topic').value);
    if(!cur.includes(b.dataset.tp))cur.push(b.dataset.tp);
    setTags(tp,cur);
    return;
  }
  if(act==='char'){
    const ta=b.closest('.sc-ed').querySelector('textarea'),s=ta.selectionStart,t=b.textContent;
    ta.value=ta.value.slice(0,s)+t+ta.value.slice(ta.selectionEnd);
    ta.selectionStart=ta.selectionEnd=s+t.length;ta.focus();fit(ta);
    if(ta.dataset.k&&ed)setEdText(ta.dataset.k,ta.value);
    if(ta===$('.sc-input'))lsSet(LS.draft,ta.value);
    return;
  }
  if(act==='tail-add'){
    const scope=b.closest('.sc-card, .sc-entry');
    const slot=scope.querySelector('.sc-tail');
    slot.innerHTML=tailTaHtml('',scope.classList.contains('sc-card')?'':'sc-edit');
    syncTail(scope);
    fit(slot.querySelector('textarea'));
    return slot.querySelector('textarea').focus();
  }
  if(act==='save')return saveMemo();
  if(act==='clear')return clearWrite();
  if(act==='unpend-edit'){
    URL.revokeObjectURL(editPending[b.dataset.i].url);
    editPending.splice(+b.dataset.i,1);
    return renderEdit();
  }
  if(act==='unpend'){
    URL.revokeObjectURL(pending[b.dataset.i].url);
    pending.splice(+b.dataset.i,1);
    return renderPreview();
  }
  if(act==='more'){weeksShown++;renderAll();return loadAllShards();}
  if(act==='fold')return b.nextElementSibling.classList.toggle('folded');
  if(act==='grp'){if(dragClick)return;const o=FOLD[b.dataset.kind].open,t=b.dataset.tp;o.has(t)?o.delete(t):o.set(t,0);return renderAll();}
  if(act==='grp-keep'){
    const f=FOLD[b.dataset.kind],t=b.dataset.tp;
    if(b.checked){f.keep.add(t);if(!f.open.has(t))f.open.set(t,0);}
    else f.keep.delete(t);
    lsSet(f.ls,JSON.stringify([...f.keep]));
    return renderAll();
  }
  if(act==='wr-page'){writePg.set(b.dataset.wk,+b.dataset.pg);return renderAll();}
  if(act==='wk-page'){weekPg=+b.dataset.pg;return renderAll();}
  if(act==='grp-page'){FOLD[b.dataset.kind].open.set(b.dataset.tp,+b.dataset.pg);return renderAll();}
  if(act==='zoom'){
    if(dragClick||!b.src)return;
    $('.sc-lightbox img').src=b.src;
    $('.sc-lightbox').hidden=false;
    return;
  }
  if(act==='audio-stop'){root.querySelectorAll('audio').forEach(a=>a.pause());return syncAudioStop();}
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
    const wrap=document.getElementById(`sc-${b.dataset.ctx}-${m.id}`);
    if(!wrap||root.querySelector('.sc-entry.editing'))return;
    const entry=wrap.closest('.sc-entry'),acts=entry.querySelector('.sc-acts');
    entry.classList.add('editing');
    dropEditPending();
    ed={id:m.id,items:blocksOf(m).map(edItem),open:new Set()};
    [...entry.children].forEach(c=>{if(!c.matches('.sc-qc, .sc-acts'))c.remove();});
    acts.insertAdjacentHTML('beforebegin',`<div class="sc-edblocks"></div><div class="sc-edctl">${attachBarHtml()}<div class="sc-prog" hidden></div>
      <div class="sc-row"><button class="sc-btn" data-act="commit" data-id="${m.id}">저장</button><button class="sc-btn ghost" data-act="cancel">취소</button>${tagHtml(tagsOf(m))}</div></div>`);
    renderEdit();
    return;
  }
  if(act==='commit'){
    const entry=b.closest('.sc-entry'),ctl=b.closest('.sc-edctl');
    b.disabled=true;
    let added;
    try{added=await uploadAll(m.qc,editPending,ctl.querySelector('.sc-prog'));}
    catch(e){b.disabled=false;alert(`파일 업로드 실패: ${e.message}`);return;}
    const fresh=new Map(editPending.map((p,i)=>[p,added[i].filename]));
    dropEditPending();
    if(added.length)m.attachments=(m.attachments||[]).concat(added);
    setBlocks(m,ed.items.map(it=>it.p?{f:fresh.get(it.p)}:it.f?{f:it.f}:{t:(it.t||'').trim()}).filter(x=>x.f||x.t));
    ed=null;
    const tg=readTags(ctl.querySelector('.sc-tp'));
    if(tg.length)m.tags=tg;else delete m.tags;
    delete m.topic;
    delete m.pin;
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
    const i=+b.dataset.i,a=m.attachments[i];
    const editing=!!(b.closest('.sc-entry.editing')&&ed&&ed.id===m.id);
    if(!a||!confirm(`첨부 ${a.origName||a.filename} 을 삭제합니까?`))return;
    const rest=blocksOf(m).filter(x=>x.f!==a.filename);
    m.attachments.splice(i,1);
    setBlocks(m,rest);
    m.mt=Date.now();
    if(editing)renderEdit();else renderAll();
    await saveMemos();
    return deleteRaw([a.filename]);
  }
}
function onCancel(e){
  if(!e.target.closest('[data-act=cancel]'))return;
  dropEditPending();
  ed=null;
  renderAll();
}

function tagHtml(tags){
  return `<span class="sc-tp"><label class="sc-pin"><input type="checkbox"${tags.length?' checked':''}>태그</label><input class="sc-topic" type="text" placeholder="쉼표로 구분" value="${esc(tags.join(', '))}"><button class="sc-btn ghost sc-tpbtn" data-act="tp-pick">선택</button></span>`;
}
function readTags(el){return el.querySelector('input[type=checkbox]').checked?parseTags(el.querySelector('.sc-topic').value):[];}
function setTags(el,tags){el.querySelector('input[type=checkbox]').checked=!!tags.length;el.querySelector('.sc-topic').value=tags.join(', ');}

function attachBarHtml(){
  return `<div class="sc-attach-bar">
    <button class="sc-btn ghost" data-act="tail-add" hidden>추가작성</button>
    <button class="sc-btn ghost" data-act="clip">클립보드</button>
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
        <div class="sc-ed">${charsHtml()}<textarea class="sc-input" placeholder="낙서..."></textarea></div>
        <div class="sc-preview"></div>
        <div class="sc-body-wrap sc-tail"></div>
        ${attachBarHtml()}
        <div class="sc-prog" hidden></div>
        <div class="sc-row"><button class="sc-btn" data-act="save">저장</button><button class="sc-btn ghost" data-act="clear">지우기</button>${tagHtml([])}</div>
      </div>
      <div class="sc-cur"></div>
    </div>
    <div class="sc-page" data-page="weeks"></div>
    <div class="sc-page" data-page="search">
      <input class="sc-search" type="text" placeholder="검색어, 또는 qcode(26w27 / 26w271)...">
      <div class="sc-label"></div>
      <div class="sc-results"></div>
    </div>
    <div class="sc-page" data-page="tag"></div>
    <button class="sc-audio-stop" data-act="audio-stop" hidden>■ 오디오 끄기</button>
    <div class="sc-lightbox" data-act="lightbox" hidden><img alt=""></div>`;
  el.innerHTML='';
  el.appendChild(root);
  root.addEventListener('click',onClick);
  root.addEventListener('play',onPlay,true);
  root.addEventListener('pause',syncAudioStop,true);
  root.addEventListener('ended',syncAudioStop,true);
  root.addEventListener('pointerdown',dragStart);
  root.addEventListener('touchmove',e=>{if(drag&&drag.on)e.preventDefault();},{passive:false});
  root.addEventListener('contextmenu',e=>{if(drag&&e.target.closest('.sc-trow, .sc-it'))e.preventDefault();});
  root.addEventListener('dragstart',e=>{if(e.target.closest('.sc-it'))e.preventDefault();});
  root.addEventListener('click',onCancel);
  root.addEventListener('input',e=>{
    if(!e.target.matches('textarea.sc-input'))return;
    fit(e.target);
    if(e.target.dataset.k&&ed)setEdText(e.target.dataset.k,e.target.value);
  });
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
window.addEventListener('resize',fitAll);
window.addEventListener('beforeunload',e=>{
  if(!isDirty()&&!pending.length&&!editPending.length)return;
  e.preventDefault();
  e.returnValue='';
});

window.Tabula={mount};
})();
