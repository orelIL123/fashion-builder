import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';

const PATTERN = __PATTERN__;
const SHEET_CM = PATTERN.sheetCm, PX = 16, TEX = SHEET_CM*PX; // 2048 px print sheet, 16 px per cm
const $ = id => document.getElementById(id);

const toast = msg => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(()=>t.remove(), 3200); };

// ---------- SaaS plan helpers (AuthService from auth.js) ----------
function plan(){ return AuthService.getPlan(); }
function requirePro(feature){
  if (plan().id === 'pro') return true;
  toast((feature||'This feature') + ' is Pro · ₪40/mo');
  openPricing();
  return false;
}
function ensureLayerRoom(){
  if (AuthService.canAddLayer(S.layers.length)) return true;
  toast(`Free plan: max ${plan().maxLayers} layers. Upgrade to Pro for unlimited.`);
  openPricing();
  return false;
}
function drawWatermark(ctx, w, h){
  if (!AuthService.needsWatermark()) return;
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#f2c14e';
  ctx.font = `700 ${Math.max(14, Math.round(w*0.028))}px "Familjen Grotesk", sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('Fashion Builder · Free', w - 16, h - 14);
  ctx.restore();
}
async function withWatermarkCanvas(srcCanvas){
  if (!AuthService.needsWatermark()) return srcCanvas;
  const c = document.createElement('canvas'); c.width = srcCanvas.width; c.height = srcCanvas.height;
  const g = c.getContext('2d'); g.drawImage(srcCanvas, 0, 0); drawWatermark(g, c.width, c.height); return c;
}
function refreshPlanUI(){
  const st = AuthService.getState();
  const badge = $('planBadge');
  if (badge){ badge.textContent = st.plan.name; badge.classList.toggle('pro', st.plan.id==='pro'); }
  const logged = !!st.user;
  if ($('accLogout')) $('accLogout').hidden = !logged;
  if ($('accEmailHint')) $('accEmailHint').textContent = st.user ? st.user.email : '';
  if ($('accSignIn')) $('accSignIn').querySelector('b').textContent = logged ? 'Account' : 'Sign in / Sign up';
  // font options
  const sel = $('textFont');
  if (sel){
    [...sel.options].forEach(o=>{
      const proOnly = o.dataset.pro === '1';
      const allowed = AuthService.canUseFont(o.value);
      o.disabled = proOnly && !allowed;
      o.hidden = false;
    });
  }
  // turntable menu hint already has Pro pill
}


// ---------- pattern pieces in sheet-pixel space (y down = glTF UV space) ----------
const USER = PATTERN.source==='user';
const WEARER = USER ? {} : {sleeveR:'Left sleeve', sleeveL:'Right sleeve'};
const pieces = PATTERN.pieces.map(p => { p = {...p, label: WEARER[p.id] || p.label};
  const pts = p.outline.map(([x,y]) => [x*PX, (SHEET_CM - y)*PX]);
  const path = new Path2D(); pts.forEach(([x,y],i)=> i?path.lineTo(x,y):path.moveTo(x,y)); path.closePath();
  const xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]);
  return {...p, pts, path, box:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]};
});
const pieceById = Object.fromEntries(pieces.map(p=>[p.id,p]));
const pieceScale = p => (p.cmPerUv || SHEET_CM)/SHEET_CM;
const sizeCm = p => [(p.box[2]-p.box[0])/PX*pieceScale(p), (p.box[3]-p.box[1])/PX*pieceScale(p)];
const isRib = p => p.id==='rib' || /^Neck rib/.test(p.label||'');
const mainPieces = () => pieces.filter(p=>!p.minor);
const _pc = document.createElement('canvas').getContext('2d');
const pieceAt = (x,y) => {
  let best=null, bestA=-1;
  for (const p of pieces){
    if (!_pc.isPointInPath(p.path,x,y)) continue;
    const a=(p.box[2]-p.box[0])*(p.box[3]-p.box[1]);
    if (a>bestA){ best=p; bestA=a; }
  }
  return best;
};
// display layout for the pattern view: main pieces shelf-packed and readable (the print sheet keeps true UV placement)
const ORDER = ['front','back','sleeveR','sleeveRb','sleeveL','sleeveLb'];
const SHOWN = pieces.filter(p=>!p.minor && !/facing/.test(p.label)).sort((a,b)=>{ const ia=ORDER.indexOf(a.id), ib=ORDER.indexOf(b.id); if(ia>=0||ib>=0) return (ia<0?99:ia)-(ib<0?99:ib); return (b.box[2]-b.box[0])*(b.box[3]-b.box[1])-(a.box[2]-a.box[0])*(a.box[3]-a.box[1]); });
{ const maxW = 165*PX, gap = 6*PX, lab = 6*PX, minCell = 31*PX; let x=0, y=0, rowH=0;
  for (const p of SHOWN){ const w=p.box[2]-p.box[0], h=p.box[3]-p.box[1], cell=Math.max(w,minCell); if (x>0 && x+cell>maxW){ x=0; y+=rowH+gap+lab; rowH=0; }
    p.dx = x+(cell-w)/2-p.box[0]; p.dy = y-p.box[1]; x += cell+gap; rowH = Math.max(rowH,h); } }
const dispBox = p => [p.box[0]+p.dx, p.box[1]+p.dy, p.box[2]+p.dx, p.box[3]+p.dy];
// display point -> {piece, sheet point}
function fromDisplay(x,y){ for (const p of SHOWN){ if (_pc.isPointInPath(p.path, x-p.dx, y-p.dy)) return {p, sx:x-p.dx, sy:y-p.dy}; } return null; }
const offsetOf = L => { const p = pieceAt(L.x,L.y); return p && p.dx!==undefined ? [p.dx,p.dy] : null; };
const allPieces = new Path2D(); pieces.forEach(p=>allPieces.addPath(p.path));

// ---------- state ----------
const FABRICS = [['Off white','#ecebe6'],['White','#f6f6f4'],['Black','#1d1d1f'],['Navy','#1f2a44'],['Olive','#5c6b4a'],['Red','#8f2a26'],['Sand','#cdb48f'],['Sky','#a9bed6'],['Rose','#d9a1a8'],['Heather','#77797a'],['Forest','#3d5a40'],['Burgundy','#5e1b26']];
const BGS = [['Paper','#f1efea'],['White','#ffffff'],['Linen','#e7dfd2'],['Stone','#d8d2c4'],['Mint','#d6e2d6'],['Mist','#d3dde8'],['Blush','#e8d6d4'],['Concrete','#9b9b98'],['Graphite','#2e2f31'],['Rust','#c9672c'],['Plum','#3d2a55'],['Ink','#17181a'],['Cream','#efe6d0'],['Oxblood','#7e1d1d'],['Sage','#9fb4a2'],['Moss','#55705a'],['Bottle','#21402d'],['Ochre','#c9a44c']];
const HANGERS = [['White','#f2f2ef'],['Black','#1e1e1f'],['Natural','#c8a27a'],['Walnut','#6b4a33'],['Grey','#9aa0a6'],['Gold','#c9a54a']];
const MATERIALS = {
  cotton: {rough:0.88, sheen:1.0, sheenRough:0.62, knit:'jersey', knitScale:1.0, softMul:1.0},
  heavy:  {rough:0.92, sheen:1.0, sheenRough:0.7,  knit:'jersey', knitScale:1.35, softMul:0.75},
  fleece: {rough:0.96, sheen:1.0, sheenRough:0.95, knit:'fleece', knitScale:1.0, softMul:0.6},
  pique:  {rough:0.86, sheen:0.8, sheenRough:0.6,  knit:'pique', knitScale:1.0, softMul:0.9},
  poly:   {rough:0.52, sheen:0.35,sheenRough:0.4,  knit:'jersey', knitScale:0.55, softMul:1.1},
};
const S = { fabric:'#40593f', grad:false, grad2:'#1f2a44', rib:'#40593f', ribMatch:true, wash:'none', washStr:0.6, washSize:1.4, washPrints:true, washSeed:3,
  bg:'#9fb4a2', layers:[], sel:null };
let uid = 0;

// ---------- layers ----------
async function ensureFont(font){
  try { await document.fonts.load(`220px "${font}"`); } catch(_){}
  try { await document.fonts.load(`700 220px "${font}"`); } catch(_){}
}
function textBitmap(L){
  const c = document.createElement('canvas'), g = c.getContext('2d');
  const fs = 220; g.font = `700 ${fs}px "${L.font}", sans-serif`;
  const lines = L.text.split('\n'); const w = Math.max(...lines.map(l=>g.measureText(l).width), 10);
  c.width = Math.ceil(w + 40); c.height = Math.ceil(lines.length*fs*1.05 + 40);
  g.font = `700 ${fs}px "${L.font}", sans-serif`; g.fillStyle = L.color; g.textAlign='center'; g.textBaseline='middle';
  lines.forEach((l,i)=> g.fillText(l, c.width/2, 20 + fs*0.55 + i*fs*1.05));
  L.src = c; L.aspect = c.height/c.width; L.thumb = null;
}
async function rebuildText(L){ await ensureFont(L.font); textBitmap(L); }
function addText(text, x, y, wCm, o={}){
  const L = {id:++uid, kind:'text', text, font:o.font||'Anton', color:o.color||'#1b1b1b', x, y, w:wCm*PX, rot:o.rot||0, opacity:o.opacity??1, flipX:!!o.flipX, flipY:!!o.flipY, locked:!!o.locked, visible:true, inside:!!o.inside};
  textBitmap(L); S.layers.push(L); return L;
}
function addImage(src, name, x, y, wCm, o={}){
  const L = {id:++uid, kind:'image', name, src, aspect:src.height/src.width, x, y, w:wCm*PX, rot:o.rot||0, opacity:o.opacity??1, flipX:!!o.flipX, flipY:!!o.flipY, locked:!!o.locked, visible:true, inside:!!o.inside};
  S.layers.push(L); return L;
}
function cloneLayer(L){
  const o = {font:L.font, color:L.color, rot:L.rot, opacity:L.opacity, flipX:L.flipX, flipY:L.flipY, inside:L.inside};
  const nx = L.x + 8*PX, ny = L.y + 8*PX, wCm = L.w/PX;
  if (L.kind==='text') return addText(L.text, nx, ny, wCm, o);
  if (L.kind==='brush'){
    const c = makeBrushCanvas(); c.getContext('2d').drawImage(L.src,0,0);
    return addBrushLayer({src:c, name:(L.name||'Brush')+' copy', opacity:L.opacity, inside:L.inside});
  }
  return addImage(L.src, (L.name||'Image')+' copy', nx, ny, wCm, o);
}
const layerName = L => L.kind==='text' ? L.text.replace(/\n/g,' ') : (L.kind==='brush' ? (L.name||'Brush') : L.name);
const layerPiece = L => { if (L.kind==='brush') return 'Paint sheet'; const p = pieceAt(L.x, L.y); return p ? p.label : 'Off pattern'; };
const cur = () => S.layers.find(l=>l.id===S.sel);

// ---------- brush ----------
const BRUSH = { on:false, eraser:false, color:'#111111', sizeCm:1.2, opacity:1, hardness:0.85 };
function makeBrushCanvas(){
  const c = document.createElement('canvas'); c.width = c.height = TEX;
  const g = c.getContext('2d'); g.clearRect(0,0,TEX,TEX); return c;
}
function addBrushLayer(o={}){
  const c = o.src || makeBrushCanvas();
  const L = {id:++uid, kind:'brush', name:o.name||'Brush paint', src:c, aspect:1, x:TEX/2, y:TEX/2, w:TEX, rot:0, opacity:o.opacity??1, flipX:false, flipY:false, locked:!!o.locked, visible:true, inside:!!o.inside};
  S.layers.push(L); return L;
}
function ensureBrushLayer(inside){
  let L = [...S.layers].reverse().find(l=>l.kind==='brush' && !!l.inside===!!inside && l.visible && !l.locked);
  if (L) return L;
  if (!ensureLayerRoom()) return null;
  L = addBrushLayer({inside:!!inside});
  select(L.id); renderLayers();
  return L;
}
function brushRadiusPx(){ return Math.max(0.5, BRUSH.sizeCm * PX / 2); }
function stampBrush(L, x, y){
  if (!L || !L.src) return;
  const g = L.src.getContext('2d');
  const r = brushRadiusPx();
  const hard = Math.max(0.05, Math.min(0.98, BRUSH.hardness));
  const grad = g.createRadialGradient(x, y, Math.max(0.01, r*hard), x, y, Math.max(r, 1));
  if (BRUSH.eraser){
    g.save(); g.globalCompositeOperation = 'destination-out';
    grad.addColorStop(0, `rgba(0,0,0,${BRUSH.opacity})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(x,y,r,0,Math.PI*2); g.fill(); g.restore();
  } else {
    g.save(); g.globalCompositeOperation = 'source-over'; g.globalAlpha = BRUSH.opacity;
    // parse hex colour
    const hex = BRUSH.color.replace('#','');
    const full = hex.length===3 ? hex.split('').map(c=>c+c).join('') : hex;
    const rr = parseInt(full.slice(0,2),16), gg = parseInt(full.slice(2,4),16), bb = parseInt(full.slice(4,6),16);
    grad.addColorStop(0, `rgba(${rr},${gg},${bb},1)`);
    grad.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
    g.fillStyle = grad; g.beginPath(); g.arc(x,y,r,0,Math.PI*2); g.fill(); g.restore();
  }
  L.thumb = null;
}
function strokeBrush(L, x0,y0,x1,y1){
  const dist = Math.hypot(x1-x0,y1-y0);
  const step = Math.max(1, brushRadiusPx() * 0.35);
  if (dist < 0.01){ stampBrush(L, x1, y1); return; }
  const n = Math.max(1, Math.ceil(dist/step));
  for (let i=0;i<=n;i++){ const t=i/n; stampBrush(L, x0+(x1-x0)*t, y0+(y1-y0)*t); }
}
function setBrushMode(on){
  BRUSH.on = !!on;
  if ($('brushTool')) $('brushTool').setAttribute('aria-pressed', BRUSH.on);
  if ($('brushPanel')) $('brushPanel').hidden = !BRUSH.on;
  if (BRUSH.on){ setPlaceMode(null); pc.style.cursor = 'crosshair'; $('hint').textContent = 'Brush: paint on 2D pieces or rotate the 3D shirt and paint · E eraser · [ ] size'; }
  else { pc.style.cursor = 'grab'; $('hint').textContent = 'Add text/photo/brush on the 2D pattern (or 3D) · drag across pieces · ⌘Z undo'; }
}
function moveLayerToPiece(L, pieceId){
  const p = pieceById[pieceId]; if (!L || !p || L.kind==='brush' || L.locked) return;
  L.x = (p.box[0]+p.box[2])/2; L.y = (p.box[1]+p.box[3])/2;
  composeSheet(); renderLayers(); commit(); toast('Moved to '+p.label);
}

// ---------- undo / redo ----------
const hist = [], fut = [];
const snapshot = () => JSON.stringify({...S, layers:S.layers.map(l=>{
  const base = {...l, src:undefined, thumb:undefined, _k:l.id};
  if (l.kind==='brush' && l.src){ try { base._dataUrl = l.src.toDataURL('image/png'); } catch(_){ base._dataUrl = null; } }
  return base;
})});
const srcById = new Map();
function commit(){ S.layers.forEach(l=>srcById.set(l.id+':'+(l.kind==='text'?l.text+l.font+l.color:''), l.src));
  const s = snapshot(); if (hist.at(-1) !== s){ hist.push(s); if(hist.length>80) hist.shift(); fut.length = 0; } updUndo(); }
function restore(s){ const o = JSON.parse(s); const oldMap = new Map(S.layers.map(l=>[l.id,l]));
  Object.assign(S, o); S.layers = o.layers.map(l=>{ const prev = oldMap.get(l.id); const L = {...l}; delete L._dataUrl; delete L._k;
    if (L.kind==='text'){ if(prev && prev.text===L.text && prev.font===L.font && prev.color===L.color) { L.src=prev.src; L.aspect=prev.aspect; } else textBitmap(L); }
    else if (L.kind==='brush'){
      const c = makeBrushCanvas();
      if (l._dataUrl){
        // decode synchronously via Image only works async — keep previous pixels when possible, else blank then async refresh
        if (prev && prev.src && prev.kind==='brush' && prev._lastUrl===l._dataUrl){ c.getContext('2d').drawImage(prev.src,0,0); }
        else {
          const im = new Image();
          im.onload = ()=>{ c.getContext('2d').clearRect(0,0,TEX,TEX); c.getContext('2d').drawImage(im,0,0); L.thumb=null; composeSheet(); drawPattern(); };
          im.src = l._dataUrl;
        }
      } else if (prev && prev.src && prev.kind==='brush'){ c.getContext('2d').drawImage(prev.src,0,0); }
      L.src = c; L.aspect = 1; L._lastUrl = l._dataUrl || null;
    }
    else L.src = (prev && prev.src) || srcById.get(L.id+':'); return L; });
  syncAllUI(); composeSheet(); renderLayers(); }
function updUndo(){ $('undo').disabled = hist.length<2; $('redo').disabled = !fut.length; }
$('undo').onclick = ()=>{ if(hist.length<2) return; fut.push(hist.pop()); restore(hist.at(-1)); updUndo(); };
$('redo').onclick = ()=>{ if(!fut.length) return; const s = fut.pop(); hist.push(s); restore(s); updUndo(); };
addEventListener('keydown', e=>{ if(e.target.matches('input[type=text],textarea')) return;
  if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='z'){ e.preventDefault(); (e.shiftKey?$('redo'):$('undo')).click(); }
  if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='d' && cur() && !e.target.matches('input,select')){ e.preventDefault(); $('dupLayer').click(); }
  if((e.key==='Delete'||e.key==='Backspace') && cur() && !cur().locked && !e.target.matches('input,select')){ S.layers = S.layers.filter(l=>l!==cur()); S.sel = S.layers.at(-1)?.id ?? null; composeSheet(); renderLayers(); commit(); }
  if (cur() && !cur().locked && !e.target.matches('input,select') && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
    e.preventDefault(); const step = (e.shiftKey?5:1)*PX; const L=cur();
    if (e.key==='ArrowLeft') L.x-=step; if (e.key==='ArrowRight') L.x+=step;
    if (e.key==='ArrowUp') L.y-=step; if (e.key==='ArrowDown') L.y+=step;
    composeSheet(); syncLayerUI(); commit();
  }
});

// ---------- noise helpers ----------
function makeNoise(seed){ const p = new Uint8Array(512); let s = seed*9973+1; for(let i=0;i<256;i++) p[i]=i;
  for(let i=255;i>0;i--){ s=(s*16807)%2147483647; const j=s%(i+1); [p[i],p[j]]=[p[j],p[i]]; } for(let i=0;i<256;i++) p[i+256]=p[i];
  const g = (h,x,y)=>((h&1)?x:-x)+((h&2)?y:-y); const f = t=>t*t*t*(t*(t*6-15)+10);
  return (x,y,period)=>{ const X=Math.floor(x), Y=Math.floor(y), xf=x-X, yf=y-Y, wrap=v=>((v%period)+period)%period;
    const a=p[p[wrap(X)]+wrap(Y)], b=p[p[wrap(X+1)]+wrap(Y)], c=p[p[wrap(X)]+wrap(Y+1)], d=p[p[wrap(X+1)]+wrap(Y+1)];
    const u=f(xf), v=f(yf); const l1=g(a,xf,yf)+(g(b,xf-1,yf)-g(a,xf,yf))*u, l2=g(c,xf,yf-1)+(g(d,xf-1,yf-1)-g(c,xf,yf-1))*u; return l1+(l2-l1)*v; }; }
function heightToNormal(h, n, strength){
  const c = document.createElement('canvas'); c.width=c.height=n; const g=c.getContext('2d'); const im=g.createImageData(n,n);
  const H=(x,y)=>h[((y+n)%n)*n+((x+n)%n)];
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){ const dx=(H(x+1,y)-H(x-1,y))*strength, dy=(H(x,y+1)-H(x,y-1))*strength;
    const l=Math.hypot(dx,dy,1), i=(y*n+x)*4; im.data[i]=(-dx/l*0.5+0.5)*255; im.data[i+1]=(dy/l*0.5+0.5)*255; im.data[i+2]=(1/l*0.5+0.5)*255; im.data[i+3]=255; }
  g.putImageData(im,0,0); return c;
}
const KNITS = {
  jersey(n){ const h=new Float32Array(n*n), P=16, Q=18; for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const u=((x%P)/P)-0.5, v=(y%Q)/Q, col=Math.floor(x/P), jit=Math.sin(col*12.9898+Math.floor(y/Q)*78.233)*0.03;
    const leg=Math.abs(Math.abs(u)-0.2-0.16*(1-v)+jit); h[y*n+x]=Math.exp(-((leg/0.11)**2))*(0.55+0.45*Math.sin(Math.PI*v))+(Math.random()-0.5)*0.06; } return h; },
  fleece(n){ const h=new Float32Array(n*n), N=makeNoise(11); for(let y=0;y<n;y++)for(let x=0;x<n;x++){ h[y*n+x]=N(x/4,y/4,n/4)*0.7+N(x/1.6,y/1.6,n/1.6)*0.5+(Math.random()-0.5)*0.35; } return h; },
  pique(n){ const h=new Float32Array(n*n), P=12; for(let y=0;y<n;y++)for(let x=0;x<n;x++){ const off=(Math.floor(y/P)%2)*P/2;
    const u=(((x+off)%P)/P)-0.5, v=((y%P)/P)-0.5; h[y*n+x]=Math.max(0,1-Math.hypot(u,v*1.25)*2.6)+(Math.random()-0.5)*0.05; } return h; },
};
function ribHeight(n){ const h=new Float32Array(n*n); for(let y=0;y<n;y++)for(let x=0;x<n;x++){ h[y*n+x]=Math.pow(Math.abs(Math.sin(Math.PI*x/(n/6))),0.6)+(Math.random()-0.5)*0.06; } return h; }
function crumpleHeight(n){ // ridged fbm: the creased, slept-in look of real jersey
  const h=new Float32Array(n*n), N=makeNoise(5);
  for(const [cells,amp] of [[3,1],[6,0.55],[12,0.3],[24,0.15]]){ const k=cells/n;
    for(let y=0;y<n;y++)for(let x=0;x<n;x++){ const v=N(x*k,y*k,cells); h[y*n+x]+=amp*(1-Math.abs(v)*1.6); } }
  return h;
}

// ---------- wash masks ----------
const washCache = new Map();
function washMask(type, size, seed){
  const key = `${type}|${size}|${seed}`; if (washCache.has(key)) return washCache.get(key);
  const n = 512, c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d'); const im = g.createImageData(n,n);
  const N = makeNoise(seed), sc = 1/size;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){ let a = 0;
    const fx=x/n*sc, fy=y/n*sc;
    if (type==='acid'){ let r=0, amp=1; for(const f of [6,12,24,48]){ r += amp*(1-Math.abs(N(fx*f,fy*f,9999))); amp*=0.5; } r/=1.875; a = Math.min(1,Math.max(0,(r-0.62)/0.22)); }
    else if (type==='vintage'){ const v = N(fx*4,fy*4,9999)*0.6+N(fx*11,fy*11,9999)*0.3; a = 0.35+v*0.9; }
    else if (type==='tiedye'){ const cx=x/n-0.27, cy=y/n-0.4; const ang=Math.atan2(cy,cx), r=Math.hypot(cx,cy); const w = Math.sin(ang*3 + r*28*sc + N(fx*6,fy*6,9999)*2.5); a = Math.max(0,w)*0.95; }
    else if (type==='caustic'){ a = 0; }
    a = Math.max(0, Math.min(1, a)); const i=(y*n+x)*4; im.data[i]=im.data[i+1]=im.data[i+2]=255; im.data[i+3]=a*255; }
  g.putImageData(im,0,0);
  if (type==='caustic'){ let s=seed*7919+3; const r=()=>{s=(s*16807)%2147483647; return s/2147483647;};
    g.lineCap='round'; for(let i=0;i<900;i++){ const x=r()*n, y=r()*n, len=(6+r()*22)*size, w=(1.2+r()*3)*size; g.globalAlpha=0.35+r()*0.6;
      g.strokeStyle='#fff'; g.lineWidth=w; g.beginPath(); g.moveTo(x,y); g.lineTo(x+len*0.75,y-len*0.65); g.stroke(); }
    g.globalAlpha=1; g.filter='blur(1.5px)'; g.drawImage(c,0,0); g.filter='none'; }
  washCache.set(key, c); return c;
}

// ---------- print textures: outside + inside ----------
const tex = document.createElement('canvas'); tex.width = tex.height = TEX; const tg = tex.getContext('2d');
const texIn = document.createElement('canvas'); texIn.width = texIn.height = TEX; const tgi = texIn.getContext('2d');
let sheetTex = null, insideTex = null;
const bleachOf = hex => { const c = new THREE.Color(hex); return '#'+c.lerp(new THREE.Color(1,1,0.97), 0.78).getHexString(); };
function paintBase(g){
  g.clearRect(0,0,TEX,TEX);
  for (const p of pieces){
    if (isRib(p) && !S.ribMatch){ g.fillStyle = S.rib; g.fill(p.path); continue; }
    if (S.grad && !isRib(p)){ const gr = g.createLinearGradient(0,p.box[1],0,p.box[3]); gr.addColorStop(0,S.fabric); gr.addColorStop(1,S.grad2); g.fillStyle = gr; }
    else g.fillStyle = S.fabric;
    g.fill(p.path);
  }
  if (PATTERN.stitches===false) return;
  g.save(); g.strokeStyle='rgba(0,0,0,0.18)'; g.lineWidth=1.6; g.setLineDash([5,4]);
  for (const id of ['front','back','sleeveR','sleeveL']){ const b = pieceById[id].box; for(const d of [2,2.6]){ g.beginPath(); g.moveTo(b[0],b[3]-d*PX); g.lineTo(b[2],b[3]-d*PX); g.stroke(); } }
  g.restore();
}
function paintLayers(g, inside){
  g.save(); g.clip(allPieces);
  for (const L of S.layers){ if(!L.visible || !!L.inside!==inside) continue;
    if (!L.src) continue;
    g.save(); g.globalAlpha = L.opacity ?? 1;
    if (L.kind==='brush'){ g.drawImage(L.src, 0, 0); }
    else {
      g.translate(L.x, L.y); g.rotate(L.rot*Math.PI/180);
      const sx = L.flipX ? -1 : 1, sy = L.flipY ? -1 : 1; if (sx!==1||sy!==1) g.scale(sx, sy);
      const w=L.w, h=L.w*L.aspect; g.drawImage(L.src,-w/2,-h/2,w,h);
    }
    g.restore(); }
  g.restore();
}
function paintWash(g){
  if (S.wash==='none' || S.washStr<=0) return;
  const m = washMask(S.wash, S.washSize, S.washSeed);
  const t = document.createElement('canvas'); t.width=t.height=TEX; const tc=t.getContext('2d');
  tc.fillStyle = bleachOf(S.fabric); tc.fillRect(0,0,TEX,TEX); tc.globalCompositeOperation='destination-in'; tc.drawImage(m,0,0,TEX,TEX);
  g.save(); g.clip(allPieces); g.globalAlpha = S.washStr; g.drawImage(t,0,0); g.restore();
}
function composeSheet(){
  for (const [g, inside] of [[tg,false],[tgi,true]]){
    paintBase(g);
    if (S.washPrints){ paintLayers(g, inside); paintWash(g); } else { paintWash(g); paintLayers(g, inside); }
  }
  if (sheetTex){ sheetTex.needsUpdate = true; insideTex.needsUpdate = true; }
  drawPattern();
}

// ---------- pattern view ----------
const pc = $('patternCanvas'), pg = pc.getContext('2d');
const PV = {k:1, ox:0, oy:0, inside:false};
function fitPattern(){
  const r = pc.getBoundingClientRect(); if(!r.width) return;
  const B = SHOWN.map(dispBox); const minX=Math.min(...B.map(b=>b[0])), minY=Math.min(...B.map(b=>b[1])), maxX=Math.max(...B.map(b=>b[2])), maxY=Math.max(...B.map(b=>b[3]));
  const pad = 56, k = Math.min((r.width-pad*2)/(maxX-minX), (r.height-pad*2-40)/(maxY-minY));
  PV.k = k; PV.ox = (r.width-(maxX-minX)*k)/2 - minX*k; PV.oy = (r.height-(maxY-minY)*k)/2 - minY*k + 10;
  drawPattern();
}
function resizePattern(){ const r = pc.getBoundingClientRect(), d = devicePixelRatio||1; pc.width = Math.max(1,r.width*d); pc.height = Math.max(1,r.height*d); fitPattern(); }
const toView = (x,y) => [x*PV.k+PV.ox, y*PV.k+PV.oy];
const toSheet = (x,y) => [(x-PV.ox)/PV.k, (y-PV.oy)/PV.k];
function layerCorners(L){ const h=L.w*L.aspect, a=L.rot*Math.PI/180, c=Math.cos(a), s=Math.sin(a);
  return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>[L.x+(u*L.w/2)*c-(v*h/2)*s, L.y+(u*L.w/2)*s+(v*h/2)*c]); }
function drawPattern(){
  const d = devicePixelRatio||1, W = pc.width/d, H = pc.height/d; if (!W) return;
  pg.setTransform(d,0,0,d,0,0); pg.clearRect(0,0,W,H);
  const step = PX*PV.k;
  pg.fillStyle='rgba(217,228,210,0.07)'; if (step*5 > 8) for(let x=PV.ox%(step*5); x<W; x+=step*5) for(let y=PV.oy%(step*5); y<H; y+=step*5) pg.fillRect(x-0.75,y-0.75,1.5,1.5);
  pg.save(); pg.translate(PV.ox, PV.oy); pg.scale(PV.k, PV.k);
  const src = PV.inside ? texIn : tex;
  for (const p of SHOWN){
    pg.save(); pg.translate(p.dx, p.dy);
    pg.save(); pg.shadowColor='rgba(0,0,0,0.5)'; pg.shadowBlur=14; pg.shadowOffsetY=3/PV.k; pg.fillStyle=S.fabric; pg.fill(p.path); pg.restore();
    pg.save(); pg.clip(p.path); pg.drawImage(src,0,0); pg.restore();
    const cx=(p.box[0]+p.box[2])/2; pg.save(); pg.strokeStyle='rgba(255,255,255,0.28)'; pg.lineWidth=1/PV.k; pg.setLineDash([5/PV.k,4/PV.k]);
    pg.beginPath(); pg.moveTo(cx,p.box[1]+6); pg.lineTo(cx,p.box[3]-6); pg.stroke(); pg.restore();
    pg.restore();
  }
  pg.restore();
  // rulers
  pg.fillStyle='rgba(16,18,15,0.92)'; pg.fillRect(0,0,W,22); pg.fillRect(0,0,22,H);
  pg.fillStyle='#9aa294'; pg.strokeStyle='#4a5146'; pg.font='9.5px "JetBrains Mono", monospace'; pg.textAlign='center';
  const unit = 25*PX; for(let v=Math.ceil(-PV.ox/PV.k/unit)*unit; v*PV.k+PV.ox<W; v+=unit){ const x=v*PV.k+PV.ox; pg.fillText(String(Math.round(v/PX)), x, 12); }
  pg.beginPath(); for(let v=Math.ceil(-PV.ox/PV.k/(5*PX))*5*PX; v*PV.k+PV.ox<W; v+=5*PX){ const x=Math.round(v*PV.k+PV.ox)+.5; pg.moveTo(x,17); pg.lineTo(x,22); } pg.stroke();
  pg.save(); pg.textAlign='center'; for(let v=Math.ceil(-PV.oy/PV.k/unit)*unit; v*PV.k+PV.oy<H; v+=unit){ const y=v*PV.k+PV.oy; pg.save(); pg.translate(11,y); pg.rotate(-Math.PI/2); pg.fillText(String(Math.round(v/PX)),0,3); pg.restore(); } pg.restore();
  pg.fillText('cm', 11, 14);
  pg.textAlign='center';
  for (const p of SHOWN){ const [w,h] = sizeCm(p); const db = dispBox(p); const [cx] = toView((db[0]+db[2])/2, 0); const [,by] = toView(0, db[3]);
    pg.fillStyle='#e9ece4'; pg.font='600 12px "Familjen Grotesk", sans-serif'; pg.fillText(p.label, cx, by+17);
    pg.fillStyle='#9aa294'; pg.font='10.5px "JetBrains Mono", monospace'; pg.fillText(`${w.toFixed(0)} × ${h.toFixed(h<10?1:0)} cm`, cx, by+31); }
  const L = cur();
  const off = L && L.kind!=='brush' && offsetOf(L);
  if (L && L.kind!=='brush' && off && L.visible && !!L.inside===PV.inside){ const c = layerCorners(L).map(([x,y])=>toView(x+off[0],y+off[1]));
    pg.strokeStyle='#f2c14e'; pg.lineWidth=1.5; pg.setLineDash([]); pg.beginPath(); c.forEach(([x,y],i)=>i?pg.lineTo(x,y):pg.moveTo(x,y)); pg.closePath(); pg.stroke();
    pg.fillStyle='#f2c14e'; c.forEach(([x,y])=>pg.fillRect(x-4,y-4,8,8));
    // rotate handle above top edge midpoint
    const midTop = [(c[0][0]+c[1][0])/2, (c[0][1]+c[1][1])/2];
    const ang = Math.atan2(c[1][1]-c[0][1], c[1][0]-c[0][0]) - Math.PI/2;
    const rh = [midTop[0]+Math.cos(ang)*28, midTop[1]+Math.sin(ang)*28];
    pg.beginPath(); pg.moveTo(midTop[0], midTop[1]); pg.lineTo(rh[0], rh[1]); pg.stroke();
    pg.beginPath(); pg.arc(rh[0], rh[1], 6, 0, Math.PI*2); pg.fill();
    L._rotHandle = rh;
    pg.font='500 10.5px "JetBrains Mono", monospace'; const lab=`${(L.w/PX).toFixed(1)} × ${(L.w*L.aspect/PX).toFixed(1)} cm`;
    const tw = pg.measureText(lab).width+12; const lx=(c[2][0]+c[3][0])/2, ly=Math.max(c[2][1],c[3][1]); pg.fillStyle='#f2c14e'; pg.fillRect(lx-tw/2, ly+8, tw, 18); pg.fillStyle='#1d1a10'; pg.fillText(lab, lx, ly+21);
    if (L.locked){ pg.fillStyle='rgba(242,193,78,.85)'; pg.font='600 11px "Familjen Grotesk"'; pg.fillText('locked', lx, ly+42); }
  }
  if (PV.guides){ pg.save(); pg.strokeStyle='rgba(242,193,78,.7)'; pg.lineWidth=1; pg.setLineDash([4,3]);
    for (const g of PV.guides){ pg.beginPath(); if (g.kind==='v'){ pg.moveTo(g.x,0); pg.lineTo(g.x,H); } else { pg.moveTo(0,g.y); pg.lineTo(W,g.y); } pg.stroke(); }
    pg.restore(); }
}
function rotHandleOf(L){ return L && L._rotHandle; }

function hitLayer(x,y,inside){ for (let i=S.layers.length-1;i>=0;i--){ const L=S.layers[i]; if(!L.visible || !!L.inside!==inside) continue;
  if (L.kind==='brush') continue; // full-sheet paint — select from layer list
  const a=-L.rot*Math.PI/180, dx=x-L.x, dy=y-L.y, lx=dx*Math.cos(a)-dy*Math.sin(a), ly=dx*Math.sin(a)+dy*Math.cos(a);
  if (Math.abs(lx)<=L.w/2 && Math.abs(ly)<=L.w*L.aspect/2) return L; } return null; }

let pdrag = null;
let placeMode = null; // 'text' | 'image' | null
function setPlaceMode(mode){
  placeMode = mode;
  if (mode) setBrushMode(false);
  const on = !!mode;
  $('placeBanner').hidden = !on;
  $('placeBanner').textContent = mode==='text' ? 'Click a pattern piece to place text…' : mode==='image' ? 'Click a pattern piece to place a photo…' : '';
  $('patternPane').classList.toggle('placing', on);
  pc.style.cursor = on ? 'crosshair' : (BRUSH.on ? 'crosshair' : 'grab');
}
function snapLayer(L, sx, sy){
  PV.guides = [];
  const p = pieceAt(sx, sy); if (!p) return [sx, sy];
  const cx = (p.box[0]+p.box[2])/2, cy = (p.box[1]+p.box[3])/2;
  const thr = 4*PX; let nx=sx, ny=sy;
  if (Math.abs(sx-cx)<thr){ nx=cx; const [vx] = toView(cx+(p.dx||0), 0); PV.guides.push({kind:'v', x:vx}); }
  if (Math.abs(sy-cy)<thr){ ny=cy; const [,vy] = toView(0, cy+(p.dy||0)); PV.guides.push({kind:'h', y:vy}); }
  return [nx, ny];
}
pc.addEventListener('pointerdown', e=>{
  const r = pc.getBoundingClientRect(), vx=e.clientX-r.left, vy=e.clientY-r.top; const [dx,dy] = toSheet(vx,vy);
  if (BRUSH.on){
    const hit = fromDisplay(dx,dy);
    if (!hit){ toast('Paint on a pattern piece'); return; }
    const L = ensureBrushLayer(PV.inside); if (!L) return;
    select(L.id);
    stampBrush(L, hit.sx, hit.sy);
    pdrag = {mode:'brush', L, last:[hit.sx, hit.sy]};
    composeSheet();
    pc.setPointerCapture(e.pointerId); return;
  }
  if (placeMode){
    const hit = fromDisplay(dx,dy);
    if (!hit){ toast('Click on a pattern piece'); return; }
    const {sx,sy} = hit;
    if (placeMode==='text'){
      if(!ensureLayerRoom()) return; const L = addText('YOUR TEXT', sx, sy, 18); select(L.id); rebuildText(L).then(()=>{ composeSheet(); renderLayers(); commit(); });
      setPlaceMode(null); composeSheet(); commit(); return;
    }
    if (placeMode==='image'){
      if (pendingImage){
        const img = pendingImage.img, name = pendingImage.name; pendingImage = null; setPlaceMode(null);
        if(!ensureLayerRoom()) return; const L = addImage(img, name, sx, sy, 24); select(L.id); composeSheet(); commit(); return;
      }
      pendingPlace = {sx, sy}; setPlaceMode(null); $('file').click(); return;
    }
  }
  const sel = cur(), off = sel && sel.kind!=='brush' && offsetOf(sel);
  if (sel && sel.kind!=='brush' && !sel.locked && off && !!sel.inside===PV.inside){
    const rh = rotHandleOf(sel);
    if (rh && Math.hypot(rh[0]-vx, rh[1]-vy)<12){ pdrag={mode:'rotate', L:sel, off}; pc.setPointerCapture(e.pointerId); return; }
    const c = layerCorners(sel).map(([x,y])=>toView(x+off[0],y+off[1])); const hi = c.findIndex(([x,y])=>Math.hypot(x-vx,y-vy)<11);
    if (hi>=0){ pdrag={mode:'scale', L:sel, off, d0:Math.hypot(dx-off[0]-sel.x, dy-off[1]-sel.y), w0:sel.w}; pc.setPointerCapture(e.pointerId); return; }
  }
  const hit = fromDisplay(dx,dy); const L = hit && hitLayer(hit.sx,hit.sy,PV.inside);
  if (L){
    select(L.id); if (L.locked){ pdrag=null; return; }
    // grab offset in DISPLAY space so dragging across packed pieces remaps UV correctly
    pdrag={mode:'move', L, gdx: dx - (L.x + hit.p.dx), gdy: dy - (L.y + hit.p.dy), lastOff:[hit.p.dx, hit.p.dy]};
  }
  else pdrag={mode:'pan', x:vx, y:vy, ox:PV.ox, oy:PV.oy};
  pc.setPointerCapture(e.pointerId);
});
pc.addEventListener('pointermove', e=>{
  const r = pc.getBoundingClientRect(), vx=e.clientX-r.left, vy=e.clientY-r.top; const [dx,dy] = toSheet(vx,vy);
  if (!pdrag){
    if (placeMode || BRUSH.on){ pc.style.cursor='crosshair'; return; }
    const sel = cur(), off = sel && sel.kind!=='brush' && offsetOf(sel);
    const rh = sel && !sel.locked && off && rotHandleOf(sel);
    if (rh && Math.hypot(rh[0]-vx, rh[1]-vy)<12){ pc.style.cursor='grab'; return; }
    const hit = fromDisplay(dx,dy); pc.style.cursor = hit && hitLayer(hit.sx,hit.sy,PV.inside)?'move':'grab'; return;
  }
  if (pdrag.mode==='brush'){
    const hit = fromDisplay(dx,dy);
    if (hit){ strokeBrush(pdrag.L, pdrag.last[0], pdrag.last[1], hit.sx, hit.sy); pdrag.last=[hit.sx,hit.sy]; composeSheet(); }
    return;
  }
  if (pdrag.mode==='move'){
    const hit = fromDisplay(dx,dy);
    const off = hit ? [hit.p.dx, hit.p.dy] : (pdrag.lastOff || [0,0]);
    if (hit) pdrag.lastOff = off;
    let nx = (dx - pdrag.gdx) - off[0];
    let ny = (dy - pdrag.gdy) - off[1];
    [nx,ny] = snapLayer(pdrag.L, nx, ny);
    pdrag.L.x = nx; pdrag.L.y = ny; composeSheet(); syncLayerUI();
  }
  else if (pdrag.mode==='scale'){ const d = Math.hypot(dx-pdrag.off[0]-pdrag.L.x, dy-pdrag.off[1]-pdrag.L.y); pdrag.L.w = Math.max(1.5*PX, pdrag.w0*d/pdrag.d0); composeSheet(); syncLayerUI(); }
  else if (pdrag.mode==='rotate'){ const ang = Math.atan2(dy-pdrag.off[1]-pdrag.L.y, dx-pdrag.off[0]-pdrag.L.x)*180/Math.PI + 90;
    pdrag.L.rot = ((Math.round(ang/5)*5)%360+540)%360-180; composeSheet(); syncLayerUI(); }
  else { PV.ox = pdrag.ox + vx-pdrag.x; PV.oy = pdrag.oy + vy-pdrag.y; drawPattern(); }
});
pc.addEventListener('pointerup', ()=>{ PV.guides=null; if(pdrag && pdrag.mode!=='pan'){ renderLayers(); commit(); } pdrag=null; drawPattern(); });
let pendingPlace = null;
let pendingImage = null;
$('placeText').onclick = ()=>{ pendingImage=null; setPlaceMode(placeMode==='text' ? null : 'text'); };
$('placeImage').onclick = ()=>{
  if (placeMode==='image'){ pendingImage=null; setPlaceMode(null); return; }
  const input = $('file');
  const once = e=>{
    const file = e.target.files?.[0]; input.removeEventListener('change', once);
    if(!file || !file.type.startsWith('image/')) return;
    const img = new Image();
    img.onload = ()=>{ pendingImage = {img, name:(file.name||'Photo').replace(/\.[^.]+$/,'')}; setPlaceMode('image');
      $('placeBanner').textContent = 'Click a pattern piece to place the photo…'; };
    img.src = URL.createObjectURL(file);
  };
  skipFileAuto = true; input.addEventListener('change', once);
  pendingPlace = null; input.click();
};
addEventListener('keydown', e=>{ if(e.key==='Escape' && placeMode){ pendingImage=null; setPlaceMode(null); } });
pc.addEventListener('wheel', e=>{ e.preventDefault(); const r=pc.getBoundingClientRect(), vx=e.clientX-r.left, vy=e.clientY-r.top;
  const f = Math.exp(-e.deltaY*0.0015); const [sx,sy]=toSheet(vx,vy); PV.k*=f; PV.ox = vx - sx*PV.k; PV.oy = vy - sy*PV.k; drawPattern(); }, {passive:false});
$('fitPattern').onclick = fitPattern;
for (const [id,v] of [['pOut',false],['pIn',true]]) $(id).onclick = ()=>{ PV.inside = v; $('pOut').setAttribute('aria-pressed', !v); $('pIn').setAttribute('aria-pressed', v); drawPattern(); };

// ---------- three.js stage ----------
const glc = $('gl'), pane = $('glPane');
const renderer = new THREE.WebGLRenderer({canvas:glc, antialias:true, alpha:true, preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.VSMShadowMap;
const ANISO = renderer.capabilities.getMaxAnisotropy();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 50);
const controls = new OrbitControls(camera, glc); controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minDistance = 0.5; controls.maxDistance = 5; controls.enablePan = false; controls.autoRotateSpeed = 1.6;
const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = envTex; scene.environmentIntensity = 0.6; scene.environmentRotation.y = 38*Math.PI/180;

const rig = new THREE.Group(); scene.add(rig);
const BD = {b:0.82};
const backdropMat = new THREE.MeshStandardMaterial({color:S.bg, roughness:1, metalness:0, envMapIntensity:0.25});
const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(9,7), backdropMat); backdrop.position.set(0,0,-0.9); backdrop.receiveShadow = true; rig.add(backdrop);
scene.background = new THREE.Color(S.bg);

// gobo (projected light pattern) — white lets light through
const GOBO = {type:'leaf', invert:false, contrast:0.75};
function goboCanvas(){
  const n=512, c=document.createElement('canvas'); c.width=c.height=n; const g=c.getContext('2d');
  g.fillStyle='#fff'; g.fillRect(0,0,n,n); g.fillStyle='#000';
  let seed=7; const r=()=>{seed=(seed*16807)%2147483647; return seed/2147483647;};
  if (GOBO.type==='leaf'){ g.filter='blur(6px)'; for(let k=0;k<26;k++){ const cx=r()*n, cy=r()*n, a0=r()*6.28;
      for(let i=0;i<9;i++){ const a=a0+(r()-0.5)*2.4, d=r()*70; g.save(); g.translate(cx+Math.cos(a)*d, cy+Math.sin(a)*d); g.rotate(a+r()); g.beginPath(); g.ellipse(0,0,10+r()*16,4+r()*6,0,0,6.283); g.fill(); g.restore(); } } }
  else if (GOBO.type==='palm'){ g.filter='blur(5px)'; for(let k=0;k<5;k++){ const x0=r()*n, y0=r()*n, a0=r()*6.28; g.lineWidth=4; g.strokeStyle='#000';
      for(let t=0;t<1;t+=0.045){ const x=x0+Math.cos(a0)*t*300, y=y0+Math.sin(a0)*t*300; for(const sgn of [-1,1]){ const a=a0+sgn*(1.0-0.3*t);
        g.save(); g.translate(x,y); g.rotate(a); g.beginPath(); g.ellipse(48,0,48*(1-t*0.5),5,0,0,6.283); g.fill(); g.restore(); } } } }
  else if (GOBO.type==='blinds'){ g.filter='blur(5px)'; g.save(); g.translate(n/2,n/2); g.rotate(-0.35); for(let y=-n;y<n;y+=34){ g.fillRect(-n,y,2*n,16); } g.restore(); }
  else if (GOBO.type==='window'){ g.filter='blur(8px)'; g.fillRect(0,0,n,n); g.fillStyle='#fff'; g.save(); g.translate(n/2,n/2); g.transform(1,0.12,-0.25,1,0,0);
      for(let i=0;i<2;i++)for(let j=0;j<3;j++) g.fillRect(-150+i*155,-190+j*128,140,116); g.restore(); }
  g.filter='none';
  if (GOBO.invert){ g.globalCompositeOperation='difference'; g.fillStyle='#fff'; g.fillRect(0,0,n,n); g.globalCompositeOperation='source-over'; }
  g.fillStyle=`rgba(255,255,255,${1-GOBO.contrast})`; g.fillRect(0,0,n,n);
  const v=g.createRadialGradient(n/2,n/2,n*0.18,n/2,n/2,n*0.5); v.addColorStop(0,'rgba(0,0,0,0)'); v.addColorStop(1,'rgba(0,0,0,1)'); g.fillStyle=v; g.fillRect(0,0,n,n);
  return c;
}
const goboTex = new THREE.CanvasTexture(goboCanvas()); goboTex.colorSpace = THREE.SRGBColorSpace;
function refreshGobo(){ goboTex.image = goboCanvas(); goboTex.needsUpdate = true; }

const KEY = {i:1, angle:-28};
const key = new THREE.SpotLight(0xfff3e0, 40, 0, 0.62, 0.9, 1.6);
key.castShadow = true; key.map = goboTex;
key.shadow.mapSize.set(1024,1024); key.shadow.bias = -0.0006; key.shadow.normalBias = 0.0; key.shadow.radius = 14; key.shadow.blurSamples = 20; key.shadow.camera.near = 0.6; key.shadow.camera.far = 7;
rig.add(key); scene.add(key.target);
function placeKey(){ const a = KEY.angle*Math.PI/180; key.position.set(Math.sin(a)*2.5, 1.45, Math.cos(a)*2.5); key.intensity = 40*KEY.i; }
placeKey();
const fill = new THREE.DirectionalLight(0xe4ecff, 0.45); fill.position.set(1.8, 0.3, 1.4); rig.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 1.2); rim.position.set(0.5, 1.4, -1.8); rig.add(rim);

// fabric maps
const mkTex = (canvas, rep) => { const t = new THREE.CanvasTexture(canvas); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep,rep); t.anisotropy = ANISO; t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = true; return t; };
const knitCache = {}; const knitTex = name => knitCache[name] ||= mkTex(heightToNormal(KNITS[name](256),256,1.5), 52);
const ribN = mkTex(heightToNormal(ribHeight(128),128,1.3), 110);
const crumpleN = mkTex(heightToNormal(crumpleHeight(512),512,9), 3.2);
sheetTex = new THREE.CanvasTexture(tex); insideTex = new THREE.CanvasTexture(texIn);
for (const t of [sheetTex, insideTex]){ t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = ANISO; }

const U = { uCrumple:{value:crumpleN}, uCrumpleMat:{value:crumpleN.matrix}, uWrinkle:{value:1.6}, uBright:{value:1}, uContrast:{value:1}, insideMap:{value:insideTex} };
crumpleN.updateMatrix();
function makeFabric(normal){
  const m = new THREE.MeshPhysicalMaterial({ map:sheetTex, normalMap:normal, normalScale:new THREE.Vector2(0.5,0.5), roughness:0.88, metalness:0,
    sheen:1, sheenRoughness:0.62, sheenColor:new THREE.Color(0.5,0.5,0.5), side:THREE.DoubleSide, envMapIntensity:0.85 });
  m.onBeforeCompile = sh => { Object.assign(sh.uniforms, U);
    sh.vertexShader = 'varying float vInside;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec3 wN = normalize(mat3(modelMatrix) * objectNormal); vec3 wP = (modelMatrix * vec4(transformed,1.)).xyz;
      vInside = dot(wN.xz, wP.xz) < 0. ? 1. : 0.;`);
    sh.fragmentShader = 'varying float vInside; uniform sampler2D insideMap; uniform sampler2D uCrumple; uniform mat3 uCrumpleMat; uniform float uWrinkle, uBright, uContrast;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', `#ifdef USE_MAP
        bool inSide = (vInside > 0.5) != !gl_FrontFacing;
        vec4 sampledDiffuseColor = inSide ? texture2D(insideMap, vMapUv) : texture2D(map, vMapUv);
        diffuseColor *= sampledDiffuseColor;
      #endif
      diffuseColor.rgb = clamp((diffuseColor.rgb - 0.18) * uContrast + 0.18, 0., 1.) * uBright;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        #ifdef USE_NORMALMAP_TANGENTSPACE
        vec3 cN = texture2D(uCrumple, (uCrumpleMat * vec3(vNormalMapUv, 1.)).xy).xyz * 2. - 1.;
        normal = normalize(normal + tbn * vec3(cN.xy * 0.5 * uWrinkle, 0.));
        #endif`);
  };
  m.customProgramCacheKey = () => 'fabric-v3';
  return m;
}
const fabricMat = makeFabric(knitTex('jersey'));
const ribMat = makeFabric(ribN); ribMat.normalScale.set(1,1);
const hangerMat = new THREE.MeshPhysicalMaterial({color:0xf2f2ef, roughness:0.35, clearcoat:0.5, clearcoatRoughness:0.3});
const hookMat = new THREE.MeshStandardMaterial({color:0xc9ccd1, metalness:1, roughness:0.22});

const APP = {material:'cotton', texture:1.2, knit:3, wrinklesOn:true};
function applyMaterial(){ const M = MATERIALS[APP.material];
  fabricMat.normalMap = knitTex(M.knit); fabricMat.roughness = M.rough; fabricMat.sheen = M.sheen; fabricMat.sheenRoughness = M.sheenRough;
  ribMat.roughness = M.rough; ribMat.sheen = M.sheen; ribMat.sheenRoughness = M.sheenRough;
  const ns = 0.42*APP.texture*M.knitScale; fabricMat.normalScale.set(ns,ns); ribMat.normalScale.set(0.6+ns,0.6+ns);
  Object.values(knitCache).forEach(t=>t.repeat.set(156/APP.knit,156/APP.knit));
  U.uWrinkle.value = APP.wrinklesOn ? +$('wrinkles').value*M.softMul : 0;
  fabricMat.needsUpdate = true; }

function fixSleeveUV(geo){ const uv = geo.attributes.uv, b = pieceById.sleeveR.box, cx = (b[0]+b[2])/2/TEX;
  const x0=b[0]/TEX-0.004, x1=b[2]/TEX+0.004, y0=b[1]/TEX-0.004, y1=b[3]/TEX+0.004;
  for (let i=0;i<uv.count;i++){ const u=uv.getX(i), v=uv.getY(i); if(u>x0&&u<x1&&v>y0&&v<y1) uv.setX(i, 2*cx-u); } uv.needsUpdate = true; }
let shirtMeshes = [], hangerMeshes = [], hookMeshes = [];
let FIT = {dist:2.2, cy:0, h:0.8, w:0.8};
function fitDist(){ const t = Math.tan(THREE.MathUtils.degToRad(camera.fov/2)); FIT.dist = Math.max(FIT.h*1.12/2/t, FIT.w*1.18/2/t/Math.max(camera.aspect,0.4)); return FIT.dist; }
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const onGarment = gltf => {
  gltf.scene.traverse(o => { if(!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    const n = (o.material && o.material.name)||'';
    const isShirt = !!o.geometry.attributes.uv;
    if (isShirt && PATTERN.mirrorSleeve!==false) fixSleeveUV(o.geometry);
    if (isShirt && (/rib/i.test(n) || /_1$/.test(o.name))) { o.material = ribMat; shirtMeshes.push(o); }
    else if (isShirt) { o.material = fabricMat; shirtMeshes.push(o); }
    else if (/hook/i.test(o.name) || /hook/i.test(o.parent?.name||'')) { o.material = hookMat; hookMeshes.push(o); }
    else { o.material = hangerMat; hangerMeshes.push(o); }
  });
  if (!USER) [...hangerMeshes, ...hookMeshes].forEach(m=>{ m.position.y -= 0.009 / (m.parent?.getWorldScale(new THREE.Vector3()).y || 1); });
  scene.add(gltf.scene); scene.updateMatrixWorld(true);
  const box = new THREE.Box3(); shirtMeshes.forEach(m=>box.expandByObject(m));
  const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
  gltf.scene.position.set(-c.x, -c.y, -c.z); scene.updateMatrixWorld(true);
  const full = new THREE.Box3().setFromObject(gltf.scene); const h = full.max.y - full.min.y;
  FIT.cy = (full.max.y + full.min.y)/2 - 0.01;
  FIT.h = Math.max(h, sz.y*1.32)*1.12; FIT.w = sz.x;
  key.target.position.set(0,FIT.cy,0);
  window.__dbg = {fabricMat, ribMat, shirtMeshes, scene, camera, renderer, THREE, controls};
  $('spec').innerHTML = `Garment <b>${(sz.x*100).toFixed(0)} × ${(sz.y*100).toFixed(0)} cm</b> as draped<br>Mesh <b>${(shirtMeshes.reduce((a,m)=>a+m.geometry.index.count/3,0)/1000).toFixed(0)}k triangles</b>, ${USER?'your CLO garment':'cloth-simulated'}, ${mainPieces().length} pattern pieces<br>Print sheet <b>${SHEET_CM} × ${SHEET_CM} cm · ${TEX}px</b> (${PX} px/cm)`;
  resizeGL(); setCam('front', true); $('loading').hidden = true;
};
const onGarmentErr = err => { $('loading').textContent = 'Could not load the garment file (assets/shirt.glb). Open this folder through a local web server — see README.'; console.error(err); };
if (window.__GLB_B64){ const bin = Uint8Array.from(atob(window.__GLB_B64), c=>c.charCodeAt(0)); loader.parse(bin.buffer, '', onGarment, onGarmentErr); }
else loader.load('assets/shirt.glb', onGarment, undefined, onGarmentErr);

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1,1,{samples:4, type:THREE.HalfFloatType}));
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, 1, 1);
gtao.updateGtaoMaterial({radius:0.07, distanceExponent:1.5, thickness:0.6, scale:1.1, samples:16});
gtao.updatePdMaterial({lumaPhi:10, depthPhi:2, normalPhi:3, radius:6, rings:2, samples:16});
gtao.blendIntensity = 1.0;
composer.addPass(gtao); composer.addPass(new OutputPass());

function resizeGL(){ const r = pane.getBoundingClientRect(); if(!r.width||!r.height) return;
  renderer.setSize(r.width, r.height, false); composer.setSize(r.width, r.height); camera.aspect = r.width/r.height; camera.updateProjectionMatrix(); if (!userMoved && FIT.h && !camAnim && !turntable) setCam('front', true); }
const CAMS = { front:[0,0.04,1], back:[0,0.04,-1], side:[0.72,0.08,0.7] };
let camAnim = null, userMoved = false;
controls.addEventListener('start', ()=>{ userMoved = true; $('hint').hidden = true; });
function setCam(name, instant){ fitDist(); const to = new THREE.Vector3(...CAMS[name]).normalize().multiplyScalar(FIT.dist).add(new THREE.Vector3(0,FIT.cy,0));
  controls.target.set(0,FIT.cy,0);
  if (instant){ camera.position.copy(to); controls.update(); return; }
  camAnim = {from:camera.position.clone(), to, t:0};
  document.querySelectorAll('[data-cam]').forEach(b=>b.setAttribute('aria-pressed', b.dataset.cam===name)); }
document.querySelectorAll('[data-cam]').forEach(b=>b.onclick=()=>setCam(b.dataset.cam));
$('resetView').onclick = ()=>{ userMoved = false; setCam('front'); };
$('autoRot').onclick = ()=>{ controls.autoRotate = !controls.autoRotate; $('autoRot').setAttribute('aria-pressed', controls.autoRotate); };

// drag / paint directly on the 3D shirt (raycast → UV → sheet)
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function hitUV(e){ const r = glc.getBoundingClientRect(); ndc.set(((e.clientX-r.left)/r.width)*2-1, -((e.clientY-r.top)/r.height)*2+1);
  ray.setFromCamera(ndc, camera); const h = ray.intersectObjects(shirtMeshes, false)[0]; return h && h.uv ? [h.uv.x*TEX, h.uv.y*TEX] : null; }
let gdrag = null;
glc.addEventListener('pointerdown', e=>{
  const uv = hitUV(e); if(!uv) return;
  if (BRUSH.on){
    const L = ensureBrushLayer(false); if (!L) return;
    select(L.id); stampBrush(L, uv[0], uv[1]);
    gdrag = {mode:'brush', L, last:uv.slice()}; controls.enabled = false; glc.setPointerCapture(e.pointerId); composeSheet(); return;
  }
  const L = hitLayer(...uv, false); if(!L) return;
  select(L.id); if(L.locked) return;
  gdrag = {mode:'move', L, dx:uv[0]-L.x, dy:uv[1]-L.y}; controls.enabled = false; glc.setPointerCapture(e.pointerId);
}, true);
glc.addEventListener('pointermove', e=>{
  if(!gdrag){ const uv=hitUV(e); glc.style.cursor = BRUSH.on ? (uv?'crosshair':'grab') : (uv && hitLayer(...uv,false) ? 'move' : 'grab'); return; }
  const uv = hitUV(e); if(!uv) return;
  if (gdrag.mode==='brush'){ strokeBrush(gdrag.L, gdrag.last[0], gdrag.last[1], uv[0], uv[1]); gdrag.last=uv.slice(); composeSheet(); return; }
  // allow moving across pieces (front ↔ back ↔ sleeves) via UV
  gdrag.L.x = uv[0]-gdrag.dx; gdrag.L.y = uv[1]-gdrag.dy; composeSheet();
});
glc.addEventListener('pointerup', ()=>{ if(gdrag){ const was=gdrag; gdrag=null; controls.enabled = true; renderLayers(); commit(); } });
glc.addEventListener('dblclick', e=>{ const uv = hitUV(e); const L = cur(); if(uv && L && L.kind!=='brush' && !L.inside){ L.x=uv[0]; L.y=uv[1]; composeSheet(); renderLayers(); commit(); } });

let useAO = true, turntable = null, recMirror = null;
function render(){ if (useAO) composer.render(); else renderer.render(scene, camera); }
function loop(){ requestAnimationFrame(loop);
  if (camAnim){ camAnim.t = Math.min(1, camAnim.t+0.045); const k = 1-Math.pow(1-camAnim.t,3);
    const tgt = controls.target, a = camAnim.from.clone().sub(tgt), b = camAnim.to.clone().sub(tgt); const ra = a.length(), rb = b.length();
    const dir = a.normalize().lerp(b.normalize(), k); if (dir.lengthSq()<1e-6) dir.set(1,0,0); dir.normalize();
    camera.position.copy(dir.multiplyScalar(ra+(rb-ra)*k).add(tgt)); if(camAnim.t>=1) camAnim=null; }
  if (turntable){ const t = Math.min(1,(performance.now()-turntable.t0)/turntable.ms); const a = t*Math.PI*2;
    camera.position.set(Math.sin(a)*FIT.dist, FIT.cy+0.04*FIT.dist, Math.cos(a)*FIT.dist); camera.lookAt(0,FIT.cy,0); if(t>=1){ const d=turntable.done; turntable=null; d(); } }
  else controls.update();
  rig.rotation.y = Math.atan2(camera.position.x, camera.position.z);
  render();
  if (recMirror && recMirror.paint){ try { recMirror.paint(); } catch(_){} }
}

// ---------- UI ----------
function select(id){ S.sel = id; const L = cur(); if (L && !!L.inside!==PV.inside) $(L.inside?'pIn':'pOut').click(); renderLayers(); drawPattern(); }
const thumbOf = L => {
  if (L.thumb) return L.thumb;
  if (L.kind==='brush' && L.src){
    const t=document.createElement('canvas'); t.width=t.height=64; const g=t.getContext('2d');
    g.fillStyle='#e8e6e0'; g.fillRect(0,0,64,64); g.drawImage(L.src,0,0,TEX,TEX,0,0,64,64);
    L.thumb = t.toDataURL(); return L.thumb;
  }
  return L.thumb = (L.src && L.src.toDataURL ? L.src.toDataURL() : (L.src && L.src.src) || '');
};
function renderLayers(){
  const box = $('layers'); box.innerHTML = '';
  if (!S.layers.length){ box.innerHTML = '<p class="sub" style="margin:0">Nothing here yet. Add an image or text above.</p>'; }
  [...S.layers].reverse().forEach(L=>{
    const row = document.createElement('div'); row.className='layer'; row.setAttribute('aria-selected', L.id===S.sel); row.tabIndex = 0;
    const eye = document.createElement('button'); eye.className='icon'; eye.title = L.visible?'Hide':'Show'; eye.setAttribute('aria-label', eye.title);
    eye.innerHTML = L.visible ? '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M1 8s2.6-5 7-5 7 5 7 5-2.6 5-7 5-7-5-7-5Z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2.2" fill="currentColor"/></svg>' : '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 2l12 12M1 8s2.6-5 7-5c1.3 0 2.5.4 3.4 1M15 8s-2.6 5-7 5c-1.3 0-2.5-.4-3.4-1" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
    eye.onclick = ev=>{ ev.stopPropagation(); L.visible=!L.visible; composeSheet(); renderLayers(); commit(); };
    const th = document.createElement('div'); th.className='thumb'; th.style.backgroundImage = `url(${thumbOf(L)})`;
    const nm = document.createElement('div'); nm.className='nm'; nm.textContent = layerName(L); const sm = document.createElement('small'); sm.textContent = `${L.kind}${L.inside?' · inside':''}${L.locked?' · locked':''} · ${layerPiece(L)}`; nm.appendChild(sm);
    const del = document.createElement('button'); del.className='icon'; del.title='Delete layer'; del.setAttribute('aria-label','Delete layer');
    del.innerHTML = '<svg width="15" height="15" viewBox="0 0 16 16"><path d="M3 4h10M6.5 4V2.5h3V4M4.5 4l.7 9.5h5.6l.7-9.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
    del.onclick = ev=>{ ev.stopPropagation(); if(L.locked){ toast('Unlock the layer first'); return; } S.layers = S.layers.filter(l=>l!==L); if(S.sel===L.id) S.sel = S.layers.at(-1)?.id ?? null; composeSheet(); renderLayers(); commit(); };
    row.append(eye, th, nm, del); row.onclick = ()=>select(L.id); row.onkeydown = ev=>{ if(ev.key==='Enter') select(L.id); };
    box.appendChild(row);
  });
  $('layerCount').textContent = S.layers.length ? `${S.layers.length}` : '';
  syncLayerUI();
}
function syncLayerUI(){
  const L = cur(); $('layerEdit').hidden = !L; $('layerTools').hidden = !L; if(!L) return;
  $('textEdit').hidden = L.kind!=='text'; $('imgEdit').hidden = L.kind!=='image';
  const isBrush = L.kind==='brush';
  if ($('lw')) $('lw').parentElement.hidden = isBrush;
  if ($('lr')) $('lr').parentElement.hidden = isBrush;
  if ($('movePieceRow')) $('movePieceRow').hidden = isBrush;
  if (L.kind==='text'){ if (document.activeElement!==$('textVal')) $('textVal').value = L.text.replace(/\n/g,' / '); $('textFont').value = L.font; $('textFont').style.fontFamily = `"${L.font}", sans-serif`; $('textColor').value = L.color; }
  if (!isBrush){
    $('lw').value = (L.w/PX).toFixed(1); $('lwo').textContent = `${(L.w/PX).toFixed(1)} cm`;
    $('lr').value = L.rot; $('lro').textContent = `${Math.round(L.rot)}°`;
  }
  $('lop').value = Math.round((L.opacity??1)*100); $('lopO').textContent = `${Math.round((L.opacity??1)*100)}%`;
  $('lInside').checked = !!L.inside;
  $('lockLayer').textContent = L.locked ? 'Unlock' : 'Lock';
  if ($('movePiece') && !isBrush){
    const p = pieceAt(L.x,L.y);
    const sel = $('movePiece');
    if (!sel.options.length){
      for (const p of SHOWN){ const o=document.createElement('option'); o.value=p.id; o.textContent=p.label; sel.appendChild(o); }
    }
    if (p) sel.value = p.id;
  }
}
$('textVal').oninput = e=>{ const L=cur(); if(!L||L.locked) return; L.text = e.target.value.replace(/\s*\/\s*/g,'\n') || ' '; textBitmap(L); composeSheet(); renderLayers(); };
$('textVal').onchange = commit;
$('textFont').onchange = async e=>{ const L=cur(); if(!L||L.locked) return; const font=e.target.value; if(!AuthService.canUseFont(font)){ toast('That font is Pro'); e.target.value=L.font; openPricing(); return; } L.font = font; $('textFont').style.fontFamily = `"${L.font}", sans-serif`; await ensureFont(L.font); textBitmap(L); composeSheet(); renderLayers(); commit(); };
$('textColor').oninput = e=>{ const L=cur(); if(!L||L.locked) return; L.color = e.target.value; textBitmap(L); composeSheet(); }; $('textColor').onchange = ()=>{ renderLayers(); commit(); };
$('lw').oninput = e=>{ const L=cur(); if(!L||L.locked) return; L.w = +e.target.value*PX; composeSheet(); syncLayerUI(); }; $('lw').onchange = commit;
$('lr').oninput = e=>{ const L=cur(); if(!L||L.locked) return; L.rot = +e.target.value; composeSheet(); syncLayerUI(); }; $('lr').onchange = commit;
$('lop').oninput = e=>{ const L=cur(); if(!L||L.locked) return; L.opacity = +e.target.value/100; composeSheet(); syncLayerUI(); }; $('lop').onchange = commit;
$('lInside').onchange = e=>{ const L=cur(); if(!L||L.locked) return; L.inside = e.target.checked; select(L.id); composeSheet(); renderLayers(); commit(); };
$('flipH').onclick = ()=>{ const L=cur(); if(!L||L.locked) return; L.flipX = !L.flipX; composeSheet(); renderLayers(); commit(); };
$('flipV').onclick = ()=>{ const L=cur(); if(!L||L.locked) return; L.flipY = !L.flipY; composeSheet(); renderLayers(); commit(); };
$('dupLayer').onclick = ()=>{ const L=cur(); if(!L) return; if(!ensureLayerRoom()) return; const N = cloneLayer(L); select(N.id); if(N.kind==='text') rebuildText(N).then(()=>{composeSheet();renderLayers();commit();}); composeSheet(); renderLayers(); commit(); };
$('lockLayer').onclick = ()=>{ const L=cur(); if(!L) return; L.locked = !L.locked; renderLayers(); drawPattern(); commit(); };
$('layerUp').onclick = ()=>{ const L=cur(); if(!L) return; const i=S.layers.indexOf(L); if(i<S.layers.length-1){ S.layers.splice(i,1); S.layers.splice(i+1,0,L); composeSheet(); renderLayers(); commit(); } };
$('layerDown').onclick = ()=>{ const L=cur(); if(!L) return; const i=S.layers.indexOf(L); if(i>0){ S.layers.splice(i,1); S.layers.splice(i-1,0,L); composeSheet(); renderLayers(); commit(); } };
$('addText').onclick = ()=>{ if(!ensureLayerRoom()) return; setBrushMode(false); const f = pieceById.front.box; const L = addText('YOUR TEXT', (f[0]+f[2])/2, f[1]+24*PX, 20); select(L.id);
  rebuildText(L).then(()=>{ composeSheet(); renderLayers(); commit(); }); composeSheet(); commit(); };
$('addImage').onclick = ()=>{ if(!ensureLayerRoom()) return; setBrushMode(false); pendingPlace = null; $('file').click(); };
if ($('brushTool')) $('brushTool').onclick = ()=> setBrushMode(!BRUSH.on);
if ($('brushColor')){ $('brushColor').value = BRUSH.color; $('brushColor').oninput = e=>{ BRUSH.color = e.target.value; }; }
if ($('brushSize')){ $('brushSize').value = BRUSH.sizeCm; $('brushSizeO').textContent = BRUSH.sizeCm.toFixed(1)+' cm';
  $('brushSize').oninput = e=>{ BRUSH.sizeCm = +e.target.value; $('brushSizeO').textContent = BRUSH.sizeCm.toFixed(1)+' cm'; }; }
if ($('brushOp')){ $('brushOp').value = Math.round(BRUSH.opacity*100); $('brushOpO').textContent = Math.round(BRUSH.opacity*100)+'%';
  $('brushOp').oninput = e=>{ BRUSH.opacity = +e.target.value/100; $('brushOpO').textContent = Math.round(BRUSH.opacity*100)+'%'; }; }
if ($('brushHard')){ $('brushHard').value = Math.round(BRUSH.hardness*100); $('brushHardO').textContent = Math.round(BRUSH.hardness*100)+'%';
  $('brushHard').oninput = e=>{ BRUSH.hardness = +e.target.value/100; $('brushHardO').textContent = Math.round(BRUSH.hardness*100)+'%'; }; }
if ($('brushEraser')) $('brushEraser').onclick = ()=>{ BRUSH.eraser = !BRUSH.eraser; $('brushEraser').setAttribute('aria-pressed', BRUSH.eraser); };
if ($('brushClear')) $('brushClear').onclick = ()=>{
  const L = cur() && cur().kind==='brush' ? cur() : [...S.layers].reverse().find(l=>l.kind==='brush' && !!l.inside===PV.inside);
  if (!L){ toast('No brush layer to clear'); return; }
  L.src.getContext('2d').clearRect(0,0,TEX,TEX); L.thumb=null; composeSheet(); renderLayers(); commit();
};
if ($('movePiece')) $('movePiece').onchange = e=>{ const L=cur(); if(L) moveLayerToPiece(L, e.target.value); };
if ($('moveFront')) $('moveFront').onclick = ()=>{ const L=cur(); if(L) moveLayerToPiece(L, 'front'); };
if ($('moveBack')) $('moveBack').onclick = ()=>{ const L=cur(); if(L) moveLayerToPiece(L, 'back'); };
addEventListener('keydown', e=>{
  if (e.target.matches('input,textarea,select')) return;
  if (e.key==='b' || e.key==='B'){ setBrushMode(!BRUSH.on); }
  if (e.key==='e' || e.key==='E'){ if (BRUSH.on){ BRUSH.eraser=!BRUSH.eraser; if($('brushEraser')) $('brushEraser').setAttribute('aria-pressed', BRUSH.eraser); } }
  if (e.key==='[' && BRUSH.on){ BRUSH.sizeCm = Math.max(0.2, +(BRUSH.sizeCm-0.2).toFixed(1)); if($('brushSize')){ $('brushSize').value=BRUSH.sizeCm; $('brushSizeO').textContent=BRUSH.sizeCm.toFixed(1)+' cm'; } }
  if (e.key===']' && BRUSH.on){ BRUSH.sizeCm = Math.min(8, +(BRUSH.sizeCm+0.2).toFixed(1)); if($('brushSize')){ $('brushSize').value=BRUSH.sizeCm; $('brushSizeO').textContent=BRUSH.sizeCm.toFixed(1)+' cm'; } }
  if (e.key==='Escape' && BRUSH.on) setBrushMode(false);
});
function placeImageFile(file, at=null){ if(!file || !file.type.startsWith('image/')) return; const img = new Image();
  img.onload = ()=>{ const f = pieceById.front.box;
    const x = at?.x ?? pendingPlace?.sx ?? (f[0]+f[2])/2;
    const y = at?.y ?? pendingPlace?.sy ?? (f[1]+28*PX);
    pendingPlace = null;
    if(!ensureLayerRoom()) return; const L = addImage(img, (file.name||'Pasted image').replace(/\.[^.]+$/,''), x, y, 24); select(L.id); composeSheet(); commit(); };
  img.src = URL.createObjectURL(file); }
let skipFileAuto = false;
$('file').onchange = e=>{ const f=e.target.files[0]; if (skipFileAuto){ skipFileAuto=false; e.target.value=''; return; } placeImageFile(f); e.target.value=''; };
addEventListener('paste', e=>{ const f = [...(e.clipboardData?.files||[])].find(f=>f.type.startsWith('image/')); if (f){ e.preventDefault(); placeImageFile(f); } });
['dragover','drop'].forEach(t=>{
  pane.parentElement.addEventListener(t, e=>{ e.preventDefault(); if(t==='drop') placeImageFile(e.dataTransfer.files[0]); });
  $('patternPane').addEventListener(t, e=>{ e.preventDefault(); if(t==='drop'){
    const r = pc.getBoundingClientRect(), [dx,dy]=toSheet(e.clientX-r.left, e.clientY-r.top);
    const hit = fromDisplay(dx,dy);
    placeImageFile(e.dataTransfer.files[0], hit ? {x:hit.sx, y:hit.sy} : null);
  }});
});

function swatches(el, list, getter, setter){ const draw = ()=>{ el.innerHTML='';
  list.forEach(([name,hex])=>{ const b=document.createElement('button'); b.className='sw'; b.style.background=hex; b.title=name; b.setAttribute('aria-label',name);
    b.setAttribute('aria-pressed', getter()===hex); b.onclick=()=>{ setter(hex); draw(); commit(); }; el.appendChild(b); });
  const c=document.createElement('label'); c.className='sw custom'; c.title='Custom colour'; const i=document.createElement('input'); i.type='color'; i.value=getter(); i.setAttribute('aria-label','Custom colour');
  i.oninput=()=>setter(i.value); i.onchange=()=>{ draw(); commit(); }; c.appendChild(i); el.appendChild(c); }; draw(); el._draw = draw; }
function setFabric(hex){ S.fabric = hex; if (S.ribMatch) S.rib = hex; const c = new THREE.Color(hex); const lum = c.r*0.3+c.g*0.59+c.b*0.11;
  const sh = new THREE.Color(hex).lerp(new THREE.Color(1,1,1), 0.45).multiplyScalar(lum<0.08?0.45:0.75); fabricMat.sheenColor.copy(sh); ribMat.sheenColor.copy(sh); composeSheet(); }
function setBg(hex){ S.bg = hex; backdropMat.color.set(hex).multiplyScalar(BD.b); scene.background = new THREE.Color(hex).multiplyScalar(BD.b*0.82); pane.style.background = hex; $('loading').style.background = hex; }
function setHanger(hex){ hangerMat.color.set(hex); }

swatches($('fabricSw'), FABRICS, ()=>S.fabric, setFabric);
swatches($('ribSw'), FABRICS, ()=>S.rib, hex=>{ S.rib=hex; composeSheet(); });
swatches($('bgSw'), BGS, ()=>S.bg, setBg);
let hangerHex = '#f2f2ef'; swatches($('hangerSw'), HANGERS, ()=>hangerHex, hex=>{ hangerHex = hex; setHanger(hex); });
$('ribMatch').onchange = e=>{ S.ribMatch = e.target.checked; $('ribSw').hidden = S.ribMatch; if(S.ribMatch) S.rib = S.fabric; composeSheet(); commit(); };
const segSet = (a,b,on)=>{ $(a).setAttribute('aria-pressed', on); $(b).setAttribute('aria-pressed', !on); };
$('cSolid').onclick = ()=>{ S.grad=false; segSet('cSolid','cGrad',true); $('gradRow').hidden = true; composeSheet(); commit(); };
$('cGrad').onclick = ()=>{ S.grad=true; segSet('cSolid','cGrad',false); $('gradRow').hidden = false; composeSheet(); commit(); };
$('grad2').oninput = e=>{ S.grad2 = e.target.value; composeSheet(); }; $('grad2').onchange = commit;
$('wash').onchange = e=>{ S.wash = e.target.value; $('washOpts').hidden = S.wash==='none'; composeSheet(); commit(); };
const bindRange = (id, fmt, fn, onEnd) => { const el=$(id), out=$(id+'O'); const upd=()=>{ out.textContent = fmt(+el.value); fn(+el.value); }; el.oninput = upd; if(onEnd) el.onchange = onEnd; out.textContent = fmt(+el.value); };
bindRange('washStr', v=>`${v}%`, v=>{ S.washStr=v/100; composeSheet(); }, commit);
bindRange('washSize', v=>`×${v.toFixed(1)}`, v=>{ S.washSize=v; composeSheet(); }, commit);
$('washPrints').onchange = e=>{ S.washPrints = e.target.checked; composeSheet(); commit(); };
$('washSeed').onclick = ()=>{ S.washSeed = (S.washSeed*7+13)%997; composeSheet(); commit(); };

$('material').onchange = e=>{ APP.material = e.target.value; applyMaterial(); };
$('aoT').onchange = e=> useAO = e.target.checked;
$('wrT').onchange = e=>{ APP.wrinklesOn = e.target.checked; applyMaterial(); };
bindRange('wrinkles', v=>v.toFixed(1), ()=>applyMaterial());
bindRange('texture', v=>v.toFixed(1), v=>{ APP.texture=v; applyMaterial(); });
bindRange('knit', v=>`×${v}`, v=>{ APP.knit=v; applyMaterial(); });
bindRange('bright', v=>v.toFixed(2), v=>U.uBright.value=v);
bindRange('contrast', v=>v.toFixed(2), v=>U.uContrast.value=v);

$('hdriT').onchange = e=>{ scene.environment = e.target.checked ? envTex : null; };
bindRange('hdriI', v=>v.toFixed(2), v=>scene.environmentIntensity=v);
bindRange('hdriR', v=>`${v}°`, v=>scene.environmentRotation.y=v*Math.PI/180);
bindRange('keyI', v=>v.toFixed(2), v=>{ KEY.i=v; placeKey(); });
bindRange('keyA', v=>`${v}°`, v=>{ KEY.angle=v; placeKey(); });
$('bdT').onchange = e=>{ backdrop.visible = e.target.checked; };
$('bdShadow').onchange = e=>{ [...shirtMeshes,...hangerMeshes,...hookMeshes].forEach(m=>m.castShadow = e.target.checked); };
$('goboSel').onchange = e=>{ GOBO.type = e.target.value; refreshGobo(); };
$('goboInv').onchange = e=>{ GOBO.invert = e.target.checked; refreshGobo(); };
bindRange('bdB', v=>v.toFixed(2), v=>{ BD.b=v; setBg(S.bg); });
bindRange('bdC', v=>v.toFixed(2), v=>{ GOBO.contrast=v; refreshGobo(); });
$('hangerT').onchange = e=> [...hangerMeshes,...hookMeshes].forEach(m=>m.visible = e.target.checked);

for (const [t,p] of [['tabDesign','paneDesign'],['tabScene','paneScene']]) $(t).onclick = ()=>{
  for (const [t2,p2] of [['tabDesign','paneDesign'],['tabScene','paneScene']]){ $(t2).setAttribute('aria-selected', t2===t); $(p2).hidden = t2!==t; } };

function setView(v){ $('stage').dataset.view = v;
  [['vPattern','pattern'],['vSplit','split'],['v3d','3d']].forEach(([id,val])=>$(id).setAttribute('aria-pressed', v===val));
  requestAnimationFrame(()=>{ resizeGL(); resizePattern(); }); }
$('vPattern').onclick=()=>setView('pattern'); $('vSplit').onclick=()=>setView('split'); $('v3d').onclick=()=>setView('3d');
function syncAllUI(){ $('fabricSw')._draw(); $('ribSw')._draw(); $('bgSw')._draw(); $('ribMatch').checked = S.ribMatch; $('ribSw').hidden = S.ribMatch;
  segSet('cSolid','cGrad',!S.grad); $('gradRow').hidden = !S.grad; $('grad2').value = S.grad2; $('wash').value = S.wash; $('washOpts').hidden = S.wash==='none';
  setFabric(S.fabric); setBg(S.bg); }

// ---------- save / load (localStorage) + pattern PNG ----------
const STORE_KEY = AuthService.LEGACY_DESIGN_KEY;
async function serializeDesign(){
  const layers = [];
  for (const L of S.layers){
    const base = {id:L.id, kind:L.kind, x:L.x, y:L.y, w:L.w, rot:L.rot, opacity:L.opacity??1, flipX:!!L.flipX, flipY:!!L.flipY, locked:!!L.locked, visible:!!L.visible, inside:!!L.inside};
    if (L.kind==='text'){ layers.push({...base, text:L.text, font:L.font, color:L.color}); }
    else if (L.kind==='brush'){
      let dataUrl = null;
      try { if (L.src && L.src.toDataURL) dataUrl = L.src.toDataURL('image/png'); } catch(_){}
      layers.push({...base, name:L.name||'Brush paint', dataUrl});
    }
    else {
      let dataUrl = null;
      try {
        if (L.src && L.src.toDataURL) dataUrl = L.src.toDataURL('image/png');
        else if (L.src && L.src.src) dataUrl = L.src.src;
      } catch(_){}
      layers.push({...base, name:L.name, dataUrl});
    }
  }
  return {version:1, fabric:S.fabric, grad:S.grad, grad2:S.grad2, rib:S.rib, ribMatch:S.ribMatch, wash:S.wash, washStr:S.washStr, washSize:S.washSize, washPrints:S.washPrints, washSeed:S.washSeed, bg:S.bg, layers, sel:S.sel, uid};
}
async function applyDesign(data){
  if (!data || !data.layers) return;
  Object.assign(S, {fabric:data.fabric, grad:!!data.grad, grad2:data.grad2, rib:data.rib, ribMatch:data.ribMatch!==false, wash:data.wash||'none', washStr:data.washStr??0.6, washSize:data.washSize??1.4, washPrints:data.washPrints!==false, washSeed:data.washSeed??3, bg:data.bg||S.bg, sel:data.sel??null});
  uid = Math.max(uid, data.uid||0, ...data.layers.map(l=>l.id||0));
  const next = [];
  for (const raw of data.layers){
    if (raw.kind==='text'){
      const L = {id:raw.id||++uid, kind:'text', text:raw.text||' ', font:raw.font||'Anton', color:raw.color||'#1b1b1b', x:raw.x, y:raw.y, w:raw.w, rot:raw.rot||0, opacity:raw.opacity??1, flipX:!!raw.flipX, flipY:!!raw.flipY, locked:!!raw.locked, visible:raw.visible!==false, inside:!!raw.inside};
      await ensureFont(L.font); textBitmap(L); next.push(L);
    } else if (raw.kind==='brush'){
      const c = makeBrushCanvas();
      if (raw.dataUrl){
        const img = await new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=raw.dataUrl; });
        c.getContext('2d').drawImage(img,0,0);
      }
      next.push({id:raw.id||++uid, kind:'brush', name:raw.name||'Brush paint', src:c, aspect:1, x:raw.x??TEX/2, y:raw.y??TEX/2, w:raw.w??TEX, rot:0, opacity:raw.opacity??1, flipX:false, flipY:false, locked:!!raw.locked, visible:raw.visible!==false, inside:!!raw.inside});
    } else if (raw.dataUrl){
      const img = await new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=raw.dataUrl; });
      next.push({id:raw.id||++uid, kind:'image', name:raw.name||'Image', src:img, aspect:img.height/img.width, x:raw.x, y:raw.y, w:raw.w, rot:raw.rot||0, opacity:raw.opacity??1, flipX:!!raw.flipX, flipY:!!raw.flipY, locked:!!raw.locked, visible:raw.visible!==false, inside:!!raw.inside});
    }
  }
  S.layers = next; syncAllUI(); composeSheet(); renderLayers(); commit(); toast('Design loaded');
}
$('saveDesign').onclick = async ()=>{
  try {
    const payload = await serializeDesign();
    if (plan().maxDesigns > 1 && AuthService.getUser()){
      AuthService.saveNamedDesign('Quick save', payload);
      toast('Saved to My designs');
    } else {
      localStorage.setItem(STORE_KEY, JSON.stringify(payload));
      toast('Saved in this browser');
    }
  } catch(err){ toast('Could not save: '+err.message); }
};
$('loadDesign').onclick = async ()=>{
  const raw = localStorage.getItem(STORE_KEY);
  if(!raw){ toast('No saved design yet'); return; }
  try { await applyDesign(JSON.parse(raw)); } catch(err){ toast('Could not load: '+err.message); }
};

async function buildPatternPngCanvas(){
  const B = SHOWN.map(dispBox); const minX=Math.min(...B.map(b=>b[0])), minY=Math.min(...B.map(b=>b[1])), maxX=Math.max(...B.map(b=>b[2])), maxY=Math.max(...B.map(b=>b[3]));
  const pad=40; const c=document.createElement('canvas'); c.width=Math.ceil(maxX-minX+pad*2); c.height=Math.ceil(maxY-minY+pad*2+36);
  const g=c.getContext('2d'); g.fillStyle='#10120f'; g.fillRect(0,0,c.width,c.height); g.translate(pad-minX, pad-minY);
  for (const p of SHOWN){ g.save(); g.translate(p.dx,p.dy); g.save(); g.clip(p.path); g.drawImage(tex,0,0); g.restore();
    g.strokeStyle='rgba(255,255,255,.25)'; g.lineWidth=1; g.stroke(p.path); g.restore(); }
  return withWatermarkCanvas(c);
}
async function exportPatternPng(){
  const c = await buildPatternPngCanvas();
  const blob = await canvasBlob(c); showModal({img:URL.createObjectURL(blob), blob, name:'pattern-sheet.png', txt:'2D sewing-pattern sheet with your prints.'});
}
$('exportPattern').onclick = ()=> exportPatternPng();

function pathToSvgD(p){
  const pts = p.pts; if (!pts.length) return '';
  return pts.map((pt,i)=> (i?'L':'M')+pt[0].toFixed(2)+','+pt[1].toFixed(2)).join(' ') + ' Z';
}
async function exportPatternSvg(){
  const B = SHOWN.map(dispBox); const minX=Math.min(...B.map(b=>b[0])), minY=Math.min(...B.map(b=>b[1])), maxX=Math.max(...B.map(b=>b[2])), maxY=Math.max(...B.map(b=>b[3]));
  const pad=40; const W=Math.ceil(maxX-minX+pad*2), H=Math.ceil(maxY-minY+pad*2+36);
  const sheetUrl = tex.toDataURL('image/png');
  let body = '';
  for (const p of SHOWN){
    const d = pathToSvgD(p);
    const tx = (p.dx + pad - minX).toFixed(2), ty = (p.dy + pad - minY).toFixed(2);
    body += `<g transform="translate(${tx},${ty})"><clipPath id="c-${p.id}"><path d="${d}"/></clipPath><image href="${sheetUrl}" width="${TEX}" height="${TEX}" clip-path="url(#c-${p.id})"/><path d="${d}" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1"/></g>`;
  }
  if (AuthService.needsWatermark()){
    body += `<text x="${W-16}" y="${H-14}" text-anchor="end" font-family="Familjen Grotesk,sans-serif" font-size="18" font-weight="700" fill="#f2c14e" opacity="0.7">Fashion Builder · Free</text>`;
  }
  const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#10120f"/>${body}</svg>`;
  const blob = new Blob([svg], {type:'image/svg+xml'});
  showModal({img:URL.createObjectURL(blob), blob, name:'pattern-sheet.svg', txt:'2D pattern as SVG (piece clips + print sheet).'});
}

// ---------- exports ----------
const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
const canvasBlob = c => new Promise(r=>c.toBlob(r,'image/png'));
function showModal({img, video, name, blob, txt}){
  $('modalImg').hidden = !img; $('modalVid').hidden = !video; if (img) $('modalImg').src = img; if (video){ $('modalVid').src = video; $('modalVid').play().catch(()=>{}); }
  $('modalTxt').textContent = txt; $('modal').hidden = false;
  $('modalDl').textContent = video ? 'Download video' : 'Download';
  $('modalDl').onclick = ()=> download(blob, name);
}
$('modalClose').onclick = ()=>{ $('modal').hidden = true; $('modalVid').pause(); };
function pieceCanvas(p, bleedCm=0, inside=false){
  const b = bleedCm*PX, [x0,y0,x1,y1] = p.box; const c = document.createElement('canvas'); c.width = Math.ceil(x1-x0+2*b); c.height = Math.ceil(y1-y0+2*b);
  const g = c.getContext('2d'); g.translate(b-x0, b-y0); const src = inside ? texIn : tex;
  if (b){ g.save(); g.strokeStyle = g.createPattern(src,'no-repeat'); g.lineWidth = b*2; g.lineJoin='round'; g.stroke(p.path); g.restore(); }
  g.save(); g.clip(p.path); g.drawImage(src,0,0); g.restore(); return c; }
function specSheet(){
  const W=1800, H=1300, c=document.createElement('canvas'); c.width=W; c.height=H; const g=c.getContext('2d');
  g.fillStyle='#fbfaf7'; g.fillRect(0,0,W,H); g.fillStyle='#16130c';
  g.font='700 40px "Familjen Grotesk", sans-serif'; g.fillText('Fashion Builder — Tech pack', 60, 84);
  g.font='18px "JetBrains Mono", monospace'; g.fillStyle='#555'; g.fillText(`${USER?'Raglan tee':'Oversized tee'} · men's crew neck · ${new Date().toISOString().slice(0,10)} · units: cm`, 60, 118);
  const DB = SHOWN.map(dispBox); const bw = Math.max(...DB.map(b=>b[2]))-Math.min(...DB.map(b=>b[0])), bh = Math.max(...DB.map(b=>b[3]))-Math.min(...DB.map(b=>b[1]));
  const k = Math.min(900/bw, 1080/bh); g.save(); g.translate(60, 150); g.scale(k,k); g.translate(-Math.min(...DB.map(b=>b[0])), -Math.min(...DB.map(b=>b[1])));
  for (const p of SHOWN){ g.save(); g.translate(p.dx,p.dy); g.save(); g.clip(p.path); g.drawImage(tex,0,0); g.restore(); g.lineWidth=2/k; g.strokeStyle='#16130c'; g.setLineDash([10,6]); g.stroke(p.path); g.setLineDash([]);
    g.fillStyle='#16130c'; g.font=`${13/k}px "Familjen Grotesk"`; g.textAlign='center'; g.fillText(p.label, (p.box[0]+p.box[2])/2, p.box[3]+16/k); g.restore(); }
  g.restore(); g.textAlign='left';
  let y = 170; const X = 1020; g.fillStyle='#16130c'; g.font='700 22px "Familjen Grotesk"'; g.fillText('Fabric', X, y); y+=34; g.font='17px "JetBrains Mono", monospace';
  for (const line of [`Body colour   ${S.fabric.toUpperCase()}${S.grad?' → '+S.grad2.toUpperCase():''}`, `Rib colour    ${(S.ribMatch?S.fabric:S.rib).toUpperCase()}`, `Material      ${$('material').selectedOptions[0].text}`, `Wash          ${$('wash').selectedOptions[0].text}${S.wash!=='none'?` ${Math.round(S.washStr*100)}%`:''}`]){ g.fillText(line, X, y); y+=28; }
  y+=26; g.font='700 22px "Familjen Grotesk"'; g.fillText('Prints', X, y); y+=34; g.font='16px "JetBrains Mono", monospace';
  for (const L of S.layers.filter(l=>l.visible)){ const p = pieceAt(L.x,L.y); const fromL = p ? (L.x-p.box[0])/PX : 0, fromT = p ? (L.y-p.box[1])/PX : 0;
    g.fillStyle='#16130c'; g.fillText(`${layerName(L).slice(0,28)}`, X, y); y+=24; g.fillStyle='#555';
    g.fillText(`  ${p?p.label:'—'}${L.inside?' (inside)':''} · ${(L.w/PX).toFixed(1)} × ${(L.w*L.aspect/PX).toFixed(1)} cm`, X, y); y+=22;
    g.fillText(`  centre ${fromL.toFixed(1)} cm from left, ${fromT.toFixed(1)} cm from top · ${Math.round(L.rot)}°`, X, y); y+=34; if (y>H-40) break; }
  drawWatermark(g, W, H);
  return c; }
async function zipOf(files){ if (!window.JSZip) { toast('ZIP library did not load. Check your connection and try again.'); return null; }
  const z = new JSZip(); for (const [n,b] of files) z.file(n, b); return z.generateAsync({type:'blob'}); }

async function capture3dPng({mode='catalogue'}={}){
  const pr = renderer.getPixelRatio();
  const prevClear = renderer.getClearColor(new THREE.Color()).getHex();
  const prevAlpha = renderer.getClearAlpha();
  const prevBg = scene.background;
  const bdVisible = backdrop.visible;
  const prevAutoClear = renderer.autoClear;
  try {
    if (mode === 'catalogue'){
      renderer.setPixelRatio(Math.min(devicePixelRatio,2)*2); resizeGL(); render();
      const c = await withWatermarkCanvas(glc);
      const blob = await canvasBlob(c);
      return {blob, w: glc.width, h: glc.height, name:'catalogue-render.png', txt:`Catalogue render at ${glc.width/2}×${glc.height/2}px ×2.`};
    }
    if (mode === 'dark'){
      renderer.setPixelRatio(Math.min(devicePixelRatio,2)*2); resizeGL();
      backdrop.visible = false; scene.background = new THREE.Color('#141613');
      renderer.setClearColor('#141613', 1); render();
      const c = await withWatermarkCanvas(glc);
      const blob = await canvasBlob(c);
      return {blob, name:'3d-dark.png', txt:'3D snapshot with a dark studio background.'};
    }
    if (mode === 'clear'){
      renderer.setPixelRatio(Math.min(devicePixelRatio,2)*2); resizeGL();
      const prevAO = useAO; useAO = false; // composer may not preserve alpha well
      backdrop.visible = false; scene.background = null;
      renderer.setClearColor(0x000000, 0); renderer.autoClear = true; render();
      // copy to offscreen preserving alpha
      const off = document.createElement('canvas'); off.width = glc.width; off.height = glc.height;
      const og = off.getContext('2d'); og.clearRect(0,0,off.width,off.height); og.drawImage(glc,0,0);
      const marked = await withWatermarkCanvas(off);
      const blob = await canvasBlob(marked);
      useAO = prevAO;
      return {blob, name:'3d-transparent.png', txt:'3D snapshot with transparent background (best-effort).'};
    }
  } finally {
    renderer.setPixelRatio(pr); resizeGL();
    backdrop.visible = bdVisible; scene.background = prevBg;
    renderer.setClearColor(prevClear, prevAlpha); renderer.autoClear = prevAutoClear;
  }
}

function showRecProgress(on, pct=0, label){
  const el = $('recProgress'); if (!el) return;
  el.hidden = !on;
  if (label) $('recProgressLabel').textContent = label;
  $('recProgressBar').style.width = Math.round(pct*100)+'%';
  $('recProgressPct').textContent = Math.round(pct*100)+'%';
}

async function recordTurntable(){
  if (!requirePro('Turntable video')) return;
  if (!window.MediaRecorder){ toast('Video recording is not supported in this browser.'); return; }
  const savedPos = camera.position.clone();
  const savedTarget = controls.target.clone();
  const wasAuto = $('autoRot')?.getAttribute('aria-pressed') === 'true';
  if (wasAuto) $('autoRot').click();
  const prevEnabled = controls.enabled; controls.enabled = false;

  const fps = 24, seconds = 5, total = fps * seconds; // ~5s turntable
  fitDist();
  const mirror = document.createElement('canvas');
  mirror.width = glc.width || 640; mirror.height = glc.height || 720;
  mirror.style.cssText = 'position:fixed;left:-9999px;top:0;pointer-events:none;';
  document.body.appendChild(mirror);
  let mctxLive = mirror.getContext('2d', { alpha: false });
  const stream = mirror.captureStream(0);
  const vtrack = stream.getVideoTracks()[0];
  const mime = ['video/webm;codecs=vp8','video/webm;codecs=vp9','video/webm','video/mp4;codecs=avc1'].find(m=>MediaRecorder.isTypeSupported(m)) || '';
  let rec;
  try { rec = new MediaRecorder(stream, mime ? {mimeType:mime, videoBitsPerSecond:4e6} : {videoBitsPerSecond:4e6}); }
  catch(_){ rec = new MediaRecorder(stream); }
  const chunks=[]; rec.ondataavailable = e=>{ if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise(r=>rec.onstop=r);

  const paint = ()=>{
    try {
      if (glc.width && glc.height && (mirror.width !== glc.width || mirror.height !== glc.height)){
        mirror.width = glc.width; mirror.height = glc.height;
        mctxLive = mirror.getContext('2d', { alpha: false });
      }
      mctxLive.drawImage(glc, 0, 0);
      if (vtrack.requestFrame) vtrack.requestFrame();
    } catch(_){}
  };

  showRecProgress(true, 0, 'Recording 360° turntable…');
  toast('Recording a 5-second turntable…');
  rec.start(100);
  const budget = 1000 / fps;

  for (let i = 0; i < total; i++){
    const t0 = performance.now();
    const t = i / (total - 1);
    const a = t * Math.PI * 2;
    camera.position.set(Math.sin(a)*FIT.dist, FIT.cy+0.04*FIT.dist, Math.cos(a)*FIT.dist);
    camera.lookAt(0, FIT.cy, 0);
    rig.rotation.y = Math.atan2(camera.position.x, camera.position.z);
    render();
    paint();
    if ((i & 1) === 0) showRecProgress(true, t, 'Recording 360° turntable…');
    const wait = budget - (performance.now() - t0);
    if (wait > 4) await new Promise(r=>setTimeout(r, wait));
    else await new Promise(r=>setTimeout(r, 0)); // yield so UI can update
  }

  showRecProgress(true, 1, 'Finalizing…');
  try { rec.requestData(); } catch(_){}
  await new Promise(r=>setTimeout(r, 200));
  rec.stop(); await stopped;
  stream.getTracks().forEach(t=>t.stop());
  mirror.remove();

  camera.position.copy(savedPos); controls.target.copy(savedTarget); controls.update();
  controls.enabled = prevEnabled;
  showRecProgress(false);

  const blobType = (mime && mime.startsWith('video/')) ? mime.split(';')[0] : 'video/webm';
  const blob = new Blob(chunks, {type: blobType});
  if (!blob.size){ toast('Recording produced an empty file — try Chrome/Edge'); return; }
  const ext = /mp4/.test(mime||'') ? 'mp4' : 'webm';
  download(blob, `turntable.${ext}`);
  showModal({video:URL.createObjectURL(blob), blob, name:`turntable.${ext}`, txt:`5-second 360° turntable · ${total} frames · ${(blob.size/1024).toFixed(0)} KB. Camera restored.`});
}

const EXPORTS = {
  async catalogue(){ const r = await capture3dPng({mode:'catalogue'}); showModal({img:URL.createObjectURL(r.blob), blob:r.blob, name:r.name, txt:r.txt}); },
  async snapDark(){ const r = await capture3dPng({mode:'dark'}); showModal({img:URL.createObjectURL(r.blob), blob:r.blob, name:r.name, txt:r.txt}); },
  async snapClear(){ const r = await capture3dPng({mode:'clear'}); showModal({img:URL.createObjectURL(r.blob), blob:r.blob, name:r.name, txt:r.txt}); },
  async patternPng(){ await exportPatternPng(); },
  async patternSvg(){ await exportPatternSvg(); },
  async print(){ const files = [];
    for (const p of pieces){ files.push([`pieces/${p.label}.png`, await canvasBlob(pieceCanvas(p))]); if (S.layers.some(l=>l.inside&&l.visible&&pieceAt(l.x,l.y)===p)) files.push([`pieces/${p.label} (inside).png`, await canvasBlob(pieceCanvas(p,0,true))]); }
    for (const L of S.layers.filter(l=>l.visible)){ const c=document.createElement('canvas'); c.width=L.src.width; c.height=L.src.height; c.getContext('2d').drawImage(L.src,0,0); files.push([`prints/${layerName(L).replace(/[^\w\- ]+/g,'').slice(0,40)||'print'}-${L.id}.png`, await canvasBlob(c)]); }
    const spec = specSheet(); files.push(['spec-sheet.png', await canvasBlob(spec)]);
    const blob = await zipOf(files); if (!blob) return; download(blob, 'print-files.zip');
    showModal({img:spec.toDataURL(), blob, name:'print-files.zip', txt:`Print files: ${files.length} files (pieces, prints and this spec sheet) in one ZIP.`}); },
  async sublimation(){ const files = []; for (const p of pieces) files.push([`${p.label} — 1cm bleed.png`, await canvasBlob(pieceCanvas(p,1))]);
    const blob = await zipOf(files); if (!blob) return; download(blob, 'sublimation-panels.zip');
    showModal({img:pieceCanvas(pieceById.front,1).toDataURL(), blob, name:'sublimation-panels.zip', txt:`${files.length} full panels with 1 cm bleed at ${PX} px/cm (≈ 41 dpi preview scale; scale up in your RIP).`}); },
  async spec(){ const c = specSheet(); const blob = await canvasBlob(c); showModal({img:c.toDataURL(), blob, name:'spec-sheet.png', txt:'Spec sheet with print sizes and positions.'}); },
  async turntable(){ await recordTurntable(); },
};
$('exportBtn').onclick = e=>{ e.stopPropagation(); const m=$('exportMenu'); m.hidden = !m.hidden; $('exportBtn').setAttribute('aria-expanded', !m.hidden); };
document.addEventListener('click', e=>{ if(!e.target.closest('.menuwrap')){ $('exportMenu').hidden = true; $('exportBtn').setAttribute('aria-expanded', false); if($('accountMenu')){ $('accountMenu').hidden = true; $('accountBtn')?.setAttribute('aria-expanded', false); } } });
document.querySelectorAll('[data-exp]').forEach(b=>b.onclick = ()=>{ $('exportMenu').hidden = true; EXPORTS[b.dataset.exp]().catch(err=>{ console.error(err); toast('Export failed: '+err.message); }); });
$('snap').onclick = async ()=>{ const r = await capture3dPng({mode:'catalogue'}); showModal({img:URL.createObjectURL(r.blob), blob:r.blob, name:'3d-snapshot.png', txt:r.txt}); };

// ---------- SaaS UI: landing, auth, pricing, designs ----------
let authMode = 'in';
function openLanding(){ $('landing').hidden = false; }
function closeLanding(){ $('landing').hidden = true; try{ sessionStorage.setItem('fb-entered','1'); }catch(_){} }
function openAuth(mode){
  authMode = mode || 'in';
  $('authModal').hidden = false;
  $('authError').textContent = '';
  $('authTabIn').setAttribute('aria-pressed', authMode==='in');
  $('authTabUp').setAttribute('aria-pressed', authMode==='up');
  $('authTitle').textContent = authMode==='up' ? 'Create account' : 'Sign in';
  $('authName').parentElement.hidden = authMode!=='up';
  $('authCodeRow').hidden = authMode!=='up';
  $('authPass').autocomplete = authMode==='up' ? 'new-password' : 'current-password';
}
function closeAuth(){ $('authModal').hidden = true; }
function openPricing(){ $('pricingModal').hidden = false; $('paySoon').hidden = true; }
function closePricing(){ $('pricingModal').hidden = true; }

$('landingOpen').onclick = ()=> closeLanding();
$('pickFree').onclick = ()=> closeLanding();
$('landingAuth').onclick = ()=> openAuth('up');
$('pickPro').onclick = ()=>{ closeLanding(); if (!AuthService.getUser()) openAuth('up'); else openPricing(); };

$('upgradeBtn').onclick = ()=> openPricing();
$('accountBtn').onclick = e=>{ e.stopPropagation(); const m=$('accountMenu'); m.hidden = !m.hidden; $('accountBtn').setAttribute('aria-expanded', !m.hidden); $('exportMenu').hidden = true; };
$('accSignIn').onclick = ()=>{ $('accountMenu').hidden = true; openAuth(AuthService.getUser()?'in':'up'); };
$('accPricing').onclick = ()=>{ $('accountMenu').hidden = true; openPricing(); };
$('accLogout').onclick = ()=>{ AuthService.logout(); refreshPlanUI(); toast('Logged out'); $('accountMenu').hidden = true; };
$('accDesigns').onclick = ()=>{ $('accountMenu').hidden = true; openDesigns(); };

$('authTabIn').onclick = ()=> openAuth('in');
$('authTabUp').onclick = ()=> openAuth('up');
$('authCancel').onclick = ()=> closeAuth();
$('authSubmit').onclick = async ()=>{
  $('authError').textContent = '';
  try {
    if (authMode==='up') await AuthService.signup({email:$('authEmail').value, password:$('authPass').value, name:$('authName').value, inviteCode:$('authCode').value});
    else await AuthService.login({email:$('authEmail').value, password:$('authPass').value});
    refreshPlanUI(); closeAuth(); closeLanding();
    toast(AuthService.getPlan().id==='pro' ? 'Welcome — Pro unlocked' : 'Signed in · Free plan');
  } catch(err){ $('authError').textContent = err.message; }
};
$('pricingClose').onclick = ()=> closePricing();
$('subscribeBtn').onclick = ()=>{ $('paySoon').hidden = false; toast('Payments coming soon'); };
$('redeemBtn').onclick = ()=>{
  try {
    if (!AuthService.getUser()){ closePricing(); openAuth('up'); toast('Sign up first, then redeem the code'); return; }
    AuthService.redeemCode($('redeemCode').value);
    refreshPlanUI(); closePricing(); toast('Pro activated with access code');
  } catch(err){ toast(err.message); }
};

function openDesigns(){
  if (!requirePro('Multiple saved designs') && plan().maxDesigns<=1){
    // requirePro already opened pricing; still allow viewing single save message
  }
  if (plan().id !== 'pro'){ openPricing(); return; }
  $('designsModal').hidden = false;
  renderDesignsList();
}
function renderDesignsList(){
  const box = $('designsList'); box.innerHTML = '';
  const list = AuthService.listDesigns();
  if (!list.length){ box.innerHTML = '<p class="sub">No named designs yet.</p>'; return; }
  list.forEach(d=>{
    const row = document.createElement('div'); row.className='row'; row.style.cssText='justify-content:space-between;align-items:center;border:1px solid var(--line);border-radius:8px;padding:8px 10px';
    const meta = document.createElement('div'); meta.innerHTML = `<b>${d.name}</b><div class="sub" style="margin:0">${new Date(d.updatedAt).toLocaleString()}</div>`;
    const actions = document.createElement('div'); actions.className='row';
    const load = document.createElement('button'); load.className='btn'; load.textContent='Load';
    load.onclick = async ()=>{ try{ await applyDesign(d.data); $('designsModal').hidden=true; toast('Loaded “'+d.name+'”'); }catch(e){ toast(e.message);} };
    const del = document.createElement('button'); del.className='btn'; del.textContent='Delete';
    del.onclick = ()=>{ AuthService.deleteNamedDesign(d.id); renderDesignsList(); };
    actions.append(load, del); row.append(meta, actions); box.appendChild(row);
  });
}
$('designsClose').onclick = ()=> $('designsModal').hidden = true;
$('designSaveAs').onclick = async ()=>{
  try {
    if (plan().id !== 'pro'){ openPricing(); return; }
    const name = $('designName').value.trim() || 'Untitled';
    AuthService.saveNamedDesign(name, await serializeDesign());
    $('designName').value=''; renderDesignsList(); toast('Saved “'+name+'”');
  } catch(err){ toast(err.message); }
};

AuthService.onChange(()=> refreshPlanUI());
refreshPlanUI();
try { if (!sessionStorage.getItem('fb-entered')) openLanding(); } catch(_){ openLanding(); }



// ---------- boot with a sample design ----------
$('pcCount').textContent = `${mainPieces().length} pieces`; $('garmentName').textContent = USER ? `Raglan tee · ${mainPieces().length} pieces` : 'Oversized tee · 5 pieces';
new ResizeObserver(()=>{ resizeGL(); resizePattern(); }).observe($('stage'));
const FONT_LIST = [...$('textFont').options].map(o=>o.value);
for (const o of $('textFont').options) o.style.fontFamily = `"${o.value}", sans-serif`;
await Promise.race([Promise.all(FONT_LIST.slice(0,8).map(f=>ensureFont(f))), new Promise(r=>setTimeout(r,2500))]);
// lazy-load the rest in background
FONT_LIST.slice(8).forEach(f=>ensureFont(f));
{
  const f = pieceById.front.box, b = pieceById.back.box, sl = pieceById.sleeveL.box;
  const fx = (f[0]+f[2])/2, bx = (b[0]+b[2])/2;
  await ensureFont('Permanent Marker'); await ensureFont('Bebas Neue'); await ensureFont('Anton');
  addText('BUILT.\nNOT\nGENERATED.', fx, f[1]+27*PX, 25, {font:'Permanent Marker', color:'#efece3', rot:-4});
  addText('FB', (sl[0]+sl[2])/2+4*PX, sl[1]+14*PX, 4.5, {font:'Bebas Neue', color:'#efece3', rot:0});
  addText('FASHION BUILDER\nL  ·  100% COTTON', bx, b[1]+6.5*PX, 9, {font:'Anton', color:'#1b1b1b', inside:true});
  S.sel = S.layers[0].id;
}
setFabric(S.fabric); setBg(S.bg); applyMaterial(); renderLayers(); resizeGL(); resizePattern(); commit(); loop();
try {
  window.__FB = {
    getS: () => S, getLayers: () => S.layers, pieceById, pieces: () => pieces, SHOWN: () => SHOWN,
    TEX, PX, BRUSH, PV, pieceAt, fromDisplay, toView, toSheet, hitLayer, composeSheet, select, addText, ensureBrushLayer,
    setBrushMode, moveLayerToPiece, stampBrush, commit, renderLayers, rebuildText, fitPattern,
    camBack: () => { const b = document.querySelector('[data-cam="back"]'); if (b) b.click(); },
    pieceClient(pieceId){
      const p = pieceById[pieceId]; if (!p) return null;
      const cx = (p.box[0]+p.box[2])/2 + p.dx, cy = (p.box[1]+p.box[3])/2 + p.dy;
      const [vx,vy] = toView(cx, cy);
      const r = $('patternCanvas').getBoundingClientRect();
      return { x: r.left + vx, y: r.top + vy, vx, vy };
    },
  };
} catch(_){}
setTimeout(()=>{ $('hint').hidden = true; }, 9000);
