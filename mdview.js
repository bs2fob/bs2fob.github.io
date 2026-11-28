// mdview.js
// md 첨부를 엠디뷰어 조판(형광펜 == ++ %%, 글자색 {+ +} {- -})으로 펴서 .md-doc 상자에 채운다
(function(){
const SPANS=[['==','mk1'],['++','mk2'],['%%','mk3']];
const exts=SPANS.map(([d,c])=>({
  name:c,level:'inline',
  start(s){const i=s.indexOf(d);return i<0?undefined:i;},
  tokenizer(s){
    if(!s.startsWith(d))return;
    const e=s.indexOf(d,d.length);if(e<=d.length)return;
    return {type:c,raw:s.slice(0,e+d.length),tokens:this.lexer.inlineTokens(s.slice(d.length,e))};
  },
  renderer(t){return '<mark class="md-'+c+'">'+this.parser.parseInline(t.tokens)+'</mark>';}
}));
[['+','tg'],['-','tr']].forEach(([m,c])=>exts.push({
  name:c,level:'inline',
  start(s){const i=s.indexOf('{'+m);return i<0?undefined:i;},
  tokenizer(s){
    if(!s.startsWith('{'+m))return;
    const e=s.indexOf(m+'}',2);if(e<2)return;
    return {type:c,raw:s.slice(0,e+2),tokens:this.lexer.inlineTokens(s.slice(2,e))};
  },
  renderer(t){return '<span class="md-'+c+'">'+this.parser.parseInline(t.tokens)+'</span>';}
}));
function escH(s){return s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);}
marked.use({gfm:true,breaks:true,extensions:exts,renderer:{
  html(t){return escH(t.text||t.raw||'').replace(/&lt;(\/?)(br|small)\s*\/?&gt;/gi,(m,c,n)=>'<'+c+n.toLowerCase()+'>');},
  link(t){const h=this.parser.parseInline(t.tokens);return /^(https?:|mailto:|#)/i.test(t.href)?'<a href="'+escH(t.href)+'" target="_blank" rel="noopener">'+h+'</a>':h;}
}});

function render(text){return marked.parse(String(text).replace(/^﻿/,''));}
async function fill(root){
  for(const el of root.querySelectorAll('.md-doc[data-src]')){
    const u=el.dataset.src;if(el.dataset.done===u)continue;
    el.dataset.done=u;
    try{
      const r=await fetch(u.startsWith('blob:')?u:u+(u.includes('?')?'&':'?')+'t='+Date.now());
      if(!r.ok)throw new Error(r.status);
      el.innerHTML=render(await r.text());
    }catch(e){if(el.dataset.done===u)el.innerHTML='<div class="md-wait">…</div>';}
  }
}
window.MdView={render,fill};
})();
