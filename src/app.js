import * as THREE from 'three';
import {OrbitControls, GLTFLoader, MeshoptDecoder, RoomEnvironment, EffectComposer, RenderPass, GTAOPass, OutputPass} from 'three';

const $ = id => document.getElementById(id);
const mark = n => { try { performance.mark('fb:'+n); } catch(_){} };
mark('start');
// ---------- garments ----------
// To add a model: drop <name>.glb (UV islands = pattern pieces) + pattern.json in assets/<id>/ and add one entry here.
// The default garment's pattern is inlined at build time; others are fetched when picked (?g=<id>).
const GARMENTS = {
  raglan:    {name:'Raglan tee',    sub:"Men's crew neck",               glb:'assets/shirt.glb',    pattern:null, sleeve:'raglan'},
  oversized: {name:'Oversized tee', sub:"Men's crew neck · drop shoulder", glb:'assets/fb/shirt.glb', pattern:'assets/fb/pattern.json', sleeve:'set-in'},
};
let GID = new URLSearchParams(location.search).get('g') || 'raglan'; if (!GARMENTS[GID]) GID = 'raglan';
let PATTERN = null;
if (GARMENTS[GID].pattern){ try { const r = await fetch(GARMENTS[GID].pattern); if (r.ok) PATTERN = await r.json(); } catch(_){} if (!PATTERN) GID = 'raglan'; }
if (!PATTERN) PATTERN = __PATTERN__;
const G = GARMENTS[GID];
const SHEET_CM = PATTERN.sheetCm, PX = 16, TEX = SHEET_CM*PX; // print sheet, 16 px per cm
// ---------- units ----------
let UNIT = 'cm'; try { UNIT = localStorage.getItem('fb-unit') || 'cm'; } catch(_){}
if (!['mm','cm','in'].includes(UNIT)) UNIT = 'cm';
const fmtNum = (cm, dp=1) => UNIT==='mm' ? String(Math.round(cm*10)) : UNIT==='in' ? (cm/2.54).toFixed(Math.max(1,dp)) : cm.toFixed(dp);
const fmtLen = (cm, dp=1) => `${fmtNum(cm,dp)} ${UNIT}`;
// ---------- render-on-demand ----------
let needRender = 3, patDirty = true;
function invalidate(n=2){ if (n > needRender) needRender = n; }

const toast = msg => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(()=>t.remove(), 3200); };

// ---------- SaaS plan helpers (AuthService from auth.js) ----------
function plan(){ return AuthService.getPlan(); }
function requirePro(feature){
  if (plan().id === 'pro') return true;
  if (!AuthService.PAYMENTS_VISIBLE){
    toast((feature||'This feature') + ' needs access');
    return false;
  }
  toast((feature||'This feature') + ' is Pro');
  openPricing();
  return false;
}
function ensureLayerRoom(){
  if (AuthService.canAddLayer(S.layers.length)) return true;
  if (!AuthService.PAYMENTS_VISIBLE){
    toast(`Layer limit reached (${plan().maxLayers}).`);
    return false;
  }
  toast(`Free plan: max ${plan().maxLayers} layers. Upgrade to Pro for unlimited.`);
  openPricing();
  return false;
}
// Free-plan watermark: the Stylooks logo, small, bottom-right, on a soft dark pill so it reads on light and dark exports.
const WM_LOGO = new Image(); WM_LOGO.decoding = 'async'; WM_LOGO.src = './assets/logo-dark.png';
const wmReady = () => WM_LOGO.complete && WM_LOGO.naturalWidth > 0;
function wmBox(w, h){
  const lw = Math.round(Math.min(260, Math.max(100, w*0.1))), lh = Math.round(lw*WM_LOGO.naturalHeight/WM_LOGO.naturalWidth);
  const pad = Math.round(lh*0.28), m = Math.max(12, Math.round(w*0.012));
  return {lw, lh, pad, x: w - m - lw - pad*2, y: h - m - lh - pad*2};
}
// extra bottom room an export needs so the watermark never sits on a pattern piece
const wmFooter = w => { if (!AuthService.needsWatermark() || !wmReady()) return 36; const b = wmBox(w, 0); return Math.max(36, -b.y + 8); };
function drawWatermark(ctx, w, h){
  if (!AuthService.needsWatermark()) return;
  ctx.save();
  if (wmReady()){
    const {lw, lh, pad, x, y} = wmBox(w, h);
    ctx.globalAlpha = 0.85; ctx.fillStyle = 'rgba(12,12,16,.55)';
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, lw+pad*2, lh+pad*2, (lh+pad*2)/2) : ctx.rect(x, y, lw+pad*2, lh+pad*2); ctx.fill();
    ctx.globalAlpha = 0.9; ctx.drawImage(WM_LOGO, x+pad, y+pad, lw, lh);
  } else {
    ctx.globalAlpha = 0.55; ctx.fillStyle = '#f2c14e';
    ctx.font = `700 ${Math.max(14, Math.round(w*0.028))}px "Familjen Grotesk", sans-serif`;
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText('Stylooks · Free', w - 16, h - 14);
  }
  ctx.restore();
}
function wmSvg(W, H){
  if (!AuthService.needsWatermark()) return '';
  if (wmReady()){
    const {lw, lh, pad, x, y} = wmBox(W, H), c = document.createElement('canvas'); c.width = WM_LOGO.naturalWidth; c.height = WM_LOGO.naturalHeight;
    c.getContext('2d').drawImage(WM_LOGO, 0, 0);
    return `<rect x="${x}" y="${y}" width="${lw+pad*2}" height="${lh+pad*2}" rx="${(lh+pad*2)/2}" fill="rgb(12,12,16)" opacity="0.47"/><image href="${c.toDataURL('image/png')}" x="${x+pad}" y="${y+pad}" width="${lw}" height="${lh}" opacity="0.9"/>`;
  }
  return `<text x="${W-16}" y="${H-14}" text-anchor="end" font-family="Familjen Grotesk,sans-serif" font-size="18" font-weight="700" fill="#f2c14e" opacity="0.7">Stylooks · Free</text>`;
}
async function withWatermarkCanvas(srcCanvas){
  if (!AuthService.needsWatermark()) return srcCanvas;
  const c = document.createElement('canvas'); c.width = srcCanvas.width; c.height = srcCanvas.height;
  const g = c.getContext('2d'); g.drawImage(srcCanvas, 0, 0); drawWatermark(g, c.width, c.height); return c;
}
function refreshPlanUI(){
  const st = AuthService.getState();
  const badge = $('planBadge');
  const approved = AuthService.isApproved();
  const gated = !!AuthService.requiresGate();
  if (badge){
    badge.hidden = !gated || !approved;
    badge.textContent = approved ? (AuthService.BETA_GATE ? 'Beta' : 'Invited') : (st.plan.name || '');
    badge.classList.toggle('pro', approved);
  }
  if ($('upgradeBtn')) $('upgradeBtn').hidden = !AuthService.PAYMENTS_VISIBLE;
  if ($('accPricing')) $('accPricing').hidden = !AuthService.PAYMENTS_VISIBLE;
  if ($('landingPricing')) $('landingPricing').hidden = !AuthService.PAYMENTS_VISIBLE;
  const logged = !!st.user;
  if ($('accSignIn')) $('accSignIn').hidden = !gated;
  if ($('accLogout')) $('accLogout').hidden = !gated || !approved;
  if ($('accEmailHint')) $('accEmailHint').textContent = st.user ? st.user.email : '';
  if ($('accSignIn')){
    const b = $('accSignIn').querySelector('b');
    if (b) b.textContent = approved ? 'Account' : (AuthService.BETA_GATE ? 'Enter beta' : 'Request access');
  }
  const sel = $('textFont');
  if (sel){
    [...sel.options].forEach(o=>{
      const allowed = AuthService.canUseFont(o.value);
      o.disabled = !allowed;
      o.hidden = false;
    });
  }
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
const inBox = (p,x,y) => x>=p.box[0] && x<=p.box[2] && y>=p.box[1] && y<=p.box[3];
const pieceAt = (x,y) => {
  let best=null, bestA=-1;
  for (const p of pieces){
    if (!inBox(p,x,y) || !_pc.isPointInPath(p.path,x,y)) continue;
    const a=(p.box[2]-p.box[0])*(p.box[3]-p.box[1]);
    if (a>bestA){ best=p; bestA=a; }
  }
  return best;
};
// display layout for the pattern view: main pieces shelf-packed and readable (the print sheet keeps true UV placement)
const ORDER = ['front','back','sleeveR','sleeveRb','sleeveL','sleeveLb'];
// Core pieces are always on the table; trims (inner hems/cuffs, facings, neck tapes) are shown on demand so that
// every printable area of the 3D garment can also be reached in the 2D drawing.
const isCore = p => (!p.minor && !/facing/.test(p.label||'')) || isRib(p);
let showTrims = false, SHOWN = [];
const PAD = {l:98, r:22, t:66, b:108}; // room for rulers + tool rail, pane header, last label row + zoom bar
function packPieces(maxW, lab, minCell){ const gap = 6*PX; let x=0, y=0, rowH=0, W=0;
  for (const p of SHOWN){ const w=p.box[2]-p.box[0], h=p.box[3]-p.box[1], cell=Math.max(w,minCell); if (x>0 && x+cell>maxW){ x=0; y+=rowH+gap+lab; rowH=0; }
    p.dx = x+(cell-w)/2-p.box[0]; p.dy = y-p.box[1]; p.cell = cell; x += cell+gap; W = Math.max(W, x-gap); rowH = Math.max(rowH,h); }
  return [W, y+rowH]; }
// Shelf-pack the shown pieces into the shape of the pane: try a range of table widths and keep the one that lets the
// pieces draw largest. Labels are a fixed size on screen, so their room in sheet units depends on the zoom.
function layoutPieces(paneW, paneH){
  for (const p of pieces){ delete p.dx; delete p.dy; }
  SHOWN = pieces.filter(p=> showTrims || isCore(p)).sort((a,b)=>{ const ia=ORDER.indexOf(a.id), ib=ORDER.indexOf(b.id); if(ia>=0||ib>=0) return (ia<0?99:ia)-(ib<0?99:ib);
    const strip = p => (p.box[2]-p.box[0]) > 6*(p.box[3]-p.box[1]) ? 1 : 0; // long bands go last so they do not break the rows
    return strip(a)-strip(b) || (b.box[2]-b.box[0])*(b.box[3]-b.box[1])-(a.box[2]-a.box[0])*(a.box[3]-a.box[1]); });
  if (!(paneW > 200 && paneH > 200)){ packPieces(170*PX, 13*PX, 32*PX); return; }
  let best = null;
  for (let w=80; w<=520; w+=10){ let lab = 13*PX, cell = 32*PX, k = 0;
    for (let it=0; it<3; it++){ const [W,H] = packPieces(w*PX, lab, cell); k = Math.min((paneW-PAD.l-PAD.r)/W, (paneH-PAD.t-PAD.b)/H); lab = 42/k; cell = Math.min(60*PX, (showTrims?96:108)/k); }
    if (!best || k > best.k) best = {k, w, lab, cell}; }
  packPieces(best.w*PX, best.lab, best.cell);
}
layoutPieces();
const dispBox = p => [p.box[0]+p.dx, p.box[1]+p.dy, p.box[2]+p.dx, p.box[3]+p.dy];
// display point -> {piece, sheet point}
function fromDisplay(x,y){ for (const p of SHOWN){ if (inBox(p, x-p.dx, y-p.dy) && _pc.isPointInPath(p.path, x-p.dx, y-p.dy)) return {p, sx:x-p.dx, sy:y-p.dy}; } return null; }
const offsetOf = L => { const p = pieceAt(L.x,L.y); return p && p.dx!==undefined ? [p.dx,p.dy] : null; };
const allPieces = new Path2D(); pieces.forEach(p=>allPieces.addPath(p.path));
const COVER = {done:false, tris:0, cm2:0}; // mesh UV area that no pattern outline covers (repaired at load)
const _srcIds = new WeakMap(); let _srcN = 0;
const srcId = o => { if (!o) return 0; let i = _srcIds.get(o); if (!i){ i = ++_srcN; _srcIds.set(o, i); } return i; };

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
const fontCss = new Promise(res=>{ const l = $('fontCss'); if (!l || l.sheet) return res();
  l.addEventListener('load', ()=>res(), {once:true}); l.addEventListener('error', ()=>res(), {once:true}); setTimeout(res, 5000); });
async function ensureFont(font){
  await fontCss;
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
  // Paint must land ABOVE whatever is on the garment: reuse a brush layer only if no photo/text of this side sits on top
  // of it (painting used to go into an older brush layer hidden underneath a newly added image). The eraser keeps the
  // selected / topmost brush layer, since it only makes sense on existing paint.
  const side = S.layers.filter(l=>!!l.inside===!!inside && l.visible);
  const sel = cur();
  let L = null;
  if (BRUSH.eraser) L = (sel && sel.kind==='brush' && !!sel.inside===!!inside && !sel.locked) ? sel : [...side].reverse().find(l=>l.kind==='brush' && !l.locked);
  else { const top = side.at(-1); if (top && top.kind==='brush' && !top.locked) L = top; }
  if (L) return L;
  if (BRUSH.eraser){ toast('Nothing to erase — the eraser works on brush paint'); return null; }
  if (!ensureLayerRoom()) return null;
  L = addBrushLayer({inside:!!inside});
  select(L.id); renderLayers();
  return L;
}
function brushRadiusPx(){ return Math.max(0.5, BRUSH.sizeCm * PX / 2); }
// Pieces are packed a few pixels apart on the print sheet, and sheet neighbours are unrelated parts of the garment.
// So every stamp is clipped to the piece under the pointer: paint near an edge can never spill onto another part.
function stampBrush(L, x, y, piece){
  if (!L || !L.src) return;
  const g = L.src.getContext('2d'), pc = piece || pieceAt(x, y), clip = pc ? pc.path : COVER.path;
  g.save(); if (clip) g.clip(clip);
  try { stampRaw(L, x, y); } finally { g.restore(); }
}
function stampRaw(L, x, y){
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
  L.thumb = null; L.rev = (L.rev|0)+1;
}
function strokeBrush(L, x0,y0,x1,y1, piece){
  const dist = Math.hypot(x1-x0,y1-y0);
  const step = Math.max(1, brushRadiusPx() * 0.35);
  if (dist < 0.01){ stampBrush(L, x1, y1, piece); return; }
  const n = Math.max(1, Math.ceil(dist/step));
  for (let i=0;i<=n;i++){ const t=i/n; stampBrush(L, x0+(x1-x0)*t, y0+(y1-y0)*t, piece); }
}
function setBrushMode(on){
  BRUSH.on = !!on;
  if ($('brushTool')) $('brushTool').setAttribute('aria-pressed', BRUSH.on);
  if ($('brushPanel')) $('brushPanel').hidden = !BRUSH.on;
  if ($('railBrush')) $('railBrush').setAttribute('aria-pressed', BRUSH.on);
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
  const base = {...l, src:undefined, orig:undefined, thumb:undefined, _url:undefined, _urlRev:undefined, _rotHandle:undefined, _k:l.id};
  if (l.kind==='brush' && l.src){ try { if (l._urlRev !== (l.rev|0) || !l._url){ l._url = l.src.toDataURL('image/png'); l._urlRev = l.rev|0; } base._dataUrl = l._url; } catch(_){ base._dataUrl = null; } }
  return base;
})});
const srcById = new Map(), origById = new Map();
function commit(){ S.layers.forEach(l=>{ if (l.orig) origById.set(l.id+':r'+(l.rev|0), l.orig); }); S.layers.forEach(l=>srcById.set(l.id+':'+(l.kind==='text'?l.text+l.font+l.color:'r'+(l.rev|0)), l.src));
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
          im.onload = ()=>{ c.getContext('2d').clearRect(0,0,TEX,TEX); c.getContext('2d').drawImage(im,0,0); L.thumb=null; L.rev=(L.rev|0)+1; L._url=l._dataUrl; L._urlRev=L.rev; composeSheet(); drawPattern(); };
          im.src = l._dataUrl;
        }
      } else if (prev && prev.src && prev.kind==='brush'){ c.getContext('2d').drawImage(prev.src,0,0); }
      L.src = c; L.aspect = 1; L._lastUrl = l._dataUrl || null;
    }
    else { L.src = srcById.get(L.id+':r'+(L.rev|0)) || (prev && prev.src); L.orig = origById.get(L.id+':r'+(L.rev|0)) || null; if (L.src) L.aspect = (L.src.naturalHeight||L.src.height)/(L.src.naturalWidth||L.src.width) || L.aspect; } return L; });
  syncAllUI(); composeSheet(); renderLayers(); }
function updUndo(){ $('undo').disabled = hist.length<2; $('redo').disabled = !fut.length; }
$('undo').onclick = ()=>{ if(hist.length<2) return; fut.push(hist.pop()); restore(hist.at(-1)); updUndo(); };
$('redo').onclick = ()=>{ if(!fut.length) return; const s = fut.pop(); hist.push(s); restore(s); updUndo(); };
addEventListener('keydown', e=>{ if(e.target.matches('input[type=text],textarea')) return;
  if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='z'){ e.preventDefault(); (e.shiftKey?$('redo'):$('undo')).click(); }
  if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='d' && cur() && !e.target.matches('input,select')){ e.preventDefault(); $('dupLayer').click(); }
  if (!e.target.matches('input,select,textarea') && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key==='l'||e.key==='L')){ e.preventDefault(); if (e.shiftKey) setLayersPop($('layersPop').hidden); else toggleLock(cur()); return; }
  if (e.key==='Escape' && $('layersPop') && !$('layersPop').hidden) setLayersPop(false);
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
const baseC = document.createElement('canvas'); baseC.width = baseC.height = TEX; const bgx = baseC.getContext('2d');
let baseKey = null;
function paintBase(g){
  // The whole sheet gets the fabric colour first, so UV areas that fall outside the traced outlines
  // (seam tapes, edge texels picked up by mip-mapping) never render black on the 3D garment.
  g.setTransform(1,0,0,1,0,0); g.globalCompositeOperation = 'source-over'; g.fillStyle = S.fabric; g.fillRect(0,0,TEX+1,TEX+1);
  const fillOf = p => { if (isRib(p) && !S.ribMatch) return S.rib;
    if (S.grad && !isRib(p)){ const gr = g.createLinearGradient(0,p.box[1],0,p.box[3]); gr.addColorStop(0,S.fabric); gr.addColorStop(1,S.grad2); return gr; }
    return S.fabric; };
  g.lineJoin = 'round'; g.lineWidth = 4;
  if (S.grad || !S.ribMatch) for (const p of pieces){ g.strokeStyle = fillOf(p); g.stroke(p.path); } // 2px colour bleed past every edge
  for (const p of pieces){ g.fillStyle = fillOf(p); g.fill(p.path); }
  if (PATTERN.stitches===false) return;
  g.save(); g.strokeStyle='rgba(0,0,0,0.18)'; g.lineWidth=1.6; g.setLineDash([5,4]);
  for (const id of ['front','back','sleeveR','sleeveL']){ if (!pieceById[id]) continue; const b = pieceById[id].box; for(const d of [2,2.6]){ g.beginPath(); g.moveTo(b[0],b[3]-d*PX); g.lineTo(b[2],b[3]-d*PX); g.stroke(); } }
  g.restore();
}
function ensureBase(){ const key = [S.fabric,S.grad,S.grad2,S.rib,S.ribMatch].join('|'); if (key !== baseKey){ baseKey = key; paintBase(bgx); } return key; }
function paintLayers(g, inside){
  g.save(); g.clip(allPieces);
  for (const L of S.layers){ if(!L.visible || !!L.inside!==inside) continue;
    if (!L.src) continue;
    g.save(); g.globalAlpha = L.opacity ?? 1;
    if (L.kind==='brush'){ g.drawImage(L.src, 0, 0); }
    else {
      const lp = pieceAt(L.x, L.y); if (lp) g.clip(lp.path); // artwork stays on the piece it sits on (no spill onto sheet neighbours)
      g.translate(L.x, L.y); g.rotate(L.rot*Math.PI/180);
      const sx = L.flipX ? -1 : 1, sy = L.flipY ? -1 : 1; if (sx!==1||sy!==1) g.scale(sx, sy);
      const w=L.w, h=L.w*L.aspect; g.drawImage(L.src,-w/2,-h/2,w,h);
    }
    g.restore(); }
  g.restore();
}
let washKey = null, washC = null;
function washOverlay(){ const key = [S.wash,S.washSize,S.washSeed,S.fabric].join('|');
  if (key !== washKey){ washKey = key; if (!washC){ washC = document.createElement('canvas'); washC.width = washC.height = TEX; }
    const tc = washC.getContext('2d'); tc.globalCompositeOperation = 'source-over'; tc.clearRect(0,0,TEX,TEX);
    tc.fillStyle = bleachOf(S.fabric); tc.fillRect(0,0,TEX+1,TEX+1); tc.globalCompositeOperation = 'destination-in'; tc.drawImage(washMask(S.wash, S.washSize, S.washSeed),0,0,TEX,TEX); }
  return washC; }
function paintWash(g){
  if (S.wash==='none' || S.washStr<=0) return;
  g.save(); g.clip(allPieces); g.globalAlpha = S.washStr; g.drawImage(washOverlay(),0,0); g.restore();
}
// composeSheet() only marks the sheet dirty; the frame loop composes at most once per frame, and only the side
// (outside / inside) whose inputs actually changed is repainted and re-uploaded to the GPU.
let composeDirty = true; const sideSig = [null, null];
function composeSheet(){ composeDirty = true; }
function composeNow(force){
  composeDirty = false;
  const bk = ensureBase(), wk = (S.wash==='none' || S.washStr<=0) ? '' : [S.wash,S.washSize,S.washSeed,S.washStr,S.washPrints].join('|');
  let changed = false;
  for (const [g, inside, i] of [[tg,false,0],[tgi,true,1]]){
    let sig = bk+'#'+wk+'#'+COVER.tris;
    for (const L of S.layers){ if (!L.visible || !!L.inside!==inside || !L.src) continue;
      sig += ';'+srcId(L.src)+'.'+(L.rev|0)+','+(L.opacity??1)+(L.kind==='brush' ? '' : ','+[L.x,L.y,L.w,L.rot,L.flipX?1:0,L.flipY?1:0,L.aspect].join(',')); }
    if (!force && sig === sideSig[i]) continue;
    sideSig[i] = sig; changed = true;
    g.globalCompositeOperation = 'copy'; g.drawImage(baseC,0,0); g.globalCompositeOperation = 'source-over';
    if (S.washPrints){ paintLayers(g, inside); paintWash(g); } else { paintWash(g); paintLayers(g, inside); }
    const t = inside ? insideTex : sheetTex; if (t) t.needsUpdate = true;
  }
  if (changed) invalidate();
  drawPattern();
}
const flushCompose = () => { if (composeDirty) composeNow(); };

// ---------- pattern view ----------
const pc = $('patternCanvas'), pg = pc.getContext('2d');
const PV = {k:1, ox:0, oy:0, inside:false, fitK:1, grid:true};
let TOOL = 'select'; // 'select' | 'pan'
function fitPattern(){
  const r = pc.getBoundingClientRect(); if(!r.width) return;
  const B = SHOWN.map(dispBox); const minX=Math.min(...B.map(b=>b[0])), minY=Math.min(...B.map(b=>b[1])), maxX=Math.max(...B.map(b=>b[2])), maxY=Math.max(...B.map(b=>b[3]));
  const aw = Math.max(60, r.width-PAD.l-PAD.r), ah = Math.max(60, r.height-PAD.t-PAD.b), k = Math.min(aw/(maxX-minX), ah/(maxY-minY));
  PV.k = PV.fitK = k; PV.ox = PAD.l + (aw-(maxX-minX)*k)/2 - minX*k; PV.oy = PAD.t + (ah-(maxY-minY)*k)/2 - minY*k;
  drawPattern();
}
function resizePattern(){ const r = pc.getBoundingClientRect(), d = devicePixelRatio||1; if (!r.width) return; pc.width = Math.max(1,r.width*d); pc.height = Math.max(1,r.height*d); layoutPieces(r.width, r.height); fitPattern(); drawPatternNow(); }
const toView = (x,y) => [x*PV.k+PV.ox, y*PV.k+PV.oy];
const toSheet = (x,y) => [(x-PV.ox)/PV.k, (y-PV.oy)/PV.k];
function layerCorners(L){ const h=L.w*L.aspect, a=L.rot*Math.PI/180, c=Math.cos(a), s=Math.sin(a);
  return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>[L.x+(u*L.w/2)*c-(v*h/2)*s, L.y+(u*L.w/2)*s+(v*h/2)*c]); }
function drawPattern(){ patDirty = true; }
function drawPatternNow(){
  patDirty = false;
  const d = devicePixelRatio||1, W = pc.width/d, H = pc.height/d; if (!W) return;
  pg.setTransform(d,0,0,d,0,0); pg.clearRect(0,0,W,H);
  const step = PX*PV.k;
  pg.fillStyle='rgba(217,228,210,0.07)'; if (PV.grid && step*5 > 8) for(let x=PV.ox%(step*5); x<W; x+=step*5) for(let y=PV.oy%(step*5); y<H; y+=step*5) pg.fillRect(x-0.75,y-0.75,1.5,1.5);
  pg.save(); pg.translate(PV.ox, PV.oy); pg.scale(PV.k, PV.k);
  const src = PV.inside ? texIn : tex;
  for (const p of SHOWN){
    pg.save(); pg.translate(p.dx, p.dy);
    pg.save(); pg.clip(p.path); pg.drawImage(src, p.box[0]-1, p.box[1]-1, p.box[2]-p.box[0]+2, p.box[3]-p.box[1]+2, p.box[0]-1, p.box[1]-1, p.box[2]-p.box[0]+2, p.box[3]-p.box[1]+2); pg.restore();
    pg.strokeStyle='rgba(255,255,255,0.22)'; pg.lineWidth=1/PV.k; pg.stroke(p.path);
    const cx=(p.box[0]+p.box[2])/2; pg.save(); pg.strokeStyle='rgba(255,255,255,0.28)'; pg.lineWidth=1/PV.k; pg.setLineDash([5/PV.k,4/PV.k]);
    pg.beginPath(); pg.moveTo(cx,p.box[1]+6); pg.lineTo(cx,p.box[3]-6); pg.stroke(); pg.restore();
    pg.restore();
  }
  pg.restore();
  // rulers
  pg.fillStyle='rgba(16,18,15,0.92)'; pg.fillRect(0,0,W,22); pg.fillRect(0,0,22,H);
  pg.fillStyle='#9aa294'; pg.strokeStyle='#4a5146'; pg.font='9.5px "JetBrains Mono", monospace'; pg.textAlign='center';
  const unit = (UNIT==='in' ? 25.4 : 25)*PX, minor = unit/5, rl = v => String(Math.round(UNIT==='in' ? v/PX/2.54 : UNIT==='mm' ? v/PX*10 : v/PX));
  for(let v=Math.ceil(-PV.ox/PV.k/unit)*unit; v*PV.k+PV.ox<W; v+=unit){ const x=v*PV.k+PV.ox; if (x>30) pg.fillText(rl(v), x, 12); }
  pg.beginPath(); for(let v=Math.ceil(-PV.ox/PV.k/minor)*minor; v*PV.k+PV.ox<W; v+=minor){ const x=Math.round(v*PV.k+PV.ox)+.5; pg.moveTo(x,17); pg.lineTo(x,22); } pg.stroke();
  pg.save(); pg.textAlign='center'; for(let v=Math.ceil(-PV.oy/PV.k/unit)*unit; v*PV.k+PV.oy<H; v+=unit){ const y=v*PV.k+PV.oy; if (y<30) continue; pg.save(); pg.translate(11,y); pg.rotate(-Math.PI/2); pg.fillText(rl(v),0,3); pg.restore(); } pg.restore();
  pg.fillStyle='rgba(16,18,15,0.92)'; pg.fillRect(0,0,22,22); pg.fillStyle='#9aa294'; pg.fillText(UNIT, 11, 14);
  pg.textAlign='center';
  const fit = (txt, maxW) => { if (pg.measureText(txt).width <= maxW) return txt; let t = txt; while (t.length > 3 && pg.measureText(t+'…').width > maxW) t = t.slice(0,-1); return t.trimEnd()+'…'; };
  for (const p of SHOWN){ const [w,h] = sizeCm(p); const db = dispBox(p); const [cx] = toView((db[0]+db[2])/2, 0); const [,by] = toView(0, db[3]);
    const maxW = Math.max(40, ((p.cell||0) + 5*PX)*PV.k), dim = `${fmtNum(w,0)} × ${fmtNum(h,h<10?1:0)} ${UNIT}`;
    pg.fillStyle='#e9ece4'; pg.font='600 11.5px "Familjen Grotesk", sans-serif'; pg.fillText(fit(p.label||p.id, maxW), cx, by+17);
    pg.fillStyle='#9aa294'; pg.font='10.5px "JetBrains Mono", monospace'; pg.fillText(fit(dim, maxW), cx, by+31); }
  { const z = Math.round(PV.k/PV.fitK*100)+'%'; const zo = $('zoomPct'); if (zo && zo.textContent !== z) zo.textContent = z; }
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
    pg.font='500 10.5px "JetBrains Mono", monospace'; const lab=`${fmtNum(L.w/PX)} × ${fmtNum(L.w*L.aspect/PX)} ${UNIT}`;
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
  $('placeText').setAttribute('aria-pressed', mode==='text'); $('placeImage').setAttribute('aria-pressed', mode==='image');
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
  if (e.button===1 || (TOOL==='pan' && !BRUSH.on && !placeMode)){ e.preventDefault(); pdrag={mode:'pan', x:vx, y:vy, ox:PV.ox, oy:PV.oy}; pc.style.cursor='grabbing'; pc.setPointerCapture(e.pointerId); return; }
  if (BRUSH.on){
    const hit = fromDisplay(dx,dy);
    if (!hit){ toast('Paint on a pattern piece'); return; }
    const L = ensureBrushLayer(PV.inside); if (!L) return;
    select(L.id);
    stampBrush(L, hit.sx, hit.sy, hit.p);
    pdrag = {mode:'brush', L, last:[hit.sx, hit.sy], piece:hit.p};
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
    if (TOOL==='pan'){ pc.style.cursor='grab'; return; }
    const sel = cur(), off = sel && sel.kind!=='brush' && offsetOf(sel);
    const rh = sel && !sel.locked && off && rotHandleOf(sel);
    if (rh && Math.hypot(rh[0]-vx, rh[1]-vy)<12){ pc.style.cursor='grab'; return; }
    const hit = fromDisplay(dx,dy); pc.style.cursor = hit && hitLayer(hit.sx,hit.sy,PV.inside)?'move':'grab'; return;
  }
  if (pdrag.mode==='brush'){
    const hit = fromDisplay(dx,dy);
    if (hit){ // crossing to another piece jumps elsewhere on the print sheet: stamp, don't drag a streak across it
      if (hit.p === pdrag.piece) strokeBrush(pdrag.L, pdrag.last[0], pdrag.last[1], hit.sx, hit.sy, hit.p); else stampBrush(pdrag.L, hit.sx, hit.sy, hit.p);
      pdrag.last=[hit.sx,hit.sy]; pdrag.piece=hit.p; composeSheet(); }
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
  const f = Math.exp(-e.deltaY*0.0015); const [sx,sy]=toSheet(vx,vy); PV.k = Math.min(PV.fitK*12, Math.max(PV.fitK*0.25, PV.k*f)); PV.ox = vx - sx*PV.k; PV.oy = vy - sy*PV.k; drawPattern(); }, {passive:false});
$('fitPattern').onclick = fitPattern;
for (const [id,v] of [['pOut',false],['pIn',true]]) $(id).onclick = ()=>{ PV.inside = v; $('pOut').setAttribute('aria-pressed', !v); $('pIn').setAttribute('aria-pressed', v); drawPattern(); };

// ---------- three.js stage ----------
const glc = $('gl'), pane = $('glPane');
const renderer = new THREE.WebGLRenderer({canvas:glc, antialias:true, alpha:true, preserveDrawingBuffer:false, powerPreference:'high-performance'});
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
function refreshGobo(){ goboTex.image = goboCanvas(); goboTex.needsUpdate = true; invalidate(); }

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
// Dead-zone repair: any mesh triangle whose UVs fall outside every traced outline becomes paintable too
// (it joins the clip region, so prints/brush land there and the base colour already covers it).
function repairCoverage(){
  const extra = new Path2D(); let n = 0, cm2 = 0;
  for (const m of shirtMeshes){ const g = m.geometry, idx = g.index ? g.index.array : null, uv = g.attributes.uv, cnt = idx ? idx.length : uv.count;
    for (let t=0; t<cnt; t+=3){ const i0 = idx?idx[t]:t, i1 = idx?idx[t+1]:t+1, i2 = idx?idx[t+2]:t+2;
      const u0=uv.getX(i0)*TEX, v0=uv.getY(i0)*TEX, u1=uv.getX(i1)*TEX, v1=uv.getY(i1)*TEX, u2=uv.getX(i2)*TEX, v2=uv.getY(i2)*TEX;
      if (pieceAt((u0+u1+u2)/3, (v0+v1+v2)/3)) continue;
      extra.moveTo(u0,v0); extra.lineTo(u1,v1); extra.lineTo(u2,v2); extra.closePath(); n++; cm2 += Math.abs((u1-u0)*(v2-v0)-(u2-u0)*(v1-v0))/2/(PX*PX); } }
  COVER.done = true; COVER.tris = n; COVER.cm2 = cm2;
  if (n){ allPieces.addPath(extra); COVER.path = extra; composeSheet(); }
  renderSpec();
}
const G3D = {w:0, h:0}; // draped garment size in cm (used by the size chart)
function renderSpec(){ if (!shirtMeshes.length) return;
  const tris = shirtMeshes.reduce((a,m)=>a+(m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count)/3,0);
  $('spec').innerHTML = `Garment <b>${G3D.w.toFixed(0)} × ${G3D.h.toFixed(0)} cm</b> as draped<br>Mesh <b>${(tris/1000).toFixed(0)}k triangles</b>, ${USER?'your CLO garment':'cloth-simulated'}, ${mainPieces().length} pattern pieces<br>Print sheet <b>${SHEET_CM} × ${SHEET_CM} cm · ${Math.floor(TEX)}px</b> (${PX} px/cm)`
    + (COVER.done ? `<br>Printable coverage <b>100%</b>${COVER.tris ? ` — ${COVER.cm2.toFixed(0)} cm² of untraced seam area auto-repaired` : ''}` : ''); }
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
  window.__dbg = {fabricMat, ribMat, shirtMeshes, scene, camera, renderer, THREE, controls, render};
  G3D.w = sz.x*100; G3D.h = sz.y*100; renderSpec();
  (window.requestIdleCallback || (f=>setTimeout(f,60)))(()=>{ try { repairCoverage(); } catch(e){ console.warn(e); } });
  resizeGL(); setCam('front', true); $('loading').hidden = true; invalidate(4); mark('garment');
};
const onGarmentErr = err => { $('loading').textContent = 'Could not load the garment file ('+G.glb+'). Open this folder through a local web server — see README.'; console.error(err); };
if (window.__GLB_B64 && GID==='raglan'){ const bin = Uint8Array.from(atob(window.__GLB_B64), c=>c.charCodeAt(0)); loader.parse(bin.buffer, '', onGarment, onGarmentErr); }
else loader.load(G.glb, onGarment, undefined, onGarmentErr);

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1,1,{samples:4, type:THREE.HalfFloatType}));
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, 1, 1);
gtao.updateGtaoMaterial({radius:0.07, distanceExponent:1.5, thickness:0.6, scale:1.1, samples:16});
gtao.updatePdMaterial({lumaPhi:10, depthPhi:2, normalPhi:3, radius:6, rings:2, samples:16});
gtao.blendIntensity = 1.0;
composer.addPass(gtao); composer.addPass(new OutputPass());

function resizeGL(){ const r = pane.getBoundingClientRect(); if(!r.width||!r.height) return;
  renderer.setSize(r.width, r.height, false); composer.setSize(r.width, r.height); camera.aspect = r.width/r.height; camera.updateProjectionMatrix(); invalidate(3); if (!userMoved && FIT.h && !camAnim && !turntable) setCam('front', true); }
const CAMS = { front:[0,0.04,1], back:[0,0.04,-1], side:[0.72,0.08,0.7] };
let camAnim = null, userMoved = false;
controls.addEventListener('start', ()=>{ userMoved = true; $('hint').hidden = true; });
function setCam(name, instant){ fitDist(); const to = new THREE.Vector3(...CAMS[name]).normalize().multiplyScalar(FIT.dist).add(new THREE.Vector3(0,FIT.cy,0));
  controls.target.set(0,FIT.cy,0);
  if (instant){ camera.position.copy(to); controls.update(); invalidate(); return; }
  camAnim = {from:camera.position.clone(), to, t:0};
  document.querySelectorAll('[data-cam]').forEach(b=>b.setAttribute('aria-pressed', b.dataset.cam===name)); }
document.querySelectorAll('[data-cam]').forEach(b=>b.onclick=()=>setCam(b.dataset.cam));
$('resetView').onclick = ()=>{ userMoved = false; setCam('front'); };
$('autoRot').onclick = ()=>{ controls.autoRotate = !controls.autoRotate; $('autoRot').setAttribute('aria-pressed', controls.autoRotate); };

// drag / paint directly on the 3D shirt (raycast → UV → sheet)
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let lastHover = 0;
function hitUV(e){ const r = glc.getBoundingClientRect(); ndc.set(((e.clientX-r.left)/r.width)*2-1, -((e.clientY-r.top)/r.height)*2+1);
  ray.setFromCamera(ndc, camera); const h = ray.intersectObjects(shirtMeshes, false)[0]; return h && h.uv ? [h.uv.x*TEX, h.uv.y*TEX] : null; }
let gdrag = null;
glc.addEventListener('pointerdown', e=>{
  const uv = hitUV(e); if(!uv) return;
  if (BRUSH.on){
    const L = ensureBrushLayer(false); if (!L) return;
    select(L.id); stampBrush(L, uv[0], uv[1], pieceAt(uv[0],uv[1]));
    gdrag = {mode:'brush', L, last:uv.slice(), piece:pieceAt(uv[0],uv[1])}; controls.enabled = false; glc.setPointerCapture(e.pointerId); composeSheet(); return;
  }
  const L = hitLayer(...uv, false); if(!L) return;
  select(L.id); if(L.locked) return;
  gdrag = {mode:'move', L, dx:uv[0]-L.x, dy:uv[1]-L.y}; controls.enabled = false; glc.setPointerCapture(e.pointerId);
}, true);
glc.addEventListener('pointermove', e=>{
  if(!gdrag){ if (e.buttons) return; const now = performance.now(); if (now-lastHover < 40) return; lastHover = now; const uv=hitUV(e); const hl = !BRUSH.on && uv ? hitLayer(...uv,false) : null; glc.style.cursor = BRUSH.on ? (uv?'crosshair':'grab') : (hl ? (hl.locked ? 'not-allowed' : 'move') : 'grab'); return; }
  const uv = hitUV(e); if(!uv) return;
  if (gdrag.mode==='brush'){ const p = pieceAt(uv[0],uv[1]); // a seam is a jump on the print sheet — never interpolate across it
    if (p === gdrag.piece && Math.hypot(uv[0]-gdrag.last[0], uv[1]-gdrag.last[1]) < 12*PX) strokeBrush(gdrag.L, gdrag.last[0], gdrag.last[1], uv[0], uv[1], p); else stampBrush(gdrag.L, uv[0], uv[1], p);
    gdrag.last=uv.slice(); gdrag.piece=p; composeSheet(); return; }
  // allow moving across pieces (front ↔ back ↔ sleeves) via UV
  gdrag.L.x = uv[0]-gdrag.dx; gdrag.L.y = uv[1]-gdrag.dy; composeSheet();
});
glc.addEventListener('pointerup', ()=>{ if(gdrag){ const was=gdrag; gdrag=null; controls.enabled = true; renderLayers(); commit(); } });
glc.addEventListener('dblclick', e=>{ const uv = hitUV(e); const L = cur(); if(uv && L && L.kind!=='brush' && !L.inside){ L.x=uv[0]; L.y=uv[1]; composeSheet(); renderLayers(); commit(); } });

let useAO = true, turntable = null, recMirror = null, recording = false;
// Quality: 'high' = fold shadows (AO) on every frame · 'fast' = never · 'adaptive' = AO on, but if the GPU cannot keep
// ~40 fps while the camera moves, skip the AO pass during motion and add it back on the first still frame.
let QUALITY = 'adaptive'; try { QUALITY = localStorage.getItem('fb-quality') || 'adaptive'; } catch(_){}
let liteMotion = false, slowFrames = 0, lastFrameT = 0, lastMoveT = 0, settled = true;
function render(lite){ if (useAO && QUALITY!=='fast' && !lite) composer.render(); else renderer.render(scene, camera); }
function loop(now){ requestAnimationFrame(loop);
  if (composeDirty) composeNow();
  if (patDirty) drawPatternNow();
  if (recording) return; // the turntable recorder drives its own frames
  if (camAnim){ camAnim.t = Math.min(1, camAnim.t+0.045); const k = 1-Math.pow(1-camAnim.t,3);
    const tgt = controls.target, a = camAnim.from.clone().sub(tgt), b = camAnim.to.clone().sub(tgt); const ra = a.length(), rb = b.length();
    const dir = a.normalize().lerp(b.normalize(), k); if (dir.lengthSq()<1e-6) dir.set(1,0,0); dir.normalize();
    camera.position.copy(dir.multiplyScalar(ra+(rb-ra)*k).add(tgt)); if(camAnim.t>=1) camAnim=null; invalidate(1); }
  let moved = false;
  if (turntable){ const t = Math.min(1,(performance.now()-turntable.t0)/turntable.ms); const a = t*Math.PI*2; moved = true;
    camera.position.set(Math.sin(a)*FIT.dist, FIT.cy+0.04*FIT.dist, Math.cos(a)*FIT.dist); camera.lookAt(0,FIT.cy,0); if(t>=1){ const d=turntable.done; turntable=null; d(); } }
  else moved = controls.update() || !!camAnim;
  if ($('stage').dataset.view==='pattern' && !recMirror) return; // 3D pane is collapsed
  if (moved){ // frame pacing while the camera moves decides whether AO is affordable in motion
    if (lastFrameT && now-lastFrameT < 200){ slowFrames = now-lastFrameT > 25 ? slowFrames+1 : Math.max(0, slowFrames-0.25); if (slowFrames > 10) liteMotion = true; }
    lastMoveT = now; settled = false; }
  else if (!settled && now-lastMoveT > 140){ settled = true; if (liteMotion) invalidate(1); }
  lastFrameT = moved ? now : 0;
  if (!moved && needRender <= 0 && !recMirror) return;
  if (needRender > 0) needRender--;
  rig.rotation.y = Math.atan2(camera.position.x, camera.position.z);
  render(QUALITY==='adaptive' && liteMotion && moved && !recMirror);
  if (recMirror && recMirror.paint){ try { recMirror.paint(); } catch(_){} }
}
// any control in the page may change the picture: redraw a few frames after every interaction
for (const t of ['input','change','click','keyup','pointerup']) addEventListener(t, ()=>invalidate(3), true);
if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', ()=>{ drawPattern(); });

// ---------- UI ----------
function select(id){ S.sel = id; const L = cur(); if (L && !!L.inside!==PV.inside) $(L.inside?'pIn':'pOut').click(); renderLayers(); drawPattern(); }
const thumbOf = L => {
  if (L.thumb) return L.thumb;
  const src = L.src; if (!src) return '';
  const t = document.createElement('canvas'); t.width = t.height = 72; const g = t.getContext('2d');
  let bg = '#e8e6e0';
  if (L.kind==='text' && /^#[0-9a-f]{6}$/i.test(L.color||'')){ const n = parseInt(L.color.slice(1),16); if ((((n>>16)&255)*0.3 + ((n>>8)&255)*0.59 + (n&255)*0.11) > 150) bg = '#2a2e28'; }
  g.fillStyle = bg; g.fillRect(0,0,72,72);
  try { const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height; if (w && h){ const k = Math.min(64/w, 64/h); g.drawImage(src, (72-w*k)/2, (72-h*k)/2, w*k, h*k); } return L.thumb = t.toDataURL(); }
  catch(_){ return src.src || ''; }
};
const LOCK_SVG = '<svg width="15" height="15" viewBox="0 0 16 16"><rect x="3.2" y="7" width="9.6" height="6.8" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
const UNLOCK_SVG = '<svg width="15" height="15" viewBox="0 0 16 16"><rect x="3.2" y="7" width="9.6" height="6.8" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.4-1" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
function toggleLock(L){ if (!L) { toast('Select a layer first'); return; } L.locked = !L.locked; if (L.locked){ pdrag = null; } toast(L.locked ? 'Locked — it will not move in 2D or 3D' : 'Unlocked'); renderLayers(); drawPattern(); commit(); }
function buildLayerRow(L){
  const row = document.createElement('div'); row.className='layer'; row.setAttribute('aria-selected', L.id===S.sel); row.tabIndex = 0;
  const eye = document.createElement('button'); eye.className='icon'; eye.title = L.visible?'Hide':'Show'; eye.setAttribute('aria-label', eye.title);
  eye.innerHTML = L.visible ? '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M1 8s2.6-5 7-5 7 5 7 5-2.6 5-7 5-7-5-7-5Z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2.2" fill="currentColor"/></svg>' : '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 2l12 12M1 8s2.6-5 7-5c1.3 0 2.5.4 3.4 1M15 8s-2.6 5-7 5c-1.3 0-2.5-.4-3.4-1" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
  eye.onclick = ev=>{ ev.stopPropagation(); L.visible=!L.visible; composeSheet(); renderLayers(); commit(); };
  const lk = document.createElement('button'); lk.className = 'icon' + (L.locked ? ' on' : ''); lk.title = L.locked ? 'Unlock layer' : 'Lock layer (cannot move in 2D / 3D)'; lk.setAttribute('aria-label', lk.title); lk.setAttribute('aria-pressed', !!L.locked); lk.innerHTML = L.locked ? LOCK_SVG : UNLOCK_SVG;
  lk.onclick = ev=>{ ev.stopPropagation(); toggleLock(L); };
  const th = document.createElement('div'); th.className='thumb'; th.style.backgroundImage = `url(${thumbOf(L)})`;
  const nm = document.createElement('div'); nm.className='nm'; nm.textContent = layerName(L); const sm = document.createElement('small'); sm.textContent = `${L.kind}${L.inside?' · inside':''}${L.locked?' · locked':''} · ${layerPiece(L)}`; nm.appendChild(sm);
  const del = document.createElement('button'); del.className='icon'; del.title='Delete layer'; del.setAttribute('aria-label','Delete layer');
  del.innerHTML = '<svg width="15" height="15" viewBox="0 0 16 16"><path d="M3 4h10M6.5 4V2.5h3V4M4.5 4l.7 9.5h5.6l.7-9.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
  del.onclick = ev=>{ ev.stopPropagation(); if(L.locked){ toast('Unlock the layer first'); return; } S.layers = S.layers.filter(l=>l!==L); if(S.sel===L.id) S.sel = S.layers.at(-1)?.id ?? null; composeSheet(); renderLayers(); commit(); };
  row.append(eye, lk, th, nm, del); row.onclick = ()=>select(L.id); row.onkeydown = ev=>{ if(ev.key==='Enter') select(L.id); };
  return row;
}
function renderLayers(){
  for (const box of [$('layers'), $('layersPopList')]){
    if (!box) continue; box.innerHTML = '';
    if (!S.layers.length){ box.innerHTML = '<p class="sub" style="margin:0">Nothing here yet. Add an image or text above.</p>'; }
    [...S.layers].reverse().forEach(L=> box.appendChild(buildLayerRow(L)));
  }
  const n = S.layers.length ? `${S.layers.length}` : '';
  $('layerCount').textContent = n; if ($('layerCountPop')) $('layerCountPop').textContent = n;
  syncLayerUI();
}
function setLayersPop(on){ const p = $('layersPop'); if (!p) return; p.hidden = !on; for (const id of ['railLayers','layers3d']) if ($(id)) $(id).setAttribute('aria-pressed', on); }
function syncLayerUI(){
  const L = cur(); { const on = !!(L && L.locked); for (const id of ['railLock','lock3d']){ const b = $(id); if (!b) continue; b.setAttribute('aria-pressed', on); b.classList.toggle('on', on); b.disabled = !L; b.style.opacity = L ? '' : '.45'; } if ($('lock3dT')) $('lock3dT').textContent = on ? 'Unlock' : 'Lock'; } $('layerEdit').hidden = !L; $('layerTools').hidden = !L; if(!L) return;
  $('textEdit').hidden = L.kind!=='text'; $('imgEdit').hidden = L.kind!=='image';
  if (L.kind==='image'){ $('bgRestore').hidden = !L.orig; $('bgTolRow').hidden = !L.orig; $('bgRemove').textContent = L.orig ? 'Background removed ✓' : 'Remove background'; $('bgRemove').disabled = !!L.orig; if (L.orig && L.bgTol){ $('bgTol').value = L.bgTol; $('bgTolO').textContent = L.bgTol; } }
  const isBrush = L.kind==='brush';
  if ($('lw')) $('lw').parentElement.hidden = isBrush;
  if ($('lr')) $('lr').parentElement.hidden = isBrush;
  if ($('movePieceRow')) $('movePieceRow').hidden = isBrush;
  if (L.kind==='text'){ if (document.activeElement!==$('textVal')) $('textVal').value = L.text.replace(/\n/g,' / '); $('textFont').value = L.font; $('textFont').style.fontFamily = `"${L.font}", sans-serif`; $('textColor').value = L.color; }
  if (!isBrush){
    $('lw').value = (L.w/PX).toFixed(1); $('lwo').textContent = fmtLen(L.w/PX);
    $('lr').value = L.rot; $('lro').textContent = `${Math.round(L.rot)}°`;
  }
  $('lop').value = Math.round((L.opacity??1)*100); $('lopO').textContent = `${Math.round((L.opacity??1)*100)}%`;
  $('lInside').checked = !!L.inside;
  $('lockLayer').textContent = L.locked ? 'Unlock' : 'Lock';
  if ($('movePiece') && !isBrush){
    const p = pieceAt(L.x,L.y);
    const sel = $('movePiece');
    if (sel.options.length !== SHOWN.length){ sel.innerHTML = '';
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
// ---------- remove image background ----------
// Runs in the browser, nothing is uploaded: the background is whatever is connected to the image border and close to
// the border's dominant colours. Great for logos / product shots on a plain backdrop; busy photos need a real cut-out.
function removeBackground(img, tol){
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height, k = Math.min(1, 2200/Math.max(w0,h0));
  const w = Math.max(1, Math.round(w0*k)), h = Math.max(1, Math.round(h0*k));
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', {willReadFrequently:true}); g.drawImage(img,0,0,w,h);
  const im = g.getImageData(0,0,w,h), d = im.data, N = w*h;
  // dominant border colours (4-bit bins)
  const bins = new Map(); let nb = 0;
  const addB = i => { if (d[i*4+3] < 16) return; const key = (d[i*4]>>4)<<8 | (d[i*4+1]>>4)<<4 | (d[i*4+2]>>4); let b = bins.get(key); if (!b){ b = [0,0,0,0]; bins.set(key,b); } b[0]+=d[i*4]; b[1]+=d[i*4+1]; b[2]+=d[i*4+2]; b[3]++; nb++; };
  for (let x=0;x<w;x++){ addB(x); addB((h-1)*w+x); } for (let y=1;y<h-1;y++){ addB(y*w); addB(y*w+w-1); }
  const refs = [...bins.values()].sort((a,b)=>b[3]-a[3]).filter((b,i)=> i===0 || b[3] > nb*0.06).slice(0,5).map(b=>[b[0]/b[3], b[1]/b[3], b[2]/b[3]]);
  const t2 = tol*tol*3, soft = t2*2.2;
  const dist = i => { if (d[i*4+3] < 16) return 0; let m = Infinity; const r = d[i*4], gg = d[i*4+1], b = d[i*4+2]; for (const f of refs){ const e = (r-f[0])**2+(gg-f[1])**2+(b-f[2])**2; if (e<m) m = e; } return m; };
  const mask = new Uint8Array(N), q = new Int32Array(N); let qh = 0, qt = 0;
  const push = i => { if (!mask[i] && dist(i) <= t2){ mask[i] = 1; q[qt++] = i; } };
  if (refs.length){ for (let x=0;x<w;x++){ push(x); push((h-1)*w+x); } for (let y=0;y<h;y++){ push(y*w); push(y*w+w-1); } }
  while (qh < qt){ const i = q[qh++], x = i%w; if (x>0) push(i-1); if (x<w-1) push(i+1); if (i>=w) push(i-w); if (i<N-w) push(i+w); }
  let removed = 0;
  for (let i=0;i<N;i++){ if (mask[i]){ d[i*4+3] = 0; removed++; continue; }
    const x = i%w; // soften the cut: edge pixels still tinted by the background fade out instead of leaving a halo
    if ((x>0 && mask[i-1]) || (x<w-1 && mask[i+1]) || (i>=w && mask[i-w]) || (i<N-w && mask[i+w])){ const e = dist(i); if (e < soft) d[i*4+3] = Math.round(d[i*4+3]*Math.max(0.15, (e-t2)/(soft-t2))); } }
  g.putImageData(im,0,0);
  return {canvas:c, ratio: removed/N};
}
function applyBgRemoval(){ const L = cur(); if (!L || L.kind!=='image' || L.locked) return;
  const orig = L.orig || L.src, tol = +$('bgTol').value;
  let res; try { res = removeBackground(orig, tol); } catch(err){ toast('Could not read this image'); return; }
  if (res.ratio < 0.01){ toast('No plain background found — try a higher tolerance'); if (!L.orig) return; }
  if (res.ratio > 0.985){ toast('That would erase the whole image — lower the tolerance'); return; }
  L.orig = orig; L.bgTol = tol; L.src = res.canvas; L.rev = (L.rev|0)+1; L.thumb = null;
  composeSheet(); renderLayers(); commit(); }
$('bgRemove').onclick = ()=>{ const L = cur(); if (L && L.locked){ toast('Unlock the layer first'); return; } applyBgRemoval(); };
$('bgTol').oninput = e=>{ $('bgTolO').textContent = e.target.value; };
$('bgTol').onchange = ()=>{ const L = cur(); if (L && L.orig) applyBgRemoval(); };
$('bgRestore').onclick = ()=>{ const L = cur(); if (!L || !L.orig || L.locked) return; L.src = L.orig; L.orig = null; L.rev = (L.rev|0)+1; L.thumb = null; composeSheet(); renderLayers(); commit(); };
$('flipV').onclick = ()=>{ const L=cur(); if(!L||L.locked) return; L.flipY = !L.flipY; composeSheet(); renderLayers(); commit(); };
$('dupLayer').onclick = ()=>{ const L=cur(); if(!L) return; if(!ensureLayerRoom()) return; const N = cloneLayer(L); select(N.id); if(N.kind==='text') rebuildText(N).then(()=>{composeSheet();renderLayers();commit();}); composeSheet(); renderLayers(); commit(); };
$('lockLayer').onclick = ()=> toggleLock(cur());
for (const id of ['railLock','lock3d']) if ($(id)) $(id).onclick = ()=> toggleLock(cur());
for (const id of ['railLayers','layers3d']) if ($(id)) $(id).onclick = ()=> setLayersPop($('layersPop').hidden);
if ($('layersPopClose')) $('layersPopClose').onclick = ()=> setLayersPop(false);
$('layerUp').onclick = ()=>{ const L=cur(); if(!L) return; const i=S.layers.indexOf(L); if(i<S.layers.length-1){ S.layers.splice(i,1); S.layers.splice(i+1,0,L); composeSheet(); renderLayers(); commit(); } };
$('layerDown').onclick = ()=>{ const L=cur(); if(!L) return; const i=S.layers.indexOf(L); if(i>0){ S.layers.splice(i,1); S.layers.splice(i-1,0,L); composeSheet(); renderLayers(); commit(); } };
$('addText').onclick = ()=>{ if(!ensureLayerRoom()) return; setBrushMode(false); const f = pieceById.front.box; const L = addText('YOUR TEXT', (f[0]+f[2])/2, f[1]+24*PX, 20); select(L.id);
  rebuildText(L).then(()=>{ composeSheet(); renderLayers(); commit(); }); composeSheet(); commit(); };
$('addImage').onclick = ()=>{ if(!ensureLayerRoom()) return; setBrushMode(false); pendingPlace = null; $('file').click(); };
if ($('brushTool')) $('brushTool').onclick = ()=> setBrushMode(!BRUSH.on);
if ($('brushColor')){ $('brushColor').value = BRUSH.color; $('brushColor').oninput = e=>{ BRUSH.color = e.target.value; }; }
if ($('brushSize')){ $('brushSize').value = BRUSH.sizeCm; $('brushSizeO').textContent = fmtLen(BRUSH.sizeCm);
  $('brushSize').oninput = e=>{ BRUSH.sizeCm = +e.target.value; $('brushSizeO').textContent = fmtLen(BRUSH.sizeCm); }; }
if ($('brushOp')){ $('brushOp').value = Math.round(BRUSH.opacity*100); $('brushOpO').textContent = Math.round(BRUSH.opacity*100)+'%';
  $('brushOp').oninput = e=>{ BRUSH.opacity = +e.target.value/100; $('brushOpO').textContent = Math.round(BRUSH.opacity*100)+'%'; }; }
if ($('brushHard')){ $('brushHard').value = Math.round(BRUSH.hardness*100); $('brushHardO').textContent = Math.round(BRUSH.hardness*100)+'%';
  $('brushHard').oninput = e=>{ BRUSH.hardness = +e.target.value/100; $('brushHardO').textContent = Math.round(BRUSH.hardness*100)+'%'; }; }
if ($('brushEraser')) $('brushEraser').onclick = ()=>{ BRUSH.eraser = !BRUSH.eraser; $('brushEraser').setAttribute('aria-pressed', BRUSH.eraser); };
if ($('brushClear')) $('brushClear').onclick = ()=>{
  const L = cur() && cur().kind==='brush' ? cur() : [...S.layers].reverse().find(l=>l.kind==='brush' && !!l.inside===PV.inside);
  if (!L){ toast('No brush layer to clear'); return; }
  L.src.getContext('2d').clearRect(0,0,TEX,TEX); L.thumb=null; L.rev=(L.rev|0)+1; composeSheet(); renderLayers(); commit();
};
if ($('movePiece')) $('movePiece').onchange = e=>{ const L=cur(); if(L) moveLayerToPiece(L, e.target.value); };
if ($('moveFront')) $('moveFront').onclick = ()=>{ const L=cur(); if(L) moveLayerToPiece(L, 'front'); };
if ($('moveBack')) $('moveBack').onclick = ()=>{ const L=cur(); if(L) moveLayerToPiece(L, 'back'); };
addEventListener('keydown', e=>{
  if (e.target.matches('input,textarea,select')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key==='b' || e.key==='B'){ setBrushMode(!BRUSH.on); }
  if (e.key==='v' || e.key==='V'){ $('toolSelect').click(); }
  if (e.key==='h' || e.key==='H'){ $('toolPan').click(); }
  if (e.key==='t' || e.key==='T'){ $('placeText').click(); }
  if (e.key==='e' || e.key==='E'){ if (BRUSH.on){ BRUSH.eraser=!BRUSH.eraser; if($('brushEraser')) $('brushEraser').setAttribute('aria-pressed', BRUSH.eraser); } }
  if (e.key==='[' && BRUSH.on){ BRUSH.sizeCm = Math.max(0.2, +(BRUSH.sizeCm-0.2).toFixed(1)); if($('brushSize')){ $('brushSize').value=BRUSH.sizeCm; $('brushSizeO').textContent=fmtLen(BRUSH.sizeCm); } }
  if (e.key===']' && BRUSH.on){ BRUSH.sizeCm = Math.min(8, +(BRUSH.sizeCm+0.2).toFixed(1)); if($('brushSize')){ $('brushSize').value=BRUSH.sizeCm; $('brushSizeO').textContent=fmtLen(BRUSH.sizeCm); } }
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
  return {version:1, garment:GID, sizeChart: SC.edited ? {source:SC.source, base:SC.baseSize, rows:SC.rows} : null, fabric:S.fabric, grad:S.grad, grad2:S.grad2, rib:S.rib, ribMatch:S.ribMatch, wash:S.wash, washStr:S.washStr, washSize:S.washSize, washPrints:S.washPrints, washSeed:S.washSeed, bg:S.bg, layers, sel:S.sel, uid};
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
  if (data.sizeChart && data.sizeChart.rows && (!data.garment || data.garment===GID)){ SC.source = data.sizeChart.source; SC.baseSize = data.sizeChart.base; SC.rows = data.sizeChart.rows; SC.edited = true; }
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
  const pad=40; const c=document.createElement('canvas'); c.width=Math.ceil(maxX-minX+pad*2); c.height=Math.ceil(maxY-minY+pad*2+wmFooter(c.width));
  const g=c.getContext('2d'); g.fillStyle='#10120f'; g.fillRect(0,0,c.width,c.height); g.translate(pad-minX, pad-minY);
  for (const p of SHOWN){ g.save(); g.translate(p.dx,p.dy); g.save(); g.clip(p.path); g.drawImage(tex,0,0); g.restore();
    g.strokeStyle='rgba(255,255,255,.25)'; g.lineWidth=1; g.stroke(p.path); g.restore(); }
  return withWatermarkCanvas(c);
}
async function exportPatternPng(){
  const c = await buildPatternPngCanvas();
  const blob = await canvasBlob(c); showModal({img:URL.createObjectURL(blob), blob, name:'pattern-sheet.png', txt:'2D sewing-pattern sheet with your prints.'});
}
$('exportPattern').onclick = ()=>{ flushCompose(); exportPatternPng(); };

function pathToSvgD(p){
  const pts = p.pts; if (!pts.length) return '';
  return pts.map((pt,i)=> (i?'L':'M')+pt[0].toFixed(2)+','+pt[1].toFixed(2)).join(' ') + ' Z';
}
async function exportPatternSvg(){
  const B = SHOWN.map(dispBox); const minX=Math.min(...B.map(b=>b[0])), minY=Math.min(...B.map(b=>b[1])), maxX=Math.max(...B.map(b=>b[2])), maxY=Math.max(...B.map(b=>b[3]));
  const pad=40; const W=Math.ceil(maxX-minX+pad*2), H=Math.ceil(maxY-minY+pad*2+wmFooter(W));
  const sheetUrl = tex.toDataURL('image/png');
  let body = '';
  for (const p of SHOWN){
    const d = pathToSvgD(p);
    const tx = (p.dx + pad - minX).toFixed(2), ty = (p.dy + pad - minY).toFixed(2);
    body += `<g transform="translate(${tx},${ty})"><clipPath id="c-${p.id}"><path d="${d}"/></clipPath><image href="${sheetUrl}" width="${TEX}" height="${TEX}" clip-path="url(#c-${p.id})"/><path d="${d}" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1"/></g>`;
  }
  body += wmSvg(W, H);
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
  g.font='700 40px "Familjen Grotesk", sans-serif'; g.fillText('Stylooks — Tech pack', 60, 84);
  g.font='18px "JetBrains Mono", monospace'; g.fillStyle='#555'; g.fillText(`${G.name} · ${G.sub} · ${new Date().toISOString().slice(0,10)} · units: cm`, 60, 118);
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
let _zipLoad = null;
const loadJSZip = () => window.JSZip ? Promise.resolve() : (_zipLoad ||= new Promise((res,rej)=>{ const sc = document.createElement('script'); sc.src = 'assets/vendor/jszip.min.js'; sc.onload = res; sc.onerror = ()=>{ _zipLoad = null; rej(new Error('zip')); }; document.head.appendChild(sc); }));
async function zipOf(files){ try { await loadJSZip(); } catch(_){} if (!window.JSZip) { toast('ZIP library did not load. Check your connection and try again.'); return null; }
  const z = new JSZip(); for (const [n,b] of files) z.file(n, b); return z.generateAsync({type:'blob'}); }

// the GL canvas is not preserved between frames: copy it in the same task as the render
const snapGL = () => { const c = document.createElement('canvas'); c.width = glc.width; c.height = glc.height; c.getContext('2d').drawImage(glc,0,0); return c; };
async function capture3dPng({mode='catalogue'}={}){
  flushCompose();
  const pr = renderer.getPixelRatio();
  const prevClear = renderer.getClearColor(new THREE.Color()).getHex();
  const prevAlpha = renderer.getClearAlpha();
  const prevBg = scene.background;
  const bdVisible = backdrop.visible;
  const prevAutoClear = renderer.autoClear;
  try {
    if (mode === 'catalogue'){
      renderer.setPixelRatio(Math.min(devicePixelRatio,2)*2); resizeGL(); render();
      const shot = snapGL(), c = await withWatermarkCanvas(shot);
      const blob = await canvasBlob(c);
      return {blob, w: shot.width, h: shot.height, name:'catalogue-render.png', txt:`Catalogue render at ${shot.width/2}×${shot.height/2}px ×2.`};
    }
    if (mode === 'dark'){
      renderer.setPixelRatio(Math.min(devicePixelRatio,2)*2); resizeGL();
      backdrop.visible = false; scene.background = new THREE.Color('#141613');
      renderer.setClearColor('#141613', 1); render();
      const c = await withWatermarkCanvas(snapGL());
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
    renderer.setPixelRatio(pr); resizeGL(); invalidate(4);
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

async function recordTurntableInner(){
  if (!requirePro('Turntable video')) return;
  if (!window.MediaRecorder){ toast('Video recording is not supported in this browser.'); return; }
  const savedPos = camera.position.clone();
  const savedTarget = controls.target.clone();
  const wasAuto = $('autoRot')?.getAttribute('aria-pressed') === 'true';
  if (wasAuto) $('autoRot').click();
  const prevEnabled = controls.enabled; controls.enabled = false; recording = true; flushCompose();

  const fps = 24, seconds = 5, total = fps * seconds; // ~5s turntable
  fitDist();
  const mirror = document.createElement('canvas');
  mirror.width = glc.width || 640; mirror.height = glc.height || 720;
  mirror.style.cssText = 'position:fixed;left:-9999px;top:0;pointer-events:none;';
  document.body.appendChild(mirror);
  let mctxLive = mirror.getContext('2d', { alpha: false });
  const stream = mirror.captureStream(0);
  const vtrack = stream.getVideoTracks()[0];
  // MP4 (H.264) plays everywhere (Facebook, Instagram, iPhone); fall back to WebM where the browser cannot record MP4.
  const mime = ['video/mp4;codecs=avc1.42E01E','video/mp4;codecs=avc1','video/mp4','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(m=>MediaRecorder.isTypeSupported(m)) || '';
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
  controls.enabled = prevEnabled; recording = false; invalidate(4);
  showRecProgress(false);

  const blobType = (mime && mime.startsWith('video/')) ? mime.split(';')[0] : 'video/webm';
  const blob = new Blob(chunks, {type: blobType});
  if (!blob.size){ toast('Recording produced an empty file — try Chrome/Edge'); return; }
  const ext = /mp4/.test(mime||'') ? 'mp4' : 'webm';
  download(blob, `turntable.${ext}`);
  showModal({video:URL.createObjectURL(blob), blob, name:`turntable.${ext}`, txt:`5-second 360° turntable · ${total} frames · ${(blob.size/1024).toFixed(0)} KB. Camera restored.`});
}

async function recordTurntable(){ try { await recordTurntableInner(); } finally { if (recording){ recording = false; controls.enabled = true; showRecProgress(false); invalidate(4); } } }
// several trims share a label ("Neck tape" ×8): keep file names unique so none is overwritten inside the ZIP
const _labelN = {}; pieces.forEach(p=>{ _labelN[p.label] = (_labelN[p.label]||0)+1; });
const pieceFile = p => (_labelN[p.label] > 1 ? `${p.label} (${p.id})` : p.label).replace(/[\\/:*?"<>|]+/g,'-');
const EXPORTS = {
  async catalogue(){ const r = await capture3dPng({mode:'catalogue'}); showModal({img:URL.createObjectURL(r.blob), blob:r.blob, name:r.name, txt:r.txt}); },
  async snapDark(){ const r = await capture3dPng({mode:'dark'}); showModal({img:URL.createObjectURL(r.blob), blob:r.blob, name:r.name, txt:r.txt}); },
  async snapClear(){ const r = await capture3dPng({mode:'clear'}); showModal({img:URL.createObjectURL(r.blob), blob:r.blob, name:r.name, txt:r.txt}); },
  async patternPng(){ await exportPatternPng(); },
  async patternSvg(){ await exportPatternSvg(); },
  async print(){ const files = [];
    for (const p of pieces){ files.push([`pieces/${pieceFile(p)}.png`, await canvasBlob(pieceCanvas(p))]); if (S.layers.some(l=>l.inside&&l.visible&&pieceAt(l.x,l.y)===p)) files.push([`pieces/${pieceFile(p)} (inside).png`, await canvasBlob(pieceCanvas(p,0,true))]); }
    for (const L of S.layers.filter(l=>l.visible)){ const c=document.createElement('canvas'); c.width=L.src.width; c.height=L.src.height; c.getContext('2d').drawImage(L.src,0,0); files.push([`prints/${layerName(L).replace(/[^\w\- ]+/g,'').slice(0,40)||'print'}-${L.id}.png`, await canvasBlob(c)]); }
    const spec = specSheet(); files.push(['spec-sheet.png', await canvasBlob(spec)]);
    files.push(['size-chart.csv', new Blob([scCsv()], {type:'text/csv'})]); files.push(['size-chart.png', await canvasBlob(scPngCanvas())]);
    const blob = await zipOf(files); if (!blob) return; download(blob, 'print-files.zip');
    showModal({img:spec.toDataURL(), blob, name:'print-files.zip', txt:`Print files: ${files.length} files (pieces, prints and this spec sheet) in one ZIP.`}); },
  async sublimation(){ const files = []; for (const p of pieces) files.push([`${pieceFile(p)} — 1cm bleed.png`, await canvasBlob(pieceCanvas(p,1))]);
    const blob = await zipOf(files); if (!blob) return; download(blob, 'sublimation-panels.zip');
    showModal({img:pieceCanvas(pieceById.front,1).toDataURL(), blob, name:'sublimation-panels.zip', txt:`${files.length} full panels with 1 cm bleed at ${PX} px/cm (≈ 41 dpi preview scale; scale up in your RIP).`}); },
  async spec(){ const c = specSheet(); const blob = await canvasBlob(c); showModal({img:c.toDataURL(), blob, name:'spec-sheet.png', txt:'Spec sheet with print sizes and positions.'}); },
  async turntable(){ await recordTurntable(); },
  async sizeChart(){ openSizeChart(); },
};
$('exportBtn').onclick = e=>{ e.stopPropagation(); const m=$('exportMenu'); m.hidden = !m.hidden; $('exportBtn').setAttribute('aria-expanded', !m.hidden); };
document.addEventListener('click', e=>{ if(!e.target.closest('.menuwrap')){ $('exportMenu').hidden = true; $('exportBtn').setAttribute('aria-expanded', false); if($('accountMenu')){ $('accountMenu').hidden = true; $('accountBtn')?.setAttribute('aria-expanded', false); } if($('garmentMenu')){ $('garmentMenu').hidden = true; $('garmentBtn').setAttribute('aria-expanded', false); } } });
document.querySelectorAll('[data-exp]').forEach(b=>b.onclick = ()=>{ $('exportMenu').hidden = true; flushCompose(); EXPORTS[b.dataset.exp]().catch(err=>{ console.error(err); toast('Export failed: '+err.message); }); });
$('snap').onclick = async ()=>{ const r = await capture3dPng({mode:'catalogue'}); showModal({img:URL.createObjectURL(r.blob), blob:r.blob, name:'3d-snapshot.png', txt:r.txt}); };

// ---------- Invite gate, account, (hidden) pricing, designs ----------
let gateMode = 'request';

function openLanding(){
  if (!AuthService.requiresGate()){ $('landing').hidden = true; return; }
  $('landing').hidden = false; syncGateView();
}
function closeLanding(){
  if (AuthService.requiresGate() && !AuthService.isApproved()){ openLanding(); return; }
  $('landing').hidden = true;
}
function openAuth(){ openLanding(); setGateMode('login'); }
function closeAuth(){ if ($('authModal')) $('authModal').hidden = true; }
function openPricing(){
  if (!AuthService.PAYMENTS_VISIBLE){ toast('Access is invite-only for now. Currently free — pricing may change later.'); return; }
  $('pricingModal').hidden = false;
  if ($('paySoon')) $('paySoon').hidden = true;
}
function closePricing(){ $('pricingModal').hidden = true; }

function setGateMode(mode){
  gateMode = mode === 'login' ? 'login' : 'request';
  if ($('gateTabRequest')) $('gateTabRequest').setAttribute('aria-pressed', gateMode==='request');
  if ($('gateTabLogin')) $('gateTabLogin').setAttribute('aria-pressed', gateMode==='login');
  if ($('gateNameRow')) $('gateNameRow').hidden = gateMode!=='request';
  if ($('gateSubmit')) $('gateSubmit').textContent = gateMode==='request' ? 'Send request · שליחת בקשה' : 'Continue · כניסה';
  if ($('gateError')) $('gateError').textContent = '';
}

function showGatePanel(which){
  const form = $('gateForm'), pend = $('gatePending'), rej = $('gateRejected'), tabs = $('gateTabs'), rev = $('gateRevoked');
  if (form) form.hidden = which !== 'form';
  if (tabs) tabs.hidden = AuthService.BETA_GATE || which !== 'form';
  if (pend) pend.hidden = which !== 'pending';
  if (rej) rej.hidden = which !== 'rejected';
  if (rev) rev.hidden = which !== 'revoked';
}

function syncGateView(){
  const u = AuthService.getUser();
  if (!AuthService.requiresGate() || AuthService.isApproved()){ $('landing').hidden = true; return; }
  $('landing').hidden = false;
  const reason = AuthService.getState().reason;
  if (reason === 'revoked'){
    showGatePanel('revoked');
  } else if (!AuthService.BETA_GATE && u?.status === 'pending'){
    if ($('gatePendingEmail')) $('gatePendingEmail').textContent = u.email;
    showGatePanel('pending');
  } else if (!AuthService.BETA_GATE && u?.status === 'rejected'){
    showGatePanel('rejected');
  } else {
    showGatePanel('form');
    if (u?.email && $('gateEmail') && !$('gateEmail').value) $('gateEmail').value = u.email;
  }
}

async function enterIfApproved(){
  refreshPlanUI();
  if (AuthService.isApproved()){
    closeLanding();
    toast('Welcome — you’re in');
    return true;
  }
  syncGateView();
  return false;
}

$('gateTabRequest') && ($('gateTabRequest').onclick = ()=>{ showGatePanel('form'); setGateMode('request'); });
$('gateTabLogin') && ($('gateTabLogin').onclick = ()=>{ showGatePanel('form'); setGateMode('login'); });
$('landingOpen') && ($('landingOpen').onclick = ()=> closeLanding());
$('pickFree') && ($('pickFree').onclick = ()=> closeLanding());
$('landingAuth') && ($('landingAuth').onclick = ()=> setGateMode('login'));
$('pickPro') && ($('pickPro').onclick = ()=> openPricing());

$('upgradeBtn') && ($('upgradeBtn').onclick = ()=> openPricing());
$('accountBtn').onclick = e=>{ e.stopPropagation(); const m=$('accountMenu'); m.hidden = !m.hidden; $('accountBtn').setAttribute('aria-expanded', !m.hidden); $('exportMenu').hidden = true; };
$('accSignIn').onclick = ()=>{ $('accountMenu').hidden = true; if (AuthService.isApproved()) toast(AuthService.getUser().email); else openLanding(); };
$('accPricing') && ($('accPricing').onclick = ()=>{ $('accountMenu').hidden = true; openPricing(); });
$('accLogout').onclick = ()=>{ AuthService.logout(); refreshPlanUI(); openLanding(); toast('Logged out'); $('accountMenu').hidden = true; };
$('accDesigns').onclick = ()=>{ $('accountMenu').hidden = true; openDesigns(); };

$('gateForm') && ($('gateForm').onsubmit = async ev=>{
  ev.preventDefault();
  if ($('gateError')) $('gateError').textContent = '';
  const email = $('gateEmail').value;
  const name = $('gateName') ? $('gateName').value : '';
  const code = $('gateCode') ? $('gateCode').value : '';
  const btn = $('gateSubmit');
  if (btn) btn.disabled = true;
  try {
    if (AuthService.BETA_GATE){
      await AuthService.redeemCode({ email, code });
      await enterIfApproved();
    } else if (gateMode === 'login'){
      try {
        await AuthService.login({ email });
        await enterIfApproved();
      } catch (err) {
        if (err.code === 'pending'){ syncGateView(); return; }
        if (err.code === 'rejected'){ syncGateView(); return; }
        throw err;
      }
    } else {
      await AuthService.requestAccess({ email, name });
      if (!(await enterIfApproved())){
        if (AuthService.getUser()?.status === 'pending'){
          toast('Request sent — waiting for approval');
        }
      }
    }
  } catch (err) {
    if ($('gateError')) $('gateError').textContent = err.message;
  } finally {
    if (btn) btn.disabled = false;
  }
});
$('gateCheckAgain') && ($('gateCheckAgain').onclick = async ()=>{
  try {
    const email = AuthService.getUser()?.email || $('gateEmail').value;
    await AuthService.login({ email });
    await enterIfApproved();
  } catch (err) {
    if (err.code === 'pending'){ toast('Still pending / עדיין ממתין לאישור'); syncGateView(); }
    else if (err.code === 'rejected') syncGateView();
    else if ($('gateError')) { showGatePanel('form'); $('gateError').textContent = err.message; }
  }
});
$('gateTryAgain') && ($('gateTryAgain').onclick = ()=>{
  const email = AuthService.getUser()?.email || '';
  AuthService.logout();
  showGatePanel('form');
  setGateMode('request');
  if ($('gateEmail') && email) $('gateEmail').value = email;
});
$('gateNewCode') && ($('gateNewCode').onclick = ()=>{
  AuthService.logout();
  showGatePanel('form');
  if ($('gateError')) $('gateError').textContent = '';
  if ($('gateCode')) $('gateCode').value = '';
});
if ($('gateCode')){
  $('gateCode').addEventListener('input', ev=>{
    ev.target.value = ev.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  });
}

// Legacy auth modal (kept in DOM, unused in invite mode)
if ($('authTabIn')) $('authTabIn').onclick = ()=> setGateMode('login');
if ($('authTabUp')) $('authTabUp').onclick = ()=> setGateMode('request');
if ($('authCancel')) $('authCancel').onclick = ()=> closeAuth();
if ($('authSubmit')) $('authSubmit').onclick = async ()=>{
  $('authError').textContent = '';
  try {
    await AuthService.requestAccess({email:$('authEmail').value, name:$('authName').value});
    closeAuth();
    await enterIfApproved();
  } catch(err){ $('authError').textContent = err.message; }
};
if ($('pricingClose')) $('pricingClose').onclick = ()=> closePricing();
if ($('subscribeBtn')) $('subscribeBtn').onclick = ()=>{ $('paySoon').hidden = false; toast('Payments coming later'); };
if ($('redeemBtn')) $('redeemBtn').onclick = ()=> toast('Access is invite-only for now');

function openDesigns(){
  if (!AuthService.isApproved()){ openLanding(); return; }
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


async function handleDecideLink(){
  const m = String(location.hash||'').match(/^#decide\/(approve|reject)\/([0-9a-f]{32,})$/i);
  if (!m) return;
  try { history.replaceState(null, '', location.pathname + location.search); } catch(_){}
  try {
    const res = await fetch(AuthService.SUPABASE_URL + '/functions/v1/decide', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Accept':'application/json' },
      body: JSON.stringify({ token: m[2], action: m[1].toLowerCase() }),
    });
    const data = await res.json().catch(()=>({}));
    const approved = data.status === 'approved';
    const who = data.name ? `${data.name} (${data.email||''})` : (data.email || '');
    if ($('decideTitle')) $('decideTitle').textContent = approved ? 'Access approved' : (data.ok ? 'Request declined' : 'Could not update this request');
    if ($('decideBody')) $('decideBody').textContent = approved
      ? `${who} can now enter Fashion Builder with this email.`
      : (data.ok ? `${who} will see a short message if they check their status.` : (data.error || 'Please try the link again.'));
    if ($('decideBodyHe')) $('decideBodyHe').textContent = approved
      ? `${who} יכול/ה להיכנס עכשיו עם אותו אימייל.`
      : (data.ok ? `הבקשה של ${who} נדחתה.` : 'לא ניתן לעדכן את הבקשה.');
    if ($('decideModal')) $('decideModal').hidden = false;
  } catch (err) {
    if ($('decideTitle')) $('decideTitle').textContent = 'Could not update this request';
    if ($('decideBody')) $('decideBody').textContent = err.message || 'Network error';
    if ($('decideModal')) $('decideModal').hidden = false;
  }
}
$('decideClose') && ($('decideClose').onclick = ()=> { $('decideModal').hidden = true; });

// ---------- pattern tools · zoom · units · trims ----------
function setTool(t){ TOOL = t; $('toolSelect').setAttribute('aria-pressed', t==='select'); $('toolPan').setAttribute('aria-pressed', t==='pan'); pc.style.cursor = 'grab'; }
$('toolSelect').onclick = ()=>{ setBrushMode(false); pendingImage = null; setPlaceMode(null); setTool('select'); };
$('toolPan').onclick = ()=>{ if (TOOL==='pan'){ setTool('select'); return; } setBrushMode(false); pendingImage = null; setPlaceMode(null); setTool('pan'); };
$('railBrush').onclick = ()=>{ setTool('select'); setBrushMode(!BRUSH.on); };
function zoomBy(f){ const r = pc.getBoundingClientRect(), vx = r.width/2, vy = r.height/2, [sx,sy] = toSheet(vx,vy);
  PV.k = Math.min(PV.fitK*12, Math.max(PV.fitK*0.25, PV.k*f)); PV.ox = vx - sx*PV.k; PV.oy = vy - sy*PV.k; drawPattern(); }
$('zoomIn').onclick = ()=> zoomBy(1.25); $('zoomOut').onclick = ()=> zoomBy(0.8);
$('gridT').onclick = ()=>{ PV.grid = !PV.grid; $('gridT').setAttribute('aria-pressed', PV.grid); drawPattern(); };
function setUnit(u){ UNIT = u; try { localStorage.setItem('fb-unit', u); } catch(_){}
  document.querySelectorAll('[data-unit]').forEach(b=>b.setAttribute('aria-pressed', b.dataset.unit===u));
  if ($('brushSizeO')) $('brushSizeO').textContent = fmtLen(BRUSH.sizeCm); syncLayerUI(); drawPattern(); }
document.querySelectorAll('[data-unit]').forEach(b=>{ b.onclick = ()=> setUnit(b.dataset.unit); b.setAttribute('aria-pressed', b.dataset.unit===UNIT); });
$('trimsT').onclick = ()=>{ showTrims = !showTrims; $('trimsT').setAttribute('aria-pressed', showTrims); { const r = pc.getBoundingClientRect(); layoutPieces(r.width, r.height); }
  $('pcCount').textContent = `${SHOWN.length} pieces`; fitPattern(); syncLayerUI();
  if (showTrims) toast('Showing trims: inner hems and cuffs, facings, neck tapes'); };

// ---------- garment picker · render quality ----------
$('gName').textContent = G.name; $('gSub').textContent = G.sub; if ($('fabricGarment')) $('fabricGarment').textContent = G.name; if ($('fabricSub')) $('fabricSub').textContent = G.sub;
{ const gm = $('garmentMenu');
  for (const [id,g] of Object.entries(GARMENTS)){ const b = document.createElement('button'); b.setAttribute('role','menuitemradio'); b.setAttribute('aria-checked', id===GID);
    const t = document.createElement('b'); t.textContent = g.name; const d = document.createElement('span'); d.textContent = g.sub; b.append(t, d);
    b.onclick = ()=>{ gm.hidden = true; if (id===GID) return;
      if (hist.length > 1 && !confirm('Switch garment? Unsaved changes to this design will be lost.')) return;
      const u = new URL(location.href); if (id==='raglan') u.searchParams.delete('g'); else u.searchParams.set('g', id); location.href = u.toString(); };
    gm.appendChild(b); }
  const more = document.createElement('p'); more.className = 'sub'; more.textContent = 'More garments are on the way.'; gm.appendChild(more);
  $('garmentBtn').onclick = e=>{ e.stopPropagation(); gm.hidden = !gm.hidden; $('garmentBtn').setAttribute('aria-expanded', !gm.hidden); $('exportMenu').hidden = true; $('accountMenu').hidden = true; }; }
$('quality').value = QUALITY;
$('quality').onchange = e=>{ QUALITY = e.target.value; try { localStorage.setItem('fb-quality', QUALITY); } catch(_){} liteMotion = false; slowFrames = 0; invalidate(3); };

// ---------- size chart (graded spec for the factory) ----------
// Widths are flat, edge to edge (half measurements), as a factory QC table expects. Every cell stays editable.
const SIZES = ['XS','S','M','L','XL','2XL','3XL'];
const POMS = [
  {c:'A', n:'Chest width',        he:'רוחב חזה',                  how:'2.5 cm below the armhole, edge to edge',            grade:5,   tol:1},
  {c:'B', n:'Bottom hem width',   he:'רוחב מכפלת תחתונה',         how:'Edge to edge at the hem',                           grade:5,   tol:1},
  {c:'C', n:'Body length (HPS)',  he:'אורך גוף מנקודת כתף גבוהה', how:'High point shoulder straight down to the hem',      grade:2.5, tol:1.5},
  {c:'D', n:'Centre back length', he:'אורך גב מרכזי',             how:'Back neck seam to the hem, along centre back',      grade:2.5, tol:1.5},
  {c:'E', n:'Sleeve length',      he:'אורך שרוול',                how: G.sleeve==='raglan' ? 'Neck seam to sleeve hem, along the top fold (raglan)' : 'Shoulder seam to sleeve hem, along the top fold', grade:1.5, tol:1},
  {c:'F', n:'Sleeve opening',     he:'פתח שרוול',                 how:'Edge to edge at the sleeve hem',                    grade:1,   tol:0.5},
  {c:'G', n:'Upper arm width',    he:'רוחב זרוע עליונה',          how:'2.5 cm below the armhole, square to the top fold',  grade:1,   tol:0.5},
  {c:'H', n:'Neck width',         he:'רוחב צווארון',              how:'Seam to seam, straight across',                     grade:0.5, tol:0.5},
  {c:'I', n:'Front neck drop',    he:'עומק צווארון קדמי',         how:'From the HPS line down to the front neck seam',     grade:0.3, tol:0.3},
  {c:'J', n:'Back neck drop',     he:'עומק צווארון אחורי',        how:'From the HPS line down to the back neck seam',      grade:0,   tol:0.3},
  {c:'K', n:'Neck rib height',    he:'גובה ריב צווארון',          how:'Finished height of the neck rib',                   grade:0,   tol:0.2},
  {c:'L', n:'Hem height',         he:'גובה מכפלת',                how:'Finished height of the hem / hem band',             grade:0,   tol:0.2},
  {c:'M', n:'Sleeve hem height',  he:'גובה מכפלת שרוול',          how:'Finished height of the sleeve hem / cuff',          grade:0,   tol:0.2},
];
const RAG = G.sleeve==='raglan';
const SC_PRESETS = {
  classic:   {base:'M', v:{A:51, B:51, C:73.5, D:71,   E:RAG?36:21,   F:18,   G:20.5, H:18.5, I:9.5, J:2.5, K:2,   L:2.5, M:2.5}, grade:{}},
  oversized: {base:'M', v:{A:58, B:58, C:74,   D:71.5, E:RAG?39.5:24, F:20.5, G:24,   H:19.5, I:9.5, J:2.5, K:2.2, L:2.5, M:2.5}, grade:{A:4, B:4, C:2, D:2}},
};
const SC = {source:'pattern', base:null, baseSize:'M', rows:null, auto:{}, edited:false, unit:'cm'};
function chordAt(p, y){ let lo = Infinity, hi = -Infinity; const pts = p.pts, n = pts.length;
  for (let i=0;i<n;i++){ const [x0,y0] = pts[i], [x1,y1] = pts[(i+1)%n]; if (y0===y1 || (y0-y)*(y1-y) > 0) continue; const x = x0+(x1-x0)*(y-y0)/(y1-y0); if (x<lo) lo = x; if (x>hi) hi = x; }
  return hi > lo ? hi-lo : 0; }
function stripHeight(p){ // mean width of a (possibly curved) strip = area / half its perimeter, in px
  let per = 0, ar = 0; const pts = p.pts, n = pts.length; for (let i=0;i<n;i++){ const [x0,y0] = pts[i], [x1,y1] = pts[(i+1)%n]; per += Math.hypot(x1-x0,y1-y0); ar += x0*y1-x1*y0; }
  return per ? Math.abs(ar)/per : 0; }
// Measure the flat pattern (true cm: each piece carries its own cm-per-UV scale).
function measurePattern(){
  const m = {}, sc = p => pieceScale(p)/PX, W = p => (p.box[2]-p.box[0])*sc(p), H = p => (p.box[3]-p.box[1])*sc(p);
  const find = re => pieces.find(p=>re.test(p.label||'') && !/inner/i.test(p.label||''));
  const f = pieceById.front, b = pieceById.back, hemF = find(/^Hem band.*front/i), hemB = find(/^Hem band.*back/i), cuff = find(/cuff/i);
  if (f){ const h = f.box[3]-f.box[1]; let maxW = 0; const rows = [];
    for (let i=1;i<80;i++){ const y = f.box[1]+h*i/80, w = chordAt(f,y); rows.push([y,w]); if (w>maxW) maxW = w; }
    const arm = rows.find(r=>r[1] >= maxW*0.97) || rows[rows.length>>1]; // armhole level = first full-width row from the top
    m.A = (chordAt(f, Math.min(f.box[3]-2, arm[0]+2.5/sc(f))) || maxW)*sc(f);
    m.B = (chordAt(f, f.box[3]-h*0.02) || maxW)*sc(f); }
  if (hemF){ m.B = W(hemF); m.L = H(hemF); }
  if (b) m.D = H(b) + (hemB ? H(hemB) : 0);
  if (G3D.h) m.C = G3D.h; // garment height as draped on the hanger: HPS to hem
  const sF = pieceById.sleeveR || pieceById.sleeveL, sB = pieceById.sleeveRb || pieceById.sleeveLb;
  if (sF){ const parts = [sF, sB].filter(Boolean); m.E = H(sF) + (cuff ? H(cuff) : 0);
    const bottom = parts.reduce((a,p)=>a + chordAt(p, p.box[3]-(p.box[3]-p.box[1])*0.03)*sc(p), 0);
    const widest = parts.reduce((a,p)=>{ let w = 0; const h = p.box[3]-p.box[1]; for (let i=1;i<40;i++) w = Math.max(w, chordAt(p, p.box[1]+h*i/40)); return a + w*sc(p); }, 0);
    const gus = pieces.find(p=>/facing/i.test(p.label||'') && !p.minor); // underarm strip sewn between the two sleeve halves
    m.F = cuff ? W(cuff)/2 : bottom/2; m.G = (widest + (sB && gus ? Math.min(W(gus), H(gus)) : 0))/2; }
  if (cuff) m.M = H(cuff);
  const ribF = pieceById.rib, ribB = find(/^Neck rib.*back/i);
  if (ribF){ const k = stripHeight(ribF)*sc(ribF);
    if (W(ribF) < 6*H(ribF)){ m.K = k; m.H = Math.max(W(ribF), ribB ? W(ribB) : 0); m.I = Math.max(0.5, H(ribF)-k); if (ribB) m.J = Math.max(0.5, H(ribB)-stripHeight(ribB)*sc(ribB)); } // curved (U-shaped) rib piece
    else m.K = Math.min(W(ribF), H(ribF)) / (PATTERN.source==='user' ? 1 : 2); } // straight strip (cut double, folded)
  if (!m.H && f){ const top = f.pts.filter(q=>q[1] < f.box[1]+0.6*PX); if (top.length > 1) m.H = (Math.max(...top.map(q=>q[0]))-Math.min(...top.map(q=>q[0])))*sc(f); }
  return m;
}
const scNearestSize = chest => { let best = 2, d = Infinity; SIZES.forEach((_,i)=>{ const e = Math.abs(chest-(51+5*(i-2))); if (e<d){ d = e; best = i; } }); return SIZES[best]; };
const SC_DETECT = () => { try { const a = measurePattern().A; return a ? scNearestSize(a) : 'M'; } catch(_){ return 'M'; } };
const r1 = v => Math.round(v*10)/10;
function scBuild(){
  let baseVals, baseSize, grades = {}; SC.auto = {};
  if (SC.source === 'pattern'){ const m = measurePattern(), pre = SC_PRESETS.classic; baseSize = SC.base || scNearestSize(m.A || 51); const bi = SIZES.indexOf(baseSize); baseVals = {};
    for (const P of POMS){ if (m[P.c] > 0){ baseVals[P.c] = m[P.c]; SC.auto[P.c] = true; } else baseVals[P.c] = pre.v[P.c] + P.grade*(bi-SIZES.indexOf(pre.base)); } }
  else { const pre = SC_PRESETS[SC.source]; baseSize = pre.base; baseVals = pre.v; grades = pre.grade; }
  const bi = SIZES.indexOf(baseSize);
  SC.rows = POMS.map(P=>{ const g = grades[P.c] ?? P.grade; return {c:P.c, grade:g, tol:P.tol, v:SIZES.map((_,i)=> Math.max(0.5, r1(baseVals[P.c] + g*(i-bi))))}; });
  SC.baseSize = baseSize; SC.edited = false;
}
const scStoreKey = 'fb-sizechart-v1-'+GID;
function scSave(){ SC.edited = true; try { localStorage.setItem(scStoreKey, JSON.stringify({source:SC.source, base:SC.baseSize, rows:SC.rows})); } catch(_){} }
function scEnsure(){ if (SC.rows) return;
  try { const o = JSON.parse(localStorage.getItem(scStoreKey) || 'null'); if (o && Array.isArray(o.rows) && o.rows.length === POMS.length){ SC.source = o.source || 'pattern'; SC.baseSize = o.base || 'M'; SC.base = SC.baseSize; SC.rows = o.rows; SC.edited = true; return; } } catch(_){}
  scBuild(); }
const inFrac = cm => { const e = Math.round(cm/2.54*8), w = Math.floor(e/8), f = e%8; if (!f) return String(w); const d = f%4===0 ? [f/4,2] : f%2===0 ? [f/2,4] : [f,8]; return (w ? w+' ' : '')+d[0]+'/'+d[1]; };
const scFmt = cm => SC.unit==='in' ? inFrac(cm) : (Math.round(cm*10)/10).toString();
function scRender(){
  scEnsure();
  const t = $('scTable'), bi = SIZES.indexOf(SC.baseSize), ro = SC.unit==='in';
  $('scSource').value = SC.source; $('scBaseRow').hidden = SC.source !== 'pattern';
  if (!$('scBase').options.length) for (const z of SIZES){ const o = document.createElement('option'); o.value = o.textContent = z; $('scBase').appendChild(o); }
  $('scBase').value = SC.baseSize; $('scCm').setAttribute('aria-pressed', !ro); $('scIn').setAttribute('aria-pressed', ro);
  t.innerHTML = '';
  const head = t.createTHead().insertRow();
  for (const [h, cls] of [['',''],['Point of measure','pom'], ...SIZES.map((z,i)=>[z, i===bi?'base':'']), ['Tol ±','tol'], ['Grade','tol']]){ const th = document.createElement('th'); th.textContent = h; if (cls) th.className = cls; th.scope = 'col'; head.appendChild(th); }
  const body = t.createTBody();
  SC.rows.forEach((R, ri)=>{ const P = POMS[ri], tr = body.insertRow();
    const code = tr.insertCell(); code.className = 'code'; code.textContent = P.c;
    const pm = tr.insertCell(); pm.className = 'pom'; const nb = document.createElement('b'); nb.textContent = P.n; const he = document.createElement('span'); he.dir = 'rtl'; he.textContent = P.he;
    const how = document.createElement('small'); how.textContent = P.how; pm.append(nb, he, how); if (SC.source==='pattern' && SC.auto[P.c]) pm.classList.add('auto');
    const cell = (val, cls, onset, label) => { const td = tr.insertCell(); if (cls) td.className = cls;
      if (ro){ td.textContent = scFmt(val); return; }
      const inp = document.createElement('input'); inp.type = 'number'; inp.step = '0.1'; inp.min = '0'; inp.value = r1(val); inp.setAttribute('aria-label', `${P.n}, ${label}`);
      inp.onchange = ()=>{ const v = parseFloat(inp.value); if (!isFinite(v) || v < 0){ inp.value = r1(val); return; } onset(r1(v)); scSave(); scRender(); };
      td.appendChild(inp); };
    R.v.forEach((v, i)=> cell(v, i===bi ? 'base' : '', nv => { if (i===bi){ const d = nv-R.v[bi]; R.v = R.v.map(x=>Math.max(0.1, r1(x+d))); } else R.v[i] = nv; }, 'size '+SIZES[i]));
    cell(R.tol, 'tol', nv => { R.tol = nv; }, 'tolerance');
    cell(R.grade, 'tol', nv => { R.grade = nv; R.v = R.v.map((_,i)=>Math.max(0.1, r1(R.v[bi]+nv*(i-bi)))); }, 'grade per size');
  });
  const det = SC.source==='pattern';
  $('scNote').textContent = det
    ? `${G.name}: the pattern on the table is cut as size ${SC.baseSize} (chest ${scFmt(SC.rows[0].v[bi])} ${SC.unit==='in'?'in':'cm'} flat). The other sizes are graded from it.`
    : `Standard men's crew-neck tee, ${SC.source==='classic'?'classic':'oversized'} fit — not measured from this pattern.`;
  scDrawDiagram($('scDiagram').getContext('2d'), 320, 300, '#d9e4d2', '#f2c14e', '#1b1e1a');
}
// flat sketch with the measurement letters
function scDrawDiagram(g, w, h, ink, accent, paper){
  const d = g.canvas === $('scDiagram') ? (devicePixelRatio||1) : 1;
  if (g.canvas === $('scDiagram')){ g.canvas.width = w*d; g.canvas.height = h*d; g.setTransform(d,0,0,d,0,0); g.clearRect(0,0,w,h); }
  g.save(); g.scale(w/320, h/300); g.lineJoin = 'round'; g.lineCap = 'round';
  g.strokeStyle = ink; g.lineWidth = 1.6; g.beginPath();
  g.moveTo(130,44); g.quadraticCurveTo(160,70,190,44); g.lineTo(248,64); g.lineTo(296,116); g.lineTo(266,138); g.lineTo(236,108); g.lineTo(236,276); g.lineTo(84,276); g.lineTo(84,108); g.lineTo(54,138); g.lineTo(24,116); g.lineTo(72,64); g.closePath(); g.stroke();
  g.lineWidth = 1; g.globalAlpha = 0.55; g.beginPath(); g.moveTo(130,44); g.quadraticCurveTo(160,54,190,44); g.moveTo(84,264); g.lineTo(236,264); g.moveTo(30,121); g.lineTo(60,143); g.moveTo(290,121); g.lineTo(260,143);
  if (RAG){ g.moveTo(130,44); g.quadraticCurveTo(104,84,84,108); g.moveTo(190,44); g.quadraticCurveTo(216,84,236,108); } else { g.moveTo(72,64); g.lineTo(84,108); g.moveTo(248,64); g.lineTo(236,108); }
  g.stroke(); g.globalAlpha = 1;
  const dim = (x0,y0,x1,y1,letter,lx,ly) => { g.strokeStyle = accent; g.fillStyle = accent; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x0,y0); g.lineTo(x1,y1); g.stroke();
    const a = Math.atan2(y1-y0,x1-x0); for (const [x,y,s] of [[x0,y0,1],[x1,y1,-1]]){ g.beginPath(); g.moveTo(x,y); g.lineTo(x+s*5*Math.cos(a-0.5), y+s*5*Math.sin(a-0.5)); g.moveTo(x,y); g.lineTo(x+s*5*Math.cos(a+0.5), y+s*5*Math.sin(a+0.5)); g.stroke(); }
    const cx = lx ?? (x0+x1)/2, cy = ly ?? (y0+y1)/2; g.beginPath(); g.arc(cx,cy,8.5,0,Math.PI*2); g.fillStyle = accent; g.fill(); g.fillStyle = paper; g.font = '700 10.5px "Familjen Grotesk", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(letter, cx, cy+0.5); };
  dim(86,126,234,126,'A',144,126); dim(86,252,234,252,'B',144,252); dim(130,46,130,274,'C',130,176); dim(176,52,176,274,'D',176,208);
  if (RAG) dim(198,36,300,106,'E',254,62); else dim(254,56,300,106,'E',284,76);
  dim(304,124,274,146,'F',300,146); dim(84,108,56,82,'G',62,100); dim(130,30,190,30,'H'); dim(160,44,160,57,'I',160,72);
  g.restore(); g.textBaseline = 'alphabetic';
}
function scCsv(){ scEnsure(); const q = v => { v = String(v); return /[",\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v; }, u = SC.unit==='in' ? 'inch' : 'cm';
  const L = [['Stylooks — size chart', G.name, G.sub, new Date().toISOString().slice(0,10)], ['Units', u, 'Garment laid flat. Widths are edge to edge (half measurements).'],
    ['Base size', SC.baseSize, SC.source==='pattern' ? 'Measured from the pattern, other sizes graded' : 'Standard '+SC.source+' fit'], [],
    ['Code','Point of measure','נקודת מדידה','How to measure', ...SIZES, 'Tolerance ±','Grade per size']];
  SC.rows.forEach((R,i)=> L.push([R.c, POMS[i].n, POMS[i].he, POMS[i].how, ...R.v.map(scFmt), scFmt(R.tol), scFmt(R.grade)]));
  return '﻿' + L.map(r=>r.map(q).join(',')).join('\r\n') + '\r\n'; }
function scPngCanvas(){ scEnsure(); const W = 2000, rowH = 62, top = 250, H = top + rowH*(POMS.length+1) + 150, c = document.createElement('canvas'); c.width = W; c.height = Math.max(H, 1180); const g = c.getContext('2d');
  g.fillStyle = '#fbfaf7'; g.fillRect(0,0,W,c.height); g.fillStyle = '#16130c'; g.font = '700 44px "Familjen Grotesk", Arial, sans-serif'; g.fillText('Size chart', 60, 92);
  g.font = '20px "JetBrains Mono", monospace'; g.fillStyle = '#555'; const u = SC.unit==='in' ? 'inch' : 'cm';
  g.fillText(`${G.name} · ${G.sub} · ${new Date().toISOString().slice(0,10)} · units: ${u} · base size ${SC.baseSize}`, 60, 132);
  g.fillText('Garment laid flat. Widths are edge to edge (half measurements). Tolerances are ± per measurement.', 60, 164);
  const x0 = 60, cw = 108, xs = 60+470, bi = SIZES.indexOf(SC.baseSize), xt = xs + cw*SIZES.length;
  g.fillStyle = '#efece3'; g.fillRect(x0, top-rowH+18, xt+cw*2-x0, rowH-10); g.fillStyle = 'rgba(242,193,78,.35)'; g.fillRect(xs+cw*bi, top-rowH+18, cw, rowH*(POMS.length+1)-10);
  g.fillStyle = '#16130c'; g.font = '700 21px "Familjen Grotesk", Arial, sans-serif'; g.fillText('Point of measure', x0+52, top-8); g.textAlign = 'center';
  SIZES.forEach((z,i)=> g.fillText(z, xs+cw*i+cw/2, top-8)); g.fillText('Tol ±', xt+cw/2, top-8); g.fillText('Grade', xt+cw*1.5, top-8);
  SC.rows.forEach((R, i)=>{ const y = top + rowH*(i+1) - 22, P = POMS[i]; g.strokeStyle = '#d9d4c6'; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y+22.5); g.lineTo(xt+cw*2, y+22.5); g.stroke();
    g.textAlign = 'center'; g.fillStyle = '#16130c'; g.font = '700 22px "Familjen Grotesk", Arial, sans-serif'; g.fillText(P.c, x0+22, y);
    g.textAlign = 'left'; g.font = '600 21px "Familjen Grotesk", Arial, sans-serif'; g.fillText(P.n, x0+52, y-8); g.font = '14px "JetBrains Mono", monospace'; g.fillStyle = '#666'; g.fillText(P.how.length > 50 ? P.how.slice(0,49)+'…' : P.how, x0+52, y+13);
    g.textAlign = 'center'; g.fillStyle = '#16130c'; g.font = '20px "JetBrains Mono", monospace'; R.v.forEach((v,k)=> g.fillText(scFmt(v), xs+cw*k+cw/2, y)); g.fillStyle = '#555'; g.fillText(scFmt(R.tol), xt+cw/2, y); g.fillText(scFmt(R.grade), xt+cw*1.5, y); });
  g.textAlign = 'left'; g.save(); g.translate(1530, 250); scDrawDiagram(g, 420, 394, '#16130c', '#b9801a', '#fbfaf7'); g.restore();
  g.fillStyle = '#555'; g.font = '16px "JetBrains Mono", monospace'; ['K  neck rib height', 'L  hem height', 'M  sleeve hem height'].forEach((t,i)=> g.fillText(t, 1560, 690+i*26));
  drawWatermark(g, W, c.height); return c; }
function openSizeChart(){ if (!SC.edited) SC.rows = null; scRender(); $('sizeModal').hidden = false; }
$('sizeChartBtn').onclick = openSizeChart;
$('scClose').onclick = ()=>{ $('sizeModal').hidden = true; };
$('sizeModal').addEventListener('click', e=>{ if (e.target === $('sizeModal')) $('sizeModal').hidden = true; });
addEventListener('keydown', e=>{ if (e.key==='Escape' && !$('sizeModal').hidden) $('sizeModal').hidden = true; });
$('scSource').onchange = e=>{ SC.source = e.target.value; SC.base = null; scBuild(); try { localStorage.removeItem(scStoreKey); } catch(_){} scRender(); };
$('scBase').onchange = e=>{ SC.base = e.target.value; scBuild(); scSave(); scRender(); };
$('scCm').onclick = ()=>{ SC.unit = 'cm'; scRender(); }; $('scIn').onclick = ()=>{ SC.unit = 'in'; scRender(); };
$('scReset').onclick = ()=>{ SC.base = null; SC.source = 'pattern'; try { localStorage.removeItem(scStoreKey); } catch(_){} scBuild(); scRender(); toast('Size chart reset to the pattern'); };
$('scCsv').onclick = ()=> download(new Blob([scCsv()], {type:'text/csv;charset=utf-8'}), `size-chart-${GID}.csv`);
$('scPng').onclick = async ()=> download(await canvasBlob(scPngCanvas()), `size-chart-${GID}.png`);
$('scCopy').onclick = async ()=>{ scEnsure(); const tsv = [['Code','Point of measure', ...SIZES, 'Tol ±','Grade'], ...SC.rows.map((R,i)=>[R.c, POMS[i].n, ...R.v.map(scFmt), scFmt(R.tol), scFmt(R.grade)])].map(r=>r.join('\t')).join('\n');
  try { await navigator.clipboard.writeText(tsv); toast('Copied — paste into Excel or Google Sheets'); } catch(_){ toast('Could not copy. Use Download CSV instead.'); } };

AuthService.onChange(()=> { refreshPlanUI(); if (AuthService.requiresGate() && !AuthService.isApproved()) openLanding(); });
refreshPlanUI();
setGateMode('request');
// The editor boots immediately; the server-side access check runs in parallel (it used to block the first frame).
if (AuthService.requiresGate() && AuthService.getUser()) $('landing').classList.add('checking');
if (!AuthService.requiresGate()) $('landing').hidden = true;
else $('landing').hidden = false;
(async ()=>{
  try { await AuthService.init(); } catch(_){}
  $('landing').classList.remove('checking');
  refreshPlanUI();
  if (!AuthService.requiresGate() || AuthService.isApproved()) $('landing').hidden = true; else openLanding();
  await handleDecideLink();
})();

// ---------- boot with a sample design ----------
$('pcCount').textContent = `${SHOWN.length} pieces`; $('garmentName').textContent = `${G.name} · ${SHOWN.length} pieces`;
new ResizeObserver(()=>{ resizeGL(); resizePattern(); }).observe($('stage'));
for (const o of $('textFont').options) o.style.fontFamily = `"${o.value}", sans-serif`; // faces download only when used
{
  const f = pieceById.front.box, b = pieceById.back.box, sl = pieceById.sleeveL.box;
  const fx = (f[0]+f[2])/2, bx = (b[0]+b[2])/2;
  addText('BUILT.\nNOT\nGENERATED.', fx, f[1]+27*PX, 25, {font:'Permanent Marker', color:'#efece3', rot:-4});
  addText('FB', (sl[0]+sl[2])/2+4*PX, sl[1]+14*PX, 4.5, {font:'Bebas Neue', color:'#efece3', rot:0});
  addText(`FASHION BUILDER\n${SC_DETECT()}  ·  100% COTTON`, bx, b[1]+6.5*PX, 9, {font:'Anton', color:'#1b1b1b', inside:true});
  S.sel = S.layers[0].id;
}
setFabric(S.fabric); setBg(S.bg); applyMaterial(); renderLayers(); resizeGL(); resizePattern(); commit(); mark('boot'); loop();
// Web fonts arrive after the first frame: re-rasterise the text layers once their faces are in.
Promise.all(['Permanent Marker','Bebas Neue','Anton'].map(ensureFont)).then(()=>{
  for (const L of S.layers) if (L.kind==='text') textBitmap(L);
  composeSheet(); renderLayers(); if (hist.length <= 1){ hist.length = 0; commit(); }
});
try {
  window.__FB = {
    grantLocalTestAccess: (email) => { AuthService.grantLocalTestAccess(email); refreshPlanUI(); closeLanding(); },
    getS: () => S, getLayers: () => S.layers, pieceById, pieces: () => pieces, SHOWN: () => SHOWN, COVER, GID, removeBackground, addImage, sizeChart: () => SC, measurePattern, sheetCanvas: () => tex,
    TEX, PX, BRUSH, PV, pieceAt, fromDisplay, toView, toSheet, hitLayer, composeSheet: () => { composeNow(); drawPatternNow(); }, select, addText, ensureBrushLayer,
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
