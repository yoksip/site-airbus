/* =====================================================================
   Administration du site — 100 % GitHub, sans backend.
   - Connexion via GitHub : jeton d'accès (PAT) OU OAuth device flow.
   - Identité = compte GitHub ; les droits sont dans data/access.json
     (clé = login GitHub, role admin|editor, groups = groupes éditables).
   - Contenu lu/écrit dans le dépôt via l'API GitHub Contents.
   Le jeton reste dans ce navigateur (localStorage), jamais dans le dépôt.
   ===================================================================== */

const CFG = window.SITE_CONFIG || {};
const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];

const state = { token:null, login:null, role:null, groups:[],
                data:null, contentSha:null,
                access:null, accessSha:null, dirty:false };

/* ---------------- encodage ---------------- */
function b64ToUtf8(b64){ const bin=atob(String(b64).replace(/\n/g,'')); const bytes=Uint8Array.from(bin,c=>c.charCodeAt(0)); return new TextDecoder().decode(bytes); }
function utf8ToB64(str){ const bytes=new TextEncoder().encode(str); let bin=''; bytes.forEach(b=>bin+=String.fromCharCode(b)); return btoa(bin); }

/* ---------------- GitHub API ---------------- */
function ghHeaders(){ return { 'Authorization':'Bearer '+state.token, 'Accept':'application/vnd.github+json' }; }
function repoUrl(p){ return `https://api.github.com/repos/${CFG.owner}/${CFG.repo}/contents/${p}`; }

async function ghGet(path){
  const r = await fetch(repoUrl(path)+`?ref=${encodeURIComponent(CFG.branch)}`, {headers:ghHeaders()});
  if(r.status===404) return {json:null, sha:null};
  if(!r.ok) throw new Error('Lecture GitHub '+r.status+' — '+(await r.text()).slice(0,140));
  const d = await r.json();
  return {json: JSON.parse(b64ToUtf8(d.content)), sha:d.sha};
}
async function ghPut(path, obj, sha, message){
  const body = {message, content:utf8ToB64(JSON.stringify(obj,null,2)), branch:CFG.branch};
  if(sha) body.sha = sha;
  const r = await fetch(repoUrl(path), {method:'PUT',
    headers:{...ghHeaders(),'Content-Type':'application/json'}, body:JSON.stringify(body)});
  if(!r.ok){ const e=await r.json().catch(()=>({})); throw new Error(e.message||('Écriture GitHub '+r.status)); }
  return r.json();
}
async function getGithubUser(token){
  const r = await fetch('https://api.github.com/user', {headers:{'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json'}});
  if(!r.ok) throw new Error('Jeton refusé par GitHub ('+r.status+').');
  return r.json();
}

/* ---------------- UI utils ---------------- */
function toast(msg, kind=''){
  const t=$('#toast'); t.textContent=msg; t.className='toast '+kind; t.hidden=false;
  clearTimeout(toast._t); toast._t=setTimeout(()=>{t.hidden=true;},3600);
}
function markDirty(){ state.dirty=true; $('#dirtyDot').hidden=false; }
function markClean(){ state.dirty=false; $('#dirtyDot').hidden=true; }
function esc(s){return (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

let _promptResolve=null;
function ask({title='Saisie',help='',label='Valeur',value='',type='text'}={}){
  return new Promise(res=>{
    _promptResolve=res;
    $('#promptTitle').textContent=title;
    $('#promptHelp').textContent=help; $('#promptHelp').hidden=!help;
    $('#promptLabel').textContent=label;
    const inp=$('#promptInput'); inp.type=type; inp.value=value;
    $('#promptModal').hidden=false; setTimeout(()=>inp.focus(),40);
  });
}
$('#promptCancel').onclick=()=>{ $('#promptModal').hidden=true; if(_promptResolve)_promptResolve(null); _promptResolve=null; };
$('#promptOk').onclick=()=>{ const v=$('#promptInput').value; $('#promptModal').hidden=true; if(_promptResolve)_promptResolve(v); _promptResolve=null; };
$('#promptInput').addEventListener('keydown',e=>{ if(e.key==='Enter'){e.preventDefault();$('#promptOk').click();} });

/* ---------------- Permissions ---------------- */
function isAdmin(){ return state.role==='admin'; }
function canEditGroup(group){ if(isAdmin()) return true; return (state.groups||[]).includes(group); }
function allGroups(){ return [...new Set((state.data.pages||[]).map(p=>p.group).filter(Boolean))].sort(); }
function accessEntry(login){ const u=(state.access&&state.access.users)||{}; const k=Object.keys(u).find(k=>k.toLowerCase()===String(login).toLowerCase()); return k?{key:k, val:u[k]}:null; }

/* =====================================================================
   Connexion
   ===================================================================== */
function showLogin(){
  $('#loginScreen').hidden=false; $('#adminApp').hidden=true;
  $('#cfgRepo').textContent = CFG.owner+'/'+CFG.repo;
  if(CFG.oauthClientId){ $('#oauthBtn').hidden=false; } else { $('#oauthBtn').hidden=true; $('#orSep').hidden=true; }
}
function showApp(){
  $('#loginScreen').hidden=true; $('#adminApp').hidden=false;
  $('#whoAmI').innerHTML = esc(state.login)+' <span class="role">'+(isAdmin()?'administrateur':'éditeur')+'</span>';
  buildTabs(); renderAll(); markClean();
}

function loginError(msg){ const e=$('#loginError'); e.hidden=false; e.textContent=msg; }

async function finishLogin(token){
  state.token = token;
  const u = await getGithubUser(token);
  state.login = u.login;
  await loadAccess();
  const me = accessEntry(state.login);
  if(!me) throw new Error("Accès refusé : le compte GitHub « "+state.login+" » n'est pas autorisé dans "+CFG.accessPath+".");
  state.role = me.val.role||'editor';
  state.groups = me.val.groups||[];
  await loadContent();
  localStorage.setItem('site_gh_token', token);
  showApp();
}

$('#loginBtn').onclick = async ()=>{
  const btn=$('#loginBtn'); btn.disabled=true; btn.textContent='Connexion…';
  $('#loginError').hidden=true;
  try{ await finishLogin($('#tokenInput').value.trim()); }
  catch(err){ loginError(err.message); localStorage.removeItem('site_gh_token'); btn.disabled=false; btn.textContent='Se connecter avec un jeton'; }
};

/* --- OAuth device flow (optionnel, si oauthClientId fourni) --- */
const sleep = ms => new Promise(r=>setTimeout(r,ms));
$('#oauthBtn').onclick = async ()=>{
  const btn=$('#oauthBtn'); btn.disabled=true; btn.textContent='Ouverture…';
  $('#loginError').hidden=true;
  try{
    const r = await fetch('https://github.com/login/device/code', {method:'POST',
      headers:{'Accept':'application/json','Content-Type':'application/json'},
      body:JSON.stringify({client_id:CFG.oauthClientId, scope:CFG.oauthScope||'repo'})});
    const d = await r.json();
    if(!d.device_code) throw new Error(d.error_description||d.error||'Échec device flow');
    $('#deviceBox').hidden=false;
    $('#deviceCode').textContent = d.user_code;
    $('#deviceLink').href = d.verification_uri || 'https://github.com/login/device';
    const interval = (d.interval||5)*1000;
    const deadline = Date.now() + (d.expires_in||900)*1000;
    let token=null;
    while(Date.now()<deadline){
      const t = await fetch('https://github.com/login/oauth/access_token', {method:'POST',
        headers:{'Accept':'application/json','Content-Type':'application/json'},
        body:JSON.stringify({client_id:CFG.oauthClientId, device_code:d.device_code, grant_type:'urn:ietf:params:oauth:grant-type:device_code'})});
      const td = await t.json();
      if(td.access_token){ token=td.access_token; break; }
      if(td.error==='authorization_pending'){ await sleep(interval); continue; }
      if(td.error==='slow_down'){ await sleep(interval+3000); continue; }
      throw new Error(td.error_description||td.error||'Autorisation refusée');
    }
    if(!token) throw new Error('Délai dépassé.');
    $('#deviceStatus').textContent='Autorisé ✔';
    await finishLogin(token);
  }catch(err){
    loginError(err.message);
    $('#deviceStatus').textContent='';
  }finally{ btn.disabled=false; btn.textContent='Se connecter avec GitHub'; }
};

$('#logoutBtn').onclick=()=>{
  if(state.dirty && !confirm('Des modifications ne sont pas enregistrées. Se déconnecter quand même ?')) return;
  localStorage.removeItem('site_gh_token');
  state.token=state.login=null; state.role=null; state.groups=[]; state.data=null;
  showLogin();
};

/* =====================================================================
   Chargement des données
   ===================================================================== */
async function loadAccess(){
  const {json, sha} = await ghGet(CFG.accessPath);
  if(json){ state.access=json; state.accessSha=sha; return; }
  // Amorçage : premier login = administrateur
  state.access = {users:{ [state.login.toLowerCase()]:{role:'admin', groups:[]} }};
  const r = await ghPut(CFG.accessPath, state.access, null, 'Initialisation de access.json — admin : '+state.login);
  state.accessSha = (r.content && r.content.sha) || (await ghGet(CFG.accessPath)).sha;
  toast('access.json créé : '+state.login+' est administrateur.','ok');
}
async function loadContent(){
  const {json, sha} = await ghGet(CFG.contentPath);
  state.data = json || {site:{}, pages:[], footer:{}};
  state.contentSha = sha;
}
async function saveAccess(message){
  const r = await ghPut(CFG.accessPath, state.access, state.accessSha, message||'Mise à jour des droits');
  state.accessSha = (r.content && r.content.sha) || (await ghGet(CFG.accessPath)).sha;
}

/* =====================================================================
   Onglets
   ===================================================================== */
let activeTab='pages';
function buildTabs(){
  const t=$('#tabs'); t.innerHTML='';
  const tabs=[['pages','Pages']];
  if(isAdmin()) tabs.push(['users','Droits d\'accès']);
  tabs.push(['account','Mon compte']);
  tabs.forEach(([id,label])=>{
    const b=document.createElement('button'); b.textContent=label; b.dataset.tab=id;
    if(id===activeTab) b.classList.add('active');
    b.onclick=()=>{ activeTab=id; buildTabs(); showPanel(); };
    t.appendChild(b);
  });
}
function showPanel(){
  $('#panelPages').hidden   = activeTab!=='pages';
  $('#panelUsers').hidden   = activeTab!=='users';
  $('#panelAccount').hidden = activeTab!=='account';
  $('#toolbar').style.display = activeTab==='pages' ? '' : 'none';
  $('#saveBtn').style.display = activeTab==='pages' ? '' : 'none';
  if(activeTab==='pages') renderPages();
  if(activeTab==='users') renderUsers();
  if(activeTab==='account') renderAccount();
}
function renderAll(){ showPanel(); }

/* =====================================================================
   Onglet Pages
   ===================================================================== */
function renderPages(){
  const p=$('#panelPages'); p.innerHTML='';
  const d=state.data;

  if(isAdmin()){
    const c=document.createElement('section'); c.className='card';
    c.innerHTML=`<h2 class="card-title">Identité du site</h2>
      <label class="field"><span>Marque</span><input id="siteBrand" type="text" value="${esc((d.site||{}).brand||'')}"></label>
      <label class="field"><span>Sous-titre (onglet)</span><input id="siteTagline" type="text" value="${esc((d.site||{}).tagline||'')}"></label>
      <div class="row2">
        <label class="field"><span>Titre bannière</span><input id="heroTitle" type="text" value="${esc(((d.site||{}).hero||{}).title||'')}"></label>
        <label class="field"><span>Sur-titre bannière</span><input id="heroKicker" type="text" value="${esc(((d.site||{}).hero||{}).kicker||'')}"></label>
      </div>
      <label class="field"><span>Texte bannière</span><textarea id="heroSub" rows="2">${esc(((d.site||{}).hero||{}).subtitle||'')}</textarea></label>`;
    p.appendChild(c);
    $('#siteBrand').oninput=e=>{d.site=d.site||{};d.site.brand=e.target.value;markDirty();};
    $('#siteTagline').oninput=e=>{d.site.tagline=e.target.value;markDirty();};
    $('#heroTitle').oninput=e=>{d.site.hero=d.site.hero||{};d.site.hero.title=e.target.value;markDirty();};
    $('#heroKicker').oninput=e=>{d.site.hero.kicker=e.target.value;markDirty();};
    $('#heroSub').oninput=e=>{d.site.hero.subtitle=e.target.value;markDirty();};
  }

  const c2=document.createElement('section'); c2.className='card';
  const mine = isAdmin() ? allGroups() : (state.groups||[]);
  c2.innerHTML=`<div class="card-head"><h2 class="card-title">Pages</h2>
      <button class="btn btn-ghost sm" id="addPage">+ Ajouter une page</button></div>
    <div id="pagesList"></div>
    <p class="hint">Groupes que tu peux modifier : <strong>${esc(mine.join(', ')||'—')}</strong>${isAdmin()?" (tous, en tant qu'administrateur)":''}.</p>`;
  p.appendChild(c2);

  const list=$('#pagesList');
  (d.pages||[]).forEach((pg,i)=>{
    const allowed=canEditGroup(pg.group);
    const b=document.createElement('div');
    b.className='page-block'+(allowed?'':' locked');
    b.innerHTML=`
      <div class="head">
        <span class="idx">#${i+1}</span>
        <input class="sid" type="text" placeholder="id" value="${esc(pg.id||'')}" ${allowed?'':'disabled'}>
        <input class="stitle" type="text" placeholder="Titre" value="${esc(pg.title||'')}" ${allowed?'':'disabled'}>
        <input class="sgroup" type="text" placeholder="groupe" value="${esc(pg.group||'')}" ${isAdmin()?'':'disabled'}>
        ${allowed?'<span class="tag-a">éditable</span>':'<span class="lock-badge">lecture seule</span>'}
        <div class="move-btns">
          <button class="sbtn up" title="Monter" ${allowed?'':'disabled'}>↑</button>
          <button class="sbtn down" title="Descendre" ${allowed?'':'disabled'}>↓</button>
          <button class="sbtn danger del" title="Supprimer" ${allowed?'':'disabled'}>🗑</button>
        </div>
      </div>
      <div class="wysiwyg" contenteditable="${allowed?'true':'false'}" data-idx="${i}">${pg.html||''}</div>`;
    const sid=b.querySelector('.sid'), st=b.querySelector('.stitle'), sg=b.querySelector('.sgroup'), wy=b.querySelector('.wysiwyg');
    if(allowed){
      sid.oninput=()=>{pg.id=sid.value.trim();markDirty();};
      st.oninput=()=>{pg.title=st.value;markDirty();};
      wy.addEventListener('input',()=>{pg.html=wy.innerHTML;markDirty();});
      if(isAdmin()) sg.oninput=()=>{pg.group=sg.value.trim();markDirty();};
      b.querySelector('.up').onclick=()=>{ if(i>0){[d.pages[i-1],d.pages[i]]=[d.pages[i],d.pages[i-1]];markDirty();renderPages();} };
      b.querySelector('.down').onclick=()=>{ if(i<d.pages.length-1){[d.pages[i+1],d.pages[i]]=[d.pages[i],d.pages[i+1]];markDirty();renderPages();} };
      b.querySelector('.del').onclick=()=>{ if(confirm('Supprimer cette page ?')){d.pages.splice(i,1);markDirty();renderPages();} };
    }
    list.appendChild(b);
  });

  $('#addPage').onclick=async ()=>{
    const title=await ask({title:'Nouvelle page',label:'Titre',value:'Nouvelle page'});
    if(!title) return;
    let group;
    if(isAdmin()){
      group=await ask({title:'Nouvelle page',help:'Groupe de la page (ex : Général, ZQIRO).',label:'Groupe',value:allGroups()[0]||'Général'});
      if(group===null) return;
    } else {
      group=(state.groups||[])[0];
      if(!group){ toast('Aucun groupe autorisé pour ton compte.','bad'); return; }
    }
    const id=(title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''))||('page-'+Date.now());
    d.pages.push({id, group, title, html:'<p>Texte à modifier…</p>'});
    markDirty(); renderPages();
  };
}

/* =====================================================================
   Onglet Droits d'accès (admin)
   ===================================================================== */
function renderUsers(){
  const p=$('#panelUsers'); p.innerHTML='';
  const c=document.createElement('section'); c.className='card';
  c.innerHTML=`<div class="card-head"><h2 class="card-title">Droits d'accès</h2>
      <button class="btn btn-ghost sm" id="addUser">+ Autoriser un compte GitHub</button></div>
    <p class="hint">Clé = <strong>login GitHub</strong> du compte. Enregistré dans <code>${esc(CFG.accessPath)}</code>.</p>
    <div id="usersBox"></div>`;
  p.appendChild(c);

  const users=(state.access&&state.access.users)||{};
  const groups=allGroups();
  const box=$('#usersBox');
  const table=document.createElement('table'); table.className='users';
  table.innerHTML=`<thead><tr><th>Compte GitHub</th><th>Rôle</th><th>Groupes éditables</th><th>Actions</th></tr></thead><tbody></tbody>`;
  const tb=table.querySelector('tbody');
  const keys=Object.keys(users).sort();
  if(keys.length===0){ tb.innerHTML='<tr><td colspan="4" class="hint">Aucun droit défini.</td></tr>'; }
  keys.forEach(k=>{
    const u=users[k]||{};
    const tr=document.createElement('tr');
    const g = u.role==='admin' ? '<em>tous</em>' : (u.groups||[]).map(x=>`<span>${esc(x)}</span>`).join('')||'<em>aucun</em>';
    tr.innerHTML=`<td><strong>${esc(k)}</strong>${k.toLowerCase()===String(state.login).toLowerCase()?' <span class="tag-a">moi</span>':''}</td>
      <td>${u.role==='admin'?'administrateur':'éditeur'}</td>
      <td class="groups">${g}</td>
      <td><div class="row-actions">
        <button class="mini edit">Éditer</button>
        ${k.toLowerCase()===String(state.login).toLowerCase()?'':`<button class="mini danger del">Retirer</button>`}
      </div></td>`;
    tr.querySelector('.edit').onclick=()=>editUser(k, u, groups);
    const del=tr.querySelector('.del');
    if(del) del.onclick=async ()=>{
      if(!confirm('Retirer les droits de '+k+' ?')) return;
      delete state.access.users[k];
      try{ await saveAccess('Retrait des droits de '+k); toast('Droits retirés.','ok'); renderUsers(); }
      catch(e){ toast('Erreur : '+e.message,'bad'); }
    };
    tb.appendChild(tr);
  });
  table.appendChild(tb); box.appendChild(table);

  $('#addUser').onclick=async ()=>{
    const login=await ask({title:'Autoriser un compte',help:'Login GitHub exact (ex : alain-dupont).',label:'Login GitHub'});
    if(!login) return;
    const role=(await ask({title:'Autoriser '+login,help:'admin ou editor',label:'Rôle',value:'editor'}))||'editor';
    const gs=(await ask({title:'Autoriser '+login,help:'Groupes séparés par des virgules (ex : ZQIRO). Ignoré si admin.',label:'Groupes',value:''}))||'';
    state.access.users[login.trim()]={ role: role.trim()==='admin'?'admin':'editor',
      groups: gs.split(',').map(s=>s.trim()).filter(Boolean) };
    try{ await saveAccess('Ajout de '+login); toast('Compte autorisé ✅','ok'); renderUsers(); }
    catch(e){ delete state.access.users[login.trim()]; toast('Erreur : '+e.message,'bad'); }
  };
}

async function editUser(k, u, groups){
  const role=(await ask({title:'Éditer '+k,help:'admin ou editor',label:'Rôle',value:u.role||'editor'}))||u.role;
  const gs=(await ask({title:'Éditer '+k,help:'Groupes séparés par des virgules.',label:'Groupes',value:(u.groups||[]).join(', ')}));
  if(gs===null) return;
  state.access.users[k]={ role: role.trim()==='admin'?'admin':'editor', groups: gs.split(',').map(s=>s.trim()).filter(Boolean) };
  try{ await saveAccess('Mise à jour de '+k); toast('Droits mis à jour ✅','ok'); renderUsers(); }
  catch(e){ toast('Erreur : '+e.message,'bad'); }
}

/* =====================================================================
   Onglet Mon compte
   ===================================================================== */
function renderAccount(){
  const p=$('#panelAccount'); p.innerHTML='';
  const c=document.createElement('section'); c.className='card';
  c.innerHTML=`<h2 class="card-title">Mon compte</h2>
    <p class="hint">Connecté en tant que <strong>${esc(state.login)}</strong> — rôle : <strong>${isAdmin()?'administrateur':'éditeur'}</strong>.</p>
    <p class="hint">Groupes éditables : <strong>${esc(isAdmin()?'tous':(state.groups.join(', ')||'aucun'))}</strong>.</p>
    <hr style="border:none;border-top:1px solid var(--line);margin:18px 0">
    <p class="hint">Authentification : compte GitHub. Pour changer de mot de passe, passe par GitHub.
    Le jeton d'accès, lui, se gère dans ce navigateur :</p>
    <button class="btn btn-ghost" id="forgetToken" type="button">Oublier le jeton sur ce navigateur</button>`;
  p.appendChild(c);
  $('#forgetToken').onclick=()=>{
    localStorage.removeItem('site_gh_token');
    toast('Jeton oublié. Reconnexion nécessaire.','ok');
    state.token=state.login=null; state.role=null; showLogin();
  };
}

/* =====================================================================
   Enregistrement du contenu
   ===================================================================== */
$('#saveBtn').onclick=async ()=>{
  const btn=$('#saveBtn'); btn.disabled=true; btn.textContent='Enregistrement…';
  try{
    const d=state.data;
    const r=await ghPut(CFG.contentPath, {site:d.site, pages:d.pages, footer:d.footer}, state.contentSha,
      'Mise à jour du contenu — '+new Date().toISOString());
    state.contentSha=(r.content && r.content.sha) || (await ghGet(CFG.contentPath)).sha;
    markClean();
    toast('Enregistré sur GitHub ✅ — le site se met à jour en ~1 min.','ok');
  }catch(e){
    toast('Erreur : '+e.message,'bad');
  }finally{ btn.disabled=false; btn.textContent='Enregistrer'; }
};

window.addEventListener('beforeunload',e=>{ if(state.dirty){e.preventDefault();e.returnValue='';} });

/* ---------------- Barre d'outils WYSIWYG ---------------- */
let lastEditable=null;
document.addEventListener('focusin',e=>{ if(e.target && e.target.classList && e.target.classList.contains('wysiwyg') && e.target.isContentEditable) lastEditable=e.target; });
$('#toolbar').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b) return;
  if(!lastEditable || !lastEditable.isContentEditable){ toast('Clique d\'abord dans une zone de texte éditable.'); return; }
  lastEditable.focus();
  if(b.dataset.cmd) document.execCommand(b.dataset.cmd,false,null);
  else if(b.dataset.block) document.execCommand('formatBlock',false,b.dataset.block);
  lastEditable.dispatchEvent(new Event('input'));
});
$('#linkBtn').addEventListener('click',()=>{
  if(!lastEditable || !lastEditable.isContentEditable){ toast('Clique d\'abord dans une zone de texte éditable.'); return; }
  const url=prompt('Adresse du lien (https://…) :'); if(!url) return;
  lastEditable.focus();
  const sel=window.getSelection();
  if(sel && sel.toString()) document.execCommand('createLink',false,url);
  else document.execCommand('insertHTML',false,`<a href="${url}">${url}</a>`);
  lastEditable.dispatchEvent(new Event('input'));
});

/* =====================================================================
   Démarrage
   ===================================================================== */
(async function init(){
  const saved=localStorage.getItem('site_gh_token');
  if(saved){
    try{ await finishLogin(saved); return; }
    catch(e){ localStorage.removeItem('site_gh_token'); state.token=state.login=null; }
  }
  showLogin();
})();
