async function api(path, method='GET'){
  const r = await fetch(path,{method});
  if(!r.ok) throw new Error(await r.text());
  return r.json();
}

/* theme (dark default, light via toggle; persisted) */
(function initTheme(){ try{ if(localStorage.getItem('noon-theme')==='light') document.documentElement.dataset.theme='light'; }catch{} })();
function toggleTheme(){
  const light=document.documentElement.dataset.theme==='light';
  if(light) delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme='light';
  try{ localStorage.setItem('noon-theme', light?'dark':'light'); }catch{}
}
const money = n => (n ?? 0).toLocaleString();
const $ = id => document.getElementById(id);

/* each module is a separate page - sidebar switches between them */
const navLinks = [...document.querySelectorAll('#nav a')];
const pageTitles = {dashboard:'Dashboard',pricing:'MRP Calculator',profit:'Net profit',orders:'Orders',
  returns:'Returns',deals:'Deals',ads:'Ads performance',products:'Products',aplus:'A+ content',
  newarrivals:'New arrivals',autocreate:'Auto Creation',
  stock:'Stock',automations:'Automations',assistant:'AI assistant',keywords:'Keywords & titles',
  image:'AI image',bestsellers:'Best sellers',compare:'Pricing & competitor match',notes:'Notes',
  calendar:'Calendar & reminders'};
function showSection(id){
  document.querySelectorAll('.wrap > section').forEach(s=>s.classList.toggle('show', s.id===id));
  navLinks.forEach(l=>l.classList.toggle('active', l.getAttribute('href')==='#'+id));
  const ttl=document.getElementById('pageTitle'); if(ttl) ttl.textContent=pageTitles[id]||'noon Online';
  positionNavIndicator();
  if(id==='autocreate') refreshCatalogInfo();
  window.scrollTo(0,0);
}
navLinks.forEach(a=>{
  a.addEventListener('click', e=>{ e.preventDefault(); showSection(a.getAttribute('href').slice(1)); });
});
/* slide the active-nav highlight to the current item */
function positionNavIndicator(){
  const ind=document.getElementById('navIndicator');
  const active=document.querySelector('#nav a.active');
  if(!ind||!active) return;
  ind.style.height=active.offsetHeight+'px';
  ind.style.transform='translateY('+active.offsetTop+'px)';
  ind.classList.add('ready');
}
window.addEventListener('resize', positionNavIndicator);
/* material-style click ripple on buttons + nav items */
document.addEventListener('click', (e)=>{
  const el=e.target.closest('.btn, #nav a'); if(!el) return;
  const rect=el.getBoundingClientRect(), size=Math.max(rect.width,rect.height);
  const r=document.createElement('span'); r.className='ripple';
  r.style.width=r.style.height=size+'px';
  r.style.left=(e.clientX-rect.left-size/2)+'px';
  r.style.top=(e.clientY-rect.top-size/2)+'px';
  el.appendChild(r); setTimeout(()=>r.remove(),650);
});
/* sub-tabs within a page (e.g. Dashboard: Overview/Action, Stock: FBP/FBN) */
function subtab(btn,group,name){
  document.querySelectorAll('#'+group+' .subpage').forEach(s=>s.classList.toggle('show', s.id===group+'-'+name));
  btn.parentNode.querySelectorAll('.stab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
}

function table(el, rows, cols){
  const t=$(el);
  if(!rows||!rows.length){t.querySelector('thead').innerHTML='';t.querySelector('tbody').innerHTML='<tr><td class="muted">No data yet.</td></tr>';return;}
  t.querySelector('thead').innerHTML='<tr>'+cols.map(c=>`<th>${c.label}</th>`).join('')+'</tr>';
  t.querySelector('tbody').innerHTML=rows.map(r=>'<tr>'+cols.map(c=>`<td>${c.render?c.render(r):(r[c.key]??'')}</td>`).join('')+'</tr>').join('');
}

const ICONS={Sales:'<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  Orders:'<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0"/>',
  Views:'<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  'Live items':'<path d="M20 7 12 3 4 7v10l8 4 8-4z"/><path d="M4 7l8 4 8-4M12 11v10"/>'};
function countUp(el){
  const to=parseFloat(el.dataset.to)||0, suf=el.dataset.suffix||'', dur=750, t0=performance.now();
  let done=false;
  (function step(t){ const p=Math.min(1,(t-t0)/dur), e=1-Math.pow(1-p,3);
    el.textContent=money(Math.round(to*e))+suf; if(p<1) requestAnimationFrame(step); else done=true; })(t0);
  setTimeout(()=>{ if(!done) el.textContent=money(to)+suf; }, dur+150); // guarantee final value
}
function renderKpis(d){
  $('dateChip').textContent=d.date;
  const cards=[['Sales',d.sales,' AED'],['Orders',d.orders,''],['Views',d.views,''],['Live items',d.liveItems,'']];
  $('kpis').innerHTML=cards.map(([l,v,suf])=>`<div class="card kpi"><div class="ico"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">${ICONS[l]||''}</svg></div><div class="label">${l}</div><div class="value" data-to="${v}" data-suffix="${suf}">0</div></div>`).join('');
  $('kpis').querySelectorAll('.value[data-to]').forEach(countUp);
}
async function loadKpis(){ renderKpis(await api('/api/dashboard')); }
async function loadChart(){
  const data=await api('/api/sales-range?days=14');
  const max=Math.max(...data.map(d=>d.sales),1);
  const W=Math.max(560,data.length*46), H=190, pad=24;
  const slot=(W-pad*2)/data.length, bw=Math.floor(slot*0.6);
  let bars='',labels='';
  data.forEach((d,i)=>{
    const x=pad+i*slot+(slot-bw)/2;
    const h=Math.round((d.sales/max)*(H-46)); const y=H-22-h;
    bars+=`<rect x="${x.toFixed(1)}" y="${y}" width="${bw}" height="${h}" rx="4" fill="#feee00"><title>${d.date}: ${d.sales} AED</title></rect>`;
    if(i%2===0) labels+=`<text x="${(x+bw/2).toFixed(1)}" y="${H-6}" font-size="9" fill="#828aa0" text-anchor="middle">${d.date.slice(5)}</text>`;
  });
  $('chart').innerHTML=`<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="xMidYMid meet">${bars}${labels}</svg>`;
}
async function viewDay(){
  const d=$('dashDate').value; if(!d) return;
  renderKpis(await api('/api/dashboard?date='+encodeURIComponent(d)));
  $('chartHint').textContent='Showing '+d;
}
function resetDay(){ $('dashDate').value=''; $('chartHint').textContent=''; loadKpis(); }

let PRODUCTS=[];
async function loadProducts(){
  PRODUCTS=await api('/api/products');
  const cats=[...new Set(PRODUCTS.map(p=>p.category).filter(Boolean))].sort();
  const sel=$('prodCat'); if(sel) sel.innerHTML='<option value="">All categories</option>'+cats.map(c=>`<option>${c}</option>`).join('');
  renderProducts();
}
function renderProducts(){
  const q=($('prodSearch')?$('prodSearch').value:'').toLowerCase();
  const cat=$('prodCat')?$('prodCat').value:'', live=$('prodLive')?$('prodLive').value:'';
  const rows=PRODUCTS.filter(p=>{
    if(q && !(`${p.productCode} ${p.title}`.toLowerCase().includes(q))) return false;
    if(cat && p.category!==cat) return false;
    if(live==='live' && !p.isLive) return false;
    if(live==='off' && p.isLive) return false;
    return true;
  });
  if($('prodCount')) $('prodCount').textContent=rows.length+' of '+PRODUCTS.length;
  table('products',rows,[{key:'productCode',label:'Code'},{key:'title',label:'Title'},{key:'category',label:'Category'},
    {key:'baseCost',label:'Cost'},{key:'price',label:'Price'},{key:'stock',label:'Stock'},
    {label:'Live',render:r=>`<span class="pill ${r.isLive?'ok':'failed'}">${r.isLive?'live':'off'}</span>`}]);
}
let FBP=[],FBN=[];
async function loadFBP(){ FBP=await api('/api/stock/fbp'); renderFBP(); }
function renderFBP(){
  const q=($('fbpSearch')?$('fbpSearch').value:'').toLowerCase();
  const rows=q?FBP.filter(r=>(r.productCode||'').toLowerCase().includes(q)):FBP;
  table('fbpTbl',rows,[{key:'productCode',label:'Code'},{key:'brand',label:'Brand'},{key:'title',label:'Title'},
    {label:'Warehouse stock',render:r=>`<b>${r.warehouseStock}</b>`}]);
}
async function loadFBN(){ FBN=await api('/api/stock/fbn'); renderFBN(); }
function renderFBN(){
  const q=($('fbnSearch')?$('fbnSearch').value:'').toLowerCase();
  const rows=q?FBN.filter(r=>(r.productCode||'').toLowerCase().includes(q)):FBN;
  const lowCount=FBN.filter(r=>r.low).length;
  if($('fbnInfo')) $('fbnInfo').innerHTML = lowCount
    ? `<span style="color:var(--red);font-weight:600">${lowCount} item(s) running low in noon's warehouse - restock soon.</span>`
    : "All noon-warehouse stock looks healthy.";
  table('fbnTbl',rows,[{key:'productCode',label:'Code'},{key:'brand',label:'Brand'},{key:'title',label:'Title'},
    {label:'In noon warehouse',render:r=>`<b>${r.noonStock}</b>`},
    {label:'Status',render:r=>r.low?`<span class="pill failed">low - restock</span>`:`<span class="pill ok">ok</span>`}]);
}
let ACTION=[];
async function loadActionItems(){ ACTION=await api('/api/action-items'); renderActionItems(); }
function renderActionItems(){
  const q=($('actSearch')?$('actSearch').value:'').toLowerCase();
  const f=$('actFilter')?$('actFilter').value:'needs';
  let rows=ACTION.filter(a=> !q || `${a.productCode} ${a.title}`.toLowerCase().includes(q));
  if(f==='needs') rows=rows.filter(a=>a.needAction);
  if($('actCount')) $('actCount').textContent=rows.length+' item(s)';
  table('actionTbl',rows,[{key:'productCode',label:'Code'},{key:'title',label:'Title'},
    {key:'views',label:'Views'},{key:'unitsSold',label:'Sold'},
    {label:'Conversion',render:r=>(r.conversion*100).toFixed(1)+'%'},
    {label:'Status',render:r=>r.needAction?`<span class="pill failed">needs action</span>`:`<span class="pill ok">ok</span>`},
    {label:'Suggested fix',render:r=>r.needAction?`<button class="btn ghost" ${sbtn} onclick="doAction('${r.productCode}','${r.suggestion.replace(/'/g,"")}')">${r.suggestion}</button>`:'<span class="muted">-</span>'}]);
}
async function doAction(code,sug){
  if(sug.indexOf('A+')>=0){ showSection('aplus'); if($('aplusFilter'))$('aplusFilter').value=''; if($('aplusSearch'))$('aplusSearch').value=code; renderAplus(); }
  else if(sug.indexOf('Lower')>=0){ showSection('compare'); if($('listSearch'))$('listSearch').value=code; renderListings(); await matchPrice(code); loadActionItems(); }
  else { showSection('ads'); }
}
let APLUS=[];
async function loadAplus(){ APLUS=await api('/api/aplus'); renderAplus(); }
function renderAplus(){
  const q=($('aplusSearch')?$('aplusSearch').value:'').toLowerCase();
  const f=$('aplusFilter')?$('aplusFilter').value:'missing';
  let rows=APLUS.filter(a=> !q || `${a.productCode} ${a.title}`.toLowerCase().includes(q));
  if(f==='missing') rows=rows.filter(a=>!a.hasAplus);
  if(f==='done') rows=rows.filter(a=>a.hasAplus);
  if($('aplusCount')) $('aplusCount').textContent=rows.length+' item(s)';
  table('aplusTbl',rows,[{key:'productCode',label:'Code'},{key:'title',label:'Title'},{key:'category',label:'Category'},
    {label:'A+',render:r=>r.hasAplus?`<span class="pill ok">uploaded</span>`:`<span class="pill failed">missing</span>`},
    {label:'',render:r=>r.hasAplus?'':`<button class="btn" ${sbtn} onclick="markAplus('${r.productCode}')">Mark uploaded</button>`}]);
}
async function markAplus(code){ await api('/api/aplus/set?code='+encodeURIComponent(code)+'&uploaded=1','POST'); loadAplus(); }
async function fbnAlert(){
  $('fbnAlertOut').innerHTML='<span class="spinner"></span> <span class="muted">Sending...</span>';
  const r=await api('/api/fbn/alert','POST');
  if(r.sent) $('fbnAlertOut').innerHTML=`<span style="color:var(--green)">Emailed alert for ${r.count} low item(s).</span>`;
  else if(r.savedTo) $('fbnAlertOut').innerHTML=`<span class="muted">No SMTP configured - alert for ${r.count} item(s) saved to ${r.savedTo}</span>`;
  else $('fbnAlertOut').innerHTML=`<span style="color:var(--red)">${r.error||'Failed'}</span>`;
}
async function loadAutos(){
  const rows=(await api('/api/automations')).slice(-20).reverse();
  table('autos',rows,[{key:'automation',label:'Automation'},
    {label:'Status',render:r=>`<span class="pill ${r.status}">${r.status}</span>`},
    {key:'itemsOk',label:'OK'},{key:'itemsFailed',label:'Failed'},
    {label:'When',render:r=>(r.at||'').replace('T',' ').slice(0,19)}]);
}
let ORDERS=[];
async function loadOrders(){ ORDERS=await api('/api/orders'); renderOrders(); }
function renderOrders(){
  const f=$('orderFilter').value;
  const rows=f?ORDERS.filter(o=>o.status===f):ORDERS;
  table('ordersTbl',rows,[{key:'orderId',label:'Order'},{key:'productCode',label:'Product'},
    {key:'sellingPrice',label:'Price'},{label:'Status',render:r=>`<span class="pill ${r.status}">${r.status}</span>`},
    {key:'orderedAt',label:'Date'}]);
}
let RETURNS=[];
const RET_CLS={requested:'partial',approved:'info',received:'info',refunded:'ok',rejected:'failed'};
const sbtn='style="padding:5px 10px;font-size:12px;margin-right:4px"';
async function loadReturns(){ RETURNS=await api('/api/returns'); renderReturns(); }
function renderRetSummary(){
  const total=RETURNS.length;
  const refundedAmt=RETURNS.filter(r=>r.status==='refunded').reduce((s,r)=>s+(+r.refundAmount||0),0);
  const cards=[['Total returns',total],['Total refunded',money(refundedAmt)+' AED']];
  $('retSummary').innerHTML=cards.map(([l,v])=>`<div class="card kpi"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('');
}
function renderReturns(){
  renderRetSummary();
  const q=($('retSearch')?$('retSearch').value:'').toLowerCase();
  const rows=RETURNS.filter(r=> !q || `${r.returnId} ${r.orderId} ${r.productCode} ${r.reason}`.toLowerCase().includes(q));
  if($('retCount')) $('retCount').textContent=rows.length+' of '+RETURNS.length;
  table('retTbl',rows,[{key:'returnId',label:'RMA'},{key:'orderId',label:'Order'},{key:'productCode',label:'Code'},
    {key:'reason',label:'Reason'},{label:'Refund',render:r=>r.refundAmount+' AED'},{key:'date',label:'Date'}]);
}
async function loadDeals(){
  const rows=await api('/api/deals');
  table('dealsTbl',rows,[{key:'title',label:'Deal'},
    {label:'Joined',render:r=>`<span class="pill ${r.joined?'ok':'info'}">${r.joined?'joined':'not joined'}</span>`},
    {key:'orders',label:'Orders'},{key:'sales',label:'Sales (AED)'}]);
}
async function loadAds(){
  const rows=await api('/api/ads');
  table('adsTbl',rows,[{key:'campaign',label:'Campaign'},{key:'spend',label:'Spend'},{key:'revenue',label:'Revenue'},
    {label:'ROAS',render:r=>`<span class="pill ${r.roas>=2?'ok':r.roas>=1?'partial':'failed'}">${r.roas}x</span>`}]);
}
async function loadProfit(){
  const d=await api('/api/netprofit');
  $('profitStats').innerHTML=
    `<div class="card"><div class="label muted">Total revenue</div><div class="stat"><span class="big">${money(d.totalRevenue)}</span><span class="muted">AED</span></div></div>`+
    `<div class="card"><div class="label muted">Total net profit</div><div class="stat"><span class="big ${d.totalNetProfit>=0?'pos':'neg'}">${money(d.totalNetProfit)}</span><span class="muted">AED</span></div></div>`;
  table('profitTbl',d.products,[{key:'productCode',label:'Code'},{key:'price',label:'Price'},{key:'unitsSold',label:'Units'},
    {key:'revenue',label:'Revenue'},{label:'Net profit',render:r=>`<span class="${r.netProfit>=0?'pos':'neg'}">${r.netProfit}</span>`}]);
}

async function loadBest(){
  const d=await api('/api/bestsellers');
  table('bestMineTbl',d.mine,[{key:'productCode',label:'Code'},{key:'title',label:'Title'},{key:'category',label:'Category'},
    {key:'unitsSold',label:'Units sold'},{key:'revenue',label:'Revenue (AED)'}]);
  table('bestPlatTbl',d.platform,[{key:'category',label:'Category'},{key:'productCode',label:'Product'},
    {key:'sales',label:'Sales'},{key:'orders',label:'Orders'},{key:'views',label:'Views'}]);
}
let NOTES=[];
async function loadNotes(){
  const q=$('noteSearch')?$('noteSearch').value.trim():'';
  NOTES=await api('/api/notes'+(q?('?q='+encodeURIComponent(q)):''));
  table('notesTbl',NOTES,[{key:'title',label:'Title'},{key:'body',label:'Note'},
    {label:'Tags',render:r=>(r.tags||[]).map(t=>`<span class="pill info">${t}</span>`).join(' ')},
    {label:'',render:r=>`<button class="btn ghost" onclick="delNote('${r.id}')">Delete</button>`}]);
}
async function addNote(){
  const tags=$('noteTags').value.split(',').map(s=>s.trim()).filter(Boolean);
  await fetch('/api/notes',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({title:$('noteTitle').value,body:$('noteBody').value,tags})});
  $('noteTitle').value='';$('noteBody').value='';$('noteTags').value='';
  loadNotes();
}
async function delNote(id){ await fetch('/api/notes/delete?id='+encodeURIComponent(id),{method:'POST'}); loadNotes(); }

let CAL=[]; const calRef=new Date();
async function loadCalendar(){ CAL=await api('/api/calendar'); renderCalendar(); }
function calShift(n){ calRef.setMonth(calRef.getMonth()+n); renderCalendar(); }
function renderCalendar(){
  const y=calRef.getFullYear(), mo=calRef.getMonth();
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  $('calTitle').textContent=months[mo]+' '+y;
  $('calDow').innerHTML=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<div class="cal-dow">${d}</div>`).join('');
  const first=new Date(y,mo,1).getDay(), days=new Date(y,mo+1,0).getDate();
  const t=new Date(), todayStr=`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
  let cells='';
  for(let i=0;i<first;i++) cells+='<div class="cal-cell blank"></div>';
  for(let d=1;d<=days;d++){
    const ds=`${y}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const evs=CAL.filter(e=>e.date===ds);
    cells+=`<div class="cal-cell${ds===todayStr?' today':''}" onclick="pickDay('${ds}')"><div class="dnum">${d}</div>`+
      evs.slice(0,3).map(e=>`<div class="cal-ev" title="${e.note}">${e.note}</div>`).join('')+
      (evs.length>3?`<div class="muted" style="font-size:10px">+${evs.length-3} more</div>`:'')+`</div>`;
  }
  $('calGrid').innerHTML=cells;
}
function pickDay(ds){ $('calDate').value=ds; $('calNote').focus(); }
async function addEvent(){
  await fetch('/api/calendar',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({date:$('calDate').value,note:$('calNote').value})});
  $('calNote').value=''; loadCalendar();
}
async function delEvent(id){ await fetch('/api/calendar/delete?id='+encodeURIComponent(id),{method:'POST'}); loadCalendar(); }

async function askAI(){
  $('askOut').innerHTML='<span class="spinner"></span> <span class="muted">Thinking...</span>';
  const r=await api('/api/assistant?q='+encodeURIComponent($('askq').value||''));
  $('askOut').innerHTML=`<div class="card" style="background:#fafbff"><b>Answer</b><div style="margin:8px 0">${r.answer}</div>`+
    `<b>Suggested actions</b><ul>${(r.suggestions||[]).map(s=>`<li>${s}</li>`).join('')}</ul></div>`;
}
async function genKeywords(){
  $('kwOut').innerHTML='<span class="spinner"></span> <span class="muted">Generating...</span>';
  const c=$('kwCode').value.trim(), cat=$('kwCat').value.trim();
  const qs=c?('code='+encodeURIComponent(c)):('category='+encodeURIComponent(cat||'audio'));
  const r=await fetch('/api/keywords?'+qs,{method:'POST'}).then(x=>x.json());
  $('kwOut').innerHTML=`<div class="muted">Optimized title</div><div style="font-weight:600;margin:4px 0 12px">${r.title}</div>`+
    `<div class="muted">Keywords</div><div style="margin:6px 0 12px">${(r.keywords||[]).map(k=>`<span class="pill info">${k}</span>`).join(' ')}</div>`+
    `<div class="muted">Description</div><div>${r.description||''}</div>`;
}
async function genImage(){
  $('imgOut').innerHTML='<span class="spinner"></span> <span class="muted">Generating...</span>';
  const qs='prompt='+encodeURIComponent($('imgPrompt').value||'')+'&code='+encodeURIComponent($('imgCode').value||'')+'&size='+encodeURIComponent($('imgSize').value||'1024x1024');
  const r=await fetch('/api/image?'+qs,{method:'POST'}).then(x=>x.json());
  $('imgOut').innerHTML=`<div class="muted">Prompt: ${r.prompt} &middot; size ${r.size}</div>`+
    (r.images||[]).map(u=>`<img src="${u}" style="max-width:360px;border-radius:12px;margin-top:10px;border:1px solid var(--line)"/>`).join(' ');
}
let LISTINGS=[];
async function loadListings(){
  LISTINGS=await api('/api/listings-pricing');
  renderListings();
}
function renderListings(){
  const q=($('listSearch')?$('listSearch').value:'').toLowerCase();
  const rows=q?LISTINGS.filter(r=>(r.productCode||'').toLowerCase().includes(q)):LISTINGS;
  table('listTbl',rows,[
    {key:'productCode',label:'Code'},{key:'title',label:'Title'},{key:'unitsSold',label:'Pcs sold'},
    {label:'My price',render:r=>`<b>${r.myPrice}</b>`},
    {key:'amazon',label:'Amazon'},{key:'jumla',label:'Jumla'},{key:'starGallery',label:'Star Gallery'},
    {label:'Status',render:r=>`<span class="pill ${r.competitive?'ok':'failed'}">${r.competitive?'competitive':'high'}</span>`},
    {label:'',render:r=>`<button class="btn" onclick="matchPrice('${r.productCode}')">Match</button>`}
  ]);
}
async function matchPrice(code){
  $('matchOut').innerHTML='<span class="spinner"></span> <span class="muted">Matching '+code+'...</span>';
  const r=await api('/api/match-price?code='+encodeURIComponent(code),'POST');
  $('matchOut').innerHTML=`<div>${code}: new price <b style="color:var(--green)">${r.newPrice} AED</b> &middot; matched cheapest ${r.matchedTo} &middot; floor ${r.floor}</div>`;
  loadListings(); loadProducts();
}
async function matchAll(){
  $('matchOut').innerHTML='<span class="spinner"></span> <span class="muted">Matching all listings...</span>';
  let n=0;
  for(const r of LISTINGS){ await api('/api/match-price?code='+encodeURIComponent(r.productCode),'POST'); n++; }
  $('matchOut').innerHTML=`<div>Matched ${n} listing(s) to the cheapest competitor (never below floor).</div>`;
  loadListings(); loadProducts();
}

let ARRIVALS=[];
async function loadArrivals(){
  ARRIVALS=await api('/api/newarrivals');
  const brands=[...new Set(ARRIVALS.map(a=>a.brand).filter(Boolean))].sort();
  const cats=[...new Set(ARRIVALS.map(a=>a.category).filter(Boolean))].sort();
  if($('arrBrand')) $('arrBrand').innerHTML='<option value="">All brands</option>'+brands.map(b=>`<option>${b}</option>`).join('');
  if($('arrCat')) $('arrCat').innerHTML='<option value="">All categories</option>'+cats.map(c=>`<option>${c}</option>`).join('');
  renderArrivals();
}
function renderArrivals(){
  const q=($('arrSearch')?$('arrSearch').value:'').toLowerCase();
  const b=$('arrBrand')?$('arrBrand').value:'', c=$('arrCat')?$('arrCat').value:'';
  const rows=ARRIVALS.filter(a=>{
    if(q && !(`${a.productCode} ${a.title}`.toLowerCase().includes(q))) return false;
    if(b && a.brand!==b) return false;
    if(c && a.category!==c) return false;
    return true;
  });
  if($('arrOut')) $('arrOut').textContent=rows.length+' of '+ARRIVALS.length+' not yet listed';
  table('arrTbl',rows,[{key:'productCode',label:'Code'},{key:'brand',label:'Brand'},{key:'title',label:'Title'},{key:'category',label:'Category'},
    {key:'stock',label:'Panel stock'},{key:'baseCost',label:'Cost'},
    {label:'',render:r=>`<button class="btn" onclick="createArrival('${r.productCode}')">Create</button>`}]);
}
async function createArrival(code){
  await api('/api/create?code='+encodeURIComponent(code),'POST');
  loadArrivals(); loadProducts(); loadKpis();
}

/* pull a clean message out of an API error (handlers return {error}) */
function acErr(e){ try{ return JSON.parse(e.message).error || e.message; }catch{ return e.message; } }
/* escape user/API text before injecting into HTML */
function esc(s){ return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

/* rich preview/result card for a fetched or created product */
function productCard(p){
  const imgs=(p.imageUrls||[]).filter(Boolean);
  const primary=p.primaryImage||imgs[0]||'';
  const gallery=imgs.slice(0,12).map(u=>`<img src="${esc(u)}" loading="lazy" title="${esc(u)}" onclick="window.open('${esc(u)}','_blank')" style="width:60px;height:60px;object-fit:cover;border-radius:8px;border:1px solid var(--line);cursor:pointer"/>`).join('');
  const vids=(p.videoUrls||[]).filter(Boolean);
  const videoHtml=vids.length?`<div class="muted" style="margin-top:12px">Videos (${vids.length})</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">`+
    vids.slice(0,4).map(v=>`<video src="${esc(v)}" controls preload="metadata" style="max-width:220px;border-radius:8px;border:1px solid var(--line)"></video>`).join('')+`</div>`:'';
  const meta=[p.brand,p.productCode,p.price!=null?(p.price+' AED'):null,
    p.isLive!=null?(p.isLive?'live':'off'):null].filter(Boolean).map(esc).join(' &middot; ');
  return `<div style="display:flex;gap:16px;margin-top:6px;flex-wrap:wrap">
    ${primary?`<img src="${esc(primary)}" style="width:128px;height:128px;object-fit:cover;border-radius:12px;border:1px solid var(--line)"/>`:''}
    <div style="flex:1;min-width:240px">
      <div style="font-weight:700;font-size:15px">${esc(p.title||p.productCode||'')}</div>
      <div class="muted" style="margin:3px 0 10px">${meta}</div>
      <div style="font-size:13px;color:var(--ink-soft);line-height:1.5">${esc((p.description||'').slice(0,400))}</div>
      ${imgs.length?`<div class="muted" style="margin-top:12px">Images (${imgs.length})</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">${gallery}</div>`:''}
      ${videoHtml}
    </div>
  </div>`;
}

/* progress bar markup */
function progressHTML(pct,label){
  return `<div class="muted" style="margin-bottom:6px">${esc(label)}</div>`+
    `<div style="height:9px;background:var(--border);border-radius:6px;overflow:hidden;max-width:460px">`+
    `<div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--y2),var(--y));transition:width .3s"></div></div>`;
}
/* Full automation: type a SKU -> fetch from connect -> create on noon via API. */
async function acBuild(){
  const sku=$('acSku').value.trim(); if(!sku){ $('acOut').innerHTML='<span class="muted">Enter a SKU first.</span>'; return; }
  const out=$('acOut');
  let p=30; out.innerHTML=progressHTML(p,'Fetching '+sku+' from connect & creating on noon…');
  const timer=setInterval(()=>{ p=Math.min(85,p+4); out.innerHTML=progressHTML(p,'Fetching from connect & creating on noon…'); },350);
  try{
    let r;
    try{ r=await api('/api/noon/create?code='+encodeURIComponent(sku),'POST'); }
    finally{ clearInterval(timer); }
    const noon=r.noon||{};
    const ok=noon.ok;
    out.innerHTML=progressHTML(100, ok ? ('Created on noon — '+esc(sku)) : ('noon API responded '+esc(String(noon.status||'?'))))+
      '<div style="margin-top:6px;font-weight:700;color:'+(ok?'var(--green)':'var(--amber)')+'">'+
        (ok?'✓ Product created on noon':'⚠ noon API did not accept the create (see response below)')+'</div>'+
      '<div style="margin-top:12px">'+productCard(r.product||{})+'</div>'+
      '<div class="muted" style="margin-top:14px">noon API &middot; <code>POST '+esc(noon.path||'')+'</code> &rarr; HTTP '+esc(String(noon.status||'?'))+'</div>'+
      '<pre style="margin-top:6px">'+esc(JSON.stringify(noon.response!==undefined?noon.response:noon,null,2)).slice(0,1400)+'</pre>';
  }catch(e){ clearInterval(timer); out.innerHTML=`<span style="color:var(--red)">${esc(acErr(e))}</span>`; }
}
/* download the noon catalogue upload file.
   fmt: 'xlsx' (default) or 'csv'; or pass an array of codes for a single item */
function downloadCatalog(fmt, codes){
  if(Array.isArray(fmt)){ codes=fmt; fmt='xlsx'; }
  fmt = fmt==='csv' ? 'csv' : 'xlsx';
  const params=[];
  if(codes&&codes.length) params.push('codes='+encodeURIComponent(codes.join(',')));
  else if($('catAll')&&$('catAll').checked) params.push('all=1');
  window.location='/api/noon/catalog.'+fmt+(params.length?('?'+params.join('&')):'');
}
/* upload the current noon catalog to Seller Lab (Playwright, saved session) */
async function uploadToNoon(){
  const all=$('catAll')&&$('catAll').checked;
  if(!confirm('Upload the current noon catalog to Seller Lab now?\n\nA browser window will open on the server to perform the upload. You must have run "node cli.js noon:login" once beforehand.')) return;
  const box=$('catalogInfo');
  box.innerHTML='<span class="spinner"></span> uploading to noon…';
  try{
    const r=await api('/api/noon/upload'+(all?'?all=1':''),'POST');
    box.innerHTML = r.ok
      ? `<span style="color:var(--green)">${esc(r.message||'Uploaded.')}</span>`
      : `<span style="color:var(--red)">${esc(r.message||'Upload failed.')}</span>`;
  }catch(e){ box.innerHTML=`<span style="color:var(--red)">${esc(acErr(e))}</span>`; }
}
/* show how many products will export and whether noon's real template is loaded */
async function refreshCatalogInfo(){
  try{
    const all=$('catAll')&&$('catAll').checked?'?all=1':'';
    const r=await api('/api/noon/catalog/count'+all);
    if($('catalogInfo')) $('catalogInfo').textContent=r.count+' product(s) will export';
    if($('catalogTpl')) $('catalogTpl').innerHTML = r.nis
      ? 'Filling noon’s NIS template — products are auto-classified and content is SEO-enriched; dropdowns &amp; validations preserved.'
      : r.usingTemplate
        ? 'Using your noon template (templates/noon-catalog-template.xlsx).'
        : 'Using default columns. Drop noon’s real template at <code>templates/noon-catalog-template.xlsx</code> to match Seller Lab exactly.';
  }catch{}
}
/* Mode 3 - upload a supplier pricelist .xlsx, generate one NIS for all SKUs */
async function acPricelist(){
  const f=$('plFile').files[0];
  if(!f){ $('plOut').innerHTML='<span class="muted">Choose a .xlsx pricelist first.</span>'; return; }
  const out=$('plOut');
  let p=20; out.innerHTML=progressHTML(p,'Parsing pricelist & fetching images from connect…');
  const timer=setInterval(()=>{ p=Math.min(85,p+5); out.innerHTML=progressHTML(p,'Parsing pricelist, fetching images & filling the NIS template…'); },450);
  try{
    const buf=await f.arrayBuffer();
    let resp;
    try{ resp=await fetch('/api/noon/pricelist-nis',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:buf}); }
    finally{ clearInterval(timer); }
    if(!resp.ok){ throw new Error(await resp.text()); }
    const total=resp.headers.get('X-Nis-Total')||'?', vars=resp.headers.get('X-Nis-Variations')||'0', singles=resp.headers.get('X-Nis-Singles')||'0';
    const blob=await resp.blob();
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=(f.name.replace(/\.xlsx$/i,'')||'pricelist')+'-NIS.xlsx';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),4000);
    out.innerHTML=progressHTML(100,'NIS generated & downloaded.')+
      `<div class="muted" style="margin-top:10px"><b>${esc(total)}</b> SKU(s) &middot; <b>${esc(vars)}</b> variation group(s) &middot; <b>${esc(singles)}</b> single(s).</div>`;
  }catch(e){ out.innerHTML=`<span style="color:var(--red)">${esc(acErr(e))}</span>`; }
}
async function optimizeDeals(){
  $('optOut').innerHTML='<span class="spinner"></span> <span class="muted">Optimizing...</span>';
  const rows=await api('/api/dealoptimizer');
  $('optOut').innerHTML=`<table style="margin-top:8px"><thead><tr><th>Deal</th><th>Recommend</th><th>Reason</th></tr></thead><tbody>`+
    rows.map(r=>`<tr><td>${r.deal}</td><td><span class="pill ${r.recommend==='join'?'ok':'failed'}">${r.recommend}</span></td><td class="muted">${r.reason}</td></tr>`).join('')+
    `</tbody></table>`;
}

async function loadAll(){
  await Promise.all([loadKpis(),loadChart(),loadProducts(),loadFBP(),loadFBN(),loadActionItems(),loadAplus(),
    loadAutos(),loadOrders(),loadReturns(),loadDeals(),loadAds(),loadProfit(),loadBest(),loadListings(),
    loadArrivals(),loadNotes(),loadCalendar()]);
}

/* ===== MRP Calculator ===== */
let MRP_TIER='Standard';
/* noon parcel shipping fee by weight + tier */
function mrpShipping(w,tier){
  if(tier==='Standard'){
    if(w<=0.25)return 14.0; if(w<=0.50)return 14.5; if(w<=1.0)return 15.0;
    if(w<=1.5)return 15.5; if(w<=2.0)return 16.0; if(w<=3.0)return 17.5;
    return 17.5+(w-3.0)*1.0;
  }
  if(w<=1.0)return 18.5; if(w<=2.0)return 19.5; if(w<=10.0)return 19.5+(w-2.0)*1.0;
  if(w<=15.0)return 32.0; if(w<=20.0)return 36.0; if(w<=25.0)return 40.0;
  if(w<=30.0)return 44.0; return 44.0+(w-30.0)*1.0;
}
function mrpSetTier(t){
  MRP_TIER=t;
  $('mrpTierStd').classList.toggle('active',t==='Standard');
  $('mrpTierOs').classList.toggle('active',t==='Oversize');
}
function mrpWeightTrigger(){ const w=parseFloat($('mrpWeight').value); if(w>=12.0) mrpSetTier('Oversize'); }
/* pull the unit price (and name) from connect for the entered SKU */
async function mrpFetch(){
  const sku=$('mrpSku').value.trim(); if(!sku) return;
  $('mrpFetchOut').innerHTML='<span class="spinner"></span> fetching from connect.oskarme.com…';
  try{
    const p=await api('/api/panel/fetch?code='+encodeURIComponent(sku));
    const hasCost=p.baseCost!=null && Number(p.baseCost)>0;
    if(hasCost) $('mrpUnit').value=Number(p.baseCost);
    $('mrpFetchOut').innerHTML=`Fetched <b>${esc(p.title||sku)}</b>`+
      (hasCost ? ` &middot; unit price <b>${Number(p.baseCost)} AED</b> filled in.`
               : ` &middot; <span style="color:var(--amber)">connect did not return a unit price (cost API not wired yet) &mdash; enter it manually.</span>`);
  }catch(e){ $('mrpFetchOut').innerHTML=`<span style="color:var(--red)">${esc(acErr(e))}</span>`; }
}
function mrpCalc(){
  $('mrpErr').textContent='';
  const unit=parseFloat($('mrpUnit').value), rrp=parseFloat($('mrpRrp').value),
        margin=parseFloat($('mrpMargin').value), weight=parseFloat($('mrpWeight').value), fee=parseFloat($('mrpFee').value);
  try{
    if([unit,rrp,margin,fee].some(v=>!(v>0))) throw new Error('Unit Price, RRP, Estimated Fee, and Margin must be greater than 0.');
    if(!(weight>=0)) throw new Error('Enter a valid weight (KG).');
    if(margin>=100) throw new Error('Margin must be less than 100%.');
    if(weight>=12.0) mrpSetTier('Oversize');
    const shipping=mrpShipping(weight,MRP_TIER);
    const cost=(unit/((1-(margin/100))/0.95))+(shipping/0.95);
    const divider=1-((fee/rrp)/0.95);
    if(divider<=0) throw new Error('Non-positive commission divider — adjust Fee or RRP.');
    const mrp=cost/divider;
    $('mrpShip').textContent=shipping.toFixed(2)+' AED';
    $('mrpComm').textContent=(divider*100).toFixed(4)+'%';
    $('mrpResult').textContent=mrp.toFixed(2);
    $('mrpCopy').textContent='Copy';
  }catch(e){ $('mrpErr').textContent=e.message; $('mrpResult').textContent='—'; $('mrpShip').textContent='—'; $('mrpComm').textContent='—'; }
}
function mrpCopy(){
  const v=$('mrpResult').textContent;
  if(v && v!=='—'){ try{ navigator.clipboard.writeText(v); }catch{} $('mrpCopy').textContent='Copied!'; }
}
function mrpClear(){
  ['mrpSku','mrpUnit','mrpRrp','mrpMargin','mrpWeight','mrpFee'].forEach(id=>{ if($(id)) $(id).value=''; });
  mrpSetTier('Standard');
  $('mrpShip').textContent='—'; $('mrpComm').textContent='—'; $('mrpResult').textContent='—';
  $('mrpErr').textContent=''; $('mrpFetchOut').textContent=''; $('mrpCopy').textContent='Copy';
}
async function createProduct(){
  const code=$('createCode').value.trim()||'ABC100';
  $('actOut').innerHTML='<span class="spinner"></span> <span class="muted">Working...</span>';
  const r=await api('/api/create?code='+encodeURIComponent(code),'POST');
  $('actOut').innerHTML=`<div class="muted">Created / updated</div><pre>${JSON.stringify(r,null,2)}</pre>`;
  loadKpis();loadProducts();loadProfit();
}
async function syncStock(){
  const box=$('stockOut')||$('actOut');
  box.innerHTML='<span class="spinner"></span> <span class="muted">Syncing all live listings...</span>';
  const r=await api('/api/syncstock','POST');
  box.innerHTML=`<div style="margin-top:6px">Status <span class="pill ${r.status}">${r.status}</span> &nbsp; changed <b>${r.changed}</b> &nbsp; ok <b>${r.ok}</b> &nbsp; failed <b>${r.failed}</b></div>`;
  loadKpis();loadFBP();loadAutos();
}

showSection('dashboard');
loadAll();
