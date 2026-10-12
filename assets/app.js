/* Page publique : rend data/pages.json. Fallback intégré si le fetch échoue. */

const FALLBACK = {
  site:{brand:"AIRBUS",tagline:"",hero:{kicker:"",title:"Contenu indisponible",subtitle:"",ctaPrimary:"",ctaPrimaryLink:"#"}},
  pages:[{id:"x",group:"Général",title:"Aucun contenu",html:"<p>Le fichier data/pages.json n'a pas pu être chargé.</p>"}],
  footer:{text:"",copyright:""}
};

const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
function setText(sel,val){$$(sel).forEach(el=>el.textContent=val==null?"":String(val));}

async function loadData(){
  try{
    const res=await fetch('data/pages.json',{cache:'no-store'});
    if(!res.ok) throw new Error(res.status);
    return await res.json();
  }catch(e){
    console.warn('data/pages.json indisponible, fallback utilisé.',e);
    return FALLBACK;
  }
}

function render(c){
  setText('[data-site="brand"]',(c.site&&c.site.brand)||'AIRBUS');
  if(c.site&&c.site.tagline&&c.site.brand) document.title=`${c.site.brand} — ${c.site.tagline}`;

  const h=(c.site&&c.site.hero)||{};
  setText('[data-hero="kicker"]',h.kicker);
  setText('[data-hero="title"]',h.title);
  setText('[data-hero="subtitle"]',h.subtitle);
  const c1=$('#cta1');
  c1.textContent=h.ctaPrimary||''; c1.href=h.ctaPrimaryLink||'#';
  c1.style.display=h.ctaPrimary?'':'none';

  // Navigation = pages
  const nav=$('#nav'); nav.innerHTML='';
  const main=$('#pages'); main.innerHTML='';
  (c.pages||[]).forEach((p,i)=>{
    const a=document.createElement('a'); a.textContent=p.title||('Page '+(i+1)); a.href='#'+(p.id||i);
    nav.appendChild(a);

    const sec=document.createElement('section');
    sec.className='section'; sec.id=p.id||('page-'+i);
    const inner=document.createElement('div'); inner.className='container';
    const box=document.createElement('div'); box.className='section-inner';
    const h2=document.createElement('h2'); h2.textContent=p.title||'';
    const prose=document.createElement('div'); prose.className='prose'; prose.innerHTML=p.html||'';
    const tag=document.createElement('span'); tag.className='group-tag'; tag.textContent=p.group||'';
    box.appendChild(h2); box.appendChild(prose); box.appendChild(tag);
    inner.appendChild(box); sec.appendChild(inner); main.appendChild(sec);
  });

  const f=c.footer||{};
  setText('[data-footer="text"]',f.text);
  setText('[data-footer="copyright"]',f.copyright);
}

loadData().then(render);
