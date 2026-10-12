/* =====================================================================
   Administration multi-utilisateurs.
   - Connexion via le backend (jeton en localStorage)
   - Permissions par GROUPE de pages (admin = tout ; éditeur = ses groupes)
   - Édition WYSIWYG, gestion des utilisateurs, changement de mot de passe
   ===================================================================== */

const CFG = window.SITE_CONFIG || {};
const API = (CFG.apiBase || '').replace(/\/$/, '');
const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];

const state = { token: null, user: null, data: null, dirty: false };

/* ---------------- API ---------------- */
async function api(path, {method='GET', body=null, auth=true}={}){
  const headers = {'Content-Type':'application/json'};
  if(auth && state.token) headers['Authorization'] = 'Bearer '+state.token;
  const res = await fetch(API+path, {method, headers, body: body?JSON.stringify(body):null});
  let data = null;
  try{ data = await res.json(); }catch(e){ data = null; }
  if(!res.ok){
    const msg = (data && (data.error||data.message)) || ('Erreur '+res.status);
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return data;
}

/* ---------------- UI utils ---------------- */
function toast(msg, kind=''){
  const t=$('#toast'); t.textContent=msg; t.className='toast '+kind; t.hidden=false;
  clearTimeout(toast._t); toast._t=setTimeout(()=>{t.hidden=true;},3400);
}
function markDirty(){ state.dirty=true; $('#dirtyDot').hidden=false; }
function markClean(){ state.dirty=false; $('#dirtyDot').hidden=true; }
function esc(s){return (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

let _promptResolve=null;
function ask({title='Saisie',help='',label='Valeur',value='',type='text'}={}){
  return new Promise(res=>{
    _promptResolve=res;
    $('#promptTitle').textContent=title;
    $('#promptHelp').textContent=help;
    $('#promptHelp').hidden=!help;
    $('#promptLabel').textContent=label;
    const inp=$('#promptInput'); inp.type=type; inp.value=value;
    $('#promptModal').hidden=false; setTimeout(()=>inp.focus(),40);
  });
}
$('#promptCancel').onclick=()=>{ $('#promptModal').hidden=true; if(_promptResolve)_promptResolve(null); _promptResolve=null; };
$('#promptOk').onclick=()=>{ const v=$('#promptInput').value; $('#promptModal').hidden=true; if(_promptResolve)_promptResolve(v); _promptResolve=null; };
$('#promptInput').addEventListener('keydown',e=>{ if(e.key==='Enter'){e.preventDefault();$('#promptOk').click();} });

/* ---------------- Permissions ---------------- */
function canEditGroup(group){
  if(!state.user) return false;
  if(state.user.role==='admin') return true;
  return (state.user.groups||[]).includes(group);
}
function isAdmin(){ return state.user && state.user.role==='admin'; }
function allGroups(){ return [...new Set((state.data.pages||[]).map(p=>p.group).filter(Boolean))].sort(); }

/* =====================================================================
   Connexion
   ===================================================================== */
function showLogin(){
  $('#loginScreen').hidden=false; $('#adminApp').hidden=true;
  $('#loginHint').innerHTML = 'Premier compte : <code>thibaud</code> / <code>airbus123</code>';
  setTimeout(()=>$('#userInput').focus(),50);
}
function showApp(){
  $('#loginScreen').hidden=true; $('#adminApp').hidden=false;
  $('#whoAmI').innerHTML = esc(state.user.username)+' <span class="role">'+(state.user.role==='admin'?'administrateur':'éditeur')+'</span>';
  buildTabs(); renderAll(); markClean();
}

$('#loginForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const btn=$('#loginBtn'); btn.disabled=true; btn.textContent='Connexion…';
  try{
    const r=await api('/api/login',{method:'POST',auth:false,body:{username:$('#userInput').value.trim(),password:$('#passInput').value}});
    state.token=r.token; state.user=r.user;
    localStorage.setItem('airbus_token', r.token);
    await loadContent();
    showApp();
  }catch(err){
    $('#loginError').hidden=false; $('#loginError').textContent=err.message;
    $('#passInput').value='';
  }finally{ btn.disabled=false; btn.textContent='Se connecter'; }
});

$('#logoutBtn').onclick=async ()=>{
  if(state.dirty && !confirm('Des modifications ne sont pas enregistrées. Se déconnecter quand même ?')) return;
  try{ await api('/api/logout',{method:'POST'}); }catch(e){}
  state.token=null; state.user=null; localStorage.removeItem('airbus_token');
  showLogin();
};

async function loadContent(){
  const r=await api('/api/content');
  state.data=r;
}

/* =====================================================================
   Onglets
   ===================================================================== */
let activeTab='pages';
function buildTabs(){
  const t=$('#tabs'); t.innerHTML='';
  const tabs=[['pages','Pages']];
  if(isAdmin()) tabs.push(['users','Utilisateurs']);
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
  if(activeTab==='pages') renderPages();
  if(activeTab==='users') renderUsers();
  if(activeTab==='account') renderAccount();
  $('#saveBtn').style.display = activeTab==='pages' ? '' : 'none';
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
  const mine = isAdmin() ? allGroups() : (state.user.groups||[]);
  c2.innerHTML=`<div class="card-head"><h2 class="card-title">Pages</h2>
      <button class="btn btn-ghost sm" id="addPage">+ Ajouter une page</button></div>
    <div id="pagesList"></div>
    <p class="hint">Tu peux modifier les pages des groupes : <strong>${esc(mine.join(', ')||'—')}</strong>${isAdmin()?' (tous, en tant qu\'administrateur)':''}.</p>`;
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
      group=await ask({title:'Nouvelle page',help:'Groupe de la page (ex : Général, ZQIRO).',label:'Groupe',value:(state.user.groups||['Général'])[0]||'Général'});
      if(group===null) return;
    } else {
      group=(state.user.groups||[])[0];
      if(!group){ toast('Aucun groupe autorisé pour ton compte.','bad'); return; }
    }
    const id=(title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''))||('page-'+Date.now());
    d.pages.push({id,group,title,html:'<p>Texte à modifier…</p>'});
    markDirty(); renderPages();
  };
}

/* =====================================================================
   Onglet Utilisateurs (admin)
   ===================================================================== */
async function renderUsers(){
  const p=$('#panelUsers'); p.innerHTML='';
  const c=document.createElement('section'); c.className='card';
  c.innerHTML=`<div class="card-head"><h2 class="card-title">Utilisateurs</h2>
      <button class="btn btn-ghost sm" id="addUser">+ Ajouter un utilisateur</button></div>
    <div id="usersBox" class="hint">Chargement…</div>`;
  p.appendChild(c);

  let users=[];
  try{ users=(await api('/api/users')).users; }
  catch(e){ $('#usersBox').textContent='Erreur : '+e.message; return; }

  const groups=allGroups();
  const box=$('#usersBox'); box.innerHTML='';
  const table=document.createElement('table'); table.className='users';
  table.innerHTML=`<thead><tr><th>Identifiant</th><th>Rôle</th><th>Groupes éditables</th><th>Actions</th></tr></thead><tbody></tbody>`;
  const tb=table.querySelector('tbody');
  users.forEach(u=>{
    const tr=document.createElement('tr');
    const g = u.role==='admin' ? '<em>tous</em>' : (u.groups||[]).map(x=>`<span>${esc(x)}</span>`).join('')||'<em>aucun</em>';
    tr.innerHTML=`<td><strong>${esc(u.username)}</strong>${u.username===state.user.username?' <span class="tag-a">moi</span>':''}</td>
      <td>${u.role==='admin'?'administrateur':'éditeur'}</td>
      <td class="groups">${g}</td>
      <td><div class="row-actions">
        <button class="mini edit">Éditer</button>
        <button class="mini pw">Mot de passe</button>
        ${u.username===state.user.username?'':`<button class="mini danger del">Supprimer</button>`}
      </div></td>`;
    tr.querySelector('.edit').onclick=()=>editUser(u,groups,users);
    tr.querySelector('.pw').onclick=async ()=>{
      const np=await ask({title:'Mot de passe',help:`Nouveau mot de passe pour ${u.username}.`,label:'Nouveau mot de passe',type:'text'});
      if(!np) return;
      try{ await api('/api/users/'+encodeURIComponent(u.username)+'/password',{method:'POST',body:{password:np}}); toast('Mot de passe mis à jour ✅','ok'); }
      catch(e){ toast('Erreur : '+e.message,'bad'); }
    };
    const del=tr.querySelector('.del');
    if(del) del.onclick=async ()=>{
      if(!confirm(`Supprimer l'utilisateur ${u.username} ?`)) return;
      try{ await api('/api/users/'+encodeURIComponent(u.username),{method:'DELETE'}); toast('Utilisateur supprimé.','ok'); renderUsers(); }
      catch(e){ toast('Erreur : '+e.message,'bad'); }
    };
    tb.appendChild(tr);
  });
  table.appendChild(tb);
  box.appendChild(table);

  $('#addUser').onclick=async ()=>{
    const username=await ask({title:'Nouvel utilisateur',label:'Identifiant'});
    if(!username) return;
    const password=await ask({title:'Nouvel utilisateur',label:'Mot de passe'});
    if(!password) return;
    const role=(await ask({title:'Nouvel utilisateur',help:'admin ou editor',label:'Rôle',value:'editor'}))||'editor';
    const gs=(await ask({title:'Nouvel utilisateur',help:'Groupes séparés par des virgules (ex : ZQIRO). Un administrateur ignore ce champ.',label:'Groupes',value:''}))||'';
    const groups=gs.split(',').map(s=>s.trim()).filter(Boolean);
    try{
      await api('/api/users',{method:'POST',body:{username,password,role:role.trim(),groups}});
      toast('Utilisateur créé ✅','ok'); renderUsers();
    }catch(e){ toast('Erreur : '+e.message,'bad'); }
  };
}

async function editUser(u, groups, all){
  const role=(await ask({title:'Éditer '+u.username,help:'admin ou editor',label:'Rôle',value:u.role}))||u.role;
  const gs=(await ask({title:'Éditer '+u.username,help:'Groupes séparés par des virgules.',label:'Groupes',value:(u.groups||[]).join(', ')}));
  if(gs===null) return;
  const groupsArr=gs.split(',').map(s=>s.trim()).filter(Boolean);
  try{
    await api('/api/users/'+encodeURIComponent(u.username),{method:'PATCH',body:{role:role.trim(),groups:groupsArr}});
    toast('Utilisateur mis à jour ✅','ok'); renderUsers();
  }catch(e){ toast('Erreur : '+e.message,'bad'); }
}

/* =====================================================================
   Onglet Mon compte
   ===================================================================== */
function renderAccount(){
  const p=$('#panelAccount'); p.innerHTML='';
  const c=document.createElement('section'); c.className='card';
  c.innerHTML=`<h2 class="card-title">Changer mon mot de passe</h2>
    <label class="field"><span>Mot de passe actuel</span><input id="pwOld" type="password" autocomplete="current-password"></label>
    <label class="field"><span>Nouveau mot de passe</span><input id="pwNew" type="password" autocomplete="new-password"></label>
    <label class="field"><span>Confirmer le nouveau mot de passe</span><input id="pwNew2" type="password" autocomplete="new-password"></label>
    <button class="btn btn-primary" id="pwGo" type="button">Mettre à jour</button>`;
  p.appendChild(c);
  $('#pwGo').onclick=async ()=>{
    const o=$('#pwOld').value, n=$('#pwNew').value, n2=$('#pwNew2').value;
    if(!n || n!==n2){ toast('Les deux nouveaux mots de passe ne correspondent pas.','bad'); return; }
    try{ await api('/api/change-password',{method:'POST',body:{old:o,new:n}}); toast('Mot de passe modifié ✅','ok'); $('#pwOld').value=$('#pwNew').value=$('#pwNew2').value=''; }
    catch(e){ toast('Erreur : '+e.message,'bad'); }
  };
}

/* =====================================================================
   Enregistrement
   ===================================================================== */
$('#saveBtn').onclick=async ()=>{
  const btn=$('#saveBtn'); btn.disabled=true; btn.textContent='Enregistrement…';
  try{
    const d=state.data;
    const payload={site:d.site, pages:d.pages, footer:d.footer};
    const r=await api('/api/save',{method:'POST',body:payload});
    markClean();
    toast('Enregistré ✅'+(r.commit?' (déployé sur GitHub)':'')+'. Le site se met à jour dans ~1 min.','ok');
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
  const saved=localStorage.getItem('airbus_token');
  if(saved){
    state.token=saved;
    try{
      const me=await api('/api/me'); state.user=me.user;
      await loadContent(); showApp(); return;
    }catch(e){ localStorage.removeItem('airbus_token'); state.token=null; }
  }
  showLogin();
})();
