// board.js
// 게시판 탭: 세부 게시판 목록·글 보기·댓글, 관리자 토큰으로 글과 첨부를 사이트 저장소에 쓴다
(function(){
const REPO='https://api.github.com/repos/bs2fob/bs2fob.github.io';
const BOARDS=[['1','자유게시판','Free Board'],['2','유틸게시판','Utilities'],['0','운영자메모','Admin Notes']];
const PER=15;
let root=null,adm='',lang='ko',cur='1',view=null,pg=0,mode='list',data={},sha={},pend=[],edit=null,replyTo=null,busy=false,blobs={};

function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);}
function L(ko,en){return lang==='en'?en:ko;}
function bname(k){const b=BOARDS.find(x=>x[0]===k);return lang==='en'?b[2]:b[1];}
function now(){const d=new Date(),z=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate())+' '+z(d.getHours())+':'+z(d.getMinutes());}
function gh(path,opt){opt=opt||{};opt.headers=Object.assign({Authorization:'Bearer '+adm,Accept:'application/vnd.github+json'},opt.headers||{});return fetch(REPO+path,opt);}
function b64enc(s){return btoa(unescape(encodeURIComponent(s)));}
function b64dec(s){return decodeURIComponent(escape(atob(s.replace(/\n/g,''))));}
function fileExt(n){const m=n.match(/\.([^.]+)$/);return m?m[1].toLowerCase():'bin';}
function kindOf(n){const e=fileExt(n);return /^(webp|jpg|jpeg|png|gif)$/.test(e)?'image':/^(mp3|m4a)$/.test(e)?'audio':e==='pdf'?'pdf':e==='zip'?'zip':'file';}
function src(f){return blobs[f]||f;}
function no5(id){return String(id).padStart(5,'0');}
function code(k,id){return k+'-'+no5(id);}

async function load(k){
  if(adm){
    const r=await gh('/contents/board/'+k+'.json?ref=main&t='+Date.now());
    if(r.ok){const j=await r.json();sha[k]=j.sha;data[k]=JSON.parse(b64dec(j.content));return;}
  }
  const r=await fetch('board/'+k+'.json?t='+Date.now());
  data[k]=r.ok?await r.json():{posts:[]};
}

async function putFile(path,b64,msg,s){
  const body={message:msg,content:b64,branch:'main'};if(s)body.sha=s;
  const r=await gh('/contents/'+path,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(r.status===403||r.status===404)throw new Error(L('토큰에 bs2fob.github.io 저장소 Contents 쓰기 권한이 없습니다.','The token lacks Contents write permission on bs2fob.github.io.'));
  if(!r.ok)throw new Error('HTTP '+r.status);
  return r.json();
}
async function delFile(path){
  const r=await gh('/contents/'+path+'?ref=main&t='+Date.now(),{cache:'no-store'});if(!r.ok)return;
  const j=await r.json();
  await gh('/contents/'+path,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'게시판 첨부 삭제',sha:j.sha,branch:'main'})});
}
async function fileSha(path){const r=await gh('/contents/'+path+'?ref=main&t='+Date.now(),{cache:'no-store'});return r.ok?(await r.json()).sha:null;}
async function copyFile(from,to){
  const r=await gh('/contents/'+from+'?ref=main',{headers:{Accept:'application/vnd.github.raw'}});
  if(!r.ok)throw new Error('HTTP '+r.status+' '+from);
  await putFile(to,await toB64(await r.blob()),'게시판 번호 이동 '+to,await fileSha(to));
}
function freeSlot(list){const used=new Set(list.map(p=>p.id));let i=1;while(used.has(i))i++;return i;}
function plan(list){
  const fixed=new Set(list.filter(p=>p.pin||(p.comments||[]).length).map(p=>p.id)),map={};let s=1;
  list.filter(p=>!fixed.has(p.id)).sort((a,b)=>a.id-b.id).forEach(p=>{while(fixed.has(s))s++;map[p.id]=s++;});
  return map;
}
async function compact(k){
  await load(k);
  const map=plan(posts()),moves=[],olds=new Set(),news=new Set();
  posts().slice().sort((a,b)=>a.id-b.id).forEach(p=>{const n=map[p.id];if(n==null||n===p.id)return;
    (p.blocks||[]).forEach(b=>{if(!b.f)return;const nf=b.f.replace(/\/\d-\d{5}_/,'/'+code(k,n)+'_');moves.push([b.f,nf]);olds.add(b.f);news.add(nf);});});
  if(!Object.keys(map).some(id=>map[id]!==+id))return;
  for(const [a,c] of moves){msg(L('번호 정리 중','Renumbering')+' · '+c);await copyFile(a,c);}
  await saveBoard(k,d=>{const m=plan(d.posts);d.posts.forEach(p=>{const n=m[p.id];if(n==null||n===p.id)return;
    (p.blocks||[]).forEach(b=>{if(b.f)b.f=b.f.replace(/\/\d-\d{5}_/,'/'+code(k,n)+'_');});p.id=n;});},'게시판 번호 정리 '+k);
  for(const f of olds)if(!news.has(f))await delFile(f).catch(()=>{});
}
async function saveBoard(k,fn,msg){
  for(let i=0;i<2;i++){
    await load(k);
    fn(data[k]);
    try{const j=await putFile('board/'+k+'.json',b64enc(JSON.stringify(data[k],null,1)),msg,sha[k]);sha[k]=j.content.sha;return;}
    catch(e){if(!/409/.test(e.message)||i)throw e;}
  }
}

function encodeImage(file){
  return new Promise((res,rej)=>{
    const img=new Image(),url=URL.createObjectURL(file);
    img.onload=()=>{
      const cv=document.createElement('canvas');cv.width=img.naturalWidth;cv.height=img.naturalHeight;
      const ctx=cv.getContext('2d');ctx.drawImage(img,0,0);
      cv.toBlob(b=>{URL.revokeObjectURL(url);if(!b)return rej(new Error('이미지 변환 실패'));res({blob:b,ext:b.type==='image/webp'?'webp':'png'});},'image/webp',0.90);
    };
    img.onerror=()=>{URL.revokeObjectURL(url);rej(new Error('이미지 로드 실패'));};
    img.src=url;
  });
}
function toB64(blob){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(',')[1]);r.onerror=rej;r.readAsDataURL(blob);});}

async function upload(k,id,list,start){
  const out=[];let n=start;
  for(const p of list){
    n++;
    let blob=p.file,ext=fileExt(p.file.name);
    if(p.type==='image'){const e=await encodeImage(p.file);blob=e.blob;ext=e.ext;}
    const path='board/raw/'+code(k,id)+'_'+String(n).padStart(2,'0')+'.'+ext;
    msg(L('첨부 올리는 중','Uploading')+' '+n+' · '+p.file.name);
    await putFile(path,await toB64(blob),'게시판 첨부 '+path);
    blobs[path]=URL.createObjectURL(blob);
    out.push({f:path,name:p.file.name,size:blob.size});
  }
  return out;
}

function msg(t){const m=root&&root.querySelector('.bd-msg');if(m)m.textContent=t||'';}
function posts(){return (data[cur]&&data[cur].posts)||[];}
function sorted(){const a=posts().slice().sort((x,y)=>y.id-x.id);return a.filter(p=>p.pin).concat(a.filter(p=>!p.pin));}

function bar(){
  return '<div class="bd-bar">'+BOARDS.map(b=>'<button class="bd-sub'+(b[0]===cur?' on':'')+'" data-sub="'+b[0]+'">'+esc(lang==='en'?b[2]:b[1])+'</button>').join('')+
    '<span class="bd-sp"></span>'+(adm&&mode==='list'?'<button class="bd-btn" data-act="new">'+L('글쓰기','Write')+'</button>':'')+'</div>';
}
function listHtml(){
  const a=sorted(),pc=Math.max(1,Math.ceil(a.length/PER));pg=Math.min(pg,pc-1);
  const rows=a.slice(pg*PER,pg*PER+PER).map(p=>{
    const c=(p.comments||[]).length;
    return '<tr class="bd-row'+(p.pin?' pin':'')+'" data-id="'+p.id+'"><td class="no">'+(p.pin?L('공지','Notice'):no5(p.id))+'</td><td><span class="ttl">'+esc(p.title)+'</span>'+(c?'<span class="cm">['+c+']</span>':'')+'</td><td class="dt">'+esc(p.date.slice(2,10))+'</td></tr>';
  }).join('');
  let nav='';
  if(pc>1){nav='<div class="bd-nav">'+(pg>0?'<span data-pg="'+(pg-1)+'">'+L('이전','Prev')+'</span>':'');for(let i=0;i<pc;i++)nav+=i===pg?'<b>'+(i+1)+'</b>':'<span data-pg="'+i+'">'+(i+1)+'</span>';nav+=(pg<pc-1?'<span data-pg="'+(pg+1)+'">'+L('다음','Next')+'</span>':'')+'</div>';}
  return bar()+'<table class="bd-tb"><tr><th class="no">'+L('번호','No.')+'</th><th>'+L('제목','Title')+'</th><th class="dt">'+L('작성일','Date')+'</th></tr>'+
    (rows||'<tr><td colspan="3" class="bd-empty">'+L('글이 없습니다.','No posts.')+'</td></tr>')+'</table>'+nav+'<div class="bd-msg"></div>';
}
function attHtml(b){
  const f=src(b.f),k=kindOf(b.f),nm=esc(b.name||b.f.split('/').pop());
  if(k==='image')return '<div class="bd-att"><img data-f="'+esc(b.f)+'" src="'+esc(f)+'" alt="'+nm+'" loading="lazy"></div>';
  if(k==='audio')return '<div class="bd-att"><audio data-f="'+esc(b.f)+'" controls preload="none" src="'+esc(f)+'"></audio><div class="bd-an">'+nm+'</div></div>';
  if(k==='pdf')return '<div class="bd-att"><iframe class="bd-pdf" data-f="'+esc(b.f)+'" src="'+esc(f)+'#navpanes=0&view=FitH" loading="lazy" title="'+nm+'"></iframe><a class="bd-an bd-pdfl" data-f="'+esc(b.f)+'" href="'+esc(f)+'" target="_blank" rel="noopener">PDF · '+nm+' · '+L('새 창에서 열기','Open in new tab')+'</a></div>';
  return '<div class="bd-att"><a class="bd-file" data-f="'+esc(b.f)+'" href="'+esc(f)+'" download="'+nm+'">'+(k==='zip'?'ZIP':L('파일','File'))+' · '+nm+' '+L('내려받기','Download')+'</a></div>';
}
function textHtml(t){return String(t).split(/\n{2,}/).map(p=>'<p>'+esc(p).replace(/\n/g,'<br>')+'</p>').join('');}
function depth(p,c){let d=0,x=c;while(x.parent){x=(p.comments||[]).find(y=>y.id===x.parent);if(!x)break;d++;}return d;}
function commentsHtml(p){
  const cs=p.comments||[],out=[];
  const walk=(par,d)=>cs.filter(c=>(c.parent||0)===par).forEach(c=>{out.push([c,d]);walk(c.id,d+1);});
  walk(0,0);
  let h='<div class="bd-cmh">'+L('댓글','Comments')+'<b>'+cs.length+'</b></div>';
  h+=out.map(([c,d])=>{
    const can=adm&&d<2;
    return '<div class="bd-ci d'+Math.min(d,2)+'"><div class="bd-ca"><span class="nm">'+esc(c.by)+'</span>'+(c.op?'<span class="op">'+L('운영자','Admin')+'</span>':'')+'<span class="t">'+esc(c.date.slice(5))+'</span><span class="bd-sp"></span>'+
      (can?'<a data-act="reply" data-c="'+c.id+'">'+L('답글','Reply')+'</a>':'')+(adm?'<a data-act="cdel" data-c="'+c.id+'">'+L('삭제','Delete')+'</a>':'')+'</div><div class="bd-cb">'+esc(c.text).replace(/\n/g,'<br>')+'</div>'+
      (replyTo===c.id?cwHtml(true):'')+'</div>';
  }).join('');
  if(adm&&!replyTo)h+=cwHtml(false);
  return h;
}
function cwHtml(re){return '<div class="bd-cw"><textarea class="bd-ct" placeholder="'+(re?L('답글 입력','Reply'):L('댓글 입력','Comment'))+'"></textarea><button class="bd-btn" data-act="csave">'+L('등록','Post')+'</button>'+(re?'<button class="bd-btn" data-act="ccancel">'+L('취소','Cancel')+'</button>':'')+'</div>';}
function viewHtml(){
  const p=posts().find(x=>x.id===view);if(!p){if(!data[cur])return bar()+'<div class="bd-empty">…</div>';mode='list';return listHtml();}
  return bar()+'<div class="bd-vh"><div class="bd-vt">'+esc(p.title)+'</div><div class="bd-vm"><span>'+code(cur,p.id)+' · '+esc(p.date)+' · '+esc(bname(cur))+'</span><button class="bd-copy" data-act="copy">'+L('URL 복사','Copy URL')+'</button></div></div>'+
    '<div class="bd-vb">'+(p.blocks||[]).map(b=>b.f?attHtml(b):textHtml(b.t)).join('')+'</div>'+commentsHtml(p)+
    '<div class="bd-vf"><button class="bd-btn" data-act="list">'+L('목록','List')+'</button><span>'+(adm?'<button class="bd-btn" data-act="edit">'+L('수정','Edit')+'</button> <button class="bd-btn" data-act="del">'+L('삭제','Delete')+'</button>':'')+'</span></div><div class="bd-msg"></div>';
}
const CHARS=['✶','✦','✧','⛧','◅','▻','➢'];
function qcode(d){
  const j=new Date(d.getFullYear(),0,1),s=new Date(j);s.setDate(j.getDate()-j.getDay());
  const ww=String(Math.floor((d-s)/86400000/7)+1).padStart(2,'0');
  return String(d.getFullYear()).slice(-2)+'w'+ww+d.getDay()+'v'+String(d.getHours()).padStart(2,'0')+Math.floor(d.getMinutes()/10);
}
function edBox(ta){return '<div class="sc-ed"><div class="sc-chars">'+CHARS.map(c=>'<button class="sc-char" data-act="char">'+c+'</button>').join('')+'</div>'+ta+'</div>';}
function fit(ta){if(!ta.offsetParent)return;ta.style.height='0';ta.style.height=(ta.scrollHeight+parseFloat(getComputedStyle(ta).lineHeight)+ta.offsetHeight-ta.clientHeight)+'px';}
function fitAll(){root.querySelectorAll('textarea.sc-input').forEach(fit);}
function attBar(){
  return '<div class="sc-attach-bar"><button class="sc-btn ghost" data-act="clip">'+L('클립보드','Clipboard')+'</button>'+
    '<label class="sc-btn ghost">'+L('이미지','Image')+'<input type="file" multiple accept="image/*" data-type="image"></label>'+
    '<label class="sc-btn ghost">'+L('오디오','Audio')+'<input type="file" multiple accept=".mp3,.m4a,audio/mpeg,audio/mp4,audio/x-m4a" data-type="audio"></label>'+
    '<label class="sc-btn ghost">PDF<input type="file" multiple accept="application/pdf" data-type="pdf"></label>'+
    '<label class="sc-btn ghost">ZIP<input type="file" multiple accept=".zip,application/zip,application/x-zip-compressed" data-type="zip"></label></div>';
}
function pendHtml(){
  return pend.map((p,i)=>{
    const u=p.url,nm=esc(p.file.name);
    const inner=p.type==='image'?'<img src="'+u+'">':p.type==='audio'?'<audio controls src="'+u+'"></audio>':p.type==='pdf'?'<iframe class="bd-pdf" src="'+u+'#navpanes=0&view=FitH"></iframe>':'<div class="bd-file">ZIP · '+nm+'</div>';
    return '<div class="bd-att bd-pend">'+inner+'<div class="bd-an">'+nm+' · '+Math.ceil(p.file.size/1024)+'KB</div><button class="bd-x" data-act="pdel" data-i="'+i+'">✕</button></div>';
  }).join('');
}
function edBlocksHtml(){
  return edit.blocks.map((b,i)=>'<div class="bd-eb">'+(b.f?attHtml(b):edBox('<textarea class="sc-input bd-et" data-i="'+i+'">'+esc(b.t)+'</textarea>'))+
    '<div class="bd-ec"><button class="bd-btn" data-act="up" data-i="'+i+'">↑</button><button class="bd-btn" data-act="down" data-i="'+i+'">↓</button><button class="bd-btn" data-act="bdel" data-i="'+i+'">✕</button></div></div>').join('')+
    '<button class="bd-btn" data-act="addtext">+ '+L('글단락','Text')+'</button>';
}
function formHtml(){
  const isEd=!!edit;
  return bar()+'<div class="sc-card bd-f"><div class="sc-stamp">'+(isEd?code(cur,edit.id):qcode(new Date()))+'</div>'+
    '<input class="bd-title" placeholder="'+L('제목','Title')+'" value="'+esc(isEd?edit.title:'')+'">'+
    (isEd?'<div class="bd-eblocks">'+edBlocksHtml()+'</div>':edBox('<textarea class="sc-input bd-body" placeholder="'+L('입력..','Write..')+'"></textarea>'))+
    '<div class="bd-pends">'+pendHtml()+'</div>'+attBar()+
    '<div class="sc-row"><button class="sc-btn" data-act="save">'+L('저장','Save')+'</button><button class="sc-btn ghost" data-act="cancel">'+L('취소','Cancel')+'</button><label class="bd-pin"><input type="checkbox" class="bd-pinck"'+(isEd&&edit.pin?' checked':'')+'> '+L('공지','Notice')+'</label></div><div class="bd-msg"></div></div>';
}
function render(){
  if(!root)return;
  root.innerHTML=mode==='view'?viewHtml():mode==='form'?formHtml():listHtml();
  if(mode==='form')fitAll();
  if(adm)hydrate();
}
async function hydrate(){
  const els=[...root.querySelectorAll('[data-f]')];
  for(const el of els){
    const f=el.dataset.f;if(blobs[f])continue;
    const h=await fetch(f,{method:'HEAD'}).catch(()=>null);if(h&&h.ok)continue;
    const r=await gh('/contents/'+f+'?ref=main',{headers:{Accept:'application/vnd.github.raw'}});if(!r.ok)continue;
    const bl=await r.blob(),t={pdf:'application/pdf',webp:'image/webp',png:'image/png',jpg:'image/jpeg',mp3:'audio/mpeg',m4a:'audio/mp4',zip:'application/zip'}[fileExt(f)]||bl.type;
    blobs[f]=URL.createObjectURL(new Blob([bl],{type:t}));
    root.querySelectorAll('[data-f="'+f+'"]').forEach(x=>{const a=x.tagName==='A'?'href':'src';x.setAttribute(a,blobs[f]+(x.tagName==='IFRAME'?'#navpanes=0&view=FitH':''));});
  }
}
function syncEdit(){if(!edit)return;root.querySelectorAll('.bd-et').forEach(t=>{edit.blocks[+t.dataset.i].t=t.value;});const ti=root.querySelector('.bd-title');if(ti)edit.title=ti.value;}

async function savePost(){
  if(busy)return;
  const title=root.querySelector('.bd-title').value.trim();
  if(!title){msg(L('제목을 넣으십시오.','Enter a title.'));return;}
  const pin=root.querySelector('.bd-pinck').checked;
  const old=pin?posts().find(p=>p.pin&&(!edit||p.id!==edit.id)):null;
  if(old&&!confirm(L('기존 공지 「'+old.title+'」 를 지우고 새 공지를 올립니다.','The current notice "'+old.title+'" will be deleted.')))return;
  busy=true;
  try{
    if(edit){
      syncEdit();
      await load(cur);
      const p=posts().find(x=>x.id===edit.id);if(!p)throw new Error(L('원본 글이 없습니다.','Post not found.'));
      const used=Math.max(0,...(p.blocks||[]).concat(edit.blocks).filter(b=>b.f).map(b=>+(b.f.match(/_(\d+)\.[^.]+$/)||[0,0])[1]));
      const added=await upload(cur,edit.id,pend,used);
      const blocks=edit.blocks.filter(b=>b.f||b.t.trim()).concat(added);
      const gone=(p.blocks||[]).filter(b=>b.f&&!blocks.some(x=>x.f===b.f)).map(b=>b.f);
      msg(L('저장 중','Saving'));
      const oldFiles=old?(old.blocks||[]).filter(b=>b.f).map(b=>b.f):[];
      await saveBoard(cur,d=>{const q=d.posts.find(x=>x.id===edit.id);q.title=title;q.pin=pin;q.blocks=blocks;if(old)d.posts=d.posts.filter(x=>x.id!==old.id);},'게시판 글 수정 '+cur+' '+edit.id);
      for(const f of gone.concat(oldFiles))await delFile(f).catch(()=>{});
      if(old)await compact(cur);
      view=edit.id;
    }else{
      await load(cur);
      if(old){
        msg(L('기존 공지 삭제 중','Deleting old notice'));
        const files=(old.blocks||[]).filter(b=>b.f).map(b=>b.f);
        await saveBoard(cur,d=>{d.posts=d.posts.filter(x=>x.id!==old.id);},'게시판 공지 교체 삭제 '+cur+' '+old.id);
        for(const f of files)await delFile(f).catch(()=>{});
      }
      const id=old?old.id:freeSlot(posts());
      const body=root.querySelector('.bd-body').value;
      const added=await upload(cur,id,pend,0);
      const blocks=(body.trim()?[{t:body}]:[]).concat(added);
      msg(L('저장 중','Saving'));
      await saveBoard(cur,d=>{if(d.posts.some(p=>p.id===id))throw new Error(L('번호가 그사이 쓰였습니다. 다시 저장하십시오.','Number taken. Save again.'));d.posts.push({id,title,date:now(),pin,blocks,comments:[]});},'게시판 글 '+cur+' '+id);
      view=id;
    }
    pend=[];edit=null;mode='view';render();msg(L('저장했습니다. 방문자 화면 반영은 사이트 빌드 뒤입니다.','Saved. Visitors see it after the site rebuilds.'));
  }catch(e){msg(e.message);}
  busy=false;
}
async function saveComment(){
  if(busy)return;
  const t=root.querySelector('.bd-ct');if(!t||!t.value.trim())return;
  const text=t.value.trim(),parent=replyTo||0,pid=view;
  busy=true;
  try{
    await saveBoard(cur,d=>{const p=d.posts.find(x=>x.id===pid);p.comments=p.comments||[];
      const c={id:Math.max(0,...p.comments.map(x=>x.id))+1,parent,by:'Bs2FoB',op:1,date:now(),text};
      if(parent&&depth(p,{parent})>=2)throw new Error(L('답글 깊이 제한입니다.','Reply depth limit.'));
      p.comments.push(c);},'게시판 댓글 '+cur+' '+pid);
    replyTo=null;render();
  }catch(e){msg(e.message);}
  busy=false;
}
async function delComment(cid){
  if(!confirm(L('이 댓글과 그 답글을 지웁니까?','Delete this comment and its replies?')))return;
  const pid=view;
  try{await saveBoard(cur,d=>{const p=d.posts.find(x=>x.id===pid);const kill=new Set([cid]);let ch=true;
    while(ch){ch=false;p.comments.forEach(c=>{if(c.parent&&kill.has(c.parent)&&!kill.has(c.id)){kill.add(c.id);ch=true;}});}
    p.comments=p.comments.filter(c=>!kill.has(c.id));},'게시판 댓글 삭제 '+cur+' '+pid);render();}
  catch(e){msg(e.message);}
}
async function delPost(){
  if(!confirm(L('이 글을 지웁니까?','Delete this post?')))return;
  const pid=view;let files=[];
  try{
    await saveBoard(cur,d=>{const p=d.posts.find(x=>x.id===pid);files=(p.blocks||[]).filter(b=>b.f).map(b=>b.f);d.posts=d.posts.filter(x=>x.id!==pid);},'게시판 글 삭제 '+cur+' '+pid);
    mode='list';view=null;render();
    msg(L('삭제했습니다. 번호 정리 중입니다.','Deleted. Renumbering.'));
    for(const f of files)await delFile(f).catch(()=>{});
    await compact(cur);
    render();msg(L('삭제와 번호 정리를 마쳤습니다.','Delete and renumbering done.'));
  }catch(e){mode='list';view=null;render();msg(e.message);}
}
async function clip(){
  try{
    const items=await navigator.clipboard.read();
    for(const it of items){const ty=it.types.find(t=>t.startsWith('image/'));if(!ty)continue;
      const f=new File([await it.getType(ty)],'clipboard.'+(ty.split('/')[1]||'png'),{type:ty});
      pend.push({file:f,type:'image',url:URL.createObjectURL(f)});root.querySelector('.bd-pends').innerHTML=pendHtml();return;}
    msg(L('클립보드에 이미지가 없습니다.','No image on the clipboard.'));
  }catch(e){msg(L('클립보드에 이미지가 없습니다.','No image on the clipboard.'));}
}

function onClick(e){
  const s=e.target.closest('[data-sub]');if(s){cur=s.dataset.sub;mode='list';pg=0;view=null;edit=null;pend=[];render();load(cur).then(render);return;}
  const r=e.target.closest('.bd-row');if(r){view=+r.dataset.id;mode='view';replyTo=null;render();window.scrollTo(0,0);return;}
  const g=e.target.closest('[data-pg]');if(g){pg=+g.dataset.pg;render();return;}
  const a=e.target.closest('[data-act]');if(!a)return;
  const act=a.dataset.act,i=+a.dataset.i;
  if(act==='char'){const ta=a.closest('.sc-ed').querySelector('textarea'),s=ta.selectionStart,t=a.textContent;
    ta.value=ta.value.slice(0,s)+t+ta.value.slice(ta.selectionEnd);ta.selectionStart=ta.selectionEnd=s+t.length;ta.focus();fit(ta);return;}
  if(act==='new'){edit=null;pend=[];mode='form';render();}
  else if(act==='list'){mode='list';view=null;render();}
  else if(act==='cancel'){pend=[];mode=edit?'view':'list';edit=null;render();}
  else if(act==='save')savePost();
  else if(act==='edit'){const p=posts().find(x=>x.id===view);edit={id:p.id,title:p.title,pin:!!p.pin,blocks:JSON.parse(JSON.stringify(p.blocks||[]))};pend=[];mode='form';render();}
  else if(act==='del')delPost();
  else if(act==='copy'){
    const u='https://bs2fob.com/?b='+code(cur,view)+'&lang='+lang;
    const done=()=>{a.textContent=L('복사됨','Copied');a.classList.add('done');setTimeout(()=>{a.textContent=L('URL 복사','Copy URL');a.classList.remove('done');},1500);};
    if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(u).then(done,()=>prompt('URL',u));else prompt('URL',u);
  }
  else if(act==='clip')clip();
  else if(act==='pdel'){pend.splice(i,1);root.querySelector('.bd-pends').innerHTML=pendHtml();}
  else if(act==='up'||act==='down'||act==='bdel'||act==='addtext'){
    syncEdit();const B=edit.blocks;
    if(act==='up'&&i>0)[B[i-1],B[i]]=[B[i],B[i-1]];
    if(act==='down'&&i<B.length-1)[B[i+1],B[i]]=[B[i],B[i+1]];
    if(act==='bdel')B.splice(i,1);
    if(act==='addtext')B.push({t:''});
    root.querySelector('.bd-eblocks').innerHTML=edBlocksHtml();fitAll();
  }
  else if(act==='reply'){replyTo=+a.dataset.c;render();const t=root.querySelector('.bd-ct');if(t)t.focus();}
  else if(act==='ccancel'){replyTo=null;render();}
  else if(act==='csave')saveComment();
  else if(act==='cdel')delComment(+a.dataset.c);
}
function onChange(e){
  const inp=e.target;if(!inp.matches('input[type=file]'))return;
  for(const f of inp.files){
    if(inp.dataset.type==='audio'&&!/^(mp3|m4a)$/.test(fileExt(f.name))){msg(L('오디오는 mp3·m4a 만 받습니다.','Audio: mp3 or m4a only.'));continue;}
    pend.push({file:f,type:inp.dataset.type,url:URL.createObjectURL(f)});
  }
  inp.value='';root.querySelector('.bd-pends').innerHTML=pendHtml();
}

function mount(el,opt){
  const stay=root&&root.isConnected;
  adm=opt.admin||'';lang=opt.lang||'ko';
  if(!stay||(!adm&&mode==='form')){mode='list';view=null;edit=null;pend=[];replyTo=null;pg=0;}
  root=document.createElement('div');root.className='bd';
  el.innerHTML='';el.appendChild(root);
  root.addEventListener('click',onClick);root.addEventListener('change',onChange);
  root.addEventListener('input',e=>{if(e.target.matches('textarea.sc-input'))fit(e.target);});
  if(opt.open&&BOARDS.some(b=>b[0]===opt.open.board)){cur=opt.open.board;view=opt.open.id;mode='view';edit=null;pend=[];}
  render();
  Promise.all(BOARDS.map(b=>load(b[0]))).then(render).catch(()=>render());
}
window.Board={mount};
})();
