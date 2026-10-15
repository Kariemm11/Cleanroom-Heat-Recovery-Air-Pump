/* Clean-room test rig — 3D scene, HMI and control wiring.
   World units are centimetres: x along the 1.0 m box (−50 … +50, partition at 0),
   y up (0 … 50), z across (−25 … +25, front face at +25).
   The plant room (x < 0) holds the AHU and the parallel heat-recovery air-pump unit
   exactly as in the earlier model; the clean room is x > 0. */
(function(){
"use strict";
if(!window.THREE){document.querySelector('.legend').insertAdjacentHTML('beforeend','<p class="sub" style="margin-top:8px">3D library could not load.</p>');return;}

/* Stale-cache guard. GitHub Pages lets browsers keep files for up to 10 minutes, so right after an update
   an old cached page can meet this newer script (or the other way round) and the scene fails to start.
   The page names the build it belongs to; on a mismatch, load it once more under a fresh URL. */
var BUILD='2026-10-15e';
var appEl=document.getElementById('app'), pageBuild=appEl?appEl.getAttribute('data-build'):null;
if(pageBuild!==BUILD){
  var q=new URLSearchParams(location.search);
  if(q.get('b')!==BUILD){ q.set('b',BUILD); location.replace(location.pathname+'?'+q.toString()+location.hash); return; }
  // a fresh load still brought an older page: say so instead of failing half-way
  var lg=document.querySelector('.legend');
  if(lg) lg.insertAdjacentHTML('beforeend','<p class="sub" style="margin-top:8px;color:var(--bad)">This page is an older cached copy. '+
    'Press Ctrl+Shift+R (Cmd+Shift+R on a Mac) to load the latest version.</p>');
  return;
}

/* ---------------------------------------------------------------- tokens */
var css = getComputedStyle(document.documentElement);
function tok(n){ return css.getPropertyValue(n).trim(); }
function col(n){ return new THREE.Color(tok(n)); }
var T = {};
function readTokens(){
  css = getComputedStyle(document.documentElement);
  T.fresh=col('--fresh'); T.ret=col('--return'); T.mix=col('--mix'); T.refrig=col('--refrig');
  T.scene=col('--scene'); T.floor=col('--floor'); T.metal=col('--metal');
  T.metalDark=col('--metal-dark'); T.glass=col('--glass'); T.ink=tok('--ink');
  T.panel=tok('--panel-solid'); T.inkDim=tok('--ink-dim');
  T.acrylic=col('--acrylic'); T.pcb=col('--pcb'); T.copper=col('--copper');
  T.sigIn=col('--sig-in'); T.sigOut=col('--sig-out'); T.contam=col('--contam');
  T.tCold=col('--t-cold'); T.tMid=col('--t-mid'); T.tHot=col('--t-hot');
  T.good=tok('--good'); T.warn=tok('--warn'); T.bad=tok('--bad');
  T.dark = document.documentElement.getAttribute('data-theme')==='dark' ||
    (document.documentElement.getAttribute('data-theme')!=='light' &&
     window.matchMedia('(prefers-color-scheme:dark)').matches);
}
readTokens();

/* ------------------------------------------------------------- renderer  */
var canvas = document.getElementById('scene');
var stage  = document.getElementById('stage');
var renderer = new THREE.WebGLRenderer({canvas:canvas, antialias:true, preserveDrawingBuffer:false});
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio||1));
renderer.outputEncoding = THREE.sRGBEncoding;

var scene = new THREE.Scene();
scene.background = T.scene.clone();

var camera = new THREE.PerspectiveCamera(40, 2, 0.5, 2000);
var VIEWS = {
  iso:   {t:[-2,16,0],   theta:0.62, phi:1.10, r:158},
  front: {t:[0,22,0],    theta:0.0,  phi:1.52, r:140},
  top:   {t:[0,10,0],    theta:0.0,  phi:0.12, r:150},
  plant: {t:[-27,5,-1],  theta:0.34, phi:0.78, r:50},
  clean: {t:[24,20,0],   theta:0.42, phi:1.18, r:92},
  hmi:   {t:[-38,41.5,27], theta:0.0, phi:1.45, r:28}
};
var target = new THREE.Vector3().fromArray(VIEWS.iso.t);
var targetGoal = target.clone();
var cam = {theta:VIEWS.iso.theta, phi:VIEWS.iso.phi, r:VIEWS.iso.r};
var camGoal = {theta:cam.theta, phi:cam.phi, r:cam.r};
function placeCamera(){
  var sp=Math.sin(cam.phi);
  camera.position.set(target.x+cam.r*sp*Math.sin(cam.theta),
                      target.y+cam.r*Math.cos(cam.phi),
                      target.z+cam.r*sp*Math.cos(cam.theta));
  camera.lookAt(target);
}

/* ---------------------------------------------------------------- lights */
var hemi=new THREE.HemisphereLight(0xffffff,0x404a55,0.85); scene.add(hemi);
var key =new THREE.DirectionalLight(0xffffff,0.75); key.position.set(60,110,90); scene.add(key);
var fill=new THREE.DirectionalLight(0xffffff,0.30); fill.position.set(-90,40,-70); scene.add(fill);
function tuneLights(){
  hemi.intensity=T.dark?0.50:0.85; key.intensity=T.dark?0.55:0.75; fill.intensity=T.dark?0.26:0.30;
}
tuneLights();

/* ---------------------------------------------- plant group and transform */
/* The earlier model is ~40 units long (louvres to duct ends). K scales it so the
   AHU's supply and return connections meet the partition and the recovery unit's
   louvres sit on the box's left wall. */
var K=1.1, XO=-20.74, YO=5.64, ZO=3.0;
var plant=new THREE.Group(); plant.scale.setScalar(K); plant.position.set(XO,YO,ZO);
plant.userData.asm='Plant room'; scene.add(plant);
function C2W(x,y,z){ return new THREE.Vector3(XO+K*x, YO+K*y, ZO+K*z); }
function W2C(x,y,z){ return new THREE.Vector3((x-XO)/K, (y-YO)/K, (z-ZO)/K); }
function tag(o,name){ o.userData.part=name; return o; }

/* fresh-air louvre: moved to the compressor intake on the left wall (model units) */
var LZU=W2C(0,0,-14).z, LYU=W2C(0,22,0).y;
var humGroup=null;

/* ======================================================================
   AHU + heat-recovery air-pump unit, in the earlier 3D model's own units; the whole
   group is scaled into the plant-room half of the box (see K, XO, YO, ZO).
   Hazardous-material design: the AHU is a single-deck 100 % fresh-air unit. There is no
   mixing box, no recirculation, no extract deck and no heat-recovery core in the AHU;
   the only exhaust path is the air-pump unit's copper plate core (non-contact).
   ====================================================================== */
/* ------------------------------------------------------------- materials */
function std(c,o){ o=o||{}; return new THREE.MeshStandardMaterial({
  color:c, metalness:o.m!==undefined?o.m:0.55, roughness:o.r!==undefined?o.r:0.45,
  transparent:!!o.t, opacity:o.o!==undefined?o.o:1, side:o.side||THREE.FrontSide,
  depthWrite:o.dw!==undefined?o.dw:true, emissive:o.e||0x000000,
  emissiveIntensity:o.ei!==undefined?o.ei:1});}

var M = {
  panel : std(T.metal.clone(), {m:0.62,r:0.34,t:true,o:0.22,side:THREE.DoubleSide,dw:false}),
  frame : std(T.metalDark.clone(), {m:0.75,r:0.32}),
  inner : std(T.metal.clone(), {m:0.40,r:0.60,side:THREE.DoubleSide}),
  copper: std(new THREE.Color('#b9712f'), {m:0.9,r:0.3}),
  fin   : std(new THREE.Color('#aab6c0'), {m:0.5,r:0.55,t:true,o:0.85,side:THREE.DoubleSide}),
  coilHot : std(new THREE.Color('#d9541a'), {m:0.35,r:0.5,e:0x5a1d00,ei:0.75,t:true,o:0.78,side:THREE.DoubleSide}),
  coilCold: std(new THREE.Color('#1878cf'), {m:0.35,r:0.5,e:0x001f3d,ei:0.75,t:true,o:0.78,side:THREE.DoubleSide}),
  coilIdle: std(new THREE.Color('#8e9aa6'), {m:0.4,r:0.6,t:true,o:0.45,side:THREE.DoubleSide}),
  filter: std(new THREE.Color('#8e9aa6'), {m:0.1,r:0.9}),
  duct  : std(T.metal.clone(), {m:0.5,r:0.5,t:true,o:0.16,side:THREE.DoubleSide,dw:false}),
  refrig: std(T.refrig.clone(), {m:0.6,r:0.35,e:0x150a30,ei:0.5}),
  base  : std(T.metalDark.clone(), {m:0.7,r:0.4})
};

/* ------------------------------------------------------------- envelope  */
var unit=new THREE.Group(); plant.add(unit); unit.userData.asm='AHU';
var explodables=[], labels=[], casingParts=[], spinners=[];
var L=20.0, H=4.6, D=3.4;
var X0=-L/2, X1=L/2, Y0=-H/2, Y1=H/2, Z0=-D/2, Z1=D/2;
var YS=-1.12, YE=1.12;          // supply deck centre line (YE: the old extract deck, now removed)
var YT=0.0;                     // roof of the single-deck 100 % fresh-air AHU
var YC=(Y0+YT)/2, HC=YT-Y0;     // casing centre line and height

/* the parallel heat-recovery air-pump unit, standing behind the AHU */
var MX0=-20.5, MX1=-9.0, MXC=(MX0+MX1)/2;
var MY=-0.6, MZ=-8.5, MH=2.6, MD=3.2;
var MZU=MZ+0.85, MZL=MZ-0.85;   // the two lanes that cross inside the core

function box(w,h,d,mat){ return new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat); }
function at(o,x,y,z){ o.position.set(x,y,z); return o; }

(function frame(){
  var t=0.14, g=new THREE.Group();
  function bar(w,h,d,x,y,z){ g.add(at(box(w,h,d,M.frame),x,y,z)); }
  [[Y0,Z0],[Y0,Z1],[YT,Z0],[YT,Z1]].forEach(function(p){ bar(L,t,t,0,p[0],p[1]); });
  [[X0,Z0],[X0,Z1],[X1,Z0],[X1,Z1]].forEach(function(p){ bar(t,HC,t,p[0],YC,p[1]); });
  [[X0,Y0],[X0,YT],[X1,Y0],[X1,YT]].forEach(function(p){ bar(t,t,D,p[0],p[1],0); });
  [-9.2,-8.0,-4.1,-2.6,-1.5,1.2,3.0,5.0,6.9,8.2].forEach(function(x){
    bar(t*0.8,HC,t*0.8,x,YC,Z0); bar(t*0.8,HC,t*0.8,x,YC,Z1);
  });
  tag(g,'AHU frame'); unit.add(g);
})();

function panel(w,h,d,x,y,z,dir){
  var m=box(w,h,d,M.panel.clone()); at(m,x,y,z);
  tag(m,'AHU casing panel'); unit.add(m); casingParts.push(m);
  explodables.push({obj:m, dir:dir.clone(), base:m.position.clone(), scale:3.6});
}
panel(L,HC,0.06, 0,YC,Z1, new THREE.Vector3(0,0,1));
panel(L,HC,0.06, 0,YC,Z0, new THREE.Vector3(0,0,-1));
panel(L,0.06,D, 0,YT,0, new THREE.Vector3(0,1,0));
panel(L,0.06,D, 0,Y0,0, new THREE.Vector3(0,-1,0));

/* --- base / machine compartment --- */
(function(){
  var g=new THREE.Group();
  g.add(at(box(L,0.30,D,M.base),0,Y0-0.17,0));
  g.add(at(box(5.8,1.70,D-0.4,M.base.clone()),-5.2,Y0-1.20,0));
  var comp=new THREE.Mesh(new THREE.CylinderGeometry(0.52,0.52,1.25,28), M.frame);
  at(comp,-6.2,Y0-1.15,0.35); g.add(comp);
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.56,0.56,0.16,28),M.base),-6.2,Y0-0.48,0.35));
  g.add(at(box(0.9,0.26,0.26,M.refrig),-4.2,Y0-0.55,0.8));
  [-8.6,-3.0,3.0,8.6].forEach(function(x){
    [Z0+0.5,Z1-0.5].forEach(function(z){ g.add(at(box(0.3,0.34,0.3,M.frame),x,Y0-2.2,z)); });
  });
  tag(g,'Base, machine compartment & R32 compressor'); unit.add(g);
  labels.push({text:'Scroll compressor', sub:'R32 · inverter driven',
    anchor:new THREE.Vector3(-6.2,Y0-1.15,0.35), off:new THREE.Vector3(-1.0,-1.0,1.6)});
  labels.push({text:'4-way reversing valve', sub:'heating ⇄ cooling', tier:'aux',
    anchor:new THREE.Vector3(-4.2,Y0-0.55,0.8), off:new THREE.Vector3(1.9,-1.2,1.4)});
})();

/* --- filtration --- */
function preFilter(x,y,label,sub,tier){
  var g=new THREE.Group();
  g.add(at(box(0.09,2.05,D-0.45,M.frame),x-0.14,y,0));
  for(var i=0;i<13;i++){
    var p=at(box(0.22,0.17,D-0.6,M.filter),x,y-0.96+i*0.16,0);
    p.rotation.z=(i%2?1:-1)*0.52; g.add(p);
  }
  g.add(at(box(0.09,2.05,D-0.45,M.frame),x+0.14,y,0));
  tag(g,label); unit.add(g);
  explodables.push({obj:g, dir:new THREE.Vector3(0,y>0?1:-1,0.4).normalize(), base:new THREE.Vector3(0,0,0), scale:3.1});
  labels.push({text:label, sub:sub||'ISO Coarse 60 % panel', tier:tier,
    anchor:new THREE.Vector3(x,y,0), off:new THREE.Vector3(-0.6,y>0?1.5:-1.5,1.6)});
}
function bagFilter(x,y,label){
  var g=new THREE.Group();
  g.add(at(box(0.16,2.0,D-0.5,M.frame),x,y,0));
  for(var i=0;i<9;i++){
    var p=at(box(0.80,0.20,D-0.6,M.filter),x+0.48,y-0.88+i*0.22,0);
    p.rotation.z=(i%2?1:-1)*0.14; g.add(p);
  }
  g.add(at(box(0.10,2.0,D-0.5,M.frame),x+0.92,y,0));
  tag(g,label); unit.add(g);
  explodables.push({obj:g, dir:new THREE.Vector3(0,y>0?1:-1,0.35).normalize(), base:new THREE.Vector3(0,0,0), scale:2.6});
  labels.push({text:label, sub:'ePM1 55 % bag',
    anchor:new THREE.Vector3(x+0.45,y,0), off:new THREE.Vector3(0.7,y>0?1.5:-1.5,1.6)});
}
function hepaFilter(x,y,label){
  var g=new THREE.Group();
  g.add(at(box(0.10,2.10,D-0.40,M.frame),x-0.18,y,0));          // gasketed holding frame
  var pm=std(new THREE.Color('#cfd6dc'),{m:0.1,r:0.9,t:true,o:0.95,side:THREE.DoubleSide});
  for(var i=0;i<26;i++) g.add(at(box(0.40,1.86,0.025,pm),x+0.12,y,-1.30+i*0.104));
  g.add(at(box(0.46,0.08,D-0.45,M.frame),x+0.12,y+0.96,0));
  g.add(at(box(0.46,0.08,D-0.45,M.frame),x+0.12,y-0.96,0));
  [-1,1].forEach(function(s){
    [-1,1].forEach(function(t){
      var c=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,0.5,10),M.frame);
      c.rotation.z=Math.PI/2; at(c,x+0.12,y+s*0.78,t*1.28); g.add(c);   // clamping screws
    });
  });
  tag(g,label); unit.add(g);
  explodables.push({obj:g, dir:new THREE.Vector3(0,-1,0.45).normalize(), base:new THREE.Vector3(0,0,0), scale:2.8});
  labels.push({text:label, sub:'H13 · 99.95 % @ MPPS · scan-tested',
    anchor:new THREE.Vector3(x+0.1,y,0), off:new THREE.Vector3(0.9,-2.0,1.5)});
}

preFilter(-8.7, YS, 'Outdoor-air pre-filter');
preFilter(-2.0, YS, 'Panel filter', 'ISO ePM10 50 % · 100 % fresh air');
bagFilter( 0.3, YS, 'Bag filter');
hepaFilter( 7.0, YS, 'HEPA final filter');

/* --- 100 % fresh-air plenum where the mixing box and the AHU core used to be --- */
(function freshPlenum(){
  var g=new THREE.Group();
  var vm=std(T.glass.clone(),{m:0.4,r:0.6,t:true,o:0.35,side:THREE.DoubleSide});
  [-6.8,-4.6].forEach(function(x){ for(var j=0;j<4;j++){ var b=box(0.05,0.42,D-0.8,vm); at(b,x,YS-0.7+j*0.47,0); b.rotation.z=0.35; g.add(b); } });
  tag(g,'Fresh-air plenum + turning vanes'); unit.add(g);
  labels.push({text:'100 % fresh air',sub:'no mixing box · no recirculation · no exhaust in the AHU',
    anchor:new THREE.Vector3(-5.7,YS+0.6,0), off:new THREE.Vector3(-1.2,2.2,1.5)});
})();

/* --- coils --- */
function coil(x,y,id,z,sz,host){
  z=z||0; sz=sz||1; host=host||unit;
  var g=new THREE.Group();
  var fins=new THREE.InstancedMesh(new THREE.BoxGeometry(0.80,1.75,0.02), M.fin, 26);
  var mtx=new THREE.Matrix4();
  for(var i=0;i<26;i++){ mtx.makeTranslation(0,0,(-1.25+i*0.1)*sz); fins.setMatrixAt(i,mtx); }
  g.add(fins); g.userData.fins=fins;
  for(var cx=0;cx<3;cx++) for(var cy=0;cy<5;cy++){
    var t=new THREE.Mesh(new THREE.CylinderGeometry(0.055,0.055,2.7*sz,10),M.copper);
    t.rotation.x=Math.PI/2; at(t,-0.26+cx*0.26,-0.7+cy*0.35,0); g.add(t);
  }
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.1,1.9,14),M.copper),0,0,1.42*sz));
  g.add(at(box(1.1,1.95,(D-0.5)*sz,std(T.glass.clone(),{m:0.3,r:0.6,t:true,o:0.1,side:THREE.DoubleSide,dw:false})),0,0,0));
  g.add(at(box(1.2,0.08,(D-0.5)*sz,M.inner),0,-1.0,0));
  g.userData.id=id; tag(g,'Coil: '+id);
  g.position.set(x,y,z);
  host.add(g);
  explodables.push({obj:g, dir:new THREE.Vector3(0,y>0?1:-1,0.5).normalize(),
    base:new THREE.Vector3(x,y,z), scale:2.4});
  return g;
}
var coilPreheat = coil(-0.9, YS, 'preheat');
var coilCooling = coil( 1.9, YS, 'cooling');
var coilReheat  = coil( 3.8, YS, 'reheat');
var coilExtract = coil(-17.3, MY, 'extract', MZL, 0.52);  // lives in the recovery unit
var lblPre ={text:'Pre-heat coil', sub:'air pump condenser',
  anchor:new THREE.Vector3(-0.9,YS,0), off:new THREE.Vector3(-1.4,-1.9,1.4)};
var lblCool={text:'Cooling coil', sub:'idle in heating mode',
  anchor:new THREE.Vector3(1.9,YS,0), off:new THREE.Vector3(0.1,-2.3,1.4)};
var lblRe  ={text:'Reheat coil', sub:'idle in heating mode',
  anchor:new THREE.Vector3(3.8,YS,0), off:new THREE.Vector3(1.6,-1.9,1.4)};
var lblExt ={text:'Exhaust-air coil', sub:'air pump evaporator',
  anchor:new THREE.Vector3(-17.3,MY,MZL), off:new THREE.Vector3(-0.8,1.9,-0.8)};
labels.push(lblPre,lblCool,lblRe,lblExt);

/* --- fans --- */
function fan(x,y,dirSign,label){
  var g=new THREE.Group(), rotor=new THREE.Group();
  var hub=new THREE.Mesh(new THREE.CylinderGeometry(0.27,0.27,0.52,20),M.frame);
  hub.rotation.z=Math.PI/2; rotor.add(hub);
  var bm=std(T.metal.clone(),{m:0.65,r:0.35,side:THREE.DoubleSide});
  for(var i=0;i<9;i++){
    var a=i/9*Math.PI*2, b=box(0.26,0.92,0.07,bm);
    b.position.set(0, Math.cos(a)*0.64, Math.sin(a)*0.64);
    b.rotation.x=-a; b.rotateY(0.55*dirSign); rotor.add(b);
  }
  at(rotor,x,y,0); g.add(rotor);
  spinners.push({obj:rotor, axis:'x', rate:dirSign*5.2, id:label});
  var cone=new THREE.Mesh(new THREE.CylinderGeometry(1.08,0.78,0.5,28,1,true),
    std(T.metal.clone(),{m:0.6,r:0.4,t:true,o:0.4,side:THREE.DoubleSide}));
  cone.rotation.z=Math.PI/2; at(cone,x-dirSign*0.55,y,0); g.add(cone);
  var ring=new THREE.Mesh(new THREE.TorusGeometry(1.08,0.05,8,32),M.frame);
  ring.rotation.y=Math.PI/2; at(ring,x-dirSign*0.8,y,0); g.add(ring);
  g.add(at(box(0.5,0.42,0.42,M.frame),x+dirSign*0.45,y,0));
  g.add(at(box(1.9,0.1,0.1,M.frame),x,y-0.98,0));
  tag(g,label); unit.add(g);
  explodables.push({obj:g, dir:new THREE.Vector3(dirSign*0.6,y>0?0.8:-0.8,0.3).normalize(), base:new THREE.Vector3(0,0,0), scale:2.6});
  labels.push({text:label, sub:'EC plug fan · VSD',
    anchor:new THREE.Vector3(x,y,0), off:new THREE.Vector3(dirSign*0.5,y>0?1.6:-1.6,1.5)});
}
fan( 5.9, YS,  1, 'Supply fan');

/* --- dampers on the four openings --- */
function damper(x,y,label,sub){
  var g=new THREE.Group();
  var bm=std(T.metalDark.clone(),{m:0.7,r:0.4,side:THREE.DoubleSide});
  for(var i=0;i<6;i++){
    var b=box(0.06,0.30,D-0.7,bm); at(b,x,y-0.80+i*0.32,0); b.rotation.z=0.55; g.add(b);
  }
  g.add(at(box(0.12,0.10,D-0.6,M.frame),x,y+1.0,0));
  g.add(at(box(0.12,0.10,D-0.6,M.frame),x,y-1.0,0));
  tag(g,label); unit.add(g);
  labels.push({text:label, sub:sub, tier:'aux',
    anchor:new THREE.Vector3(x,y,0), off:new THREE.Vector3(x<0?-1.7:1.7,y>0?1.3:-1.3,1.2)});
}
damper(X0+0.2, YS, 'Fresh-air inlet', 'from the air-pump Cu core');
damper(X1-0.2, YS, 'Supply air to the clean room', 'duct connection');

/* --- ductwork --- */
var ducts=new THREE.Group(); tag(ducts,'AHU duct connections');
[[-1,YS],[1,YS]].forEach(function(p){
  var d=box(3.4,2.1,D-0.4,M.duct); at(d,p[0]*(L/2+1.7),p[1],0); ducts.add(d);
  var e=new THREE.LineSegments(new THREE.EdgesGeometry(d.geometry),
    new THREE.LineBasicMaterial({color:T.metalDark.clone(),transparent:true,opacity:0.55}));
  e.position.copy(d.position); ducts.add(e);
});
unit.add(ducts);

/* --- auxiliaries --- */
var aux=new THREE.Group(); unit.add(aux);
var doors=new THREE.Group(); unit.add(doors);

(function eliminator(){
  var g=new THREE.Group();
  var bm=std(T.glass.clone(),{m:0.4,r:0.5,t:true,o:0.62,side:THREE.DoubleSide});
  for(var i=0;i<12;i++){
    var b=box(0.30,1.80,0.05,bm); at(b,2.9,YS,-1.32+i*0.24);
    b.rotation.y=(i%2?0.55:-0.55); g.add(b);
  }
  g.add(at(box(0.44,0.07,D-0.5,M.inner),2.9,YS-0.96,0));
  tag(g,'Droplet eliminator'); aux.add(g);
  explodables.push({obj:g,dir:new THREE.Vector3(0,-1,0.4).normalize(),base:new THREE.Vector3(0,0,0),scale:2.2});
  labels.push({text:'Droplet eliminator',sub:'carry-over protection',tier:'aux',
    anchor:new THREE.Vector3(2.9,YS,0),off:new THREE.Vector3(-0.2,-2.4,1.2)});
})();

(function humidifier(){
  var g=new THREE.Group();
  var hm=std(new THREE.Color('#9fb6c7'),{m:0.85,r:0.28});
  for(var i=0;i<3;i++) g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.055,0.055,1.65,10),hm),4.8,YS+0.05,-0.9+i*0.9));
  g.add(at(box(0.14,0.14,D-0.7,hm),4.8,YS-0.82,0));
  g.add(at(box(0.52,0.92,0.46,M.frame),4.8,Y0-0.55,Z1+0.42));
  g.add(at(box(0.56,0.07,D-0.5,M.inner),4.8,YS-0.95,0));
  tag(g,'Steam humidifier'); aux.add(g); humGroup=g;
  labels.push({text:'Steam humidifier',sub:'lance bank + drip tray',tier:'aux',
    anchor:new THREE.Vector3(4.8,YS,0),off:new THREE.Vector3(1.9,-2.2,1.0)});
})();

function attenuator(x,y,label){
  var g=new THREE.Group();
  var sm=std(T.metal.clone(),{m:0.25,r:0.85,t:true,o:0.55,side:THREE.DoubleSide});
  for(var i=0;i<4;i++) g.add(at(box(1.30,1.86,0.22,sm),x,y,-1.05+i*0.70));
  g.add(at(box(1.34,0.07,D-0.5,M.inner),x,y+(y>0?0.98:-0.98),0));
  tag(g,label); aux.add(g);
  explodables.push({obj:g,dir:new THREE.Vector3(x>0?1:-1,0,0.3).normalize(),base:new THREE.Vector3(0,0,0),scale:2.4});
  labels.push({text:label,sub:'splitter attenuator',tier:'aux',
    anchor:new THREE.Vector3(x,y,0),off:new THREE.Vector3(x>0?1.5:-1.5,y>0?1.5:-1.5,1.2)});
}
attenuator( 8.2, YS, 'Supply attenuator');

function sensor(x,y,z,text,sub){
  var g=new THREE.Group();
  g.add(at(box(0.17,0.28,0.17,M.frame),x,y,z));
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.03,0.8,8),M.frame),x,y-0.5,z));
  tag(g,'Sensor: '+text); aux.add(g);
  labels.push({text:text,sub:sub,tier:'aux',anchor:new THREE.Vector3(x,y,z),
    off:new THREE.Vector3(0,y>0?1.3:-1.4,1.1)});
}
sensor( 7.2, YS+0.85, 0.75, 'Supply T + RH', 'cascade control');
sensor(-9.4, YS+0.85, 0.75, 'TT-109 off the Cu core', 'fresh air after the non-contact pre-cooling');
/* rig additions in the same style: the two coil-leaving sensors */
sensor(-0.25, YS+0.85, 0.75, 'TT-103 after pre-heat', 'pre-heat coil control');
sensor( 3.35, YS+0.85,-0.75, 'TT-104 off cooling coil', 'cooling coil control');

(function gauges(){
  var gm=std(new THREE.Color('#d7dde3'),{m:0.2,r:0.7});
  [[-8.7,YS+0.55],[-2.0,YS+0.55],[0.3,YS+0.55],[7.0,YS+0.55]].forEach(function(p){
    var d=new THREE.Mesh(new THREE.CylinderGeometry(0.17,0.17,0.08,18),gm);
    d.rotation.x=Math.PI/2; at(d,p[0],p[1],Z1+0.08); tag(d,'Filter ΔP gauge'); aux.add(d);
  });
  labels.push({text:'Filter ΔP gauges',sub:'4 × 0–500 Pa',tier:'aux',
    anchor:new THREE.Vector3(0.3,YS+0.55,Z1+0.08),off:new THREE.Vector3(-0.8,-2.6,1.3)});
})();

(function controlPanel(){
  var g=new THREE.Group();
  g.add(at(box(1.7,1.9,0.26,M.frame),9.0,YC,Z1+0.22));
  g.add(at(box(1.5,1.7,0.03,std(T.metalDark.clone(),{m:0.4,r:0.6})),9.0,YC,Z1+0.37));
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,0.4,10),M.inner),9.7,YC,Z1+0.4));
  tag(g,'AHU control panel'); aux.add(g);
  labels.push({text:'Control panel',sub:'BMS + EC fan drives',tier:'aux',
    anchor:new THREE.Vector3(9.0,YC,Z1+0.3),off:new THREE.Vector3(1.6,1.6,1.0)});
})();

(function weatherLouvres(){
  var bm=std(T.metalDark.clone(),{m:0.6,r:0.5,side:THREE.DoubleSide});
  [[LZU,LYU]].forEach(function(q){                  // fresh-air intake only: no exhaust leaves through this wall
    var z=q[0], yy=q[1], lg=new THREE.Group(); tag(lg,'Fresh-air louvre + bird mesh');
    for(var i=0;i<6;i++){
      var b=box(0.20,0.16,1.45,bm); at(b,MX0-5.6,yy-0.55+i*0.22,z);
      b.rotation.z=0.72; lg.add(b);
    }
    var mesh=new THREE.Mesh(new THREE.PlaneGeometry(1.5,1.45),
      std(T.metal.clone(),{m:0.6,r:0.5,t:true,o:0.3,side:THREE.DoubleSide}));
    mesh.rotation.y=Math.PI/2; at(mesh,MX0-5.45,yy,z); lg.add(mesh); ducts.add(lg);
  });
  labels.push({text:'Weather louvre + bird mesh',sub:'fresh-air compressor intake',tier:'aux',
    anchor:new THREE.Vector3(MX0-5.6,LYU,LZU),off:new THREE.Vector3(1.6,1.9,-0.8)});
  var fm=std(new THREE.Color('#5d6b78'),{m:0.1,r:0.95,t:true,o:0.85,side:THREE.DoubleSide});
  [[-1,YS],[1,YS]].forEach(function(p){
    for(var k=0;k<3;k++) ducts.add(at(box(0.07,2.2+k*0.06,D-0.3+k*0.05,fm), p[0]*(L/2+0.3+k*0.09), p[1], 0));
  });
})();

(function accessDoors(){
  var dm=new THREE.LineBasicMaterial({color:T.metalDark.clone(),transparent:true,opacity:0.8});
  function door(x,y,w){
    var g=new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x-w/2,y-0.95,Z1+0.05), new THREE.Vector3(x+w/2,y-0.95,Z1+0.05),
      new THREE.Vector3(x+w/2,y+0.95,Z1+0.05), new THREE.Vector3(x-w/2,y+0.95,Z1+0.05),
      new THREE.Vector3(x-w/2,y-0.95,Z1+0.05)]);
    doors.add(new THREE.Line(g,dm));
    var h1=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,0.26,10),M.frame);
    h1.rotation.x=Math.PI/2; at(h1,x+w/2-0.22,y,Z1+0.13); doors.add(h1);
  }
  [[-8.6,1.5],[-5.7,2.2],[-3.3,1.9],[-0.6,2.4],[2.1,2.0],[4.6,1.9],[7.5,2.3],[9.3,1.2]]
    .forEach(function(s){ door(s[0],YS,s[1]); });
})();

/* ============ parallel heat-recovery air-pump unit (the HRV package) === */
var modUnit=new THREE.Group(); plant.add(modUnit); modUnit.userData.asm='Heat-recovery air-pump unit';
modUnit.add(coilExtract);                       // the evaporator sits in its exhaust lane
(function(){
  var ML=MX1-MX0, t2=0.12;
  var gm=std(T.metal.clone(),{m:0.62,r:0.34,t:true,o:0.20,side:THREE.DoubleSide,dw:false});
  modUnit.add(at(box(ML,MH,0.06,gm.clone()),MXC,MY,MZ+MD/2));
  modUnit.add(at(box(ML,MH,0.06,gm.clone()),MXC,MY,MZ-MD/2));
  modUnit.add(at(box(ML,0.06,MD,gm.clone()),MXC,MY+MH/2,MZ));
  modUnit.add(at(box(ML,0.06,MD,gm.clone()),MXC,MY-MH/2,MZ));
  [[MY-MH/2,MZ-MD/2],[MY-MH/2,MZ+MD/2],[MY+MH/2,MZ-MD/2],[MY+MH/2,MZ+MD/2]].forEach(function(p){
    modUnit.add(at(box(ML,t2,t2,M.frame),MXC,p[0],p[1])); });
  [[MX0,MZ-MD/2],[MX0,MZ+MD/2],[MX1,MZ-MD/2],[MX1,MZ+MD/2]].forEach(function(p){
    modUnit.add(at(box(t2,MH,t2,M.frame),p[0],MY,p[1])); });
  [[MX0,MY-MH/2],[MX0,MY+MH/2],[MX1,MY-MH/2],[MX1,MY+MH/2]].forEach(function(p){
    modUnit.add(at(box(t2,t2,MD,M.frame),p[0],p[1],MZ)); });

  // the two lanes are separated either side of the core, which is what makes the X crossing
  var dm=std(T.metal.clone(),{m:0.4,r:0.6,t:true,o:0.45,side:THREE.DoubleSide});
  modUnit.add(at(box((MXC-1.5)-MX0,MH-0.2,0.05,dm),(MX0+(MXC-1.5))/2,MY,MZ));
  modUnit.add(at(box(MX1-(MXC+1.5),MH-0.2,0.05,dm),((MXC+1.5)+MX1)/2,MY,MZ));

  // non-contact crossflow core, set on the diagonal (same look as the first design). The plates are
  // copper (Cu-ETP), polished to a surface roughness Ra ≤ 0.8 µm: smooth and cleanable, nothing sticks.
  // They stack horizontally: one stream takes the odd layers, the other the even layers, so the
  // exhaust never touches the fresh air; it only pre-cools / pre-heats it through the plates.
  var coreG=new THREE.Group();
  var cm=std(T.glass.clone(),{m:0.55,r:0.4,t:true,o:0.40,side:THREE.DoubleSide});
  for(var i=0;i<11;i++) coreG.add(at(box(2.2,0.035,2.2,cm),0,-0.95+i*0.19,0));
  coreG.add(at(box(2.2,MH-0.5,2.2,std(T.glass.clone(),{m:0.3,r:0.6,t:true,o:0.10,side:THREE.DoubleSide,dw:false})),0,0,0));
  coreG.rotation.y=Math.PI/4; at(coreG,MXC,MY,MZ); tag(coreG,'Cu plate core (Ra ≤ 0.8 µm)'); modUnit.add(coreG);
  explodables.push({obj:coreG,dir:new THREE.Vector3(0,1,0),base:new THREE.Vector3(MXC,MY,MZ),scale:2.6});
  labels.push({text:'Cu plate core',sub:'copper plates · Ra ≤ 0.8 µm · no air contact',
    anchor:new THREE.Vector3(MXC,MY+1.2,MZ),off:new THREE.Vector3(0,2.0,-1.0)});

  // inlet filters, one on each incoming lane
  function modFilter(x,z,label){
    var g=new THREE.Group();
    g.add(at(box(0.10,MH-0.5,1.45,M.frame),x-0.13,0,0));
    for(var i=0;i<9;i++){
      var p=at(box(0.22,0.15,1.35,M.filter),x,-0.62+i*0.155,0);
      p.rotation.z=(i%2?1:-1)*0.5; g.add(p);
    }
    g.add(at(box(0.10,MH-0.5,1.45,M.frame),x+0.13,0,0));
    at(g,0,MY,z); tag(g,label); modUnit.add(g);
    explodables.push({obj:g,dir:new THREE.Vector3(0,1,0),base:new THREE.Vector3(0,MY,z),scale:2.2});
    labels.push({text:label,sub:'ISO Coarse panel',tier:'aux',
      anchor:new THREE.Vector3(x,MY,z),off:new THREE.Vector3(0,1.7,-0.9)});
  }
  modFilter(MX0+1.5, MZU, 'Fresh-air filter');
  modFilter(MX1-1.5, MZU, 'Exhaust filter');

  // the two fans, both on the leaving lanes, as on the reference unit
  function modFan(x,z,dirSign,label){
    var g=new THREE.Group(), rotor=new THREE.Group();
    var hub=new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.18,0.36,16),M.frame);
    hub.rotation.z=Math.PI/2; rotor.add(hub);
    var bm=std(T.metal.clone(),{m:0.65,r:0.35,side:THREE.DoubleSide});
    for(var i=0;i<9;i++){
      var a=i/9*Math.PI*2, b=box(0.18,0.62,0.05,bm);
      b.position.set(0,Math.cos(a)*0.44,Math.sin(a)*0.44);
      b.rotation.x=-a; b.rotateY(0.55*dirSign); rotor.add(b);
    }
    g.add(rotor); spinners.push({obj:rotor,axis:'x',rate:dirSign*5.0,id:label});
    var ring=new THREE.Mesh(new THREE.TorusGeometry(0.74,0.045,8,28),M.frame);
    ring.rotation.y=Math.PI/2; at(ring,-dirSign*0.4,0,0); g.add(ring);
    g.add(at(box(0.34,0.3,0.3,M.frame),dirSign*0.38,0,0));
    at(g,x,MY,z); tag(g,label); modUnit.add(g);
    explodables.push({obj:g,dir:new THREE.Vector3(dirSign,0.5,0).normalize(),
      base:new THREE.Vector3(x,MY,z),scale:2.2});
    labels.push({text:label,sub:'EC fan',
      anchor:new THREE.Vector3(x,MY,z),off:new THREE.Vector3(dirSign*0.8,-1.7,-0.9)});
  }
  modFan(MX1-1.5, MZL,  1, 'Tempered-air fan');
  modFan(MX0+1.4, MZL, -1, 'FAN-103 exhaust fan');

  // control box and power feed, drawn on top as on the reference
  modUnit.add(tag(at(box(1.1,0.55,0.8,M.frame),MXC+2.2,MY+MH/2+0.3,MZ+0.4),'Recovery unit control box'));
  modUnit.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,1.0,10),M.frame),MXC+3.1,MY+MH/2+0.5,MZ+0.4));
  labels.push({text:'Recovery unit control',sub:'interlocked with the AHU',tier:'aux',
    anchor:new THREE.Vector3(MXC+2.2,MY+MH/2+0.3,MZ+0.4),off:new THREE.Vector3(1.9,1.4,-0.6)});

  // spigots at both ends
  [[MX0-0.5,MZU],[MX0-0.5,MZL],[MX1+0.5,MZU],[MX1+0.5,MZL]].forEach(function(p){
    modUnit.add(tag(at(box(1.0,MH-0.6,1.5,M.duct),p[0],MY,p[1]),'Recovery unit spigot'));
  });

  labels.push({text:'Heat-recovery air-pump unit',sub:'the only exhaust path · non-contact pre-cooling',
    anchor:new THREE.Vector3(MXC,MY+MH/2,MZ),off:new THREE.Vector3(-3.4,2.9,-1.2)});
})();

/* --- refrigerant pipework --- */
var refrig=new THREE.Group(), refrigCurves=[];
(function(){
  function run(points,r){
    var cv=new THREE.CatmullRomCurve3(points.map(function(p){return new THREE.Vector3(p[0],p[1],p[2]);}));
    refrig.add(new THREE.Mesh(new THREE.TubeGeometry(cv,72,r||0.075,10,false),M.refrig));
    refrigCurves.push(cv); return cv;
  }
  var zf=Z1+0.35;
  run([[-6.2,Y0-0.45,0.35],[-6.2,Y0-0.30,zf],[-4.6,Y0-0.15,zf],[-2.6,Y0-0.6,zf],[-0.9,YS-1.2,zf],[-0.9,YS,Z1-0.1]]);
  run([[-0.9,YS+0.4,Z1-0.1],[-0.2,YS+0.6,zf],[0.6,Y0-0.9,zf],[1.9,YS-1.3,zf],[1.9,YS,Z1-0.1]]);
  // liquid line: coils → liquid receiver → filter-drier → sight glass → EEV → the recovery unit's exhaust coil
  run([[3.8,YS,Z1-0.1],[3.0,YS-1.3,zf],[0.9,Y0-1.3,zf],[-0.7,Y0-1.35,zf],[-1.7,Y0-1.45,zf],[-2.45,Y0-1.47,zf],[-3.2,Y0-1.5,zf],
       [-7.6,Y0-1.3,0.4],[-10.5,Y0-0.9,-3.4],[-14.5,MY-1.0,-6.6],[-17.3,MY-0.9,MZL+0.5],[-17.3,MY,MZL+0.4]]);
  // suction line back from the recovery unit, through the suction accumulator, to the compressor
  run([[-17.3,MY+0.5,MZL+0.4],[-19.8,MY+0.4,-6.4],[-15.0,MY-1.3,-4.2],
       [-9.4,Y0-1.4,-1.4],[-8.3,Y0-1.55,1.3],[-7.3,Y0-1.2,zf],[-6.7,Y0-0.5,1.3],[-6.2,Y0-0.45,0.35]],0.09);
  refrig.add(at(box(0.34,0.34,0.34,M.frame),-3.2,Y0-1.5,zf));
  labels.push({text:'Electronic expansion valve', sub:'superheat control', tier:'aux',
    anchor:new THREE.Vector3(-3.2,Y0-1.5,zf), off:new THREE.Vector3(0.4,-1.1,0.9)});

  /* Where the refrigerant comes from and where it is kept. The R32 is weighed in through the Schrader
     charging ports at commissioning (design charge ≈ 40 g) and never vented. While running, the liquid
     receiver holds the surplus liquid, and the suction accumulator catches liquid that the evaporator
     has not boiled off (mode change, defrost) so the compressor only takes in vapour. For service the
     charge is pumped down into the receiver, or recovered into a recovery cylinder. */
  var shell=std(new THREE.Color('#3d4650'),{m:0.55,r:0.45}), brass=std(new THREE.Color('#b8923a'),{m:0.85,r:0.3});
  function vessel(name,x,y,z,r,h){
    var g=new THREE.Group(); tag(g,name);
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,24),shell),x,y,z));
    [1,-1].forEach(function(sg){ var cap=new THREE.Mesh(new THREE.SphereGeometry(r,24,12,0,Math.PI*2,0,Math.PI/2),shell);
      if(sg<0) cap.rotation.x=Math.PI; at(cap,x,y+sg*h/2,z); g.add(cap); });
    return g;
  }
  // liquid receiver, with its rotalock outlet valve and a level sight glass
  var rcv=vessel('R32 liquid receiver',-0.7,Y0-1.3,zf,0.3,0.8);
  rcv.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.11,0.11,0.32,12),brass),-0.7,Y0-0.66,zf));
  var lvl=new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.09,0.05,16),std(new THREE.Color('#9fd8f5'),{m:0.1,r:0.1,e:0x1d5f86,ei:0.6}));
  lvl.rotation.x=Math.PI/2; at(lvl,-0.7,Y0-1.42,zf+0.3); rcv.add(lvl);
  refrig.add(rcv);
  // suction accumulator (U-tube inside), between the 4-way valve and the compressor suction
  refrig.add(vessel('R32 suction accumulator',-7.3,Y0-1.2,zf,0.34,0.9));
  // bi-flow filter-drier and sight glass with moisture indicator, ahead of the EEV
  var dr=new THREE.Group(); tag(dr,'R32 filter-drier (bi-flow)');
  var drb=new THREE.Mesh(new THREE.CylinderGeometry(0.14,0.14,0.62,16),M.copper); drb.rotation.z=Math.PI/2; at(drb,-1.7,Y0-1.45,zf); dr.add(drb);
  refrig.add(dr);
  var sg=new THREE.Group(); tag(sg,'R32 sight glass + moisture indicator');
  sg.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.13,0.13,0.22,16),brass),-2.45,Y0-1.47,zf));
  var eye=new THREE.Mesh(new THREE.CylinderGeometry(0.085,0.085,0.04,16),std(new THREE.Color('#22c55e'),{m:0.1,r:0.2,e:0x0b5a24,ei:0.8}));
  eye.rotation.x=Math.PI/2; at(eye,-2.45,Y0-1.47,zf+0.13); sg.add(eye);
  refrig.add(sg);
  // Schrader charging / service ports: liquid side on the receiver outlet, suction side at the accumulator inlet
  [['R32 charging port (liquid side)',-1.15,Y0-1.38],['R32 charging port (suction side)',-7.85,Y0-1.42]].forEach(function(c){
    var g=new THREE.Group(); tag(g,c[0]);
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.06,0.34,10),brass),c[1],c[2]+0.17,zf));
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.085,0.085,0.12,12),std(new THREE.Color('#1d4ed8'),{m:0.3,r:0.5})),c[1],c[2]+0.38,zf));  // cap
    refrig.add(g);
  });
  labels.push({text:'Liquid receiver', sub:'stores the R32 charge · pump-down vessel',
    anchor:new THREE.Vector3(-0.7,Y0-0.95,zf), off:new THREE.Vector3(0.9,-1.6,1.5)});
  labels.push({text:'Suction accumulator', sub:'catches liquid · protects the compressor',
    anchor:new THREE.Vector3(-7.3,Y0-0.8,zf), off:new THREE.Vector3(-1.2,-1.7,1.5)});
  labels.push({text:'Filter-drier + sight glass', sub:'bi-flow · moisture indicator', tier:'aux',
    anchor:new THREE.Vector3(-2.1,Y0-1.45,zf), off:new THREE.Vector3(-0.2,-1.9,1.2)});
  labels.push({text:'Charging ports', sub:'Schrader valves · R32 weighed in here', tier:'aux',
    anchor:new THREE.Vector3(-1.15,Y0-1.0,zf), off:new THREE.Vector3(1.6,-0.6,1.0)});
  tag(refrig,'R32 refrigerant pipework'); unit.add(refrig);
})();

/* earlier-model labels live in model units; flag them so they are mapped to the world */
labels.forEach(function(l){ l.space='c'; });
/* ===================================================================== RIG */
var rig=new THREE.Group(); rig.userData.asm='Rig'; scene.add(rig);
var BX=50, BY=50, BZ=25, TH=0.5;                 // outer half-length, height, half-depth, acrylic
function W(x,y,z){ return new THREE.Vector3(x,y,z); }

/* -------------------------------------------------------- materials */
var MR={
  acrylic: new THREE.MeshStandardMaterial({color:T.acrylic.clone(),metalness:0,roughness:0.08,
    transparent:true,opacity:0.12,side:THREE.DoubleSide,depthWrite:false}),
  acrylicEdge: new THREE.LineBasicMaterial({color:T.acrylic.clone(),transparent:true,opacity:0.85}),
  pvc: new THREE.MeshStandardMaterial({color:T.metal.clone(),metalness:0.1,roughness:0.25,
    transparent:true,opacity:0.20,side:THREE.DoubleSide,depthWrite:false}),
  alu: std(new THREE.Color('#2b3137'),{m:0.7,r:0.4}),
  steel: std(new THREE.Color('#c9d1d8'),{m:0.85,r:0.28}),
  white: std(new THREE.Color('#eef1f4'),{m:0.1,r:0.55}),
  blue: std(new THREE.Color('#2e6db4'),{m:0.45,r:0.4}),
  black: std(new THREE.Color('#15191d'),{m:0.3,r:0.6}),
  pcb: std(T.pcb.clone(),{m:0.15,r:0.55}),
  copper: std(T.copper.clone(),{m:0.85,r:0.3}),
  chip: std(new THREE.Color('#1c1f22'),{m:0.2,r:0.5}),
  term: std(new THREE.Color('#1f8a4c'),{m:0.1,r:0.6}),
  screen: new THREE.MeshBasicMaterial({color:0xffffff}),
  led: new THREE.MeshBasicMaterial({color:0xf3f7ff})
};

/* ------------------------------------------------- acrylic enclosure */
var box3d=new THREE.Group(); box3d.userData.asm='Acrylic enclosure'; rig.add(box3d);
var wallParts=[];
function wall(name,w,h,d,x,y,z,dir){
  var m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),MR.acrylic); at(m,x,y,z); tag(m,name);
  m.renderOrder=1;
  var e=new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry),MR.acrylicEdge); m.add(e);
  box3d.add(m); wallParts.push({obj:m,dir:dir,base:m.position.clone()});
  return m;
}
wall('Acrylic base plate',2*BX,TH,2*BZ, 0,TH/2,0, W(0,-1,0));
wall('Acrylic roof',2*BX,TH,2*BZ, 0,BY-TH/2,0, W(0,1,0));
wall('Acrylic back wall',2*BX,BY-2*TH,TH, 0,BY/2,-BZ+TH/2, W(0,0,-1));
wall('Acrylic front wall',2*BX,BY-2*TH,TH, 0,BY/2,BZ-TH/2, W(0,0,1));
wall('Acrylic left wall (outdoor side)',TH,BY-2*TH,2*BZ-2*TH, -BX+TH/2,BY/2,0, W(-1,0,0));
wall('Acrylic right wall',TH,BY-2*TH,2*BZ-2*TH, BX-TH/2,BY/2,0, W(1,0,0));
var partition=wall('Acrylic partition wall',TH,BY-2*TH,2*BZ-2*TH, 0,BY/2,0, W(0,0,0));
var CEIL=40;                                         // clean-room false ceiling (underside)
wall('Clean-room false ceiling',BX-TH*1.5,TH,2*BZ-2*TH, (BX-TH/2+TH/2)/2,CEIL+TH/2,0, W(0,0.6,0));

/* aluminium base frame + levelling feet */
(function base(){
  var g=new THREE.Group(); tag(g,'Aluminium base frame'); g.userData.asm='Acrylic enclosure';
  [[0,-BZ+1],[0,BZ-1]].forEach(function(p){ g.add(at(box(2*BX,2,2,MR.alu),p[0],-1,p[1])); });
  [[-BX+1,0],[0,0],[BX-1,0]].forEach(function(p){ g.add(at(box(2,2,2*BZ-4,MR.alu),p[0],-1,p[1])); });
  [[-BX+2,-BZ+2],[-BX+2,BZ-2],[BX-2,-BZ+2],[BX-2,BZ-2]].forEach(function(p){
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(1.6,1.9,1.2,20),MR.black),p[0],-2.6,p[1]));
  });
  rig.add(g);
})();

/* floor grid + soft contact shadow: the same look as the earlier simulators (display only, not exported) */
var floorGrid;
(function floor(){
  var cv=document.createElement('canvas'); cv.width=cv.height=256;
  var ctx=cv.getContext('2d'), gr=ctx.createRadialGradient(128,128,10,128,128,126);
  gr.addColorStop(0,'rgba(0,0,0,0.42)'); gr.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=gr; ctx.fillRect(0,0,256,256);
  var sh=new THREE.Mesh(new THREE.PlaneGeometry(160,80),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthWrite:false}));
  sh.rotation.x=-Math.PI/2; sh.position.set(0,-3.18,0); sh.userData.noExport=true; scene.add(sh);
  floorGrid=new THREE.GridHelper(480,48,T.floor.clone(),T.floor.clone());
  floorGrid.material.vertexColors=false; floorGrid.material.color=T.floor.clone();
  floorGrid.material.transparent=true; floorGrid.material.opacity=0.35;
  floorGrid.position.y=-3.25; floorGrid.userData.noExport=true; scene.add(floorGrid);
})();

/* clean-room door on the front face */
(function door(){
  var g=new THREE.Group(); tag(g,'Clean-room access door'); g.userData.asm='Acrylic enclosure';
  var z=BZ+0.05, x0=30, x1=48, y0=3, y1=37;          // the pass box and the staging bench take the wall to its left
  var dm=new THREE.LineBasicMaterial({color:T.metalDark.clone(),transparent:true,opacity:0.9});
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([W(x0,y0,z),W(x1,y0,z),W(x1,y1,z),W(x0,y1,z),W(x0,y0,z)]),dm));
  [y0+5,y1-5].forEach(function(y){
    var h=new THREE.Mesh(new THREE.CylinderGeometry(0.45,0.45,4,12),MR.steel); at(h,x0+0.4,y,z+0.4); g.add(h);
  });
  var hd=at(box(0.8,6,0.8,MR.steel),x1-2.5,(y0+y1)/2,z+1.1); g.add(hd);
  g.add(at(box(0.6,0.6,1.0,MR.steel),x1-2.5,(y0+y1)/2+2.4,z+0.5));
  g.add(at(box(0.6,0.6,1.0,MR.steel),x1-2.5,(y0+y1)/2-2.4,z+0.5));
  rig.add(g);
})();

/* ------------------------------------------------------------- ducts */
var rigDucts=new THREE.Group(); rigDucts.userData.asm='Ductwork'; rig.add(rigDucts);
function roundedPath(pts,bend){
  var cp=new THREE.CurvePath(), v=pts.map(function(p){return W(p[0],p[1],p[2]);});
  var cur=v[0].clone();
  for(var i=1;i<v.length;i++){
    var a=v[i-1], b=v[i], c=v[i+1];
    if(!c){ cp.add(new THREE.LineCurve3(cur.clone(),b.clone())); break; }
    var d1=b.clone().sub(a), d2=c.clone().sub(b);
    var r=Math.min(bend, d1.length()*0.45, d2.length()*0.45);
    var p1=b.clone().sub(d1.normalize().multiplyScalar(r)), p2=b.clone().add(d2.normalize().multiplyScalar(r));
    if(cur.distanceTo(p1)>1e-3) cp.add(new THREE.LineCurve3(cur.clone(),p1));
    cp.add(new THREE.QuadraticBezierCurve3(p1,b.clone(),p2));
    cur=p2;
  }
  return cp;
}
/* Every air duct is rectangular. r is the round duct the airflow was sized for (calculations §11):
   the rectangle w × h = 2.2 r × 1.55 r has the same friction loss (Huebscher equivalent diameter
   De = 1.30 (w h)^0.625 / (w + h)^0.25 ≈ 2 r). Each straight run is one box section; sections overlap
   at the corners like mitred elbows. Width stays horizontal, height vertical; a vertical run keeps
   the width of the run before it. */
var DUCT_W=2.2, DUCT_H=1.55;
function duct(name,pts,r,mat,group,bend,wh){
  var w=wh?wh[0]:DUCT_W*r, h=wh?wh[1]:DUCT_H*r, e=Math.max(w,h)/2;     // wh: an explicit section where space is tight
  var g=new THREE.Group(); tag(g,name);
  var v=pts.map(function(p){ return W(p[0],p[1],p[2]); });
  var side=null, k;
  for(k=0;k<v.length-1;k++){ var d0=v[k+1].clone().sub(v[k]).normalize(); if(Math.abs(d0.y)<0.9){ side=W(d0.z,0,-d0.x).normalize(); break; } }
  if(!side) side=W(0,0,1);
  var edgeMat=new THREE.LineBasicMaterial({color:T.metalDark.clone(),transparent:true,opacity:0.5});
  for(k=0;k<v.length-1;k++){
    var a=v[k], b=v[k+1], dv=b.clone().sub(a), L=dv.length(); if(L<1e-3) continue;
    var n=dv.clone().divideScalar(L), ax;
    if(Math.abs(n.y)<0.9){ ax=W(n.z,0,-n.x).normalize(); side=ax.clone(); } else ax=side.clone();
    var ay=new THREE.Vector3().crossVectors(n,ax).normalize();
    var e0=k>0?e:0, e1=k<v.length-2?e:0;
    var sec=new THREE.Mesh(new THREE.BoxGeometry(w,h,L+e0+e1),mat||MR.pvc);
    sec.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(ax,ay,n));
    sec.position.copy(a).addScaledVector(n,(L+e1-e0)/2);
    sec.userData.cad={type:'rseg',wall:0.15};
    if(!g.children.length) sec.userData.cad.duct={pts:pts.map(function(p){ return [p[0],p[1],p[2]]; }),r:r,w:w,h:h};   // centre line for the calculations
    sec.renderOrder=2; sec.add(new THREE.LineSegments(new THREE.EdgesGeometry(sec.geometry),edgeMat));
    g.add(sec);
  }
  g.userData.curve=roundedPath(pts,bend||r*1.6); g.userData.r=r; g.userData.rect=[w,h];   // reused by the duct-airflow layer
  (group||rigDucts).add(g);
  return g;
}
function rectDuct(name,w,h,d,x,y,z){
  var m=at(box(w,h,d,MR.pvc),x,y,z); m.renderOrder=2; tag(m,name);
  var e=new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry),
    new THREE.LineBasicMaterial({color:T.metalDark.clone(),transparent:true,opacity:0.55}));
  m.add(e); rigDucts.add(m); return m;
}
function flangeRing(name,x,y,z,r,axis){             // rectangular wall sleeve flange around a duct
  var w=DUCT_W*r+0.5, h=DUCT_H*r+0.5, t=0.4, g=new THREE.Group(); tag(g,name);
  g.add(at(box(t,t,w+2*t,MR.steel),0,h/2+t/2,0)); g.add(at(box(t,t,w+2*t,MR.steel),0,-h/2-t/2,0));
  g.add(at(box(t,h,t,MR.steel),0,0,w/2+t/2)); g.add(at(box(t,h,t,MR.steel),0,0,-w/2-t/2));
  if(axis==='y') g.rotation.z=Math.PI/2; else if(axis==='z') g.rotation.y=Math.PI/2;
  at(g,x,y,z); rigDucts.add(g); return g;
}

var MBIBO={bag:std(new THREE.Color('#e8f2f8'),{m:0,r:0.35,t:true,o:0.45,side:THREE.DoubleSide,dw:false}),
  pack:std(new THREE.Color('#e9edf1'),{m:0.05,r:0.9}), ring:std(new THREE.Color('#9aa7b2'),{m:0.85,r:0.3})};
/* key world points from the earlier model */
var P_AHU_OA = C2W(-13.4,YS,0), P_AHU_SUP=C2W(13.4,YS,0);
var P_HR_EXIN=C2W(MX1+0.5,MY,MZU);                     // the air-pump unit's exhaust inlet spigot (the only exhaust path)
var P_HR_TOUT=C2W(MX1+0.5,MY,MZL);                     // … and its tempered fresh-air outlet spigot
var TEMPR=[[P_HR_TOUT.x,P_HR_TOUT.y,P_HR_TOUT.z],[-24.8,P_HR_TOUT.y,P_HR_TOUT.z],[-24.8,P_HR_TOUT.y,-1.0],[-34.6,P_HR_TOUT.y,-1.0],[-34.6,P_AHU_OA.y,2.6]];
var P_HR_FRESH=C2W(MX0-1.0,MY,MZU), P_HR_EXH=C2W(MX0-1.0,MY,MZL);
/* outer HEPA on its own floor stand at the front-right of the plant room, next to the common exhaust stack;
   the stack takes both exhausts (FAN-103 normal, FAN-103B bypass), each through a backdraft damper */
var BYP={y:22, z:-5.415, x0:-42.4, x1:-36, fx:-43.6, rx:-46.4, ty:40, sx:-7.5, sz:10, top:57, jy:45};
var EXR=[[P_HR_EXH.x+0.1,P_HR_EXH.y,P_HR_EXH.z],[-48.4,P_HR_EXH.y,P_HR_EXH.z],[-48.4,P_HR_EXH.y,-21],[-48.4,BYP.jy,-21],
         [BYP.sx,BYP.jy,-21],[BYP.sx,BYP.jy,BYP.sz-0.8]];
var HX=-46.5, HY=11;                                   // fresh-air header line
var COMP={x:-42.5,y:22,z:-14};                         // fresh-air compressor (volute centre)

/* fresh-air header: compressor → recovery air-pump unit + AHU */
duct('Compressor discharge',[[COMP.x,17.6,-11.3],[COMP.x,13.6,-11.3],[COMP.x-2.6,HY,-11.3],[HX+0.2,HY,-11.3]],1.1);
duct('Fresh-air header',[[HX,HY,-12.4],[HX,HY,3.4]],1.15);
/* the air-pump unit's lanes now carry all the fresh air and all the exhaust: tall, narrow sections that fit
   its spigots (1.6 × 2.2 cm), so the velocity stays near 5 m/s */
var LANE=[1.6,2.2];
duct('Header → recovery unit (fresh lane)',[[HX,HY,P_HR_FRESH.z],[HX,P_HR_FRESH.y,P_HR_FRESH.z],[P_HR_FRESH.x-0.2,P_HR_FRESH.y,P_HR_FRESH.z]],0.75,null,null,null,LANE);
duct('Core bypass: header → AHU (baseline test)',[[HX,HY,P_AHU_OA.z],[HX,P_AHU_OA.y,P_AHU_OA.z],[P_AHU_OA.x+0.3,P_AHU_OA.y,P_AHU_OA.z]],1.0);
/* the connections the earlier model drew only as air: recovery unit → AHU, and the exhaust run */
(function transfer(){
  var LNr=0.62;
  function cduct(name,pts,r,wh){
    var w=pts.map(function(p){ var v=C2W(p[0],p[1],p[2]); return [v.x,v.y,v.z]; });
    return duct(name,w,r*K,null,null,null,wh);
  }
  /* tempered air leaves the unit, runs towards the partition first, then behind the AHU to its intake,
     so it never crosses the exhaust inlet */
  duct('Tempered-air duct: recovery unit → AHU',TEMPR,LNr*K,null,null,null,LANE);
  /* the air-pump unit's exhaust no longer leaves through the outdoor wall next to the fresh-air intake:
     it climbs in the back-left corner, runs along the top of the plant room and joins the common roof
     stack at the front-right, as far from the intake as the room allows */
  duct('Exhaust: air-pump unit → roof stack',EXR,0.6*K,null,null,null,LANE);
})();
/* supply: AHU supply connection → boot → riser → through the partition → ceiling void */
var RZ=8.5, RX=-4.5, RY=44.5;
rectDuct('Supply boot',3.0,2.32,8.7, -4.5,P_AHU_SUP.y,5.7);
/* the riser feeds the bag-in/bag-out supply terminals: ceiling terminal 1, the LAF hood over the filler, and
   ceiling terminals 2 + 3 above and just behind the operator (down-flow over the operator to exhaust terminal 3) */
var LAF={x0:25.6,x1:35.4,z0:-15.4,z1:7.4,y0:24,y1:27.6};       // unidirectional-flow hood over the filler
var CT={x:44.5, z:[-5.2,3.2], a:7.2, tx:39.5};                  // ceiling terminals 2 + 3: centre x, centre z's, face size, riser tee
duct('Supply riser',[[RX,P_AHU_SUP.y+1.1,RZ],[RX,RY,RZ],[0.6,RY,RZ],[8,RY,RZ],[8,RY,0],[CT.tx,RY,0]],1.4);
duct('Terminal drop 1 (ceiling)',[[14,RY,0],[14,CEIL+1.4,0]],1.0);
duct('LAF supply drop',[[30.5,RY,0],[30.5,RY-1.4,-4],[30.5,LAF.y1+0.2,-4]],1.1);
CT.z.forEach(function(z,i){                                      // tee at the end of the riser, one drop per terminal
  duct('Terminal drop '+(i+2)+' (ceiling, above the operator)',[[CT.tx,RY,0],[CT.tx,RY,z],[CT.x,RY,z],[CT.x,CEIL+1.4,z]],0.85);
});
flangeRing('Partition sleeve: supply',0,RY,RZ,1.4,'x');
/* exhaust: low-level BIBO HEPA exhaust terminals in the partition → collector → PT-102 → DV-101 →
   straight to the air-pump unit (Cu core). Nothing goes back to the AHU. */
var GRILLE=[[6.9,3],[6.9,-13]];                                // low-level exhaust terminals in the partition: centre y, z
var T3={y:4.15, z:-1, hx:51.3, dz:-26.3};                       // exhaust terminal 3: low on the right wall, behind the operator;
                                                                // its BIBO housing sits outside the wall (x hx), its duct runs outside the back wall (z dz)
var EXY=11, EXZ=P_HR_EXIN.z, DVX=-23.5;                          // exhaust main height, line, diverter position
duct('Exhaust collector A (behind the partition)',[[-1.75,9.6,GRILLE[0][1]],[-1.75,EXY,GRILLE[0][1]],[-1.75,EXY,EXZ-0.9]],0.85);
duct('Exhaust collector B (behind the partition)',[[-1.75,9.6,GRILLE[1][1]],[-1.75,EXY,GRILLE[1][1]],[-1.75,EXY,EXZ+0.9]],0.85);
duct('Exhaust collector C (right wall, behind the operator)',[[T3.hx,T3.y,T3.z-3.5],[T3.hx,T3.y,T3.dz],[-1.75,T3.y,T3.dz],[-1.75,EXY,T3.dz],[-1.75,EXY,GRILLE[1][1]]],0.85);
duct('Exhaust main: clean room → DV-101',[[-1.75,EXY,EXZ],[DVX+1.4,EXY,EXZ]],0.75,null,null,null,LANE);
duct('Exhaust: DV-101 → air-pump unit (Cu core)',[[DVX-1.4,EXY,EXZ],[-27.2,EXY,EXZ],[-27.2,P_HR_EXIN.y,EXZ],[P_HR_EXIN.x+0.45,P_HR_EXIN.y,EXZ]],0.75,null,null,null,LANE);
/* the HEPA bypass climbs from DV-101 and runs to the front of the plant room, towards the partition; the outer
   HEPA, FAN-103B and a vertical stack through the roof sit there, well away from the fresh-air compressor and
   its intake louvre (a contaminated discharge must never be drawn back into the fresh air) */

/* the outer HEPA sits on a shelf beside the fresh-air compressor (both serviced from the outdoor-wall side);
   its discharge still rises and runs to the one roof stack at the front-right, far from the fresh-air intake */
duct('HEPA bypass: DV-101 → outer BIBO HEPA',[[DVX,EXY+1.4,EXZ],[DVX,BYP.y,EXZ],[BYP.x1,BYP.y,BYP.z]],0.75,null,null,null,LANE);
duct('Bypass discharge: FAN-103B → roof stack',[[BYP.fx-1.2,BYP.y,BYP.z],[BYP.rx,BYP.y,BYP.z],[BYP.rx,BYP.ty,BYP.z],[BYP.sx,BYP.ty,BYP.z],
  [BYP.sx,BYP.ty,BYP.sz],[BYP.sx,BYP.top,BYP.sz]],0.75,null,null,null,LANE);
flangeRing('Roof sleeve: common exhaust stack',BYP.sx,BY-TH/2,BYP.sz,0.75,'y');
/* contaminated-exhaust protection: PT-102 watches the exhaust on its way to the air pump; if it carries
   particles (a release in the room, or a leaking exhaust-terminal filter) L3 throws DV-101 and the exhaust
   goes through the outer BIBO HEPA (police filter) and FAN-103B to outdoors, never through the Cu core.
   DV-101 is spring return: with no power it rests on the HEPA bypass (fail-safe). */
var exhSafe=new THREE.Group(); exhSafe.userData.asm='Exhaust safety: PT-102 + DV-101 + outer HEPA'; rig.add(exhSafe);
var DVBLADE;
(function exhaustSafety(){
  var top=EXY+LANE[1]/2;
  var pt=new THREE.Group(); tag(pt,'PT-102 exhaust particle sensor');
  pt.add(at(box(3.0,2.6,2.2,MR.white),-17,top+1.3,EXZ));
  pt.add(at(box(2.0,1.0,0.12,MR.black),-17,top+1.6,EXZ+1.12));
  pt.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.18,1.6,10),MR.steel),-17.8,top-0.2,EXZ));     // sample probe into the duct
  exhSafe.add(pt);
  var tt=new THREE.Group(); tag(tt,'TT-107 exhaust air T (DS18B20)');
  tt.add(at(box(0.9,0.9,0.9,MR.white),-14.2,top+0.45,EXZ)); exhSafe.add(tt);
  var dv=new THREE.Group(); tag(dv,'DV-101 diverter damper + spring-return actuator');
  dv.add(at(box(2.8,2.8,2.4,MR.steel),DVX,EXY+0.3,EXZ));
  dv.add(at(box(1.8,1.8,1.3,MR.black),DVX,EXY+0.3,EXZ+2.0));                                              // 24 V spring-return actuator
  dv.add(at(box(0.5,0.5,0.4,std(new THREE.Color('#f59e0b'),{m:0.2,r:0.5})),DVX+0.5,EXY+0.9,EXZ+2.7));     // position indicator
  DVBLADE=at(box(2.4,0.12,1.9,MR.alu),DVX,EXY+0.3,EXZ); dv.add(DVBLADE);
  exhSafe.add(dv);
  bibo('Outer BIBO HEPA housing (H14 police filter)',(BYP.x0+BYP.x1)/2,BYP.y,BYP.z,BYP.x1-BYP.x0,6.0,6.0,'+z',exhSafe);
  var fb=new THREE.Group(); tag(fb,'FAN-103B HEPA-bypass exhaust fan');
  fb.add(at(box(2.4,4.4,4.4,MR.blue),BYP.fx,BYP.y,BYP.z));
  var mo=new THREE.Mesh(new THREE.CylinderGeometry(1.2,1.2,1.6,20),MR.alu); mo.rotation.x=Math.PI/2; at(mo,BYP.fx,BYP.y,BYP.z+3.0); fb.add(mo);
  exhSafe.add(fb);
  var cap=new THREE.Mesh(new THREE.ConeGeometry(2.2,1.4,4),MR.steel); cap.rotation.y=Math.PI/4; at(cap,BYP.sx,BYP.top+1.6,BYP.sz); tag(cap,'Exhaust stack rain cap');
  var st=new THREE.Group(); tag(st,'Outer HEPA wall shelf');                       // on the outdoor wall, beside FAN-101
  st.add(at(box(14,0.5,6.6,MR.alu),-42.2,BYP.y-3.25,BYP.z));
  st.add(at(box(0.5,5.5,6.6,MR.alu),-BX+TH+0.25,BYP.y-5.75,BYP.z));
  var br2=box(0.5,8,0.5,MR.alu); br2.rotation.z=-0.72; at(br2,-BX+3.9,BYP.y-6.6,BYP.z); st.add(br2);
  exhSafe.add(st);
  [['Backdraft damper: normal exhaust',BYP.sx,BYP.jy,BYP.sz-1.6,0],['Backdraft damper: HEPA bypass',BYP.sx-2,BYP.ty,BYP.z,1]].forEach(function(q){
    var g=new THREE.Group(); tag(g,q[0]); g.add(at(box(q[4]?0.5:2.0,2.6,q[4]?2.0:0.5,MR.steel),q[1],q[2],q[3]));
    var bl=box(q[4]?0.1:1.6,1.9,q[4]?1.6:0.1,MR.alu); bl.rotation[q[4]?'z':'x']=0.5; at(bl,q[1],q[2],q[3]); g.add(bl); exhSafe.add(g); });
  exhSafe.add(cap);
})();

/* --------------------------------------------- fresh-air compressor */
var compRotor=new THREE.Group();
(function compressor(){
  var g=new THREE.Group(); tag(g,'FAN-101 fresh-air compressor'); g.userData.asm='Fresh-air compressor';
  var vol=new THREE.Mesh(new THREE.CylinderGeometry(4.2,4.2,3.6,40),MR.blue); vol.rotation.z=Math.PI/2;
  at(vol,COMP.x,COMP.y,COMP.z); g.add(vol);
  // scroll outlet, tangential and downward
  g.add(at(box(3.6,5.6,3.0,MR.blue),COMP.x,COMP.y-3.0,COMP.z+2.75));
  g.add(at(box(3.0,0.5,2.4,MR.steel),COMP.x,COMP.y-5.9,COMP.z+2.75));
  // inlet bell + intake duct to the wall louvre
  var bell=new THREE.Mesh(new THREE.TorusGeometry(2.0,0.45,12,32),MR.steel); bell.rotation.y=Math.PI/2;
  at(bell,COMP.x-2.0,COMP.y,COMP.z); g.add(bell);
  var intake=box(5.0,3.4,3.4,MR.pvc); at(intake,COMP.x-4.5,COMP.y,COMP.z); intake.userData.cad={type:'rseg',wall:0.15}; g.add(intake);
  // motor on the far side
  var mot=new THREE.Mesh(new THREE.CylinderGeometry(2.2,2.2,5.2,28),MR.alu); mot.rotation.z=Math.PI/2;
  at(mot,COMP.x+4.6,COMP.y,COMP.z); g.add(mot);
  for(var i=0;i<6;i++){
    var fn=new THREE.Mesh(new THREE.TorusGeometry(2.2,0.12,6,28),MR.alu); fn.rotation.y=Math.PI/2;
    at(fn,COMP.x+2.8+i*0.75,COMP.y,COMP.z); g.add(fn);
  }
  var cap=new THREE.Mesh(new THREE.CylinderGeometry(1.6,2.2,0.8,28),MR.black); cap.rotation.z=-Math.PI/2;
  at(cap,COMP.x+7.6,COMP.y,COMP.z); g.add(cap);
  g.add(at(box(2.0,1.2,1.6,MR.black),COMP.x+4.6,COMP.y+2.6,COMP.z));          // driver box
  g.add(at(box(3.0,2.3,2.6,MR.alu),COMP.x+4.6,COMP.y-3.35,COMP.z));            // motor foot
  // impeller (spins with the PWM speed)
  for(var b=0;b<10;b++){
    var bl=box(0.3,1.5,0.18,MR.steel), a=b/10*Math.PI*2;
    bl.position.set(0,Math.cos(a)*2.4,Math.sin(a)*2.4); bl.rotation.x=-a; bl.rotateZ(0.5); compRotor.add(bl);
  }
  compRotor.add(at(new THREE.Mesh(new THREE.CylinderGeometry(1.1,1.1,1.2,20),MR.steel),0,0,0));
  compRotor.children[compRotor.children.length-1].rotation.z=Math.PI/2;
  compRotor.position.set(COMP.x+0.4,COMP.y,COMP.z); g.add(compRotor);
  // wall bracket + shelf
  g.add(at(box(14.4,0.5,5.6,MR.alu),-42.3,COMP.y-4.75,COMP.z-1.8));
  g.add(at(box(0.5,6,5.6,MR.alu),-BX+TH+0.25,COMP.y-2.0,COMP.z-1.8));
  var br=box(0.5,9.2,0.5,MR.alu); br.rotation.z=-0.72; at(br,-BX+3.9,COMP.y-8.0,COMP.z-3.8); g.add(br);
  // intake hood on the outside of the left wall
  g.add(at(box(2.6,6.0,6.0,MR.steel),-BX-1.3,COMP.y+0.6,COMP.z));
  g.add(at(box(0.3,4.6,4.6,std(T.metal.clone(),{m:0.6,r:0.5,t:true,o:0.4,side:THREE.DoubleSide})),-BX-2.65,COMP.y,COMP.z));
  rig.add(g);
})();

/* ------------------------------------------------------- clean room */
var clean=new THREE.Group(); clean.userData.asm='Clean room'; rig.add(clean);
var DIFF=[[14,0]];
/* Bag-in/bag-out (BIBO) HEPA housing: stainless body, H14 pack, a clamped filter-change port with its
   PVC change bag on the ring, so a used filter is bagged out without anyone touching it. ax is the
   air direction ('x','y','z'); bag is the side the change port is on ('+x','-z' …). */
function bibo(name,cx,cy,cz,w,h,d,bag,host){
  var g=new THREE.Group(); tag(g,name);
  g.add(at(box(w,h,d,MR.steel),cx,cy,cz));
  var sx=bag[1]==='x'?(bag[0]==='+'?1:-1):0, sy=bag[1]==='y'?(bag[0]==='+'?1:-1):0, sz=bag[1]==='z'?(bag[0]==='+'?1:-1):0;
  var px=cx+sx*(w/2+0.25), py=cy+sy*(h/2+0.25), pz=cz+sz*(d/2+0.25), rr=Math.min(sx?Math.min(h,d):(sy?Math.min(w,d):Math.min(w,h)),6)*0.32;
  var ring=new THREE.Mesh(new THREE.TorusGeometry(rr,0.22,8,28),MBIBO.ring);
  if(sx) ring.rotation.y=Math.PI/2; else if(sy) ring.rotation.x=Math.PI/2;
  at(ring,px,py,pz); g.add(ring);
  var bg=new THREE.Mesh(new THREE.SphereGeometry(rr,18,12),MBIBO.bag); bg.scale.set(sx?1.4:0.95,sy?1.4:0.95,sz?1.4:0.95);
  bg.position.set(px+sx*rr*0.9,py+sy*rr*0.9-(sy?0:rr*0.25),pz+sz*rr*0.9); g.add(bg);
  var lv=box(0.35,0.35,1.6,MBIBO.ring); at(lv,px+sx*0.3+(sx?0:rr+0.6),py+sy*0.3,pz+sz*0.3); g.add(lv);   // clamp lever
  (host||clean).add(g); return g;
}
/* perforated stainless grille (round holes on a square pitch) on every terminal face */
var PERF_TEX=(function(){
  var cv=document.createElement('canvas'); cv.width=cv.height=64; var c=cv.getContext('2d');
  c.fillStyle='#e8edf1'; c.fillRect(0,0,64,64); c.fillStyle='#3a4552';
  for(var i=0;i<4;i++) for(var j=0;j<4;j++){ c.beginPath(); c.arc(8+i*16,8+j*16,4.2,0,Math.PI*2); c.fill(); }
  var t=new THREE.CanvasTexture(cv); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.anisotropy=4; return t;
})();
function hepaFace(name,cx,cy,cz,a,b,normal,host){              // perforated grille seen from the room
  // normal 'x': a = height (y), b = width (z) · 'y': a = x, b = z · 'z': a = x, b = y
  var g=new THREE.Group(); tag(g,name);
  var tex=PERF_TEX.clone(); tex.needsUpdate=true; tex.repeat.set(Math.max(1,a/1.1),Math.max(1,b/1.1));
  var mt=new THREE.MeshStandardMaterial({map:tex,metalness:0.55,roughness:0.4});
  mt.userData.cadColor=new THREE.Color('#d4dbe1');               // the CAD export keeps a plain stainless colour
  var plate=normal==='x'?box(0.3,a,b,mt):(normal==='y'?box(a,0.3,b,mt):box(a,b,0.3,mt));
  g.add(at(plate,cx,cy,cz));
  var fr=0.5, fm=MR.steel;                                         // frame
  if(normal==='y'){ g.add(at(box(a+fr,0.4,fr,fm),cx,cy,cz-b/2)); g.add(at(box(a+fr,0.4,fr,fm),cx,cy,cz+b/2));
    g.add(at(box(fr,0.4,b,fm),cx-a/2,cy,cz)); g.add(at(box(fr,0.4,b,fm),cx+a/2,cy,cz)); }
  else if(normal==='x'){ g.add(at(box(0.4,fr,b+fr,fm),cx,cy-a/2,cz)); g.add(at(box(0.4,fr,b+fr,fm),cx,cy+a/2,cz));
    g.add(at(box(0.4,a,fr,fm),cx,cy,cz-b/2)); g.add(at(box(0.4,a,fr,fm),cx,cy,cz+b/2)); }
  (host||clean).add(g); return g;
}
/* ceiling terminal 1: H14 BIBO housing in the ceiling void, filter face flush with the false ceiling */
DIFF.forEach(function(d,i){
  bibo('Ceiling BIBO HEPA terminal '+(i+1)+' (H14)',d[0],CEIL+2.2,d[1],8.6,3.6,8.6,'+z');
  hepaFace('Ceiling terminal '+(i+1)+' face screen',d[0],CEIL-0.15,d[1],8.6,8.6,'y');
});
/* LAF hood over the vial filler: unidirectional down-flow, H14 BIBO pack, fed with 100 % fresh air from
   the riser (no fan, no recirculation); clear PVC skirts guide the first air down to the RABS */
(function lafHood(){
  var cx=(LAF.x0+LAF.x1)/2, cz=(LAF.z0+LAF.z1)/2, w=LAF.x1-LAF.x0, d=LAF.z1-LAF.z0;
  bibo('LAF hood: H14 BIBO filter housing',cx,(LAF.y0+LAF.y1)/2,cz,w,LAF.y1-LAF.y0,d,'-z');
  hepaFace('LAF hood: perforated outlet screen',cx,LAF.y0-0.15,cz,w-0.6,d-0.6,'y');
  var g=new THREE.Group(); tag(g,'LAF hood: PVC skirts + hangers');
  var sk=std(new THREE.Color('#dbeef7'),{m:0.05,r:0.05,t:true,o:0.18,side:THREE.DoubleSide,dw:false});
  var sh=4.4, sy=LAF.y0-sh/2-0.3;
  [[cx,LAF.z0,w,0.15],[cx,LAF.z1,w,0.15]].forEach(function(q){ var m_=at(box(q[2],sh,q[3],sk),q[0],sy,q[1]); m_.renderOrder=2; g.add(m_); });
  [[LAF.x0,cz],[LAF.x1,cz]].forEach(function(q){ var m_=at(box(0.15,sh,d,sk),q[0],sy,q[1]); m_.renderOrder=2; g.add(m_); });
  [[LAF.x0+1,LAF.z0+1],[LAF.x0+1,LAF.z1-1],[LAF.x1-1,LAF.z0+1],[LAF.x1-1,LAF.z1-1]].forEach(function(q){
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.18,CEIL-LAF.y1,8),MR.steel),q[0],(CEIL+LAF.y1)/2,q[1])); });
  clean.add(g);
})();
/* ceiling terminals 2 + 3: H14 BIBO housings in the ceiling void, above and just behind the operator. Clean air comes
   down over the operator (head and shoulders first), so what the operator sheds is carried down to exhaust terminal 3
   at the foot of the wall behind them, away from the filler; the LAF hood keeps the Grade A first air over the product.
   Bagged out from the ceiling void, like terminal 1. 72 × 72 mm faces: the same face velocity as terminal 1. */
CT.z.forEach(function(z,i){
  bibo('Ceiling BIBO HEPA terminal '+(i+2)+' (H14)',CT.x,CEIL+1.9,z,CT.a,3.0,CT.a,i?'+z':'-z');
  hepaFace('Ceiling terminal '+(i+2)+' face screen',CT.x,CEIL-0.15,z,CT.a,CT.a,'y');
});
/* low-level exhaust terminals in the partition: H14 BIBO housings on the plant-room side, so a
   contaminated filter is bagged out from outside the clean room */
GRILLE.forEach(function(gr,i){
  var y=gr[0], z=gr[1];
  hepaFace('Low-level exhaust terminal '+(i+1)+' face screen',TH/2+0.2,y,z,5.4,7.0,'x');
  bibo('Exhaust BIBO HEPA terminal '+(i+1)+' (H14)',-1.6,y,z,2.6,5.4,7.0,i?'-z':'+z',rigDucts);
});
/* exhaust terminal 3: low on the right wall, right behind the operator and under ceiling terminals 2 + 3, so what the
   operator sheds is taken straight down and out. Its H14 BIBO housing is outside the wall (bagged out from outside the
   clean room); collector C runs outside the right and back walls and enters the plant room to join collector B. */
hepaFace('Low-level exhaust terminal 3 face screen',BX-TH-0.2,T3.y,T3.z,5.4,7.0,'x');
bibo('Exhaust BIBO HEPA terminal 3 (H14)',T3.hx,T3.y,T3.z,2.6,5.4,7.0,'+z',rigDucts);
(function ledPanel(){
  var m=at(box(22,0.3,6,MR.led),24,CEIL-0.25,-15); tag(m,'LED clean-room luminaire'); clean.add(m);
})();

/* ------------------------------------------------------ PCB + HMI */
var ctrl=new THREE.Group(); ctrl.userData.asm='Controls and HMI'; rig.add(ctrl);
var PCB={x0:-30,x1:-12,y0:27,y1:39,z:-BZ+TH+1.6};       // on the back wall, components face into the box
var pcbTex=(function(){
  var cv=document.createElement('canvas'); cv.width=1080; cv.height=720;
  var c=cv.getContext('2d'); pcbTex_draw(c,cv.width,cv.height);
  var t=new THREE.CanvasTexture(cv); t.anisotropy=4; return t;
})();
function pcbTex_draw(c,w,h){
  c.fillStyle='#0f5a35'; c.fillRect(0,0,w,h);
  c.strokeStyle='rgba(214,170,90,.85)'; c.lineCap='round';
  // traces: bus lines from the MCU to the edge connectors
  for(var i=0;i<16;i++){
    var x=60+i*62; c.lineWidth=5;
    c.beginPath(); c.moveTo(540,330); c.lineTo(540+(x-540)*0.4,470); c.lineTo(x,560); c.lineTo(x,h-40); c.stroke();
  }
  for(var j=0;j<6;j++){ c.lineWidth=7; c.beginPath(); c.moveTo(120+j*150,40); c.lineTo(120+j*150,150); c.lineTo(540,250); c.stroke(); }
  c.fillStyle='rgba(214,170,90,.9)';
  for(var k=0;k<16;k++){ c.beginPath(); c.arc(60+k*62,h-34,13,0,Math.PI*2); c.fill(); }
  c.fillStyle='#f1f5f2'; c.font='bold 34px IBM Plex Mono, monospace';
  c.fillText('CLEAN-ROOM RIG CTRL  v1.0',260,705-40-610);
  c.font='22px IBM Plex Mono, monospace';
  ['FT101','FT102','1W-A','1W-B','I2C','FAN101','FAN102','FAN103','SV101','CMP101','RV101','EEV101','HTR101','HUM101','CLEAN','PDT101']
    .forEach(function(s,i){ c.save(); c.translate(52+i*62,h-60); c.rotate(-Math.PI/2); c.fillText(s,0,0); c.restore(); });
  c.fillText('ESP32-S3',470,300); c.fillText('ACS712 ×3',760,170); c.fillText('24V IN',40,120); c.fillText('HMI UART',880,60);
  c.strokeStyle='#f1f5f2'; c.lineWidth=2; c.strokeRect(14,14,w-28,h-28);
}
(function pcb(){
  var g=new THREE.Group(); tag(g,'Main controller PCB');
  var w=PCB.x1-PCB.x0, h=PCB.y1-PCB.y0, cx=(PCB.x0+PCB.x1)/2, cy=(PCB.y0+PCB.y1)/2;
  var board=new THREE.Mesh(new THREE.BoxGeometry(w,h,0.16),[MR.pcb,MR.pcb,MR.pcb,MR.pcb,
    new THREE.MeshStandardMaterial({map:pcbTex,metalness:0.15,roughness:0.55}),MR.pcb]);
  at(board,cx,cy,PCB.z); g.add(board);
  var zf=PCB.z+0.08;                                   // component side, towards the clear front wall
  function comp(mesh,x,y,dz){ mesh.position.set(x,y,zf+dz); g.add(mesh); return mesh; }
  comp(box(2.6,1.8,0.32,MR.steel),cx,cy+0.6,0.16);                         // ESP32-S3 module can
  comp(box(3.0,2.4,0.1,MR.chip),cx,cy+0.4,0.05);
  [0,1,2].forEach(function(i){                                             // ACS712 current sensors
    comp(box(0.6,0.5,0.18,MR.chip),PCB.x1-4.2+i*1.3,PCB.y1-3.5,0.09);
    comp(box(1.0,0.8,0.8,MR.term),PCB.x1-4.2+i*1.3,PCB.y1-2.0,0.4);
  });
  [0,1,2,3].forEach(function(i){                                           // MOSFET drivers + heatsinks
    comp(box(0.8,1.2,0.35,MR.chip),PCB.x0+2+i*1.6,cy+2.4,0.18);
    comp(box(1.2,1.6,0.25,MR.steel),PCB.x0+2+i*1.6,cy+3.6,0.55);
  });
  var ind=new THREE.Mesh(new THREE.CylinderGeometry(0.7,0.7,0.7,18),MR.black); ind.rotation.x=Math.PI/2;
  comp(ind,PCB.x0+1.8,PCB.y1-2.2,0.35);                                    // buck converter
  for(var c2=0;c2<3;c2++){ var cap=new THREE.Mesh(new THREE.CylinderGeometry(0.35,0.35,1.0,14),MR.black);
    cap.rotation.x=Math.PI/2; comp(cap,PCB.x0+3.4+c2*0.9,PCB.y1-2.2,0.5); }
  comp(box(0.9,0.9,0.12,MR.chip),cx+3.2,cy+0.4,0.06);                      // TCA9548A I²C mux
  comp(box(16.6,0.9,0.8,MR.black),cx,PCB.y0+0.8,0.4);                      // edge connectors (harness)
  comp(box(2.4,0.9,1.0,MR.term),PCB.x0+1.8,PCB.y1-0.9,0.5);                // 24 V terminal
  comp(box(2.0,0.7,0.8,MR.black),PCB.x1-2,PCB.y1-0.8,0.4);                 // HMI header
  window.__leds=[];
  ['#22c55e','#f59e0b','#ef4444'].forEach(function(cl,i){
    var l=new THREE.Mesh(new THREE.BoxGeometry(0.3,0.2,0.2),new THREE.MeshBasicMaterial({color:cl}));
    comp(l,cx-3+i*0.6,PCB.y1-0.8,0.1); window.__leds.push(l);
  });
  [[PCB.x0+0.6,PCB.y0+0.6],[PCB.x1-0.6,PCB.y0+0.6],[PCB.x0+0.6,PCB.y1-0.6],[PCB.x1-0.6,PCB.y1-0.6]].forEach(function(p){
    var s=new THREE.Mesh(new THREE.CylinderGeometry(0.25,0.25,1.5,10),MR.steel); s.rotation.x=Math.PI/2;
    at(s,p[0],p[1],PCB.z-0.83); g.add(s);
  });
  ctrl.add(g);
})();
var hmiTex, hmiCanvas, hmiScreenMesh;
(function hmi(){
  var g=new THREE.Group(); tag(g,'HMI-101 7-inch touch screen');
  hmiCanvas=document.createElement('canvas'); hmiCanvas.width=800; hmiCanvas.height=450;
  hmiTex=new THREE.CanvasTexture(hmiCanvas); hmiTex.anisotropy=4;
  var face=new THREE.Group();
  face.add(at(box(17.4,10.6,1.0,MR.black),0,0,0));
  hmiScreenMesh=new THREE.Mesh(new THREE.PlaneGeometry(15.4,8.66),new THREE.MeshBasicMaterial({map:hmiTex}));
  hmiScreenMesh.position.set(0,0,0.52); face.add(hmiScreenMesh); tag(hmiScreenMesh,'HMI-101 display');
  face.position.set(-38,41.5,BZ+1.6); face.rotation.x=-0.12; g.add(face);
  [[-6,-3],[6,-3],[-6,3],[6,3]].forEach(function(p){
    var s=new THREE.Mesh(new THREE.CylinderGeometry(0.3,0.3,1.2,10),MR.steel); s.rotation.x=Math.PI/2;
    at(s,-38+p[0],41.5+p[1],BZ+0.6); g.add(s);
  });
  ctrl.add(g);
})();
(function psu(){
  var g=new THREE.Group(); tag(g,'24 V DC power supply');
  g.add(at(box(9,3.2,5,MR.steel),-40,TH+1.6,-20));
  for(var i=0;i<8;i++) g.add(at(box(0.25,2.4,4.2,MR.alu),-43.6+i*1.0,TH+3.3,-20));
  var cb=new THREE.Mesh(new THREE.CylinderGeometry(0.35,0.35,4.6,10),MR.black); cb.rotation.z=Math.PI/2;
  at(cb,-46.8,TH+1.6,-20); g.add(cb);
  ctrl.add(g);
})();
/* small sensor bodies the earlier model did not have */
(function rigSensors(){
  function body(name,w,h,d,x,y,z,mat){ var m=at(box(w,h,d,mat||MR.white),x,y,z); tag(m,name); ctrl.add(m); return m; }
  body('TT-101/MT-101 fresh-air T+RH (SHT31)',1.4,1.4,1.0,HX-1.6,HY+0.4,-1.2);
  body('FT-101 fresh-air flow (D6F)',1.6,1.2,1.2,HX-1.6,HY+0.2,1.4,MR.black);
  body('FT-102 supply airflow (D6F)',1.6,1.2,1.2,RX,20,RZ+1.9,MR.black);
  body('MT-106 room T+RH (SHT31)',3,4,1.2,44,22,-BZ+TH+0.6);
  body('PDT-101 room ΔP (SDP810)',1.2,3,2.6,TH/2+0.6,30,-19);
  var tb=new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.18,2.4,8),MR.pvc); tb.rotation.z=Math.PI/2;
  at(tb,-0.5,30.8,-19); tag(tb,'PDT-101 reference tube'); ctrl.add(tb);
  body('TT-108 exhaust T (DS18B20)',0.8,0.8,0.8,C2W(-18.3,0,0).x,C2W(0,MY+MH/2,0).y+0.4,C2W(0,0,MZL).z);
})();

/* ================================================= clean-room equipment
   Human scale in the clean room is about 1:7 (the 14 cm bench is a 1 m bench),
   so the operator is 25 cm tall and the machine sizes follow from that. */
var CR={};                                         // animated parts, driven by updateCleanRoom()

/* staging bench on the front wall, right beside the pass box: material goes pass box → bench → filler
   infeed in a few steps, and the bench stays out of the air path to the low-level exhausts
   (at the back-left it stood right in front of exhaust terminal 2) */
(function bench(){
  var g=new THREE.Group(); tag(g,'Staging bench + vial tray');
  var x=23, z=19.6, h=13;
  g.add(at(box(12,0.6,8,MR.steel),x,h,z));
  g.add(at(box(10.6,0.4,6.4,MR.steel),x,4,z));
  [[-5.4,-3.4],[-5.4,3.4],[5.4,-3.4],[5.4,3.4]].forEach(function(p){
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.45,0.45,h-0.5,12),MR.steel),x+p[0],(h-0.5)/2+0.5,z+p[1]));
  });
  g.add(at(box(7,0.5,4.4,MR.white),x-1.0,h+0.55,z));
  var vg=std(new THREE.Color('#bfe6ff'),{m:0.1,r:0.1,t:true,o:0.6});
  for(var i=0;i<4;i++) for(var j=0;j<2;j++)
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.5,1.6,14),vg),x-4.1+i*1.5,h+1.6,z-1.0+j*2.0));
  clean.add(g);
})();

/* ------------------------------------------------ pass box (stand-alone, not wired to the rig PCB) */
var PBX={x0:6,x1:16,y0:12.5,y1:22.5,zi:18,zo:28};   // body; the front wall sits at z 24.5…25
(function passBox(){
  var g=new THREE.Group(); tag(g,'Pass box'); g.userData.asm='Clean room';
  var cx=(PBX.x0+PBX.x1)/2, cy=(PBX.y0+PBX.y1)/2, cz=(PBX.zi+PBX.zo)/2;
  var W_=PBX.x1-PBX.x0, H_=PBX.y1-PBX.y0, D_=PBX.zo-PBX.zi, t=0.3;
  // stainless shell, open at both ends for the doors
  g.add(at(box(W_,t,D_,MR.steel),cx,PBX.y1-t/2,cz));
  g.add(at(box(W_,t,D_,MR.steel),cx,PBX.y0+t/2,cz));
  g.add(at(box(t,H_,D_,MR.steel),PBX.x0+t/2,cy,cz));
  g.add(at(box(t,H_,D_,MR.steel),PBX.x1-t/2,cy,cz));
  // wall flange on both faces of the acrylic
  [BZ-TH-0.15,BZ+0.15].forEach(function(z){
    g.add(at(box(W_+2,0.6,0.3,MR.steel),cx,PBX.y1+0.7,z)); g.add(at(box(W_+2,0.6,0.3,MR.steel),cx,PBX.y0-0.7,z));
    g.add(at(box(0.6,H_+2,0.3,MR.steel),PBX.x0-0.7,cy,z)); g.add(at(box(0.6,H_+2,0.3,MR.steel),PBX.x1+0.7,cy,z));
  });
  // perforated shelf and a transfer container on it
  g.add(at(box(W_-0.8,0.25,D_-1.2,MR.white),cx,PBX.y0+2.6,cz));
  CR.pbItem=at(box(3.2,2.0,2.6,std(new THREE.Color('#d9e6f2'),{m:0.1,r:0.5})),cx,PBX.y0+3.8,cz+1.5); g.add(CR.pbItem);
  // UV lamp under the roof
  CR.uvMat=new THREE.MeshStandardMaterial({color:new THREE.Color('#b9a6ff'),emissive:new THREE.Color('#7c4dff'),emissiveIntensity:0.05});
  var uv=new THREE.Mesh(new THREE.CylinderGeometry(0.25,0.25,D_-2,12),CR.uvMat); uv.rotation.x=Math.PI/2;
  at(uv,cx,PBX.y1-0.9,cz); g.add(uv);
  // two doors on vertical hinges, each with a window and handle
  function door(z,dirZ,name){
    var piv=new THREE.Group(); piv.position.set(PBX.x0+0.2,cy,z);
    var d=new THREE.Group(); tag(d,name);
    d.add(at(box(W_-0.4,H_-0.4,0.3,MR.steel),(W_-0.4)/2,0,0));
    d.add(at(box(W_-4.4,H_-4.6,0.36,std(new THREE.Color('#cfe8f5'),{m:0.1,r:0.05,t:true,o:0.45})),(W_-0.4)/2,0.4,0));
    d.add(at(box(0.5,2.6,0.5,MR.alu),W_-1.6,0,dirZ*0.45));
    piv.add(d); g.add(piv); return piv;
  }
  CR.pbOuter=door(PBX.zo+0.15,1,'Pass box outer door');
  CR.pbInner=door(PBX.zi-0.15,-1,'Pass box inner door');
  // interlock lamps on both faces
  CR.pbLamps=[];
  [[PBX.zo+0.35,'outer'],[PBX.zi-0.35,'inner']].forEach(function(q){
    var gl=new THREE.MeshBasicMaterial({color:0x22c55e}), rl=new THREE.MeshBasicMaterial({color:0xef4444});
    var a=at(new THREE.Mesh(new THREE.BoxGeometry(0.7,0.5,0.2),gl),cx-0.6,PBX.y1+1.5,q[0]);
    var b=at(new THREE.Mesh(new THREE.BoxGeometry(0.7,0.5,0.2),rl),cx+0.6,PBX.y1+1.5,q[0]);
    g.add(a); g.add(b); CR.pbLamps.push({side:q[1],green:a,red:b});
  });
  // support legs inside the clean room
  [PBX.x0+0.5,PBX.x1-0.5].forEach(function(x){
    g.add(at(box(0.5,PBX.y0-TH,0.5,MR.steel),x,TH+(PBX.y0-TH)/2,PBX.zi+0.6));
  });
  clean.add(g);
})();

/* ------------------------------------------------ vial filling machine (stand-alone, not wired to the rig PCB) */
/* The filler and the operator stand next to the right wall. They are built in the filler's own frame
   (VF, OP: line along x, glove side +z) and turned a quarter turn, so the line runs along the wall and
   the operator's back faces the right wall (ceiling terminals 2 + 3 above, exhaust terminal 3 at the foot of the wall):
   FW() maps the frame to the world. */
var VF={x0:24,x1:48,z0:-11.5,z1:-0.5,deck:10.9,cz:-6}, FTX=36.5, FTZ=32;
function FW(x,y,z){ return W(z+FTX,y,FTZ-x); }
(function filler(){
  var g=new THREE.Group(); tag(g,'Vial filling machine'); g.userData.asm='Clean room';
  var cx=(VF.x0+VF.x1)/2, L=VF.x1-VF.x0, D=VF.z1-VF.z0;
  var poly=std(new THREE.Color('#dbeef7'),{m:0.05,r:0.05,t:true,o:0.16,side:THREE.DoubleSide,dw:false});
  // cabinet on levelling feet
  [[VF.x0+1.5,VF.z0+1.8],[VF.x0+1.5,VF.z1-2],[VF.x1-1.5,VF.z0+1.8],[VF.x1-1.5,VF.z1-2]].forEach(function(p){
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.45,0.6,1.0,12),MR.black),p[0],TH+0.5,p[1]));
  });
  g.add(at(box(L,8.9,D,MR.steel),cx,TH+1+4.45,VF.cz));
  [-6,0,6].forEach(function(dx){ g.add(at(box(5.2,6.4,0.15,std(new THREE.Color('#aeb8c2'),{m:0.8,r:0.3})),cx+dx,TH+5.6,VF.z1+0.08)); });
  g.add(at(box(L,0.4,D,MR.steel),cx,VF.deck-0.2,VF.cz));                                // deck
  // open RABS: polycarbonate walls on a stainless frame, glove ports in front
  var rh=8.2, ry=VF.deck+rh/2;
  [[cx,ry,VF.z1-0.15,L,rh,0.3],[cx,ry,VF.z0+0.15,L,rh,0.3]].forEach(function(p){ var m=at(box(p[3],p[4],p[5],poly),p[0],p[1],p[2]); m.renderOrder=2; g.add(m); });
  [[VF.x0+0.15,ry,VF.cz],[VF.x1-0.15,ry,VF.cz]].forEach(function(p){ var m=at(box(0.3,rh,D-0.6,poly),p[0],p[1],p[2]); m.renderOrder=2; g.add(m); });
  [[VF.x0,VF.z0],[VF.x0,VF.z1],[VF.x1,VF.z0],[VF.x1,VF.z1]].forEach(function(p){ g.add(at(box(0.4,rh,0.4,MR.steel),p[0],ry,p[1])); });
  [VF.z0,VF.z1].forEach(function(z){ g.add(at(box(L,0.4,0.4,MR.steel),cx,VF.deck+rh,z)); });
  [VF.x0,VF.x1].forEach(function(x){ g.add(at(box(0.4,0.4,D,MR.steel),x,VF.deck+rh,VF.cz)); });
  CR.ports=[31.5,34.5,38.5,41.5];
  CR.ports.forEach(function(x){
    g.add(at(new THREE.Mesh(new THREE.TorusGeometry(1.0,0.25,10,28),MR.steel),x,VF.deck+4.4,VF.z1));
    var gl=new THREE.Mesh(new THREE.CylinderGeometry(0.55,0.75,2.6,14),std(new THREE.Color('#2a2f36'),{m:0.1,r:0.8}));
    gl.rotation.x=Math.PI/2; at(gl,x,VF.deck+4.1,VF.z1-1.4); g.add(gl);
  });
  // infeed turntable and outfeed accumulation table
  function table(x,r,name){
    var t=new THREE.Group(); t.position.set(x,VF.deck+0.2,VF.cz); tag(t,name);
    t.add(at(new THREE.Mesh(new THREE.CylinderGeometry(r,r,0.35,40),MR.steel),0,0,0));
    var rim=new THREE.Mesh(new THREE.TorusGeometry(r,0.12,8,40),MR.steel); rim.rotation.x=Math.PI/2; at(rim,0,0.5,0); t.add(rim);
    g.add(t); return t;
  }
  CR.infeed=table(VF.x0+3.3,2.7,'Infeed turntable'); CR.outfeed=table(VF.x1-2.6,2.2,'Outfeed accumulation table');
  // conveyor between them
  CR.cv={x0:VF.x0+6.0,x1:VF.x1-4.8,y:VF.deck+0.15};
  g.add(at(box(CR.cv.x1-CR.cv.x0,0.3,1.6,MR.black),(CR.cv.x0+CR.cv.x1)/2,CR.cv.y,VF.cz));
  [-1,1].forEach(function(s){ g.add(at(box(CR.cv.x1-CR.cv.x0,0.5,0.15,MR.steel),(CR.cv.x0+CR.cv.x1)/2,CR.cv.y+0.6,VF.cz+s*0.95)); });
  // filling station: gantry, needle carriage, product tank, peristaltic pump
  CR.fillX=34.5; CR.stopX=40.5;
  [VF.cz-2.6,VF.cz+2.6].forEach(function(z){ g.add(at(box(0.6,6.4,0.6,MR.steel),CR.fillX,VF.deck+3.2,z)); });
  g.add(at(box(0.8,0.8,5.8,MR.steel),CR.fillX,VF.deck+6.4,VF.cz));
  CR.needles=new THREE.Group(); tag(CR.needles,'Filling needle carriage');
  CR.needles.add(at(box(1.0,1.0,2.4,MR.alu),0,0,0));
  for(var n=0;n<4;n++){ CR.needles.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.07,2.0,8),MR.steel),0,-1.5,-0.9+n*0.6)); }
  CR.needles.position.set(CR.fillX,VF.deck+4.7,VF.cz); g.add(CR.needles);
  var tank=new THREE.Group(); tag(tank,'Product holding tank');
  tank.add(at(new THREE.Mesh(new THREE.CylinderGeometry(1.4,1.4,3.6,24),MR.steel),0,0,0));
  tank.add(at(new THREE.Mesh(new THREE.SphereGeometry(1.4,24,12),MR.steel),0,1.8,0));
  tank.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.3,0.3,1.2,10),MR.steel),0,-2.2,0));
  tank.position.set(30.0,VF.deck+2.6,VF.z0+2.1); g.add(tank);
  var pump=new THREE.Group(); tag(pump,'Peristaltic dosing pump');
  pump.add(at(box(2.2,2.0,1.6,MR.white),0,0,0));
  var rot=new THREE.Mesh(new THREE.CylinderGeometry(0.75,0.75,0.3,18),MR.alu); rot.rotation.x=Math.PI/2; at(rot,0,0.1,0.95); pump.add(rot);
  pump.position.set(32.9,VF.deck+1.0,VF.z0+2.1); g.add(pump); CR.pumpRotor=rot;
  var hose=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    W(30.0,VF.deck+0.6,VF.z0+3.2),W(31.4,VF.deck+0.6,VF.z0+3.3),W(32.9,VF.deck+2.1,VF.z0+2.9),
    W(34.2,VF.deck+6.0,VF.cz-1.6),W(CR.fillX,VF.deck+5.4,VF.cz-0.8)]),40,0.12,8,false),
    std(new THREE.Color('#e9eef3'),{m:0.0,r:0.4,t:true,o:0.85}));
  tag(hose,'Product hose'); g.add(hose);
  // stoppering station: vibratory bowl, chute and press head
  var bowl=new THREE.Group(); tag(bowl,'Stopper vibratory bowl');
  bowl.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.7,0.9,2.4,16),MR.alu),0,-1.6,0));
  bowl.add(at(new THREE.Mesh(new THREE.CylinderGeometry(1.8,1.2,1.4,32),MR.steel),0,0.35,0));
  CR.bowlX=43.5; bowl.position.set(CR.bowlX,VF.deck+3.1,-9.6); g.add(bowl); CR.bowl=bowl;
  var chute=new THREE.Mesh(new THREE.BoxGeometry(0.6,1,0.25),MR.steel); tag(chute,'Stopper chute');
  limb(chute,W(42.3,VF.deck+3.6,-8.6),W(40.9,VF.deck+1.9,-6.7)); g.add(chute);
  [VF.cz-2.4,VF.cz+2.4].forEach(function(z){ g.add(at(box(0.5,5.2,0.5,MR.steel),CR.stopX,VF.deck+2.6,z)); });
  g.add(at(box(0.7,0.7,5.4,MR.steel),CR.stopX,VF.deck+5.2,VF.cz));
  CR.press=at(box(1.2,1.0,1.4,MR.alu),CR.stopX,VF.deck+3.6,VF.cz); tag(CR.press,'Stopper press head'); g.add(CR.press);
  // light tower and the machine's own panel
  CR.beacon=[];
  ['#22c55e','#f59e0b','#ef4444'].forEach(function(c,i){
    var m=new THREE.Mesh(new THREE.CylinderGeometry(0.42,0.42,0.8,14),new THREE.MeshStandardMaterial({color:new THREE.Color(c),emissive:new THREE.Color(c),emissiveIntensity:0.1}));
    at(m,VF.x1-0.9,VF.deck+rh+1.0+i*0.85,VF.z0+0.9); g.add(m); CR.beacon.push(m);
  });
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.15,0.15,1.2,8),MR.steel),VF.x1-0.9,VF.deck+rh+0.4,VF.z0+0.9));
  var pan=at(box(3.6,2.4,0.3,MR.black),VF.x1-3.2,8.3,VF.z1+0.25); pan.rotation.x=-0.18; tag(pan,'Filler operator panel'); g.add(pan);
  // vials: glass body, product, stopper
  var glass=std(new THREE.Color('#cfeaff'),{m:0.1,r:0.05,t:true,o:0.5}), prod=std(new THREE.Color('#f0b44c'),{m:0,r:0.3,t:true,o:0.85}),
      stop=std(new THREE.Color('#6f7b86'),{m:0.1,r:0.7});
  function vial(){
    var v=new THREE.Group(); tag(v,'Vial');
    v.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.42,0.42,1.4,14),glass),0,0.7,0));
    var l=at(new THREE.Mesh(new THREE.CylinderGeometry(0.34,0.34,0.7,12),prod),0,0.4,0); v.add(l);
    var s=at(new THREE.Mesh(new THREE.CylinderGeometry(0.46,0.46,0.35,12),stop),0,1.55,0); v.add(s);
    v.userData.liq=l; v.userData.stop=s; return v;
  }
  CR.vials=[]; CR.pitch=1.3;
  var nv=Math.floor((CR.cv.x1-CR.cv.x0)/CR.pitch);
  for(var i=0;i<nv;i++){ var v=vial(); v.userData.u=i*CR.pitch; g.add(v); CR.vials.push(v); }
  [[CR.infeed,1.85,8,false],[CR.outfeed,1.45,7,true]].forEach(function(q){
    for(var k=0;k<q[2];k++){
      var a=k/q[2]*Math.PI*2, v=vial(); v.position.set(Math.cos(a)*q[1],0.2,Math.sin(a)*q[1]);
      v.userData.liq.visible=q[3]; v.userData.stop.visible=q[3]; q[0].add(v);
    }
  });
  g.rotation.y=Math.PI/2; g.position.set(FTX,0,FTZ);           // along the right wall
  clean.add(g); CR.filler=g;
})();

/* ------------------------------------------------ gowned operator */
var OP={x:33,z:6.4}, OPW=FW(33,0,6.4);                         // filler frame / world
(function operator(){
  var g=new THREE.Group(); tag(g,'Operator (Grade B gown)'); g.userData.asm='Clean room';
  var suit=std(new THREE.Color('#f1f4f7'),{m:0.0,r:0.85}), boot=std(new THREE.Color('#d5dde5'),{m:0,r:0.8}),
      mask=std(new THREE.Color('#9fd3f2'),{m:0,r:0.7}), gog=std(new THREE.Color('#1d2a35'),{m:0.3,r:0.2}),
      glove=std(new THREE.Color('#5b4fd6'),{m:0,r:0.6}), skin=std(new THREE.Color('#c99a7a'),{m:0,r:0.7});
  function ell(rx,ry,rz,x,y,z,mat){ var m=new THREE.Mesh(new THREE.SphereGeometry(1,24,16),mat); m.scale.set(rx,ry,rz); m.position.set(x,y,z); g.add(m); return m; }
  function cyl(rx,h,rz,x,y,z,mat,rt){ var m=new THREE.Mesh(new THREE.CylinderGeometry(rt||1,1,1,20),mat); m.scale.set(rx,h,rz); m.position.set(x,y,z); g.add(m); return m; }
  [-1.2,1.2].forEach(function(dx){
    g.add(at(box(1.7,1.3,3.0,boot),dx,TH+0.65,-0.3));                    // overshoe boots
    cyl(1.05,10.6,1.05,dx,TH+1.3+5.3,0,suit);                             // legs
  });
  ell(2.6,1.6,1.7,0,12.4,0,suit);                                         // hips
  cyl(2.7,8.4,1.65,0,16.6,0,suit,0.98);                                   // torso
  ell(3.0,1.5,1.8,0,20.6,0,suit);                                         // shoulders
  g.add(at(box(0.18,7.2,0.1,std(new THREE.Color('#9aa7b4'),{m:0.3,r:0.5})),0,16.6,-1.66));  // zip
  g.add(at(box(1.2,0.8,0.12,std(new THREE.Color('#1273cc'),{m:0.1,r:0.5})),1.1,19.0,-1.68)); // badge
  cyl(0.65,1.2,0.65,0,21.8,0,skin);                                        // neck
  ell(1.75,2.05,1.85,0,23.6,0,suit);                                      // hood over the head
  cyl(2.2,1.8,1.6,0,21.7,0,suit,0.7);                                     // hood cape
  g.add(at(box(2.5,0.85,0.5,gog),0,24.0,-1.7));                           // goggles
  g.add(at(box(2.0,1.05,0.45,mask),0,22.9,-1.65));                        // face mask
  // arms reaching into the RABS glove ports (two limb segments each)
  CR.arms=[];
  [[-1,CR.ports[0]],[1,CR.ports[1]]].forEach(function(q){
    var up=new THREE.Mesh(new THREE.CylinderGeometry(0.75,0.8,1,14),suit), lo=new THREE.Mesh(new THREE.CylinderGeometry(0.62,0.72,1,14),suit),
        hand=new THREE.Mesh(new THREE.SphereGeometry(0.62,14,10),glove), sh=new THREE.Mesh(new THREE.SphereGeometry(0.85,14,10),suit);
    g.add(up); g.add(lo); g.add(hand); g.add(sh);
    CR.arms.push({s:q[0],port:q[1],up:up,lo:lo,hand:hand,sh:sh});
  });
  g.position.set(OPW.x,0,OPW.z); g.rotation.y=Math.PI/2;          // back to the right wall: ceiling terminals 2 + 3 above, exhaust terminal 3 at its foot
  clean.add(g); CR.op=g;
})();
function limb(m,a,b){
  var d=b.clone().sub(a), L=d.length();
  m.position.copy(a).addScaledVector(d,0.5); m.scale.set(1,L,1);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());
}
function poseArms(t){
  CR.arms.forEach(function(a,i){
    var sh=new THREE.Vector3(a.s*2.85,20.5,-0.2);
    var hand=new THREE.Vector3(a.port-OP.x+0.25*Math.sin(t*1.7+i*2.1),VF.deck+4.4+0.25*Math.sin(t*2.3+i),VF.z1-OP.z-0.6);
    var el=sh.clone().lerp(hand,0.5).add(new THREE.Vector3(a.s*0.9,-2.0,0));
    a.sh.position.copy(sh); limb(a.up,sh,el); limb(a.lo,el,hand); a.hand.position.copy(hand);
  });
}

/* ------------------------------------------------ animation */
CR.t=0; CR.pb={state:'ready · both doors locked',innerOpen:false,transfers:0,lastC:0};
function smooth(x){ x=Math.max(0,Math.min(1,x)); return x*x*(3-2*x); }
function updateCleanRoom(dt,run){
  CR.t+=dt; var t=CR.t;
  var v=run?1.3:0;                                   // conveyor speed, cm/s (one vial per pitch)
  var span=CR.cv.x1-CR.cv.x0;
  CR.vials.forEach(function(m){
    m.userData.u=(m.userData.u+v*dt)%span;
    var x=CR.cv.x0+m.userData.u; m.position.set(x,CR.cv.y+0.15,VF.cz);
    m.userData.liq.visible=x>CR.fillX+0.3; m.userData.stop.visible=x>CR.stopX+0.3;
  });
  CR.infeed.rotation.y+=dt*0.5*(run?1:0); CR.outfeed.rotation.y-=dt*0.45*(run?1:0);
  // needles dip when a vial sits under them; the press head follows the stopper station
  var ph=((CR.vials[0].userData.u-(CR.fillX-CR.cv.x0))%CR.pitch+CR.pitch)%CR.pitch/CR.pitch;
  var dip=run?Math.sin(Math.PI*smooth(1-Math.abs(ph-0.5)*2.2)):0;
  CR.needles.position.y=VF.deck+4.7-1.5*dip;
  var ps=((CR.vials[0].userData.u-(CR.stopX-CR.cv.x0))%CR.pitch+CR.pitch)%CR.pitch/CR.pitch;
  CR.press.position.y=VF.deck+3.6-0.9*(run?Math.sin(Math.PI*smooth(1-Math.abs(ps-0.5)*2.2)):0);
  CR.pumpRotor.rotation.z-=dt*4*(run?1:0);
  CR.bowl.position.x=CR.bowlX+(run?0.04*Math.sin(t*60):0);
  CR.beacon[0].material.emissiveIntensity=run?1.2:0.1; CR.beacon[2].material.emissiveIntensity=run?0.1:1.2;
  // pass box transfer cycle, 40 s: idle → outer door → UV → inner door → idle (doors interlocked)
  var c=t%40, oA=0, iA=0, uv=0, item=c>=12.5&&c<26.5;   // item put in through the outer door, taken out through the inner
  if(c>=10&&c<18) oA=smooth((c-10)/2)*(1-smooth((c-15)/2));
  else if(c>=18&&c<24) uv=1;
  else if(c>=24&&c<32) iA=smooth((c-24)/2)*(1-smooth((c-29)/2));
  CR.pbOuter.rotation.y=-oA*1.45; CR.pbInner.rotation.y=iA*1.45;
  if(c<CR.pb.lastC) CR.pb.transfers++;
  CR.pb.lastC=c; CR.pb.innerOpen=iA>0.05;
  CR.pb.state=oA>0.01?'outer door open · inner locked':(iA>0.01?'inner door open · outer locked':(uv?'UV cycle · both doors locked':'ready · both doors locked'));
  CR.pbItem.visible=item; CR.uvMat.emissiveIntensity=0.05+uv*1.6;
  CR.pbLamps.forEach(function(l){
    var mayOpen=uv?false:(l.side==='outer'?iA<0.01:oA<0.01);
    l.green.visible=mayOpen; l.red.visible=!mayOpen;
  });
  poseArms(t);
}
updateCleanRoom(0,true);

/* ------------------------------------------------ PT-101 air particle sensor */
/* laser particle counter on the back wall with a 2-port sampling manifold: one port samples
   room air, the other runs a sample tube to an isokinetic probe beside the filling needles */
var PT={x:30,y:16,z:-BZ+TH+0.8};
(function particleSensor(){
  var g=new THREE.Group(); tag(g,'PT-101 air particle sensor'); g.userData.asm='Controls and HMI';
  g.add(at(box(3.2,4.2,1.6,MR.white),PT.x,PT.y,PT.z));
  g.add(at(box(2.2,1.2,0.12,MR.black),PT.x,PT.y+0.8,PT.z+0.82));
  CR.ptLed=new THREE.Mesh(new THREE.BoxGeometry(0.4,0.25,0.12),new THREE.MeshBasicMaterial({color:0x22c55e}));
  at(CR.ptLed,PT.x+1.1,PT.y-1.4,PT.z+0.82); g.add(CR.ptLed);
  g.add(at(box(2.4,0.7,1.0,MR.alu),PT.x,PT.y+2.45,PT.z));                                    // manifold
  [-0.7,0.7].forEach(function(dx){ g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.2,0.2,0.8,10),MR.steel),PT.x+dx,PT.y+3.2,PT.z)); });
  var fun=new THREE.Mesh(new THREE.CylinderGeometry(0.6,0.2,0.7,16,1,true),MR.steel); at(fun,PT.x-0.7,PT.y+4.6,PT.z); g.add(fun);   // room-air port
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.15,0.15,0.9,8),MR.steel),PT.x-0.7,PT.y+3.9,PT.z));
  // isokinetic probe at the fill point, facing the first air, and its sample tube over the RABS
  var pr=new THREE.Group(); tag(pr,'PT-101 isokinetic probe');
  pr.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.45,0.14,0.9,16,1,true),MR.steel),0,0.45,0));
  pr.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.12,1.4,8),MR.steel),0,-0.7,0));
  pr.position.copy(FW(35.6,VF.deck+2.6,-7.8)); g.add(pr);
  function fw(x,y,z){ var v=FW(x,y,z); return [v.x,v.y,v.z]; }
  var tube=new THREE.Mesh(new THREE.TubeGeometry(roundedPath([fw(35.6,VF.deck+1.2,-7.8),fw(35.6,VF.deck+0.9,-10.5),
    fw(35.6,VF.deck+8.7,-10.7),fw(35.6,VF.deck+8.9,-12.3),[23.6,PT.y+3.6,-8.0],[PT.x-0.7,PT.y+3.6,-20.5],[PT.x+0.7,PT.y+3.6,PT.z]],0.9),80,0.13,8,false),
    std(new THREE.Color('#e6eef4'),{m:0,r:0.4,t:true,o:0.8}));
  tag(tube,'PT-101 sample tube'); g.add(tube);
  ctrl.add(g);
})();

/* ------------------------------------------------ containment zones (display only, not exported) */
/* Each zone is a translucent volume with a floor footprint and a solid colour badge (GRADE A, GRADE B …).
   Badges keep a constant size on screen, like the sensor tags, and grow with the Large readings mode. */
var zoneGroup=new THREE.Group(); zoneGroup.userData.noExport=true; scene.add(zoneGroup);
var ZONES=[
  {t:'GRADE A',s:'ISO 5 · LAF first air at the fill point',c:'#16a34a',bc:'#15803d',o:0.22,f:0.45,
   b:[LAF.x0+0.2,VF.deck,LAF.z0+0.2,LAF.x1-0.2,LAF.y0,LAF.z1-0.2],at:[LAF.x1+1.5,LAF.y1+1.6,LAF.z0+2]},
  {t:'GRADE B',s:'ISO 7 in operation · +15 Pa',c:'#2563eb',bc:'#1d4ed8',o:0.07,f:0.22,
   b:[TH/2+0.1,TH,-BZ+TH,BX-TH,CEIL,BZ-TH],at:[30,3.5,17]},
  {t:'PASS BOX',s:'airlock · interlocked doors + UV',c:'#d97706',bc:'#b45309',o:0.26,f:0.5,
   b:[PBX.x0,PBX.y0,PBX.zi,PBX.x1,PBX.y1,PBX.zo],at:[(PBX.x0+PBX.x1)/2,PBX.y0-2.6,PBX.zo+0.5]},
  {t:'UNCLASSIFIED',s:'plant room · 0 Pa reference',c:'#64748b',bc:'#475569',o:0.04,f:0.18,
   b:[-BX+TH,TH,-BZ+TH,-TH/2-0.1,BY-TH,BZ-TH],at:[-30,3.5,17]}
];
var zoneBadges=[], ZB_SCALE=0.00050, zoneBadgeK=1;
function makeZoneBadge(title,sub,color){
  var dpr=2,pad=12,fs=30,ss=19, cv=document.createElement('canvas'), c=cv.getContext('2d');
  c.font='700 '+fs+'px "IBM Plex Sans", sans-serif'; var w=c.measureText(title).width;
  c.font='500 '+ss+'px "IBM Plex Mono", monospace'; w=Math.max(w,c.measureText(sub).width);
  var Wd=Math.ceil(w+pad*2), Hh=Math.ceil(fs+ss+pad*2+2);
  cv.width=Wd*dpr; cv.height=Hh*dpr; c.scale(dpr,dpr);
  c.fillStyle=color; roundRect(c,0,0,Wd,Hh,7); c.fill();
  c.strokeStyle='rgba(255,255,255,0.75)'; c.lineWidth=2; roundRect(c,2.5,2.5,Wd-5,Hh-5,5); c.stroke();
  c.textBaseline='top'; c.fillStyle='#ffffff';
  c.font='700 '+fs+'px "IBM Plex Sans", sans-serif'; c.fillText(title,pad,pad-3);
  c.fillStyle='rgba(255,255,255,0.9)'; c.font='500 '+ss+'px "IBM Plex Mono", monospace'; c.fillText(sub,pad,pad+fs);
  var tex=new THREE.CanvasTexture(cv); tex.anisotropy=4;
  var sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false,depthWrite:false,sizeAttenuation:false}));
  sp.renderOrder=10.5; sp.userData.wh=[Wd,Hh];        // above the name labels (10), under the live readings (11)
  sp.scale.set(Wd*ZB_SCALE*zoneBadgeK,Hh*ZB_SCALE*zoneBadgeK,1);
  return sp;
}
function scaleZoneBadges(k){
  zoneBadgeK=k;
  zoneBadges.forEach(function(sp){ sp.scale.set(sp.userData.wh[0]*ZB_SCALE*k,sp.userData.wh[1]*ZB_SCALE*k,1); });
}
function buildZones(){
  while(zoneGroup.children.length){ var c=zoneGroup.children.pop(); if(c.geometry) c.geometry.dispose(); if(c.material){ if(c.material.map) c.material.map.dispose(); c.material.dispose(); } }
  zoneBadges=[];
  ZONES.forEach(function(z){
    var b=z.b, w=b[3]-b[0], h=b[4]-b[1], d=b[5]-b[2];
    var m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshBasicMaterial({color:new THREE.Color(z.c),transparent:true,opacity:z.o,depthWrite:false,side:THREE.DoubleSide}));
    m.position.set(b[0]+w/2,b[1]+h/2,b[2]+d/2); m.renderOrder=4; zoneGroup.add(m);
    var e=new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry),new THREE.LineBasicMaterial({color:new THREE.Color(z.c),transparent:true,opacity:0.9}));
    e.position.copy(m.position); zoneGroup.add(e);
    var fl=new THREE.Mesh(new THREE.PlaneGeometry(w,d),new THREE.MeshBasicMaterial({color:new THREE.Color(z.c),transparent:true,opacity:z.f,depthWrite:false,side:THREE.DoubleSide}));
    fl.rotation.x=-Math.PI/2; fl.position.set(b[0]+w/2,b[1]+0.06,b[2]+d/2); fl.renderOrder=3; zoneGroup.add(fl);   // zone footprint, read like a zoning plan
    var sp=makeZoneBadge(z.t,z.s,z.bc); sp.position.set(z.at[0],z.at[1],z.at[2]); zoneGroup.add(sp); zoneBadges.push(sp);
  });
}

/* the recovery unit floats in the earlier model; on the rig it stands on four posts */
(function hrPosts(){
  var g=new THREE.Group(); tag(g,'Recovery unit support posts'); g.userData.asm='Heat-recovery air-pump unit';
  var bot=C2W(0,MY-MH/2,0).y;
  [[MX0+0.3,MZ-MD/2+0.3],[MX0+0.3,MZ+MD/2-0.3],[MX1-0.3,MZ-MD/2+0.3],[MX1-0.3,MZ+MD/2-0.3]].forEach(function(p){
    var w=C2W(p[0],0,p[1]);
    g.add(at(box(0.5,bot-TH,0.5,MR.alu),w.x,TH+(bot-TH)/2,w.z));
  });
  rig.add(g);
})();

/* ========================================================== air paths */
/* vertices: [x,y,z,radius,colourKey,temperatureKey] in world cm.
   colourKey f/r/m = fresh / exhaust / supply; temperatureKey names an air state of the model */
var RW=1.12, RN=0.72, LN=0.58;
function cw(list){ return list.map(function(p){ var v=C2W(p[0],p[1],p[2]); return [v.x,v.y,v.z,p[3]*K,p[4],p[5]]; }); }
var TRAIN_C=[
  [-2.6,YS,0,0.88,'f','t1'],[-2.0,YS,0,0.86,'f','t1'],[-0.9,YS,0,0.80,'f','t1'],[0.3,YS,0,0.86,'m','ph'],
  [1.2,YS,0,0.86,'m','ph'],[1.9,YS,0,0.78,'m','ph'],[2.9,YS,0,0.76,'m','cc'],[3.8,YS,0,0.78,'m','cc'],
  [4.8,YS,0,0.84,'m','rh'],[5.5,YS,0,RN,'m','rh'],[5.9,YS,0,0.45,'m','rh'],[6.5,YS,0,0.95,'m','sup'],
  [7.1,YS,0,0.74,'m','sup'],[8.2,YS,0,0.82,'m','sup'],[9.1,YS,0,0.95,'m','sup'],[10.0,YS,0,0.95,'m','sup'],[13.2,YS,0,0.9,'m','sup']];
var PATHS={
  comp: [[-55,22,-14,1.8,'f','oa'],[-49.5,22,-14,1.5,'f','oa'],[-45,22,-14,1.4,'f','oa'],[-42.6,22,-14,1.0,'f','oa'],
         [-42.5,25.0,-13.0,1.0,'f','oa'],[-42.5,24.4,-10.6,1.0,'f','oa'],[-42.5,19,-11.3,1.0,'f','oa'],
         [-42.5,13.8,-11.3,0.85,'f','oa'],[-44.9,HY,-11.3,0.85,'f','oa'],[HX,HY,-11.3,0.85,'f','oa'],[HX,HY,P_HR_FRESH.z,0.85,'f','oa']],
  hr:   [[HX,HY,P_HR_FRESH.z,0.6,'f','oa'],[HX,P_HR_FRESH.y,P_HR_FRESH.z,0.6,'f','oa'],[P_HR_FRESH.x,P_HR_FRESH.y,P_HR_FRESH.z,0.6,'f','oa']].concat(cw([
         [MX0+1.5,MY,MZU,LN,'f','oa'],[MXC-1.9,MY,MZU,LN,'f','oa'],[MXC-1.1,MY+0.50,MZ+0.60,0.34,'f','oa'],
         [MXC,MY+0.50,MZ,0.34,'f','oa'],[MXC+1.1,MY+0.50,MZ-0.60,0.34,'f','t1'],[MXC+1.9,MY,MZL,LN,'f','t1'],
         [MX1-2.2,MY,MZL,LN,'f','t1'],[MX1-1.5,MY,MZL,0.42,'f','t1']]).concat(TEMPR.map(function(p,i){
         return [p[0],p[1],p[2],i===TEMPR.length-1?0.9:0.6,'f','t1']; }))),
  direct:[[HX,HY,P_HR_FRESH.z,0.85,'f','oa'],[HX,HY,P_AHU_OA.z,0.85,'f','oa'],[HX,P_AHU_OA.y,P_AHU_OA.z,0.8,'f','oa'],
         [P_AHU_OA.x+0.2,P_AHU_OA.y,P_AHU_OA.z,0.8,'f','oa']],
  supply: cw([[-13.2,YS,0,RW,'f','tin'],[-10.6,YS,0,RW,'f','tin'],[-9.8,YS,0,1.00,'f','tin'],[-8.7,YS,0,0.90,'f','tin'],
         [-7.1,YS,0,0.84,'f','tin'],[-5.7,YS,0,0.80,'f','tin'],[-4.3,YS,0,0.84,'f','t2'],[-3.9,YS,0,0.88,'f','t2']].concat(TRAIN_C)),
  /* exhaust: low-level BIBO terminals → collector → PT-102 → DV-101 → Cu core (or the outer HEPA) */
  exA: [[0.6,GRILLE[0][0],GRILLE[0][1],1.0,'r','ret'],[-1.6,GRILLE[0][0],GRILLE[0][1],1.0,'r','ret'],[-1.75,EXY,GRILLE[0][1],0.8,'r','ret'],[-1.75,EXY,EXZ,0.8,'r','ret']],
  exC: [[BX-TH-0.6,T3.y,T3.z,1.0,'r','ret'],[T3.hx,T3.y,T3.z,1.0,'r','ret'],[T3.hx,T3.y,T3.z-3.5,0.8,'r','ret'],[T3.hx,T3.y,T3.dz,0.8,'r','ret'],
        [-1.75,T3.y,T3.dz,0.8,'r','ret'],[-1.75,EXY,T3.dz,0.8,'r','ret'],[-1.75,EXY,GRILLE[1][1],0.8,'r','ret'],[-1.75,EXY,EXZ,0.8,'r','ret']],
  exB: [[0.6,GRILLE[1][0],GRILLE[1][1],1.0,'r','ret'],[-1.6,GRILLE[1][0],GRILLE[1][1],1.0,'r','ret'],[-1.75,EXY,GRILLE[1][1],0.8,'r','ret'],[-1.75,EXY,EXZ,0.8,'r','ret']],
  exMain: [[-1.75,EXY,EXZ,0.75,'r','ret'],[-14.2,EXY,EXZ,0.75,'r','ret'],[-17,EXY,EXZ,0.75,'r','ret'],[DVX,EXY,EXZ,0.75,'r','ret']],
  exCore: [[DVX,EXY,EXZ,0.6,'r','r1'],[-27.2,EXY,EXZ,0.6,'r','r1'],[-27.2,P_HR_EXIN.y,EXZ,0.6,'r','r1'],[P_HR_EXIN.x+0.4,P_HR_EXIN.y,EXZ,0.55,'r','r1']].concat(cw([
         [MX1+0.6,MY,MZU,0.5,'r','r1'],[MX1-1.5,MY,MZU,LN,'r','r1'],
         [MXC+1.9,MY,MZU,LN,'r','r1'],[MXC+1.1,MY-0.50,MZ+0.60,0.34,'r','r1'],[MXC,MY-0.50,MZ,0.34,'r','r1'],
         [MXC-1.1,MY-0.50,MZ-0.60,0.34,'r','r2'],[MXC-1.9,MY,MZL,LN,'r','r2'],[-17.3,MY,MZL,0.46,'r','r2'],
         [MX0+1.4,MY,MZL,0.42,'r','exh']])).concat(EXR.map(function(p){ return [p[0],p[1],p[2],0.6,'r','exh']; }),
         [[BYP.sx,BYP.jy,BYP.sz,0.6,'r','exh'],[BYP.sx,BYP.top,BYP.sz,0.9,'r','exh'],[BYP.sx,BYP.top+6,BYP.sz,1.6,'r','exh']]),
  exByp: [[DVX,EXY+0.6,EXZ,0.6,'c','ret'],[DVX,BYP.y,EXZ,0.6,'c','ret'],[BYP.x1,BYP.y,BYP.z,0.6,'c','ret'],
         [(BYP.x0+BYP.x1)/2,BYP.y,BYP.z,1.4,'r','ret'],[BYP.x0,BYP.y,BYP.z,0.8,'r','ret'],[BYP.fx-1.2,BYP.y,BYP.z,0.6,'r','ret'],[BYP.rx,BYP.y,BYP.z,0.6,'r','ret'],
         [BYP.rx,BYP.ty,BYP.z,0.6,'r','ret'],[BYP.sx,BYP.ty,BYP.z,0.6,'r','ret'],[BYP.sx,BYP.ty,BYP.sz,0.6,'r','ret'],
         [BYP.sx,BYP.top,BYP.sz,0.9,'r','ret'],[BYP.sx,BYP.top+6,BYP.sz,1.6,'r','ret']]
};
var RISER0=[[P_AHU_SUP.x-0.2,P_AHU_SUP.y,P_AHU_SUP.z,1.0,'m','sup'],[RX,P_AHU_SUP.y,4.6,1.0,'m','sup'],[RX,P_AHU_SUP.y,RZ,1.0,'m','sup'],
  [RX,P_AHU_SUP.y+2.5,RZ,1.1,'m','sup'],[RX,RY,RZ,1.1,'m','sup'],[0.5,RY,RZ,1.1,'m','sup'],[8,RY,RZ,1.1,'m','sup'],
  [8,RY,0,1.1,'m','sup'],[14,RY,0,1.0,'m','sup']];
PATHS.riserA=RISER0.concat([[14,CEIL+1.4,0,0.9,'m','sup'],[14,CEIL+0.2,0,1.1,'m','sup']]);
PATHS.riserB=RISER0.concat([[30.5,RY,0,1.0,'m','sup'],[CT.tx,RY,0,1.0,'m','sup'],[CT.tx,RY,CT.z[0],0.8,'m','sup'],[CT.x,RY,CT.z[0],0.8,'m','sup'],[CT.x,CEIL+1.4,CT.z[0],0.8,'m','sup'],[CT.x,CEIL+0.2,CT.z[0],1.0,'m','sup']]);
PATHS.riserD=RISER0.concat([[30.5,RY,0,1.0,'m','sup'],[CT.tx,RY,0,1.0,'m','sup'],[CT.tx,RY,CT.z[1],0.8,'m','sup'],[CT.x,RY,CT.z[1],0.8,'m','sup'],[CT.x,CEIL+1.4,CT.z[1],0.8,'m','sup'],[CT.x,CEIL+0.2,CT.z[1],1.0,'m','sup']]);
PATHS.riserC=RISER0.concat([[30.5,RY,0,1.0,'m','sup'],[30.5,RY-1.4,-4,0.9,'m','sup'],[30.5,LAF.y1+0.4,-4,0.9,'m','sup'],[30.5,LAF.y0+0.8,-4,1.2,'m','sup']]);
function GZ(z){ return z>-5?GRILLE[0][1]:GRILLE[1][1]; }      // nearest partition exhaust terminal
PATHS.room=[];
DIFF.forEach(function(d){
  [[1,0],[-1,0],[0,1],[0,-1]].forEach(function(dr){
    var xd=d[0], zd=d[1], dist;
    if(dr[0]>0) dist=BX-TH-xd; else if(dr[0]<0) dist=xd-TH/2; else dist=BZ-TH;
    var reach=Math.max(3,dist-3.5);
    var x2=xd+dr[0]*reach, z2=zd+dr[1]*reach;
    if(x2>PBX.x0-3 && x2<PBX.x1+3 && z2>PBX.zi-4) x2=PBX.x1+4;     // go round the pass box
    var gz=GZ(z2), gy=GRILLE[0][0];
    PATHS.room.push([[xd,CEIL-0.6,zd,1.4,'m','sup'],[xd+dr[0]*5.5,CEIL-1.6,zd+dr[1]*5.5,2.2,'m','sup'],
      [x2,CEIL-5,z2,3.0,'m','room'],[x2,24,z2,3.6,'m','room'],[x2,9,z2,3.4,'r','room'],
      [Math.min(7,Math.max(x2,4)),5.0,(z2+gz)/2,2.6,'r','room'],[3.2,gy,gz,1.8,'r','ret'],[0.6,gy,gz,1.4,'r','ret']]);
  });
});
/* LAF first air: straight down from the hood over the open RABS and the filling needles,
   then off the back of the filler and out at low level */
[27.6,33.4].forEach(function(x){ [-11,-3,4].forEach(function(z){
  var gz=GZ(z), gy=GRILLE[0][0];
  PATHS.room.push([[x,LAF.y0-0.4,z,1.6,'m','sup'],[x,VF.deck+8.4,z,2.4,'m','sup'],[x,VF.deck+2.2,z,2.4,'m','sup'],
    [x-5,VF.deck-1.5,z,2.4,'m','room'],[16,4.6,(z+gz)/2,2.6,'r','room'],[3.2,gy,gz,1.8,'r','ret'],[0.6,gy,gz,1.4,'r','ret']]);
}); });
/* ceiling terminals 2 + 3: down over the operator; most of it goes on down behind the operator's legs into exhaust
   terminal 3 at the foot of the right wall, the rest along the floor beside the filler to the partition terminals */
CT.z.forEach(function(z){ [-2.2,0,2.2].forEach(function(d){
  var x=CT.x+d, gz=z>0?GRILLE[0][1]:GRILLE[1][1], gy=GRILLE[0][0];
  PATHS.room.push([[x,CEIL-0.6,z,1.3,'m','sup'],[x,CEIL-4.5,z,1.9,'m','sup'],[x+0.8,24,z*0.85,2.4,'m','room'],
    [46+d*0.4,12,(z+T3.z)/2,2.4,'m','room'],[47.6,T3.y+0.6,T3.z+(z>0?1.6:-1.6),1.8,'r','room'],[BX-TH-0.6,T3.y,T3.z,1.3,'r','ret']]);
  PATHS.room.push([[x,CEIL-0.6,z,1.3,'m','sup'],[x-1,CEIL-5,z*1.2,2.0,'m','sup'],[x-2.5,18,z>0?7+d:-11+d,2.6,'m','room'],
    [38,6,z>0?10:-18,3.0,'m','room'],[20,5,z>0?8:-19,2.8,'r','room'],[3.2,gy,gz,1.8,'r','ret'],[0.6,gy,gz,1.4,'r','ret']]);
}); });
/* contamination: particles shed by the operator are swept past the sides of the filler at low level,
   under the LAF first air, and out through the low-level exhausts; plus what the pass box lets in */
PATHS.contam=[[OPW.x,20,OPW.z,2.2,'c','room'],[OPW.x-2.5,14,OPW.z+4,2.8,'c','room'],[37,8,10,3.2,'c','room'],
  [20,5,8,2.8,'c','room'],[3.2,GRILLE[0][0],GRILLE[0][1],1.6,'c','ret'],[0.6,GRILLE[0][0],GRILLE[0][1],1.2,'c','ret']];
PATHS.contam2=[[OPW.x+0.5,17,OPW.z-1,2.2,'c','room'],[OPW.x-2,9,OPW.z-6,3.0,'c','room'],[37,5,-18,3.2,'c','room'],
  [18,4.5,-19,2.6,'c','room'],[3.2,GRILLE[1][0],GRILLE[1][1],1.6,'c','ret'],[0.6,GRILLE[1][0],GRILLE[1][1],1.2,'c','ret']];
PATHS.pbx=[[(PBX.x0+PBX.x1)/2,(PBX.y0+PBX.y1)/2,PBX.zi-0.5,1.6,'c','room'],[10,12,PBX.zi-5,2.4,'c','room'],
  [8,5,8,2.8,'c','room'],[3.2,GRILLE[0][0],GRILLE[0][1],1.6,'c','ret'],[0.6,GRILLE[0][0],GRILLE[0][1],1.2,'c','ret']];
/* what the operator sheds low down goes straight back into exhaust terminal 3 behind the legs */
PATHS.contam3=[[OPW.x+0.6,13,OPW.z+0.8,2.0,'c','room'],[OPW.x+2.4,7,OPW.z+0.4,2.2,'c','room'],[46.8,T3.y+0.4,T3.z,1.8,'c','room'],
  [BX-TH-0.6,T3.y,T3.z,1.3,'c','ret'],[T3.hx,T3.y,T3.z,1.0,'c','ret']];

/* polyline with arc-length table and a perpendicular frame per segment */
function mkPath(pts){
  var v=[],r=[],ck=[],tk=[],cum=[0],n1=[],n2=[],total=0;
  pts.forEach(function(p){ v.push(W(p[0],p[1],p[2])); r.push(p[3]); ck.push(p[4]); tk.push(p[5]); });
  for(var i=0;i<v.length-1;i++){
    var d=v[i+1].clone().sub(v[i]), L=d.length(); total+=L; cum.push(total);
    d.normalize();
    var up=Math.abs(d.y)>0.9?W(1,0,0):W(0,1,0);
    var a=new THREE.Vector3().crossVectors(d,up).normalize(), b=new THREE.Vector3().crossVectors(d,a).normalize();
    n1.push(a); n2.push(b);
  }
  var p={v:v,r:r,ck:ck,tk:tk,cum:cum,total:total,n1:n1,n2:n2,pts:pts,
    col:v.map(function(){return new THREE.Color();})};
  ALLPATHS.push(p); return p;
}
var ALLPATHS=[];
function segAt(p,s){
  var cum=p.cum,i=1;
  while(i<cum.length-1 && cum[i]<s) i++;
  var span=cum[i]-cum[i-1]||1;
  return {i:i, t:Math.max(0,Math.min(1,(s-cum[i-1])/span))};
}

/* ---------------------------------------------------------- streams */
function makeDot(){
  var cv=document.createElement('canvas'); cv.width=cv.height=64;
  var ctx=cv.getContext('2d');
  var g=ctx.createRadialGradient(32,32,0,32,32,32);
  g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(0.35,'rgba(255,255,255,0.85)'); g.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=g; ctx.fillRect(0,0,64,64);
  return new THREE.CanvasTexture(cv);
}
var dotTex=makeDot();
var airGroup=new THREE.Group(); scene.add(airGroup);
var MOBILE=window.innerWidth<760;
function stream(name,paths,count,flowKey,opt){
  opt=opt||{};
  count=Math.round(count*(MOBILE?0.55:1));
  var ps=paths.map(mkPath);
  var geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(count*3),3));
  geo.setAttribute('color',new THREE.BufferAttribute(new Float32Array(count*3),3));
  var mat=new THREE.PointsMaterial({size:opt.size||0.5,map:dotTex,vertexColors:true,
    transparent:true,opacity:0.98,depthWrite:false,sizeAttenuation:true});
  var pts=new THREE.Points(geo,mat); pts.renderOrder=5; pts.frustumCulled=false; airGroup.add(pts);
  var P=[];
  for(var i=0;i<count;i++){
    var k=Math.floor(Math.random()*ps.length), ang=Math.random()*6.283, rr=Math.sqrt(Math.random());
    P.push({k:k,s:Math.random()*ps[k].total,oa:Math.cos(ang)*rr,ob:Math.sin(ang)*rr,ph:Math.random()*6.283,sp:0.85+Math.random()*0.3});
  }
  return {name:name,paths:ps,parts:P,geo:geo,mat:mat,obj:pts,count:count,flow:flowKey,
    vk:opt.vk||7,fadeIn:!!opt.fadeIn,fadeOut:!!opt.fadeOut};
}
var STREAMS=[
  stream('comp',[PATHS.comp],460,'Qfa',{fadeIn:true}),
  stream('hr',[PATHS.hr],440,'Qhr',{size:0.42}),
  stream('direct',[PATHS.direct],240,'Qdir'),
  stream('supply',[PATHS.supply],620,'Qfa',{size:0.42}),
  stream('riser',[PATHS.riserA,PATHS.riserB,PATHS.riserC,PATHS.riserD],760,'Qsup',{vk:9}),
  stream('room',PATHS.room,1700,'Qsup',{size:0.85,vk:11}),
  stream('ret',[PATHS.exA,PATHS.exB,PATHS.exC],420,'Qret'),
  stream('exmain',[PATHS.exMain],300,'Qex',{size:0.42}),
  stream('stale',[PATHS.exCore],460,'Qcore',{size:0.42,fadeOut:true}),
  stream('byp',[PATHS.exByp],360,'Qbyp',{size:0.42,fadeOut:true}),
  stream('contam',[PATHS.contam,PATHS.contam2,PATHS.contam3],360,'Qcont',{size:0.6,vk:6,fadeIn:true}),
  stream('pbx',[PATHS.pbx],160,'Qpbx',{size:0.6,vk:8,fadeIn:true})
];
var _v=new THREE.Vector3(), _c=new THREE.Color();
function tempColor(t,out){
  if(t<=21){ var a=Math.max(0,Math.min(1,(t+5)/26)); return out.copy(T.tCold).lerp(T.tMid,a); }
  var b=Math.max(0,Math.min(1,(t-21)/24)); return out.copy(T.tMid).lerp(T.tHot,b);
}
var colorMode='stream';
function streamColor(k,out){ return out.copy(k==='f'?T.fresh:(k==='r'?T.ret:(k==='c'?T.contam:T.mix))); }
function refreshPathColors(states){
  ALLPATHS.forEach(function(p){
    for(var i=0;i<p.v.length;i++){
      if(colorMode==='temp' && states && p.ck[i]!=='c') tempColor(states[p.tk[i]]!==undefined?states[p.tk[i]]:21,p.col[i]);
      else streamColor(p.ck[i],p.col[i]);
    }
  });
}
function updateStream(st,dt,speed,flows){
  var pos=st.geo.attributes.position.array, cols=st.geo.attributes.color.array;
  var q=flows[st.flow]||0, ff=Math.max(0,Math.min(3,q/flows.ref));
  st.obj.visible=(st.name==='contam'||st.name==='pbx'?contamVisible:airVisible) && q>0.02;
  if(st.name==='contam') st.geo.setDrawRange(0,Math.round(st.count*(flows.contamFrac||1)));
  for(var i=0;i<st.count;i++){
    var pp=st.parts[i], p=st.paths[pp.k], tot=p.total;
    var g=segAt(p,pp.s), j=g.i, t=g.t;
    var rad=p.r[j-1]+(p.r[j]-p.r[j-1])*t;
    pp.s += dt*speed*ff*pp.sp*st.vk/Math.max(0.5,Math.min(rad,4));
    if(pp.s>tot){ pp.s-=tot; pp.k=Math.floor(Math.random()*st.paths.length); }
    _v.lerpVectors(p.v[j-1],p.v[j],t);
    var w=0.86+0.14*Math.sin(time*2.2+pp.ph), n1=p.n1[j-1], n2=p.n2[j-1];
    pos[i*3]  =_v.x+(n1.x*pp.oa+n2.x*pp.ob)*rad*w;
    pos[i*3+1]=_v.y+(n1.y*pp.oa+n2.y*pp.ob)*rad*w;
    pos[i*3+2]=_v.z+(n1.z*pp.oa+n2.z*pp.ob)*rad*w;
    _c.copy(p.col[j-1]).lerp(p.col[j],t);
    var e=1;
    if(st.fadeIn) e=Math.min(1,pp.s/4); if(st.fadeOut) e=Math.min(e,(tot-pp.s)/4);
    e=Math.max(0,e); e=e*e*(3-2*e);
    cols[i*3]=_c.r*e; cols[i*3+1]=_c.g*e; cols[i*3+2]=_c.b*e;
  }
  st.geo.attributes.position.needsUpdate=true;
  st.geo.attributes.color.needsUpdate=true;
}
var airVisible=true, contamVisible=true;

/* ---------------------------------------------- coloured air columns */
var ribbons=new THREE.Group(); scene.add(ribbons);
var RIBS=['comp','hr','direct','supply','riserA','riserB','riserC','riserD','exA','exB','exC','exMain','exCore','exByp'];
var ribbonMeshes=[];
function buildRibbons(){
  while(ribbons.children.length){ var c=ribbons.children.pop(); c.geometry.dispose(); c.material.dispose();
    var ix=ALLPATHS.indexOf(c.userData.path); if(ix>=0) ALLPATHS.splice(ix,1); }
  ribbonMeshes=[];
  RIBS.forEach(function(k){
    var p=mkPath(PATHS[k]);
    var cv=new THREE.CatmullRomCurve3(p.v,false,'centripetal');
    var avg=p.r.reduce(function(a,b){return a+b;},0)/p.r.length;
    var segs=Math.max(40,Math.round(p.total*1.5)), rs=12;
    var geo=new THREE.TubeGeometry(cv,segs,avg*0.55,rs,false);
    var colors=new Float32Array(geo.attributes.position.count*3);
    geo.setAttribute('color',new THREE.BufferAttribute(colors,3));
    var m=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:0.16,depthWrite:false}));
    m.renderOrder=3; m.userData.path=p; m.userData.segs=segs; m.userData.rs=rs; ribbons.add(m); ribbonMeshes.push(m);
  });
}
function colorRibbons(){
  ribbonMeshes.forEach(function(m){
    var p=m.userData.path, segs=m.userData.segs, rs=m.userData.rs, arr=m.geometry.attributes.color.array;
    for(var i=0;i<=segs;i++){
      var g=segAt(p,p.total*i/segs); _c.copy(p.col[g.i-1]).lerp(p.col[g.i],g.t);
      for(var j=0;j<=rs;j++){ var o=(i*(rs+1)+j)*3; arr[o]=_c.r; arr[o+1]=_c.g; arr[o+2]=_c.b; }
    }
    m.geometry.attributes.color.needsUpdate=true;
  });
}
buildRibbons();

/* ------------------------------------------------------------ arrows */
var arrows=new THREE.Group(); scene.add(arrows);
var arrowDefs=[
  {p:[-57,22,-14], rz:-Math.PI/2, c:'fresh'},
  {p:[14,35.6,0], rz:Math.PI, c:'mix'},
  {p:[30.5,LAF.y0-3.2,-4], rz:Math.PI, c:'mix'},
  {p:[CT.x,CEIL-4.4,CT.z[0]], rz:Math.PI, c:'mix'},
  {p:[CT.x,CEIL-4.4,CT.z[1]], rz:Math.PI, c:'mix'},
  {p:[BYP.sx,BYP.top+4.5,BYP.sz], rz:0, c:'ret'},
  {p:[3.4,GRILLE[0][0]+4.6,GRILLE[0][1]], rz:Math.PI/2, c:'ret'},
  {p:[3.4,GRILLE[1][0]+4.6,GRILLE[1][1]], rz:Math.PI/2, c:'ret'},
  {p:[45.6,T3.y+0.2,T3.z+5.6], rz:-Math.PI/2, c:'ret'}
];
function buildArrows(){
  while(arrows.children.length){ var c=arrows.children.pop(); c.geometry.dispose(); c.material.dispose(); }
  arrowDefs.forEach(function(d){
    var m=new THREE.Mesh(new THREE.ConeGeometry(1.1,2.6,22),
      new THREE.MeshBasicMaterial({color:d.c==='fresh'?T.fresh:(d.c==='ret'?T.ret:T.mix),transparent:true,opacity:0.85}));
    m.position.set(d.p[0],d.p[1],d.p[2]); m.rotation.z=d.rz; arrows.add(m);
  });
}
buildArrows();

/* ------------------------------------------------- refrigerant flow */
var refDots=(function(){
  var per=24,n=refrigCurves.length*per;
  var geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(n*3),3));
  var mat=new THREE.PointsMaterial({size:0.42,map:dotTex,color:T.refrig.clone(),
    transparent:true,opacity:0.95,depthWrite:false,sizeAttenuation:true});
  var pts=new THREE.Points(geo,mat); pts.renderOrder=6; pts.frustumCulled=false; unit.add(pts);
  return {geo:geo,mat:mat,obj:pts,per:per,t:0};
})();
function updateRefrig(dt,speed,dir){
  refDots.t=(refDots.t+dt*speed*0.08)%1;
  var arr=refDots.geo.attributes.position.array,k=0,v=new THREE.Vector3();
  for(var c=0;c<refrigCurves.length;c++) for(var i=0;i<refDots.per;i++){
    refrigCurves[c].getPointAt((i/refDots.per+refDots.t*dir+10)%1, v);
    arr[k++]=v.x; arr[k++]=v.y; arr[k++]=v.z;
  }
  refDots.geo.attributes.position.needsUpdate=true;
}

/* ========================================================== PCB wiring */
/* every sensor and actuator is reached by a flat FR4 strip (copper tracks on it)
   that leaves the edge connector of the main board — no loose wires */
var aw=function(x,y,z){ return C2W(x,y,z); };
var DEV=[
  /* tag, signal dir, riser foot x, riser foot z, top y, riser face ('z' or 'x'), PCB channel, label */
  ['TT-101','in', HX-1.6,-1.2, HY-0.3],
  ['FT-101','in', HX-1.6, 1.4, HY-0.3],
  ['FAN-101','out',COMP.x+4.6,-11.2,COMP.y],
  ['TT-109','in', aw(-9.4,0,0).x,5.2,aw(0,YS+0.85,0).y],
  ['EEV-101','out',aw(-3.2,0,0).x,5.7,aw(0,Y0-1.5,0).y],
  ['TT-103','in', aw(-0.25,0,0).x,5.2,aw(0,YS+0.85,0).y],
  ['CMP-101','out',aw(-6.2,0,0).x,4.9,aw(0,Y0-1.15,0).y],
  ['TT-104','in', aw(3.35,0,0).x,5.2,aw(0,YS+0.85,0).y],
  ['HTR-101','out',aw(3.8,0,0).x+0.6,5.2,aw(0,YS,0).y],
  ['HUM-101','out',aw(4.8,0,0).x+0.2,5.9,aw(0,Y0-0.55,0).y],
  ['FAN-102','out',aw(6.35,0,0).x-0.3,5.2,aw(0,YS,0).y],
  ['PDT-102','in', aw(7.0,0,0).x+0.5,5.3,aw(0,YS+0.55,0).y],
  ['TT-105','in', aw(7.2,0,0).x+1.0,5.2,aw(0,YS+0.85,0).y],
  ['FT-102','in', RX,11.3,20],
  ['TT-107','in', -14.2,EXZ+1.0,EXY+0.6],
  ['PT-102','in', -17,EXZ+1.6,EXY+1.6],
  ['DV-101','out',DVX,EXZ+2.7,EXY-0.6],
  ['FAN-103','out',aw(MX0+1.02,0,0).x,-4.2,aw(0,MY,0).y],
  ['FAN-103B','out',BYP.fx,BYP.z+2.6,BYP.y-2.2],
  ['TT-108','in', aw(-18.3,0,0).x+0.3,-4.2,aw(0,MY+MH/2,0).y+0.4],
  ['TT-106','in', 44,-BZ+TH+0.6,20,'z'],
  ['PDT-101','in', TH/2+0.25,-17.5,28.5,'x'],
  ['PSU','in', -37.2,-17.3,TH+3.2],
  ['PT-101','in', PT.x+0.8, -BZ+TH+0.6, PT.y-2.1]
];
var traceGroup=new THREE.Group(); traceGroup.userData.asm='PCB wiring harness'; rig.add(traceGroup);
var trTexU, trTexV;
(function(){
  function mk(vert){
    var cv=document.createElement('canvas'); cv.width=64; cv.height=64; var c=cv.getContext('2d');
    c.fillStyle='#11643c'; c.fillRect(0,0,64,64); c.fillStyle='#d6a24f';
    for(var i=0;i<4;i++){ var o=8+i*14; if(vert) c.fillRect(o,0,5,64); else c.fillRect(0,o,64,5); }
    var t=new THREE.CanvasTexture(cv); t.anisotropy=4; return t;
  }
  trTexU=mk(false); trTexV=mk(true);
})();
var stripMatU=new THREE.MeshStandardMaterial({map:trTexU,metalness:0.3,roughness:0.5});
var stripMatV=new THREE.MeshStandardMaterial({map:trTexV,metalness:0.3,roughness:0.5});
var SIGS=[];
function strip(name,pts,face){
  var g=new THREE.Group(); tag(g,'PCB strip: '+name);
  var Wd=0.55, Th=0.1;
  for(var i=0;i<pts.length-1;i++){
    var a=pts[i], b=pts[i+1], d=b.clone().sub(a), L=d.length(); if(L<1e-3) continue;
    var ax=Math.abs(d.x)>1e-3?'x':(Math.abs(d.y)>1e-3?'y':'z');
    var thin = ax==='y' ? (face||'z') : 'y';
    var dims={x:Wd,y:Wd,z:Wd}; dims[ax]=L+Wd; dims[thin]=Th;
    var runU = (thin==='y') ? ax==='x' : (thin==='z' ? ax==='x' : ax==='z');
    var m=new THREE.Mesh(new THREE.BoxGeometry(dims.x,dims.y,dims.z), runU?stripMatU:stripMatV);
    m.position.copy(a).add(b).multiplyScalar(0.5); m.userData.strip={ax:ax,thin:thin,L:L+Wd,Th:Th}; g.add(m);
  }
  traceGroup.add(g);
}
DEV.forEach(function(d,i){
  var px=PCB.x0+0.9+i*0.78, yf=TH+0.07+0.022*i, lane=-22.0+0.6*i;
  var fx=d[2], fz=d[3], ty=d[4];
  var pts=[W(px,PCB.y0+0.4,PCB.z+0.25),W(px,yf,PCB.z+0.25),W(px,yf,lane),W(fx,yf,lane),W(fx,yf,fz),W(fx,ty,fz)];
  strip(d[0],pts,d[5]);
  SIGS.push({tag:d[0],dir:d[1],pts:pts,len:0});
});
/* HMI ribbon: board top edge → through the front wall → screen */
(function(){
  var hz=BZ-TH-0.4, hy=BY-TH-0.4;
  var pts=[W(-13.5,PCB.y1-0.2,PCB.z+0.25),W(-13.5,hy,PCB.z+0.25),W(-13.5,hy,hz),W(-38,hy,hz),W(-38,45.6,hz),W(-38,45.6,BZ+1.2)];
  strip('HMI-101',pts,'z'); SIGS.push({tag:'HMI-101',dir:'out',pts:pts,len:0});
})();
var sigDots=(function(){
  var per=3, n=SIGS.length*per;
  SIGS.forEach(function(s){ var c=[0]; for(var i=1;i<s.pts.length;i++) c.push(c[i-1]+s.pts[i].distanceTo(s.pts[i-1])); s.cum=c; s.len=c[c.length-1]; });
  var geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(n*3),3));
  geo.setAttribute('color',new THREE.BufferAttribute(new Float32Array(n*3),3));
  var mat=new THREE.PointsMaterial({size:0.9,map:dotTex,vertexColors:true,transparent:true,opacity:1,depthWrite:false});
  var pts=new THREE.Points(geo,mat); pts.renderOrder=7; pts.frustumCulled=false; scene.add(pts);
  return {geo:geo,obj:pts,per:per,t:0};
})();
function updateSignals(dt){
  sigDots.t+=dt;
  var pos=sigDots.geo.attributes.position.array, col=sigDots.geo.attributes.color.array, k=0;
  SIGS.forEach(function(s,si){
    var c=s.dir==='in'?T.sigIn:T.sigOut;
    for(var j=0;j<sigDots.per;j++){
      var u=((sigDots.t*7+j*s.len/sigDots.per+si*3.1)%s.len);
      if(s.dir==='in') u=s.len-u;
      var i=1; while(i<s.cum.length-1 && s.cum[i]<u) i++;
      var t=(u-s.cum[i-1])/((s.cum[i]-s.cum[i-1])||1);
      _v.lerpVectors(s.pts[i-1],s.pts[i],t);
      pos[k*3]=_v.x; pos[k*3+1]=_v.y+0.12; pos[k*3+2]=_v.z;
      col[k*3]=c.r; col[k*3+1]=c.g; col[k*3+2]=c.b; k++;
    }
  });
  sigDots.geo.attributes.position.needsUpdate=true; sigDots.geo.attributes.color.needsUpdate=true;
}

/* ================================================== air flow in the ducts */
/* A glowing core inside every duct, with chevrons that travel in the flow direction. The speed follows
   the live airflow of that duct; the colour follows the air colour mode (by stream or by temperature).
   Display only: the group is skipped by the CAD export. */
var ductFlow=new THREE.Group(); ductFlow.userData.noExport=true; scene.add(ductFlow);
var ductFlowOn=true, DUCTFLOW=[];
function makeFlowTex(){
  var cv=document.createElement('canvas'); cv.width=128; cv.height=64;
  var c=cv.getContext('2d');
  c.fillStyle='rgba(255,255,255,0.20)'; c.fillRect(0,0,128,64);              // the air itself
  var g=c.createLinearGradient(8,0,92,0);                                     // streak trailing each chevron
  g.addColorStop(0,'rgba(255,255,255,0)'); g.addColorStop(1,'rgba(255,255,255,0.55)');
  c.fillStyle=g; c.fillRect(8,26,84,12);
  c.fillStyle='rgba(255,255,255,0.98)';                                       // chevron pointing downstream (+u)
  c.beginPath(); c.moveTo(80,12); c.lineTo(104,32); c.lineTo(80,52); c.lineTo(88,32); c.closePath(); c.fill();
  var t=new THREE.CanvasTexture(cv); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.anisotropy=4;
  return t;
}
var flowTex0=makeFlowTex();
/* q: flow key from flows(); share: part of that flow in this duct; ck/tk: stream colour + air state */
function addDuctFlow(curve,r,q,share,ck,tk){
  var len=curve.getLength(), tex=flowTex0.clone(); tex.needsUpdate=true;
  tex.repeat.set(Math.max(1,len/4.5),2);
  var mat=new THREE.MeshBasicMaterial({map:tex,color:0xffffff,transparent:true,opacity:0.95,depthWrite:false,side:THREE.DoubleSide});
  var mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,Math.max(16,Math.round(len*1.5)),r,12,false),mat);
  mesh.renderOrder=3; ductFlow.add(mesh);
  DUCTFLOW.push({mesh:mesh,tex:tex,mat:mat,q:q,share:share||1,ck:ck,tk:tk});
}
var DUCTAIR={
  'Compressor discharge':['Qfa',1,'f','oa'],
  'Fresh-air header':['Qfa',1,'f','oa'],
  'Header → recovery unit (fresh lane)':['Qhr',1,'f','oa'],
  'Core bypass: header → AHU (baseline test)':['Qdir',1,'f','oa'],
  'Tempered-air duct: recovery unit → AHU':['Qhr',1,'f','t1'],
  'Exhaust: air-pump unit → roof stack':['Qcore',1,'r','exh'],
  'Supply riser':['Qsup',1,'m','sup'],
  'Terminal drop 1 (ceiling)':['Qsup',0.25,'m','sup'],
  'Terminal drop 2 (ceiling, above the operator)':['Qsup',0.175,'m','sup'],
  'Terminal drop 3 (ceiling, above the operator)':['Qsup',0.175,'m','sup'],
  'LAF supply drop':['Qsup',0.4,'m','sup'],
  'Exhaust collector A (behind the partition)':['Qret',0.333,'r','ret'],
  'Exhaust collector B (behind the partition)':['Qret',0.667,'r','ret'],
  'Exhaust collector C (right wall, behind the operator)':['Qret',0.333,'r','ret'],
  'Exhaust main: clean room → DV-101':['Qex',1,'r','ret'],
  'Exhaust: DV-101 → air-pump unit (Cu core)':['Qcore',1,'r','r1'],
  'HEPA bypass: DV-101 → outer BIBO HEPA':['Qbyp',1,'c','ret'],
  'Bypass discharge: FAN-103B → roof stack':['Qbyp',1,'r','ret']
};
rigDucts.children.forEach(function(d){
  var k=DUCTAIR[d.userData.part]; if(!k || !d.userData.curve) return;
  addDuctFlow(d.userData.curve,d.userData.r*0.62,k[0],k[1],k[2],k[3]);       // the rectangle's inscribed core
});
function line3(pts){ var cp=new THREE.CurvePath(); for(var i=0;i<pts.length-1;i++) cp.add(new THREE.LineCurve3(W(pts[i][0],pts[i][1],pts[i][2]),W(pts[i+1][0],pts[i+1][1],pts[i+1][2]))); return cp; }
// the straight runs that are boxes or open cylinders rather than swept ducts
addDuctFlow(line3([[-BX-1.2,COMP.y,COMP.z],[COMP.x-2.2,COMP.y,COMP.z]]),1.15,'Qfa',1,'f','oa');                         // louvre → compressor
addDuctFlow(roundedPath([[P_AHU_SUP.x+0.2,P_AHU_SUP.y,P_AHU_SUP.z],[RX,P_AHU_SUP.y,P_AHU_SUP.z+0.6],[RX,P_AHU_SUP.y,RZ]],1.2),0.85,'Qsup',1,'m','sup');  // supply boot
function colorDuctFlow(){
  var states=m.a;
  DUCTFLOW.forEach(function(d){
    if(colorMode==='temp' && states) tempColor(states[d.tk]!==undefined?states[d.tk]:21,d.mat.color);
    else streamColor(d.ck,d.mat.color);
  });
}
function updateDuctFlow(dt,speed,fl){
  var ref=Math.max(fl.ref||1,0.5);
  DUCTFLOW.forEach(function(d){
    var q=(fl[d.q]||0)*d.share, ff=Math.max(0,Math.min(3,q/ref));
    d.mesh.visible=q>0.02;
    d.tex.offset.x-=dt*speed*ff*2.2;                  // −offset moves the chevrons downstream
  });
}

/* ============================================================== labels */
function roundRect(ctx,x,y,w,h,rr){
  ctx.beginPath(); ctx.moveTo(x+rr,y); ctx.lineTo(x+w-rr,y); ctx.quadraticCurveTo(x+w,y,x+w,y+rr);
  ctx.lineTo(x+w,y+h-rr); ctx.quadraticCurveTo(x+w,y+h,x+w-rr,y+h); ctx.lineTo(x+rr,y+h);
  ctx.quadraticCurveTo(x,y+h,x,y+h-rr); ctx.lineTo(x,y+rr); ctx.quadraticCurveTo(x,y,x+rr,y); ctx.closePath();
}
function makeLabelSprite(text,sub,scale){
  var dpr=2,pad=14,fs=30,ss=21,w=0;
  var cv=document.createElement('canvas'),ctx=cv.getContext('2d');
  ctx.font='600 '+fs+'px "IBM Plex Sans", sans-serif'; w=ctx.measureText(text).width;
  ctx.font='400 '+ss+'px "IBM Plex Mono", monospace'; w=Math.max(w,ctx.measureText(sub||'').width);
  var Wd=Math.ceil(w+pad*2), Hh=sub?Math.ceil(fs+ss+pad*2+6):Math.ceil(fs+pad*2);
  cv.width=Wd*dpr; cv.height=Hh*dpr; ctx.scale(dpr,dpr);
  ctx.fillStyle=T.dark?'rgba(14,20,27,0.88)':'rgba(255,255,255,0.90)';
  ctx.strokeStyle=T.dark?'rgba(130,155,180,0.45)':'rgba(40,60,80,0.25)'; ctx.lineWidth=1.5;
  roundRect(ctx,0,0,Wd,Hh,5); ctx.fill(); ctx.stroke();
  ctx.fillStyle=T.ink; ctx.textBaseline='top';
  ctx.font='600 '+fs+'px "IBM Plex Sans", sans-serif'; ctx.fillText(text,pad,pad-2);
  if(sub){ ctx.fillStyle=T.inkDim; ctx.font='400 '+ss+'px "IBM Plex Mono", monospace'; ctx.fillText(sub,pad,pad+fs+2); }
  var tex=new THREE.CanvasTexture(cv); tex.anisotropy=4;
  var sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false,depthWrite:false,sizeAttenuation:false}));
  sp.renderOrder=10; sp.scale.set(Wd*scale,Hh*scale,1);
  return sp;
}
var RIGLABELS=[
  {text:'Fresh-air compressor',sub:'FAN-101 · 100 % fresh air, once through',a:W(COMP.x,COMP.y+4.2,COMP.z),o:W(-3,9,3)},
  {text:'Fresh-air header',sub:'→ air-pump Cu core (bypass only for the baseline test)',a:W(HX,HY+1.2,-4),o:W(-9,6,10),tier:'plant'},
  {text:'AHU · 100 % fresh air',sub:'no mixing box, no recirculation, no exhaust inside',a:C2W(1,YT,0),o:W(9,6,13)},
  {text:'Heat-recovery air-pump unit',sub:'Cu plate core · the only exhaust path',a:C2W(MXC,MY+MH/2,MZ),o:W(-6,13,-8)},
  {text:'Supply riser',sub:'FT-102 airflow → 4 BIBO HEPA terminals',a:W(RX,32,RZ),o:W(5,5,9)},
  {text:'Ceiling BIBO HEPA terminal 1',sub:'H14 · bag-in/bag-out from the ceiling void',a:W(14,CEIL-0.4,0),o:W(-3,-6,13)},
  {text:'LAF hood over the filler',sub:'H14 BIBO · down-flow first air · 100 % fresh air',a:W(LAF.x1,LAF.y1,LAF.z1),o:W(4,6,10)},
  {text:'Ceiling BIBO HEPA terminals 2 + 3',sub:'H14 · above the operator · down to exhaust terminal 3',a:W(CT.x,CEIL-0.4,CT.z[1]+CT.a/2),o:W(3,5,12)},
  {text:'Low-level exhaust terminals',sub:'H14 BIBO · straight to the air pump',a:W(0.6,GRILLE[0][0]+2,GRILLE[0][1]),o:W(9,-1,12)},
  {text:'Exhaust terminal 3',sub:'H14 BIBO · low on the wall behind the operator',a:W(BX-TH,T3.y+2,T3.z+3.5),o:W(6,-2,12)},
  {text:'PT-102 exhaust particles',sub:'diverts dirty exhaust before the air pump',a:W(-17,EXY+3.2,EXZ),o:W(4,8,6),tier:'plant'},
  {text:'DV-101 diverter',sub:'spring return · fail-safe to the HEPA',a:W(DVX,EXY+1.4,EXZ+1.6),o:W(-3,6,8),tier:'plant'},
  {text:'Outer BIBO HEPA + FAN-103B',sub:'beside the fresh-air compressor · out through the common roof stack',a:W((BYP.x0+BYP.x1)/2,BYP.y+3,BYP.z),o:W(4,9,9),tier:'plant'},
  {text:'Clean room',sub:'ACH = supply airflow ÷ room volume',a:W(26,30,-16),o:W(-4,14,-6),tier:'aux'},
  {text:'HMI-101 touch screen',sub:'7-inch · every set point',a:W(-38,46.8,BZ+2),o:W(-6,6,6),tier:'plant'},
  {text:'Main controller PCB',sub:'ESP32-S3 · 3 × ACS712 current',a:W(-21,PCB.y1,PCB.z+0.3),o:W(3,7,3),tier:'plant'},
  {text:'PCB wiring harness',sub:'flat FR4 strips, no loose wires',a:W(-8,TH+0.3,-14),o:W(18,-4,-6),tier:'plant'},
  {text:'Exhaust outlet: common roof stack',sub:'both exhausts · rain cap · far from the fresh-air intake',a:W(BYP.sx,BYP.top+2.3,BYP.sz),o:W(6,3,6)},
  {text:'Acrylic enclosure',sub:'1000 × 500 × 500 mm · 5 mm PMMA',a:W(BX,BY,BZ),o:W(8,2,8)},
  {text:'Vial filling machine',sub:'along the right wall · open RABS under the LAF',a:FW(44,VF.deck+8.4,VF.z0),o:W(-6,9,-6)},
  {text:'Pass box',sub:'material transfer · interlocked doors + UV',a:W((PBX.x0+PBX.x1)/2,PBX.y1+0.3,BZ),o:W(-8,7,6)},
  {text:'Operator',sub:'under ceiling terminals 2 + 3 · down-flow to exhaust terminal 3',a:W(OPW.x,25.6,OPW.z),o:W(5,6,9)},
  {text:'Air particle sensor',sub:'PT-101 · room air + fill-point probe',a:W(PT.x,PT.y+2.1,PT.z),o:W(-2,18,4)},
  {text:'24 V DC supply',sub:'feeds the PCB',a:W(-40,TH+3.2,-20),o:W(-5,-5,-4),tier:'aux'},
  {text:'Room T + RH',sub:'MT-106 · SHT31',a:W(44,24,-BZ+TH+1.2),o:W(4,6,4),tier:'aux'},
  {text:'Room pressure',sub:'PDT-101 · SDP810',a:W(TH/2+1.2,31.5,-19),o:W(5,5,-2),tier:'aux'}
];
var labelGroup=new THREE.Group(); scene.add(labelGroup);
var leaderMat=new THREE.LineBasicMaterial({color:T.metalDark.clone(),transparent:true,opacity:0.9});
var labelMode='key', REACH=2.0;
function buildLabels(){
  while(labelGroup.children.length){
    var c=labelGroup.children.pop();
    if(c.material && c.material!==leaderMat){ if(c.material.map) c.material.map.dispose(); c.material.dispose(); }
    if(c.geometry) c.geometry.dispose();
  }
  if(labelMode==='off') return;
  function put(anchor,pos,text,sub,scale){
    var sp=makeLabelSprite(text,sub,scale); sp.position.copy(pos); labelGroup.add(sp);
    var knee=anchor.clone().lerp(pos,0.72); knee.y=pos.y;
    labelGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([anchor.clone(),knee,pos.clone()]),leaderMat));
    var dot=new THREE.Mesh(new THREE.SphereGeometry(0.22,10,8),new THREE.MeshBasicMaterial({color:leaderMat.color}));
    dot.position.copy(anchor); dot.renderOrder=9; labelGroup.add(dot);
  }
  RIGLABELS.forEach(function(d){
    if(d.tier==='aux' && labelMode!=='all') return;
    if(d.tier==='plant' && labelMode==='key') return;
    put(d.a,d.a.clone().add(d.o),d.text,d.sub,0.00052);
  });
  if(labelMode==='plant'||labelMode==='all'){
    labels.forEach(function(d){
      if(d.tier==='aux' && labelMode!=='all') return;
      var a=C2W(d.anchor.x,d.anchor.y,d.anchor.z);
      put(a,a.clone().add(d.off.clone().multiplyScalar(REACH*K)),d.text,d.sub,0.00040);
    });
  }
}
function refreshLabels(){ buildLabels(); labelGroup.visible=labelMode!=='off'; }

/* ---------------------------------------------------- live sensor tags */
var tagGroup=new THREE.Group(); scene.add(tagGroup);
var TAGDEF=[
  ['TT-101',W(HX-1.8,HY+3.4,-1.6),'in'], ['FT-101',W(HX-1.8,HY-3.2,2.4),'in'],
  ['FAN-101',W(COMP.x+1,COMP.y+6.6,COMP.z+2),'out'],
  ['TT-109',C2W(-9.4,YT+1.6,0.8),'in'], ['TT-103',C2W(-0.25,YT+3.3,0),'in'],
  ['TT-104',C2W(3.35,YT+1.6,0),'in'], ['TT-105',C2W(7.2,YT+3.3,0),'in'],
  ['TT-107',W(-12.6,EXY+3.6,EXZ+2),'in'], ['PDT-102',C2W(7.6,Y0-1.4,Z1+0.8),'in'],
  ['PT-102',W(-18,EXY+6.4,EXZ),'in'], ['DV-101',W(DVX-3,EXY+5.2,EXZ+3),'out'],
  ['FAN-103B',W(BYP.fx,BYP.y+4.8,BYP.z+2.5),'out'], ['FAN-102',C2W(5.0,Y0-2.9,Z1+0.9),'out'],
  ['CMP-101',C2W(-6.6,Y0-3.3,Z1+1.2),'out'], ['FAN-103',C2W(MX0+1.4,MY+MH/2+2.4,MZL),'out'],
  ['TT-108',C2W(-18.3,MY+MH/2+2.6,MZL),'in'],
  ['FT-102',W(RX+0.5,24,RZ+3.4),'in'], ['TT-106',W(42,28,-21),'in'], ['PDT-101',W(4,35,-19),'in'],
  ['ACH',W(20,30,4),'calc'], ['CT',W(-21,PCB.y0-2.4,PCB.z+1.2),'in'], ['PT-101',W(PT.x-7,PT.y+1,PT.z+2),'in']
];
var TAGS=TAGDEF.map(function(d){
  var cv=document.createElement('canvas'); cv.width=600; cv.height=176;     // 2× so the Large readings stay sharp
  var tex=new THREE.CanvasTexture(cv); tex.anisotropy=4;
  // constant on-screen size, so tags stay readable from the whole-box view to close-ups
  var sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false,depthWrite:false,sizeAttenuation:false}));
  var big=d[0]==='ACH'; sp.scale.set(big?0.15:0.105,big?0.044:0.031,1); sp.position.copy(d[1]); sp.renderOrder=11;
  tagGroup.add(sp);
  return {id:d[0],kind:d[2],cv:cv,tex:tex,sp:sp,last:''};
});
function drawTag(t,line1,line2,state){
  var key=line1+'|'+line2+'|'+state+'|'+T.dark; if(key===t.last) return; t.last=key;
  var c=t.cv.getContext('2d'), w=300, h=88;
  c.setTransform(2,0,0,2,0,0); c.clearRect(0,0,w,h);
  c.fillStyle=T.dark?'rgba(10,15,21,0.92)':'rgba(255,255,255,0.94)';
  roundRect(c,2,2,w-4,h-4,10); c.fill();
  c.lineWidth=3; c.strokeStyle=state==='alarm'?T.bad:(t.kind==='out'?tok('--sig-out'):(t.kind==='calc'?tok('--mix'):tok('--sig-in')));
  roundRect(c,2,2,w-4,h-4,10); c.stroke();
  c.fillStyle=T.inkDim; c.font='600 24px "IBM Plex Mono", monospace'; c.textBaseline='top'; c.fillText(line1,14,8);
  c.fillStyle=T.ink; c.font='600 34px "IBM Plex Mono", monospace'; c.fillText(line2,14,40);
  t.tex.needsUpdate=true;
}

/* ============================================================ the model */
var m=RigModel.create(), P=m.P, P0=RigModel.defaults();
var MODE={
  winter:{dir:1, coils:{preheat:'hot',cooling:'idle',reheat:'hot',extract:'cold'},
    lbl:{preheat:['Pre-heat coil','air pump condenser'],cooling:['Cooling coil','idle in heating mode'],
         reheat:['Reheat coil','PTC trim heater'],extract:['Exhaust-air coil','air pump evaporator']}},
  summer:{dir:-1, coils:{preheat:'idle',cooling:'cold',reheat:'hot',extract:'hot'},
    lbl:{preheat:['Pre-heat coil','idle in cooling mode'],cooling:['Cooling coil','air pump evaporator'],
         reheat:['Reheat coil','desuperheater + PTC trim'],extract:['Exhaust-air coil','air pump condenser']}}
};
var state={season:'winter',casing:'ghost',explode:0,speed:1,simSpeed:10,doors:true,refrig:true,ducts:true,spin:true,playing:true};
var COILS={preheat:coilPreheat,cooling:coilCooling,reheat:coilReheat,extract:coilExtract};
var COILLBL={preheat:lblPre,cooling:lblCool,reheat:lblRe,extract:lblExt};
var coilMat={};
Object.keys(COILS).forEach(function(k){ coilMat[k]={hot:M.coilHot.clone(),cold:M.coilCold.clone(),idle:M.coilIdle}; });
function coilRoles(){
  var d=MODE[state.season].coils, r={};
  Object.keys(d).forEach(function(k){ r[k]=d[k]; });
  if(!m.recovery){ r.extract='idle'; }
  return r;
}
function applySeason(){
  var d=MODE[state.season];
  m.season=state.season;
  loadFields();
  var roles=coilRoles();
  Object.keys(COILS).forEach(function(k){
    COILS[k].userData.fins.material=coilMat[k][roles[k]];
    COILLBL[k].text=d.lbl[k][0]; COILLBL[k].sub=d.lbl[k][1];
  });
  if(!m.recovery){
    COILLBL.preheat.sub=state.season==='winter'?'electric (baseline test)':'idle in cooling mode';
    COILLBL.cooling.sub=state.season==='summer'?'plain chiller (baseline test)':'idle in heating mode';
    COILLBL.extract.sub='off — recovery bypassed';
  }
  document.getElementById('lblCoil').textContent=state.season==='winter'?'After pre-heat set point °C':'Off-coil set point °C';
  refreshLabels(); syncModePill();
}
function applyCasing(){
  casingParts.forEach(function(o){
    if(state.casing==='off'){ o.visible=false; }
    else { o.visible=true; o.material.opacity=state.casing==='solid'?0.78:0.2; }
  });
  doors.visible = state.doors && state.casing!=='off';
}
function applyBox(v){
  MR.acrylic.opacity=v==='frost'?0.38:0.12; MR.acrylic.roughness=v==='frost'?0.85:0.08;
  box3d.visible=v!=='off'; MR.acrylic.needsUpdate=true;
}
function applyExplode(){
  var a=state.explode;
  explodables.forEach(function(e){
    var s=(e.scale||2.5)*a;
    e.obj.position.set(e.base.x+e.dir.x*s, e.base.y+e.dir.y*s, e.base.z+e.dir.z*s);
  });
  wallParts.forEach(function(w){ w.obj.position.copy(w.base).addScaledVector(w.dir,a*26); });
  casingParts.forEach(function(o){
    if(state.casing!=='off') o.material.opacity=(state.casing==='solid'?0.78:0.2)*(1-a*0.75);
  });
  ribbons.visible = document.getElementById('cbRibbon').checked && a<0.25;
}

/* ---------------------------------------------------------- formatting */
function f1(v){ return (Math.round(v*10)/10).toFixed(1); }
function f0(v){ return String(Math.round(v)); }
function f2(v){ return (Math.round(v*100)/100).toFixed(2); }
function sgn(v,d){ var s=(d===0?f0(v):(d===2?f2(v):f1(v))); return (v<0?'−':'')+s.replace('-',''); }
function tC(v){ return sgn(v)+' °C'; }
function hms(t){ t=Math.floor(t); var h=Math.floor(t/3600), mi=Math.floor(t%3600/60), s=t%60;
  return (h<10?'0':'')+h+':'+(mi<10?'0':'')+mi+':'+(s<10?'0':'')+s; }
function kfmt(v){ v=Math.max(0,v); return v>=1e6?(v/1e6).toFixed(2)+'M':(v>=1e4?Math.round(v/1e3)+'k':(v>=1e3?(v/1e3).toFixed(1)+'k':String(Math.round(v)))); }
/* EU GMP Annex 1 (2022) / ISO 14644-1 airborne particle limits per m³, in operation */
function gradeOf(c05,c5){
  if(c05<=3520&&c5<=29) return {g:'A',iso:'ISO 5',short:'Grade A · ISO 5'};
  if(c05<=352000&&c5<=2930) return {g:'B',iso:'ISO 7',short:'Grade B in op · ISO 7'};
  if(c05<=3520000&&c5<=29300) return {g:'C',iso:'ISO 8',short:'Grade C in op · ISO 8'};
  return {g:'—',iso:'> ISO 8',short:'above Grade C'};
}
function esc(s){ return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }

/* ====================================================================== HMI */
var $=function(id){ return document.getElementById(id); };
var hmiEl=$('hmi');
/* sensors and actuators, with the board channel each one uses */
var IO=[
  ['TT-101','Fresh-air temperature',function(){return sgn(m.s.TT101)+' °C';},'SHT31 on the fresh-air header','I²C mux ch0 · 0x44','in'],
  ['MT-101','Fresh-air humidity',function(){return f0(m.s.MT101)+' %';},'SHT31','I²C mux ch0','in'],
  ['FT-101','Fresh-air flow',function(){return f2(m.s.FT101)+' m³/h';},'Omron D6F-W04A1 air velocity','ADC1_CH0 · GPIO1','in'],
  ['TT-109','Fresh air off the Cu core (pre-cooled / pre-heated)',function(){return sgn(m.s.TT109)+' °C';},'DS18B20 probe at the AHU inlet','1-Wire A · GPIO15','in'],
  ['TT-103','Air after pre-heat',function(){return sgn(m.s.TT103)+' °C';},'DS18B20 probe','1-Wire A · GPIO15','in'],
  ['TT-104','Air off the cooling coil',function(){return sgn(m.s.TT104)+' °C';},'DS18B20 probe','1-Wire A · GPIO15','in'],
  ['TT-105','Final supply-air temperature',function(){return sgn(m.s.TT105)+' °C';},'SHT31 after the HEPA','I²C mux ch1 · 0x44','in'],
  ['MT-105','Final supply-air humidity',function(){return f0(m.s.MT105)+' %';},'SHT31','I²C mux ch1','in'],
  ['FT-102','Final supply airflow',function(){return f2(m.s.FT102)+' m³/h';},'Omron D6F-W04A1 in the riser','ADC1_CH1 · GPIO2','in'],
  ['PDT-101','Clean-room pressure',function(){return sgn(m.s.PDT101)+' Pa';},'Sensirion SDP810-125Pa','I²C mux ch2 · 0x25','in'],
  ['PDT-102','HEPA filter ΔP',function(){return f0(m.s.PDT102)+' Pa';},'Sensirion SDP810-500Pa','I²C mux ch3 · 0x25','in'],
  ['TT-106','Clean-room temperature',function(){return sgn(m.s.TT106)+' °C';},'SHT31','I²C mux ch4 · 0x44','in'],
  ['MT-106','Clean-room humidity',function(){return f0(m.s.MT106)+' %';},'SHT31','I²C mux ch4','in'],
  ['TT-107','Exhaust air to the air pump',function(){return sgn(m.s.TT107)+' °C';},'DS18B20 probe on the exhaust main','1-Wire B · GPIO16','in'],
  ['TT-108','Exhaust after the air-pump coil',function(){return sgn(m.s.TT108)+' °C';},'DS18B20 probe','1-Wire B · GPIO16','in'],
  ['CT-101','Current: air-pump compressor',function(){return f2(m.s.CT101)+' A';},'ACS712-05B on the PCB','ADC1_CH3 · GPIO4','in'],
  ['CT-102','Current: fans',function(){return f2(m.s.CT102)+' A';},'ACS712-05B on the PCB','ADC1_CH4 · GPIO5','in'],
  ['CT-103','Current: reheat + humidifier',function(){return f2(m.s.CT103)+' A';},'ACS712-05B on the PCB','ADC1_CH5 · GPIO6','in'],
  ['VT-101','DC bus voltage',function(){return f1(m.s.VT101)+' V';},'100 k / 10 k divider','ADC1_CH6 · GPIO7','in'],
  ['PT-101','Airborne particles ≥0.5 / ≥5.0 µm: room · fill point',function(){return kfmt(m.s.PT101)+' · '+kfmt(m.s.PT101A)+' /m³';},'Laser particle counter, 2.83 L/min, 2-port manifold (room air + isokinetic fill-point probe)','I²C mux ch5 · 0x69','in'],
  ['PT-102','Exhaust particles ≥0.5 µm, before DV-101',function(){return kfmt(m.s.PT102)+' /m³ · trip '+kfmt(P.pxTrip);},'Sensirion SPS30 on the exhaust main (indicative)','I²C mux ch7 · 0x69','in'],
  ['ACH','Air changes per hour',function(){return f1(m.kpi.ach)+' /h';},'FT-102 ÷ clean-room volume','calculated','calc'],
  ['FAN-101','Fresh-air compressor speed',function(){return f0(m.act.fa*100)+' %';},'24 V BLDC centrifugal blower','PWM GPIO38 · tach GPIO10','out'],
  ['FAN-102','Supply fan speed',function(){return f0(m.act.sf*100)+' %';},'24 V EC plug fan','PWM GPIO39 · tach GPIO11','out'],
  ['FAN-103','Exhaust fan (air-pump unit) / FAN-103B (HEPA bypass)',function(){return f0(m.act.ef*100)+' % · '+(m.act.dv>0.5?'FAN-103B':'FAN-103');},'2 × 24 V EC fan, one PWM; DV-101 end switch powers the fan of the open path','PWM GPIO40 · tach GPIO12','out'],
  ['DV-101','Exhaust diverter: air pump ⇄ outer BIBO HEPA',function(){return m.act.dv>0.5?'HEPA bypass':(m.act.dv<0.05?'to air pump':'moving '+f0(m.act.dv*100)+' %');},'24 V spring-return on/off actuator + SPDT end switch (fail-safe: HEPA)','MOSFET · GPIO21','out'],
  ['CMP-101','Air-pump compressor',function(){return f0(m.act.cmp*100)+' %';},'24 V BLDC R32 compressor + driver','0–5 V via PWM-RC · GPIO41','out'],
  ['RV-101','Reversing valve',function(){return m.season==='winter'?'heating':'cooling';},'4-way valve coil','relay · GPIO42','out'],
  ['EEV-101','Expansion valve',function(){return f0(80+m.act.cmp*400)+' steps';},'stepper EEV','STEP/DIR · GPIO13/14','out'],
  ['HTR-101','Reheat PTC element',function(){return f0(m.act.rh*100)+' %';},'24 V PTC heater','MOSFET PWM · GPIO47','out'],
  ['HUM-101','Steam humidifier',function(){return f0(m.act.hum*100)+' %';},'24 V steam generator','MOSFET PWM · GPIO48','out'],
  ['HMI-101','Touch screen',function(){return 'online';},'7-inch HMI display','UART TX17 / RX18','out']
];
function ioIndex(tag){ for(var i=0;i<IO.length;i++) if(IO[i][0]===tag) return i; return -1; }

/* KPI bar */
var KPIS=[
  ['ach','Clean-room ACH','m'],['dp','Room pressure','g'],['rt','Room temp','m'],['rrh','Room RH','m'],
  ['pt','Particles ≥0.5 µm','r'],['q','Supply airflow','m'],['fa','Fresh air','f'],['pw','Power now','p'],['red','Energy saving','g'],['co2','CO₂ footprint','r']
];
$('kbar').innerHTML=KPIS.map(function(k){
  return '<div class="kp '+k[2]+'"><div class="n">'+k[1]+'</div><div class="v" id="k-'+k[0]+'">–</div><div class="d" id="kd-'+k[0]+'">&nbsp;</div></div>';
}).join('');

/* Overview mimic */
$('pane-ov').innerHTML='<svg class="mimic" viewBox="0 0 1110 252" role="img" aria-label="Rig overview mimic">'+
 /* lines: fresh (through the air-pump Cu core; the straight line is the baseline-test bypass) */
 '<path class="ln lf" d="M50 110H76M108 110H190"/><path class="ln lf" d="M190 110V165H215"/><path class="ln lf" d="M355 165H375V110H400"/>'+
 '<path class="ln lf" d="M190 110H375" stroke-dasharray="4 4" opacity=".55"/><text x="282" y="104" text-anchor="middle" class="lb">bypass (baseline)</text>'+
 /* supply */
 '<path class="ln lm" d="M400 110H880"/><path class="ln lm" d="M880 110H902V40H1060V60M972 40V60"/>'+
 /* exhaust: room → PT-102 → DV-101 → air-pump unit → outdoors; DV-101 → outer HEPA → outdoors */
 '<path class="ln lr" d="M930 196H905V205H355"/><path class="ln lr" d="M215 205H40"/>'+
 '<path class="ln lr" d="M640 205V234H612M562 234H520" id="m-bypl"/>'+
 '<path class="flow" id="fl-f" d="M50 110H190V165H215M355 165H375V110H400"/><path class="flow" id="fl-s" d="M400 110H880H902V40H1060"/><path class="flow" id="fl-r" d="M930 196H905V205H40"/>'+
 /* compressor */
 '<circle cx="92" cy="110" r="16" class="box"/><path d="M82 104l20 12M82 116l20-12" stroke="var(--ink-dim)" stroke-width="2"/>'+
 '<text x="92" y="146" text-anchor="middle" class="lb">FAN-101</text><text x="92" y="161" text-anchor="middle" class="val" id="m-fan101">–</text>'+
 '<text x="8" y="96" class="lb">Outdoor</text>'+
 '<rect class="tag" x="118" y="62" width="104" height="32" rx="4"/><text x="126" y="75" class="lb">TT-101 · MT-101</text><text x="126" y="89" class="val" id="m-tt101">–</text>'+
 '<rect class="tag" x="226" y="62" width="84" height="32" rx="4"/><text x="234" y="75" class="lb">FT-101</text><text x="234" y="89" class="val" id="m-ft101">–</text>'+
 /* recovery unit */
 '<rect class="box" x="215" y="146" width="140" height="78" rx="4"/><text x="285" y="140" text-anchor="middle" class="lb">Air-pump unit · Cu core</text>'+
 '<path d="M265 160l40 40M305 160l-40 40" stroke="var(--copper,#b9712f)" stroke-width="3"/>'+
 '<rect x="238" y="194" width="12" height="22" fill="var(--refrig)" opacity=".55"/>'+
 '<text x="322" y="182" class="val" id="m-hr">–</text>'+
 '<text x="8" y="196" class="lb">Exhaust</text>'+
 '<rect class="tag" x="46" y="214" width="96" height="32" rx="4"/><text x="54" y="227" class="lb">TT-108</text><text x="54" y="241" class="val" id="m-tt108">–</text>'+
 /* AHU: 100 % fresh air, no mixing box, no core */
 '<rect class="unit" x="400" y="66" width="480" height="96" rx="6"/><text x="408" y="60" class="lb">AHU · 100 % fresh air</text>'+
 '<path d="M420 96v28M428 96v28M436 96v28" stroke="var(--ink-dim)" stroke-width="2"/><text x="428" y="152" text-anchor="middle" class="lb">Filters</text>'+
 '<text x="500" y="106" text-anchor="middle" class="lb">no mixing</text><text x="500" y="120" text-anchor="middle" class="lb">no recirc.</text>'+
 '<rect x="550" y="96" width="16" height="28" fill="var(--return)" opacity=".7" id="m-phc"/><text x="558" y="152" text-anchor="middle" class="lb">Pre-heat</text>'+
 '<rect x="602" y="96" width="16" height="28" fill="var(--fresh)" opacity=".7" id="m-ccc"/><text x="610" y="152" text-anchor="middle" class="lb">Cool</text>'+
 '<rect x="652" y="96" width="16" height="28" fill="var(--return)" opacity=".7" id="m-rhc"/><text x="660" y="152" text-anchor="middle" class="lb">Reheat</text>'+
 '<path d="M704 98v24M712 98v24M720 98v24" stroke="var(--fresh)" stroke-width="2"/><text x="712" y="152" text-anchor="middle" class="lb">Hum</text>'+
 '<circle cx="768" cy="110" r="14" class="box"/><path d="M760 104l16 12M760 116l16-12" stroke="var(--ink-dim)" stroke-width="2"/><text x="768" y="152" text-anchor="middle" class="lb">Fan</text>'+
 '<rect x="814" y="94" width="18" height="32" class="box"/><path d="M818 98l10 4-10 4 10 4-10 4 10 4-10 4" stroke="var(--ink-dim)" fill="none"/><text x="823" y="152" text-anchor="middle" class="lb">HEPA</text>'+
 '<text x="558" y="138" text-anchor="middle" class="val" id="m-ph">–</text>'+
 '<text x="610" y="138" text-anchor="middle" class="val" id="m-cc">–</text><text x="660" y="138" text-anchor="middle" class="val" id="m-rh">–</text>'+
 '<text x="712" y="138" text-anchor="middle" class="val" id="m-hum">–</text><text x="768" y="138" text-anchor="middle" class="val" id="m-sf">–</text>'+
 '<text x="823" y="138" text-anchor="middle" class="val" id="m-hepa">–</text>'+
 '<rect class="tag" x="440" y="14" width="84" height="32" rx="4"/><text x="448" y="27" class="lb">TT-109 core</text><text x="448" y="41" class="val" id="m-tt109">–</text>'+
 '<rect class="tag" x="530" y="14" width="84" height="32" rx="4"/><text x="538" y="27" class="lb">TT-103 pre</text><text x="538" y="41" class="val" id="m-tt103">–</text>'+
 '<rect class="tag" x="620" y="14" width="84" height="32" rx="4"/><text x="628" y="27" class="lb">TT-104 coil</text><text x="628" y="41" class="val" id="m-tt104">–</text>'+
 '<rect class="tag" x="752" y="14" width="124" height="32" rx="4"/><text x="760" y="27" class="lb">TT-105 · MT-105 final</text><text x="760" y="41" class="val" id="m-tt105">–</text>'+
 '<path d="M482 46V100M572 46V100M662 46V100M840 46V100" stroke="var(--line)" stroke-dasharray="2 3"/>'+
 '<rect class="tag" x="910" y="4" width="84" height="30" rx="4"/><text x="918" y="16" class="lb">FT-102</text><text x="918" y="29" class="val" id="m-ft102">–</text>'+
 /* exhaust safety: PT-102, DV-101, outer BIBO HEPA */
 '<rect class="tag" x="790" y="214" width="108" height="32" rx="4" id="m-pt102b"/><text x="798" y="227" class="lb">PT-102 exhaust</text><text x="798" y="241" class="val" id="m-pt102">–</text>'+
 '<rect class="tag" x="680" y="214" width="96" height="32" rx="4"/><text x="688" y="227" class="lb">TT-107 exhaust</text><text x="688" y="241" class="val" id="m-tt107">–</text>'+
 '<path d="M630 197l20 16M630 213l20-16" stroke="var(--ink)" stroke-width="2.5"/><text x="640" y="190" text-anchor="middle" class="lb">DV-101</text>'+
 '<text x="622" y="192" text-anchor="end" class="val" id="m-dv">–</text>'+
 '<rect x="562" y="224" width="50" height="20" class="box"/><path d="M566 228l8 4-8 4 8 4M578 228l8 4-8 4 8 4M590 228l8 4-8 4 8 4" stroke="var(--ink-dim)" fill="none"/>'+
 '<text x="516" y="232" text-anchor="end" class="lb">outer HEPA</text><text x="516" y="246" text-anchor="end" class="lb">→ outdoors</text>'+
 /* clean room */
 '<rect class="box" x="930" y="60" width="172" height="150" rx="4"/>'+
 '<rect x="962" y="60" width="20" height="5" fill="var(--mix)"/><rect x="1050" y="60" width="20" height="5" fill="var(--mix)"/><rect x="1097" y="96" width="5" height="40" fill="var(--mix)"/>'+
 '<text x="1016" y="86" text-anchor="middle" class="lb">Clean room · 4 BIBO HEPA</text>'+
 '<text x="1016" y="120" text-anchor="middle" class="val" style="font-size:22px" id="m-ach">–</text>'+
 '<text x="1016" y="146" text-anchor="middle" id="m-room">–</text><text x="1016" y="166" text-anchor="middle" id="m-dp">–</text>'+
 '<text x="1016" y="188" text-anchor="middle" class="lb" id="m-vol">–</text>'+
 '</svg>';

/* Sensors table */
$('pane-sn').innerHTML='<table class="sens"><thead><tr><th>Tag</th><th>Measures / drives</th><th>Value</th><th>Device</th><th>PCB channel</th><th></th></tr></thead><tbody>'+
  IO.map(function(r,i){ return '<tr><td class="tg">'+r[0]+'</td><td>'+esc(r[1])+'</td><td class="v" id="io-'+i+'">–</td><td>'+esc(r[3])+'</td><td class="tg">'+esc(r[4])+'</td><td><span class="io '+(r[5]==='out'?'out':'in')+'">'+(r[5]==='out'?'OUT':(r[5]==='calc'?'CALC':'IN'))+'</span></td></tr>'; }).join('')+
  '</tbody></table>';

/* Control loops */
var LOOPS=[
  {k:'L1',pv:function(){return f2(m.s.FT102)+' m³/h';},sp:function(){return f2(P.flow)+' m³/h';},out:'FAN-102 supply fan',sens:'FT-102'},
  {k:'L2',pv:function(){return f2(m.s.FT101)+' m³/h';},sp:function(){return f2(m.s.FT102)+' m³/h (= FT-102, 100 % OA)';},out:'FAN-101 fresh-air compressor',sens:'FT-101'},
  {k:'L3',pv:function(){return kfmt(m.s.PT102)+' /m³';},sp:function(){return 'trip > '+kfmt(P.pxTrip)+' · reset < '+kfmt(P.pxReset);},out:'DV-101 exhaust diverter',sens:'PT-102',
   meta:'2-position: trip after 5 s above the trip level, back to the air pump after 60 s below the reset level. Manual: < 50 % = air pump, ≥ 50 % = HEPA bypass.'},
  {k:'L4',pv:function(){return tC(m.season==='winter'?m.s.TT103:m.s.TT104);},sp:function(){return tC(m.coilSP||P[m.season].coil);},out:'CMP-101 air-pump compressor',sens:'TT-103 / TT-104'},
  {k:'L5',pv:function(){return tC(m.s.TT105);},sp:function(){return tC(P[m.season].sup);},out:'HTR-101 reheat coil',sens:'TT-105'},
  {k:'L6',pv:function(){return f0(m.s.MT106)+' % RH';},sp:function(){return f0(P.rh)+' % RH';},out:'HUM-101 humidifier (winter) · coil reset (summer)',sens:'MT-106'},
  {k:'L7',pv:function(){return sgn(m.s.PDT101)+' Pa';},sp:function(){return '+'+f0(P.dp)+' Pa';},out:'FAN-103 / FAN-103B exhaust fan',sens:'PDT-101'}
];
$('pane-lp').innerHTML='<div class="loops">'+LOOPS.map(function(l){
  var L=m.loops[l.k];
  return '<div class="loop" data-k="'+l.k+'"><h4>'+l.k+' · '+esc(L.name)+'</h4>'+
    '<div class="meta">sensor '+l.sens+' → '+esc(l.out)+' · '+(l.meta?esc(l.meta):'PI Kp '+L.kp+' Ti '+L.ti+' s')+'</div>'+
    '<div class="pv"><span>PV <b id="lp-pv-'+l.k+'">–</b></span><span>SP <b id="lp-sp-'+l.k+'">–</b></span><span>OUT <b id="lp-out-'+l.k+'">–</b></span></div>'+
    '<div class="bar"><i id="lp-bar-'+l.k+'" style="width:0%"></i></div>'+
    '<div class="am"><div class="seg"><button data-am="auto" aria-pressed="true">Auto</button><button data-am="man" aria-pressed="false">Manual</button></div>'+
    '<input type="range" min="0" max="100" value="0" aria-label="'+l.k+' manual output" disabled></div></div>';
}).join('')+'</div>';
Array.prototype.forEach.call(document.querySelectorAll('.loop'),function(card){
  var k=card.dataset.k, L=m.loops[k], rng=card.querySelector('input[type=range]');
  card.querySelector('.seg').addEventListener('click',function(e){
    var b=e.target.closest('button'); if(!b) return;
    Array.prototype.forEach.call(card.querySelectorAll('.seg button'),function(x){ x.setAttribute('aria-pressed',String(x===b)); });
    L.man=b.dataset.am==='man'; rng.disabled=!L.man;
    if(L.man){ L.mv=L.out; rng.value=Math.round(L.out*100); }
  });
  rng.addEventListener('input',function(){ L.mv=+rng.value/100; });
});

/* Energy & CO₂ */
$('pane-en').innerHTML='<div class="energy">'+
  '<div class="card"><h4>Current sensors</h4>'+
    '<div class="kv"><span>CT-101 air-pump compressor</span><b id="e-ct1">–</b></div>'+
    '<div class="kv"><span>CT-102 fans</span><b id="e-ct2">–</b></div>'+
    '<div class="kv"><span>CT-103 reheat + humidifier</span><b id="e-ct3">–</b></div>'+
    '<div class="kv"><span>Controls (board + HMI)</span><b id="e-ctl">–</b></div>'+
    '<div class="kv"><span>VT-101 bus</span><b id="e-vt">–</b></div>'+
    '<div class="kv"><span>Total input</span><b id="e-tot">–</b></div></div>'+
  '<div class="card"><h4>Now vs. no heat recovery</h4><div class="big" id="e-red">–</div>'+
    '<div class="cmp"><div class="r"><span>This rig</span><span class="t"><i id="e-bar-a" style="background:var(--mix)"></i></span><b id="e-pa">–</b></div>'+
    '<div class="r"><span>Baseline</span><span class="t"><i id="e-bar-b" style="background:var(--return)"></i></span><b id="e-pb">–</b></div></div>'+
    '<p class="note">Baseline = the same rig, 100 % fresh air, same airflow and set points, with the Cu core bypassed: electric pre-heat in winter, a plain chiller (COP <span id="e-copb">–</span>) in summer, electric reheat.</p></div>'+
  '<div class="card"><h4>Energy counters</h4>'+
    '<div class="kv"><span>Measured energy</span><b id="e-wh">–</b></div>'+
    '<div class="kv"><span>Baseline energy (twin)</span><b id="e-whb">–</b></div>'+
    '<div class="kv"><span>Saved</span><b id="e-whs">–</b></div>'+
    '<div class="kv"><span>A/B test: recovery on, avg</span><b id="e-abh">–</b></div>'+
    '<div class="kv"><span>A/B test: baseline, avg</span><b id="e-abb">–</b></div>'+
    '<div class="kv"><span>A/B measured reduction</span><b id="e-abr">–</b></div>'+
    '<div class="btns" style="margin-top:6px"><button class="btn" id="btnEreset" type="button">Reset counters</button></div>'+
    '<p class="note">For a measured A/B result, run a while with <b>Recovery on</b>, then switch to <b>Baseline test</b> at the same conditions.</p></div>'+
  '<div class="card"><h4>Carbon footprint</h4>'+
    '<div class="kv"><span>Now</span><b id="e-co2h">–</b></div>'+
    '<div class="kv"><span>Baseline now</span><b id="e-co2hb">–</b></div>'+
    '<div class="kv"><span>Emitted so far</span><b id="e-co2">–</b></div>'+
    '<div class="kv"><span>Avoided so far</span><b id="e-co2s">–</b></div>'+
    '<div class="kv"><span>Rig, per year</span><b id="e-co2y">–</b></div>'+
    '<div class="kv"><span>Scaled to 5 000 m³/h, saved per year</span><b id="e-scale">–</b></div>'+
    '<p class="note">CO₂ = electrical energy × grid factor (<span id="e-ef">–</span> kg/kWh, editable). The scale-up multiplies the thermal saving by the airflow ratio and is indicative only.</p></div>'+
  '<div class="card"><h4>Air pump + recovery</h4>'+
    '<div class="kv"><span id="e-copl">COP</span><b id="e-cop">–</b></div>'+
    '<div class="kv"><span>Coil duty</span><b id="e-qhp">–</b></div>'+
    '<div class="kv"><span>Compressor input</span><b id="e-w">–</b></div>'+
    '<div class="kv"><span>Recovered by the Cu plate core</span><b id="e-qrec">–</b></div>'+
    '<div class="kv"><span>Desuperheater reheat (free)</span><b id="e-dsh">–</b></div>'+
    '<div class="kv"><span>To outdoor condenser</span><b id="e-out">–</b></div>'+
    '<div class="kv"><span>Refrigerant</span><b>R32 · A2L · GWP 675</b></div>'+
    '<div class="kv"><span>Charge (design)</span><b>≈ 40 g · 27 kg CO₂e</b></div>'+
    '<p class="note">Charged through the Schrader ports at commissioning, by weight. While running, the surplus liquid sits in the liquid receiver; the suction accumulator keeps liquid out of the compressor. For service the charge is pumped down into the receiver or recovered into a cylinder, never vented.</p></div>'+
  '<div class="card"><h4>Air changes per hour</h4><div class="big" id="e-ach">–</div>'+
    '<p class="note" id="e-achf">–</p>'+
    '<div class="kv"><span>Room (net)</span><b id="e-dims">–</b></div>'+
    '<div class="kv"><span>Floor area</span><b id="e-area">–</b></div>'+
    '<div class="kv"><span>Typical band</span><b id="e-iso">–</b></div>'+
    '<p class="note">ACH divides the airflow by the room <b>volume</b> (m³/h ÷ m³ = 1/h). Divided by floor area it would give m/h, which is not an air-change rate.</p></div>'+
  '</div>';
$('btnEreset').addEventListener('click',function(){ RigModel.resetEnergy(m); });

/* Trends: one chart per unit, never two scales on one chart */
var CHARTS=[
  {id:'tc',title:'Air temperatures (°C)',ser:[['TT101','TT-101 fresh','--s1'],['TT109','TT-109 off Cu core','--s2'],['TT103','TT-103 pre-heat','--s3'],['TT105','TT-105 final','--s4'],['TT106','TT-106 room','--s5']],unit:'°C',dec:1},
  {id:'rh',title:'Relative humidity (%)',ser:[['MT105','MT-105 supply','--s1'],['MT106','MT-106 room','--s2']],unit:'%',dec:0},
  {id:'pw',title:'Electrical power (W)',ser:[['P','This rig','--s3'],['Pb','Baseline (no recovery)','--s2']],unit:'W',dec:1},
  {id:'ach',title:'Clean-room ACH (1/h)',ser:[['ACH','ACH','--s1']],unit:'/h',dec:1},
  {id:'dp',title:'Clean-room pressure (Pa)',ser:[['DP','PDT-101','--s1']],unit:'Pa',dec:1,lim:[15,'set point']},
  {id:'pr',title:'Room particles ≥0.5 µm (per m³)',ser:[['PR','PT-101 room','--s1']],unit:'/m³',dec:0,lim:[352000,'Grade B in operation'],zero:true},
  {id:'pa',title:'Fill-point particles ≥0.5 µm (per m³)',ser:[['PA','PT-101 fill point','--s3']],unit:'/m³',dec:0,lim:[3520,'Grade A'],zero:true},
  {id:'px',title:'Exhaust particles before DV-101 (per m³)',ser:[['PX','PT-102 exhaust','--s4']],unit:'/m³',dec:0,lim:[1000,'DV-101 trip'],zero:true},
  {id:'q',title:'Airflows (m³/h)',ser:[['QS','FT-102 supply','--s1'],['QF','FT-101 fresh air','--s2'],['QE','Exhaust fans','--s3']],unit:'m³/h',dec:2,zero:true},
  {id:'act',title:'Actuator outputs (%)',ser:[['USF','FAN-102 supply','--s1'],['UFA','FAN-101 compressor','--s2'],['UDV','DV-101 to HEPA','--s3'],['UCM','CMP-101 air pump','--s4'],['URH','HTR-101 reheat','--s5']],unit:'%',dec:0,zero:true},
  {id:'co',title:'CO₂ emissions (g/h)',ser:[['CO','This rig','--s3'],['COB','Baseline (no recovery)','--s2']],unit:'g/h',dec:1,zero:true}
];
$('pane-tr').innerHTML='<div class="trends">'+CHARTS.map(function(c){
  return '<div class="chart" id="ch-'+c.id+'"><h4>'+c.title+'</h4>'+
    (c.ser.length>1?'<div class="lg">'+c.ser.map(function(s){return '<span><i style="background:var('+s[2]+')"></i>'+s[1]+'</span>';}).join('')+'</div>':'')+
    '<svg viewBox="0 0 320 120" preserveAspectRatio="none"></svg><div class="tip" hidden></div></div>';
}).join('')+'</div><p class="note">Last 15 minutes of simulated time, one sample every 2 s. Hover a chart to read values.</p>';
function drawCharts(){
  var d=m.trend; if(d.length<2) return;
  CHARTS.forEach(function(c){
    var el=$('ch-'+c.id), svg=el.querySelector('svg');
    var lo=Infinity, hi=-Infinity;
    d.forEach(function(p){ c.ser.forEach(function(s){ var v=p[s[0]]; if(v<lo) lo=v; if(v>hi) hi=v; }); });
    if(c.lim){ lo=Math.min(lo,c.lim[0]); hi=Math.max(hi,c.lim[0]); }
    if(c.id==='ach'||c.id==='pw'||c.zero){ lo=Math.min(lo,0); }
    var pad=(hi-lo)*0.12||1; lo-=pad; hi+=pad;
    if(c.id==='ach'||c.id==='pw'||c.zero) lo=Math.max(0,lo);
    var X0=30,X1=316,Y0=8,Y1=106, t0=d[0].t, t1=d[d.length-1].t;
    function X(t){ return X0+(X1-X0)*(t-t0)/Math.max(t1-t0,1); }
    function Y(v){ return Y1-(Y1-Y0)*(v-lo)/(hi-lo); }
    var h='';
    for(var g=0;g<=3;g++){ var v=lo+(hi-lo)*g/3, y=Y(v);
      h+='<line x1="'+X0+'" x2="'+X1+'" y1="'+y+'" y2="'+y+'" stroke="var(--line-soft)" stroke-width="1"/>'+
         '<text x="'+(X0-4)+'" y="'+(y+3)+'" text-anchor="end">'+(Math.abs(hi-lo)<10?v.toFixed(1):(Math.abs(v)>=1e4?kfmt(v):Math.round(v)))+'</text>'; }
    if(c.lim){ var yl=Y(c.lim[0]);
      h+='<line x1="'+X0+'" x2="'+X1+'" y1="'+yl+'" y2="'+yl+'" stroke="var(--bad)" stroke-width="1" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>'+
         '<text x="'+(X1-2)+'" y="'+(yl-3)+'" text-anchor="end" style="fill:var(--bad)">'+c.lim[1]+' '+(c.lim[0]>=1e4?kfmt(c.lim[0]):c.lim[0])+'</text>'; }
    h+='<text x="'+X1+'" y="118" text-anchor="end">now</text><text x="'+X0+'" y="118">−'+Math.round((t1-t0)/60)+' min</text>';
    c.ser.forEach(function(s){
      var pts=d.map(function(p){ return X(p.t).toFixed(1)+','+Y(p[s[0]]).toFixed(1); }).join(' ');
      h+='<polyline points="'+pts+'" fill="none" stroke="var('+s[2]+')" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>';
    });
    h+='<line class="xh" x1="0" x2="0" y1="'+Y0+'" y2="'+Y1+'" stroke="var(--ink-dim)" stroke-width="1" visibility="hidden" vector-effect="non-scaling-stroke"/>';
    svg.innerHTML=h; c._map={X0:X0,X1:X1,t0:t0,t1:t1};
  });
}
CHARTS.forEach(function(c){
  var el=$('ch-'+c.id), svg=el.querySelector('svg'), tip=el.querySelector('.tip');
  svg.addEventListener('pointermove',function(e){
    var d=m.trend; if(!c._map||d.length<2) return;
    var r=svg.getBoundingClientRect(), x=(e.clientX-r.left)/r.width*320;
    var t=c._map.t0+(x-c._map.X0)/(c._map.X1-c._map.X0)*(c._map.t1-c._map.t0), best=d[0];
    d.forEach(function(p){ if(Math.abs(p.t-t)<Math.abs(best.t-t)) best=p; });
    var xh=svg.querySelector('.xh'), bx=c._map.X0+(c._map.X1-c._map.X0)*(best.t-c._map.t0)/Math.max(c._map.t1-c._map.t0,1);
    if(xh){ xh.setAttribute('x1',bx); xh.setAttribute('x2',bx); xh.setAttribute('visibility','visible'); }
    tip.hidden=false;
    tip.innerHTML='<div>t = '+hms(best.t)+'</div>'+c.ser.map(function(s){
      var bv=best[s[0]], txt=(c.unit==='/m³'&&bv>=1e4)?kfmt(bv):bv.toFixed(c.dec);
      return '<div><i style="display:inline-block;width:10px;height:2px;background:var('+s[2]+');vertical-align:middle;margin-right:5px"></i>'+s[1]+' <b>'+txt+' '+c.unit+'</b></div>'; }).join('');
    var tx=e.clientX-el.getBoundingClientRect().left+12; if(tx>el.clientWidth-170) tx-=190;
    tip.style.left=tx+'px'; tip.style.top='24px';
  });
  svg.addEventListener('pointerleave',function(){ tip.hidden=true; var xh=svg.querySelector('.xh'); if(xh) xh.setAttribute('visibility','hidden'); });
});

/* Alarms */
function drawAlarms(){
  var h='<div class="alist">';
  if(!m.alarms.length) h+='<div class="arow ok"><span class="ic">✓</span><span class="t">—</span><span class="t">OK</span><span>No active alarms</span><span></span></div>';
  m.alarms.forEach(function(a){ h+='<div class="arow '+a.sev+'"><span class="ic">!</span><span class="t">ACTIVE</span><span class="t">'+a.id+'</span><span>'+esc(a.text)+'</span><span class="t">'+a.sev+'</span></div>'; });
  h+='</div><p class="note" style="margin:10px 0 4px">Event log</p><div class="alist">';
  m.alarmLog.slice(0,14).forEach(function(a){
    h+='<div class="arow '+(a.kind==='cleared'?'ok':a.sev)+'"><span class="ic">'+(a.kind==='cleared'?'✓':'!')+'</span><span class="t">'+hms(a.t)+'</span><span class="t">'+a.id+'</span><span>'+esc(a.text)+'</span><span class="t">'+a.kind+'</span></div>';
  });
  if(!m.alarmLog.length) h+='<div class="arow ok"><span class="ic"></span><span class="t">—</span><span class="t"></span><span>No events yet</span><span></span></div>';
  $('pane-al').innerHTML=h+'</div>';
}

/* Contamination containment strategy: the barriers, each with its live state */
var BARRIERS=[
  {t:'Pressure cascade',d:'The clean room is held above the plant room and the lab, so any leak flows outward and outside air cannot get in. PDT-101 drives the exhaust fans (L7).'},
  {t:'100 % fresh air, BIBO HEPA on every terminal',d:'Once-through fresh air only: nothing is recirculated. Panel and ePM1 bag filters and an H13 HEPA in the AHU, then an H14 bag-in/bag-out HEPA at every supply terminal (3 ceiling terminals, LAF hood) and every exhaust terminal (2 in the partition, 1 low on the right wall). Used filters are bagged out without being touched.'},
  {t:'Dilution and recovery',d:'A high air-change rate dilutes what people and the process shed. Recovery to 1 % of a peak takes 4.6 ÷ ACH hours.'},
  {t:'LAF first air at the fill point (Grade A)',d:'The filler runs under its own LAF hood (H14 BIBO, fed with 100 % fresh air). Down-flow first air reaches the needles before anything else, then sweeps down and away.'},
  {t:'Operator and product protection: down-flow over the operator',d:'Ceiling terminals 2 + 3 blow clean air down over the operator; exhaust terminal 3 at the foot of the wall behind the operator takes it straight out, so what the operator sheds goes down and away from the filler. The RABS barrier and the LAF hood keep product dust away from the operator\'s breathing zone.'},
  {t:'Material transfer through the pass box',d:'Two interlocked doors that never open together, with a UV cycle between them. The clean room is never open to the lab.'},
  {t:'People: gowning and glove ports',d:'Grade B gown: hood, goggles, mask, overshoes, sterile gloves. Hands enter the RABS only through the glove ports; no open-door interventions.'},
  {t:'Heat recovery without cross-contamination',d:''},
  {t:'Contaminated exhaust: PT-102 → DV-101 → outer HEPA',d:'PT-102 watches the exhaust before it reaches the air pump. A high count (a release in the room or a leaking exhaust filter) throws DV-101: the exhaust goes through the outer BIBO HEPA and FAN-103B to outdoors and never through the Cu core. DV-101 is spring return, so with no power it rests on the HEPA path.'},
  {t:'Monitoring, alert and action limits',d:'PT-101 counts continuously at the fill point and in the room. Alert at 70 % of a limit: investigate. Action at the limit: stop filling, clean, re-qualify.'}
];
var LIMITS=[['A','3 520','29','3 520','29','ISO 5'],['B','3 520','29','352 000','2 930','ISO 7'],
            ['C','352 000','2 930','3 520 000','29 300','ISO 8'],['D','3 520 000','29 300','not set','not set','—']];
$('pane-ct').innerHTML='<div class="ct">'+
  '<div class="ct-top"><div class="ct-sum"><span class="stt" id="ct-pill">–</span><b id="ct-sum">–</b></div>'+
  '<button class="hbtn" id="ctZones" type="button" aria-pressed="false">Show zones in 3D</button></div>'+
  '<div class="ct-kpis">'+[['r05','Room ≥0.5 µm'],['r5','Room ≥5.0 µm'],['a05','Fill point ≥0.5 µm'],['a5','Fill point ≥5.0 µm'],['dp','Room pressure'],['rec','Recovery 100:1']]
    .map(function(k){ return '<div class="ck"><div class="n">'+k[1]+'</div><div class="v" id="ct-k-'+k[0]+'">–</div><div class="d" id="ct-kd-'+k[0]+'">&nbsp;</div></div>'; }).join('')+'</div>'+
  '<div class="ct-list">'+BARRIERS.map(function(b,i){
    return '<div class="cbar"><span class="stt" id="ct-s-'+i+'">–</span><div><h5>'+(i+1)+' · '+esc(b.t)+'</h5><p id="ct-d-'+i+'">'+esc(b.d)+'</p></div><b id="ct-v-'+i+'">–</b></div>'; }).join('')+'</div>'+
  '<p class="note" style="margin:6px 0 2px">Airborne particle limits per m³, EU GMP Annex 1 (2022) and ISO 14644-1. The rig\'s clean room is Grade B; the fill point under the RABS is Grade A.</p>'+
  '<div style="overflow-x:auto"><table class="sens ct-lim"><thead><tr><th>Grade</th><th>At rest ≥0.5 µm</th><th>At rest ≥5.0 µm</th><th>In operation ≥0.5 µm</th><th>In operation ≥5.0 µm</th><th>ISO (in op.)</th><th>This rig now</th></tr></thead><tbody>'+
  LIMITS.map(function(r){ return '<tr><td class="tg">'+r[0]+'</td><td class="v">'+r[1]+'</td><td class="v">'+r[2]+'</td><td class="v">'+r[3]+'</td><td class="v">'+r[4]+'</td><td>'+r[5]+'</td><td class="v" id="ct-g-'+r[0]+'">—</td></tr>'; }).join('')+
  '</tbody></table></div></div>';
$('ctZones').addEventListener('click',function(){ var cb=$('cbZones'); cb.checked=!cb.checked; cb.dispatchEvent(new Event('change')); });
var STT={ok:['ok','✓ OK'],warn:['warn','! CHECK'],bad:['bad','✕ ACTION']};
function setStt(id,st){ var el=$(id); if(!el) return; el.className='stt '+STT[st][0]; if(el.textContent!==STT[st][1]) el.textContent=STT[st][1]; }
function lvl(v,lim){ return v>lim?'bad':(v>0.7*lim?'warn':'ok'); }
function worst(a){ return a.indexOf('bad')>=0?'bad':(a.indexOf('warn')>=0?'warn':'ok'); }
function updateContainment(){
  var s=m.s, a=m.a, k=m.kpi, P_=P, st=[], v=[], d={};
  var dp=s.PDT101; st[0]=dp>=10?'ok':(dp>=5?'warn':'bad'); v[0]=sgn(dp)+' Pa (set +'+f0(P_.dp)+')';
  st[1]=s.PDT102>450?'warn':'ok'; v[1]='supply ≈ '+kfmt(a.Csup||0)+' /m³ · ΔP '+f0(s.PDT102)+' Pa';
  var ach=k.ach, rec=ach>0.1?4.6/ach*60:Infinity; st[2]=ach>=40?'ok':(ach>=20?'warn':'bad');
  v[2]=f1(ach)+' ACH · 100:1 in '+(isFinite(rec)?f1(rec)+' min':'—');
  st[3]=worst([lvl(s.PT101A,3520),lvl(s.PT101A5,29)]); v[3]=kfmt(s.PT101A)+' /m³ · ≥5 µm '+f0(s.PT101A5);
  st[4]='ok'; v[4]='2 ceiling terminals over the operator · 3 low exhausts (2 partition, 1 behind the operator)';
  st[5]='ok'; v[5]=CR.pb.state+' · '+CR.pb.transfers+' transfers';
  st[6]='ok'; v[6]='operator working through the gloves';
  if(!m.recovery){ st[7]='ok'; v[7]='core bypassed: no transfer'; d[7]='In the baseline test the fresh air bypasses the Cu core, so exhaust and fresh air cannot meet.'; }
  else { st[7]='ok'; v[7]='Cu plate core: no air contact'; d[7]='The exhaust only pre-cools (summer) or pre-heats (winter) the fresh air through sealed copper plates (Ra ≤ 0.8 µm, smooth and cleanable). The two streams never touch, there is no mixing box and no exhaust air enters the AHU.'; }
  var ids={}; m.alarms.forEach(function(x){ ids[x.id]=1; });
  var dvx=m.act.dv;
  st[8]=s.PT102>P_.pxTrip?'bad':(dvx>0.5||s.PT102>P_.pxReset?'warn':'ok');
  v[8]=dvx>0.5?'diverted to the outer HEPA · PT-102 '+kfmt(s.PT102)+' /m³':(dvx>0.05?'DV-101 moving':'to the air pump · PT-102 '+kfmt(s.PT102)+' /m³');
  st[9]=(ids.A11||ids.A12)?'bad':(ids.A10?'warn':'ok'); v[9]=(ids.A11||ids.A12||ids.A10)?'limit exceeded: see Alarms':'within alert limits';
  BARRIERS.forEach(function(b,i){ setStt('ct-s-'+i,st[i]); setText('ct-v-'+i,v[i]); if(d[i]) setText('ct-d-'+i,d[i]); });
  var all=worst(st); setStt('ct-pill',all);
  var bad=BARRIERS.filter(function(b,i){ return st[i]!=='ok'; }).map(function(b){ return b.t.charAt(0).toLowerCase()+b.t.slice(1); });
  var room=gradeOf(s.PT101,s.PT101R5), fill=gradeOf(s.PT101A,s.PT101A5);
  setText('ct-sum',bad.length?('Check: '+bad.join(', ')+'.'):('Contained. Room '+room.short+', fill point '+fill.short+'.'));
  setText('ct-k-r05',kfmt(s.PT101)); setText('ct-kd-r05','/m³ · limit 352k (B in op)');
  setText('ct-k-r5',f0(s.PT101R5)); setText('ct-kd-r5','/m³ · limit 2 930');
  setText('ct-k-a05',kfmt(s.PT101A)); setText('ct-kd-a05','/m³ · limit 3 520 (A)');
  setText('ct-k-a5',f0(s.PT101A5)); setText('ct-kd-a5','/m³ · limit 29');
  setText('ct-k-dp',sgn(dp)+' Pa'); setText('ct-kd-dp','vs plant room and lab');
  setText('ct-k-rec',isFinite(rec)?f1(rec)+' min':'—'); setText('ct-kd-rec','Annex 1 guide: 15-20 min');
  setText('ct-g-A','fill point '+kfmt(s.PT101A)+' / '+f0(s.PT101A5)); setText('ct-g-B','room '+kfmt(s.PT101)+' / '+f0(s.PT101R5));
}

/* tab switching + collapse */
var activePane='ov';
$('hmiTabs').addEventListener('click',function(e){
  var b=e.target.closest('button'); if(!b) return;
  Array.prototype.forEach.call(this.querySelectorAll('button'),function(x){ x.setAttribute('aria-selected',String(x===b)); });
  activePane=b.dataset.p;
  Array.prototype.forEach.call(document.querySelectorAll('.pane'),function(p){ p.classList.toggle('on',p.id==='pane-'+activePane); });
  updateHMI(true);
});
function setHmiOpen(open){
  if(open && hmiEl.hidden) setHmiHidden(false);
  hmiEl.classList.toggle('collapsed',!open);
  $('btnHmi').textContent=open?'Collapse':'Open HMI';
  $('btnHmi').setAttribute('aria-expanded',String(open));
  setTimeout(resize,30);
}
$('btnHmi').addEventListener('click',function(){ setHmiOpen(hmiEl.classList.contains('collapsed')); });
/* pull-tabs: hide the whole HMI dock (bottom) or the control rail (top right), e.g. when presenting */
function setHmiHidden(h){
  hmiEl.hidden=h; var b=$('hmiTab');
  b.setAttribute('aria-expanded',String(!h)); b.title=h?'Show the HMI dock':'Hide the HMI dock';
  b.querySelector('span').textContent=h?'Show HMI-101 · Rig controller':'Hide HMI-101';
  setTimeout(resize,30);
}
$('hmiTab').addEventListener('click',function(){ setHmiHidden(!hmiEl.hidden); });
function setRailHidden(h){
  $('stage').classList.toggle('railHidden',h); var b=$('railTab');
  b.setAttribute('aria-expanded',String(!h)); b.title=h?'Show the control panel':'Hide the control panel';
  b.querySelector('span').textContent=h?'Operating mode · controls':'Hide controls';
}
$('railTab').addEventListener('click',function(){ setRailHidden(!$('stage').classList.contains('railHidden')); });
function setLegendHidden(h){
  $('stage').classList.toggle('legendHidden',h); var b=$('legTab');
  b.setAttribute('aria-expanded',String(!h)); b.title=h?'Show the legend':'Hide the legend';
  b.querySelector('span').textContent=h?'Clean-room test rig':'Hide';
}
$('legTab').addEventListener('click',function(){ setLegendHidden(!$('stage').classList.contains('legendHidden')); });
$('btnRun').addEventListener('click',function(){ m.on=!m.on; syncModePill(); });
function syncModePill(){
  $('pRun').className='pill '+(m.on?'run':'stop'); $('pRunT').textContent=m.on?'RUN':'STOPPED';
  $('btnRun').textContent=m.on?'Stop system':'Start system';
  $('pMode').textContent=(state.season==='winter'?'WINTER':'SUMMER')+' · '+(m.recovery?'RECOVERY ON':'BASELINE TEST');
}

function setText(id,v){ var el=$(id); if(el && el.textContent!==v) el.textContent=v; }
function isoBand(a){
  if(a>=240) return 'ISO 5 range (240–480 /h)'; if(a>=150) return 'ISO 6 range (150–240 /h)';
  if(a>=60) return 'ISO 7 range (60–90 /h)'; if(a>=20) return 'ISO 8 range (20–40 /h)'; return 'below ISO 8 guidance';
}
function updateHMI(force){
  var s=m.s, k=m.kpi, a=m.a, pw=m.pw, S=P[m.season];
  setText('clock','t = '+hms(m.t)+' · '+state.simSpeed+'×');
  // KPI bar
  setText('k-ach',f1(k.ach)); setText('kd-ach','/h · '+f2(s.FT102)+' ÷ '+RigModel.ROOM.V.toFixed(4)+' m³');
  setText('k-dp',sgn(s.PDT101)+' Pa'); setText('kd-dp','set +'+f0(P.dp)+' Pa');
  setText('k-rt',tC(s.TT106)); setText('kd-rt','supply '+tC(s.TT105));
  setText('k-rrh',f0(s.MT106)+' %'); setText('kd-rrh','set '+f0(P.rh)+' %');
  setText('k-pt',kfmt(s.PT101)+' /m³'); setText('kd-pt',gradeOf(s.PT101,s.PT101R5).short+' · fill pt '+kfmt(s.PT101A));
  setText('k-q',f2(s.FT102)+' m³/h'); setText('kd-q','set '+f2(P.flow));
  setText('k-fa',f0(k.f*100)+' %'); setText('kd-fa',f2(s.FT101)+' m³/h');
  setText('k-pw',f1(pw.total)+' W'); setText('kd-pw',f2(pw.total/P.volt)+' A @ '+f0(P.volt)+' V');
  setText('k-red',(m.recovery?f0(k.red*100):'0')+' %'); setText('kd-red','baseline '+f1(pw.base)+' W');
  setText('k-co2',f1(k.co2h)+' g/h'); setText('kd-co2','saves '+f1(Math.max(0,k.co2hBase-k.co2h))+' g/h');
  var al=m.alarms.length; $('pAl').hidden=!al; setText('pAlT',al+' alarm'+(al===1?'':'s')); $('pAl').className='pill al';
  if(hmiEl.classList.contains('collapsed') && !force) return;
  if(activePane==='ov'){
    setText('m-fan101',f0(m.act.fa*100)+' %'); setText('m-tt101',tC(s.TT101)+' · '+f0(s.MT101)+' %'); setText('m-ft101',f2(s.FT101)+' m³/h');
    setText('m-hr',!m.recovery?'bypass':(m.act.dv>0.5?'no exhaust':f0(P.e1)+' %'));
    setText('m-tt108',tC(s.TT108));
    setText('m-ph',f0((m.season==='winter'?m.act.cmp:0)*100)+'%');
    setText('m-cc',f0((m.season==='summer'?m.act.cmp:0)*100)+'%'); setText('m-rh',f0(m.act.rh*100)+'%');
    setText('m-hum',f0(m.act.hum*100)+'%'); setText('m-sf',f0(m.act.sf*100)+'%'); setText('m-hepa',f0(s.PDT102)+' Pa');
    setText('m-tt109',tC(s.TT109)); setText('m-tt103',tC(s.TT103)); setText('m-tt104',tC(s.TT104));
    setText('m-tt105',tC(s.TT105)+' · '+f0(s.MT105)+' %'); setText('m-ft102',f2(s.FT102)+' m³/h'); setText('m-tt107',tC(s.TT107));
    setText('m-pt102',kfmt(s.PT102)+' /m³'); setText('m-dv',m.act.dv>0.5?'HEPA':'air pump');
    $('m-bypl').style.opacity=m.act.dv>0.5?'1':'.35';
    setText('m-ach',f1(k.ach)+' ACH'); setText('m-room',tC(s.TT106)+' · '+f0(s.MT106)+' % RH');
    setText('m-dp',sgn(s.PDT101)+' Pa'); var gr=gradeOf(s.PT101,s.PT101R5); setText('m-vol','PT-101 '+kfmt(s.PT101)+'/m³ · '+(gr.g==='—'?'> Grade C':'Grade '+gr.g));
    $('m-phc').setAttribute('opacity',String(0.2+0.8*(m.season==='winter'?m.act.cmp:0)));
    $('m-ccc').setAttribute('opacity',String(0.2+0.8*(m.season==='summer'?m.act.cmp:0)));
    $('m-rhc').setAttribute('opacity',String(0.2+0.8*m.act.rh));
    $('fl-f').style.opacity=a.Qfa>0.05?'.85':'0'; $('fl-s').style.opacity=a.Qsup>0.05?'.85':'0'; $('fl-r').style.opacity=a.Qsup>0.05?'.85':'0';
  } else if(activePane==='sn'){
    IO.forEach(function(r,i){ setText('io-'+i,r[2]()); });
  } else if(activePane==='lp'){
    LOOPS.forEach(function(l){
      var L=m.loops[l.k];
      setText('lp-pv-'+l.k,l.pv()); setText('lp-sp-'+l.k,l.sp());
      var o=l.k==='L3'?f0(L.out*90)+'°':(l.k==='L6'&&m.season==='summer'?'−'+f1(6*L.out)+' K':f0(L.out*100)+' %');
      setText('lp-out-'+l.k,o+(L.man?' (manual)':'')); $('lp-bar-'+l.k).style.width=(L.out*100).toFixed(0)+'%';
    });
  } else if(activePane==='en'){
    var V=P.volt, E=m.E;
    setText('e-ct1',f2(s.CT101)+' A · '+f1(s.CT101*V)+' W'); setText('e-ct2',f2(s.CT102)+' A · '+f1(s.CT102*V)+' W');
    setText('e-ct3',f2(s.CT103)+' A · '+f1(s.CT103*V)+' W'); setText('e-ctl',f1(pw.ctl)+' W');
    setText('e-vt',f1(s.VT101)+' V'); setText('e-tot',f1(pw.total)+' W');
    setText('e-red',m.recovery?(f0(k.red*100)+' % less power'):'Baseline test running');
    var mx=Math.max(pw.total,pw.base,1);
    $('e-bar-a').style.width=(pw.total/mx*100).toFixed(1)+'%'; $('e-bar-b').style.width=(pw.base/mx*100).toFixed(1)+'%';
    setText('e-pa',f1(pw.total)+' W'); setText('e-pb',f1(pw.base)+' W'); setText('e-copb',f1(P.cop));
    setText('e-wh',f1(E.act)+' Wh'); setText('e-whb',f1(E.base)+' Wh'); setText('e-whs',f1(E.base-E.act)+' Wh · '+(E.base>0?f0((1-E.act/E.base)*100):'0')+' %');
    var ah=E.ab.hr.t>0?E.ab.hr.wh/(E.ab.hr.t/3600):0, ab=E.ab.base.t>0?E.ab.base.wh/(E.ab.base.t/3600):0;
    setText('e-abh',E.ab.hr.t>0?f1(ah)+' W ('+hms(E.ab.hr.t)+')':'not run yet');
    setText('e-abb',E.ab.base.t>0?f1(ab)+' W ('+hms(E.ab.base.t)+')':'not run yet');
    setText('e-abr',(ah>0&&ab>0)?f0((1-ah/ab)*100)+' %':'run both modes');
    setText('e-co2h',f1(k.co2h)+' g CO₂/h'); setText('e-co2hb',f1(k.co2hBase)+' g CO₂/h');
    setText('e-co2',f1(E.co2)+' g'); setText('e-co2s',f1(Math.max(0,E.co2base-E.co2))+' g');
    setText('e-co2y',f1(k.annualKWh*P.ef)+' kg/yr ('+f0(k.annualKWh)+' kWh)');
    var savedKWh=Math.max(0,k.annualBaseKWh-k.annualKWh)*k.scale;
    setText('e-scale',f0(savedKWh/1000)+' MWh · '+f1(savedKWh*P.ef/1000)+' t CO₂');
    setText('e-ef',f2(P.ef));
    setText('e-copl',m.recovery?(m.season==='winter'?'Heating COP':'Cooling EER'):(m.season==='winter'?'Electric pre-heat':'Plain chiller COP'));
    setText('e-cop',f1(pw.cop)); setText('e-qhp',f1(pw.Qhp)+' W'); setText('e-w',f1(pw.W)+' W');
    setText('e-qrec',f1(pw.Qrec)+' W'); setText('e-dsh',f1(pw.Qdsh)+' W'); setText('e-out',f1(pw.Qout)+' W');
    setText('e-ach',f1(k.ach)+' /h');
    setText('e-achf','ACH = Q ÷ V = '+f2(s.FT102)+' m³/h ÷ '+RigModel.ROOM.V.toFixed(4)+' m³');
    var R=RigModel.ROOM; setText('e-dims',(R.L*1000).toFixed(0)+' × '+(R.W*1000).toFixed(0)+' × '+(R.H*1000).toFixed(0)+' mm');
    setText('e-area',R.A.toFixed(3)+' m²'); setText('e-iso',isoBand(k.ach));
  } else if(activePane==='ct'){ updateContainment();
  } else if(activePane==='tr'){ drawCharts(); }
  else if(activePane==='al'){ drawAlarms(); }
}

/* the 3D screen on the front of the box mirrors the HMI */
function drawScreen(){
  var c=hmiCanvas.getContext('2d'), w=hmiCanvas.width, h=hmiCanvas.height, s=m.s, k=m.kpi;
  c.fillStyle='#0b1118'; c.fillRect(0,0,w,h);
  c.fillStyle='#16212c'; c.fillRect(0,0,w,46);
  c.fillStyle='#e7eef5'; c.font='600 22px "IBM Plex Mono", monospace'; c.textBaseline='middle';
  c.fillText('HMI-101  CLEAN-ROOM RIG',16,24);
  c.fillStyle=m.on?'#3ccf7a':'#ff6b6b'; c.beginPath(); c.arc(w-150,23,8,0,7); c.fill();
  c.fillStyle='#8ca0b3'; c.font='18px "IBM Plex Mono", monospace'; c.fillText(m.on?'RUN':'STOP',w-134,24);
  c.fillText(m.season==='winter'?'WIN':'SUM',w-78,24);
  var tiles=[['ACH',f1(k.ach),'/h','#2fd6b4'],['ROOM ΔP',sgn(s.PDT101),'Pa','#3ccf7a'],['ROOM T',sgn(s.TT106),'°C','#49aeff'],
             ['ROOM RH',f0(s.MT106),'%','#49aeff'],['POWER',f1(m.pw.total),'W','#a68bff'],['SAVING',m.recovery?f0(k.red*100):'0','%','#3ccf7a']];
  tiles.forEach(function(t,i){
    var x=16+(i%3)*258, y=60+Math.floor(i/3)*110;
    c.fillStyle='#121a23'; c.fillRect(x,y,246,98);
    c.fillStyle=t[3]; c.fillRect(x,y,5,98);
    c.fillStyle='#8ca0b3'; c.font='600 17px "IBM Plex Mono", monospace'; c.fillText(t[0],x+16,y+20);
    c.fillStyle='#e7eef5'; c.font='600 40px "IBM Plex Mono", monospace'; c.fillText(t[1],x+16,y+62);
    var wv=c.measureText(t[1]).width;
    c.fillStyle='#8ca0b3'; c.font='20px "IBM Plex Mono", monospace'; c.fillText(t[2],x+16+wv+8,y+66);
  });
  // temperature chain
  var chain=[['OA',s.TT101],['CORE',s.TT109],['PRE',s.TT103],['COIL',s.TT104],['SUP',s.TT105],['ROOM',s.TT106]];
  chain.forEach(function(t,i){
    var x=16+i*128, y=292;
    var col=new THREE.Color(); tempColor(t[1],col);
    c.fillStyle='#'+col.getHexString(); c.fillRect(x,y,118,8);
    c.fillStyle='#8ca0b3'; c.font='600 16px "IBM Plex Mono", monospace'; c.fillText(t[0],x,y+28);
    c.fillStyle='#e7eef5'; c.font='600 22px "IBM Plex Mono", monospace'; c.fillText(sgn(t[1])+'°',x,y+56);
  });
  c.fillStyle=m.alarms.length?'#ff6b6b':'#3ccf7a'; c.font='600 18px "IBM Plex Mono", monospace';
  c.fillText(m.alarms.length?('ALARM '+m.alarms[0].id+' '+m.alarms[0].text).slice(0,62):'NO ACTIVE ALARMS',16,h-24);
  hmiTex.needsUpdate=true;
}

/* tags in the scene */
function updateTags(){
  var s=m.s, A=m.act, alarmIds={}; m.alarms.forEach(function(a){ alarmIds[a.id]=1; });
  var map={
    'TT-101':['TT-101 · MT-101',sgn(s.TT101)+'° '+f0(s.MT101)+'%'], 'FT-101':['FT-101 fresh',f2(s.FT101)+' m³/h'],
    'FAN-101':['FAN-101 comp.',f0(A.fa*100)+' %'], 'TT-109':['TT-109 off Cu core',sgn(s.TT109)+' °C'],
    'TT-103':['TT-103 pre-heat',sgn(s.TT103)+' °C'], 'TT-104':['TT-104 coil',sgn(s.TT104)+' °C'],
    'TT-105':['TT-105 final',sgn(s.TT105)+'° '+f0(s.MT105)+'%'], 'TT-107':['TT-107 exhaust',sgn(s.TT107)+' °C'],
    'PDT-102':['PDT-102 HEPA',f0(s.PDT102)+' Pa'], 'PT-102':['PT-102 exhaust',kfmt(s.PT102)+' /m³'],
    'DV-101':['DV-101 diverter',A.dv>0.5?'→ outer HEPA':'→ air pump'], 'FAN-103B':['FAN-103B bypass',f0((A.dv>0.5?A.ef:0)*100)+' %'],
    'FAN-102':['FAN-102 supply',f0(A.sf*100)+' %'], 'CMP-101':['CMP-101 R32',f0(A.cmp*100)+' %'],
    'FAN-103':['FAN-103 exhaust',f0((A.dv>0.5?0:A.ef)*100)+' %'], 'TT-108':['TT-108 exhaust',sgn(s.TT108)+' °C'],
    'FT-102':['FT-102 supply',f2(s.FT102)+' m³/h'], 'TT-106':['TT-106 · MT-106',sgn(s.TT106)+'° '+f0(s.MT106)+'%'],
    'PDT-101':['PDT-101 room',sgn(s.PDT101)+' Pa'], 'ACH':['ACH = Q ÷ V',f1(m.kpi.ach)+' /h'],
    'CT':['CT-101…103',f2(s.CT101+s.CT102+s.CT103)+' A'],
    'PT-101':['PT-101 ≥0.5 µm',kfmt(s.PT101)+' · A '+kfmt(s.PT101A)]
  };
  TAGS.forEach(function(t){
    var d=map[t.id]; if(!d) return;
    var al=(t.id==='PT-102'&&alarmIds.A06)||(t.id==='DV-101'&&A.dv>0.5)||(t.id==='PT-101'&&(alarmIds.A11||alarmIds.A12))||(t.id==='PDT-101'&&(alarmIds.A02||alarmIds.A03))||(t.id==='TT-108'&&alarmIds.A05)||(t.id==='FT-102'&&alarmIds.A01);
    drawTag(t,d[0],d[1],al?'alarm':'');
  });
}

/* actuator visuals: fans, damper blades, coils, refrigerant, bypass */
var _q=new THREE.Quaternion(), _up=new THREE.Vector3(0,1,0);
function actuatorVisuals(){
  var A=m.act;
  if(DVBLADE) DVBLADE.rotation.z=A.dv*Math.PI/4;           // DV-101 blade: flat = to the air pump, tilted = up to the HEPA
  var roles=coilRoles();
  var out={preheat:m.season==='winter'?A.cmp:0,cooling:m.season==='summer'?A.cmp:0,reheat:A.rh,
           extract:m.recovery&&A.dv<0.5?A.cmp:0};
  Object.keys(COILS).forEach(function(k){
    var mt=coilMat[k][roles[k]]; if(roles[k]==='idle') return;
    var o=Math.max(0,Math.min(1,out[k]));
    mt.emissiveIntensity=0.15+1.4*o; mt.opacity=0.45+0.4*Math.min(1,o*2);
  });
  var leds=window.__leds; if(leds){
    leds[0].visible=Math.sin(time*6)>0;
    var anyMan=Object.keys(m.loops).some(function(k){ return m.loops[k].man; });
    leds[1].visible=anyMan; leds[2].visible=m.alarms.length>0;
  }
}
var SPIN={'Supply fan':'sf','Tempered-air fan':'fa','FAN-103 exhaust fan':'efc'};

/* ============================================================= controls */
function seg(id,fn){
  var el=document.getElementById(id);
  el.addEventListener('click',function(ev){
    var b=ev.target.closest('button'); if(!b) return;
    Array.prototype.forEach.call(el.querySelectorAll('button'),function(x){ x.setAttribute('aria-pressed',String(x===b)); });
    fn(b.dataset.v);
  });
}
function clearSeg(id){ Array.prototype.forEach.call(document.querySelectorAll('#'+id+' button'),function(x){ x.setAttribute('aria-pressed','false'); }); }
seg('segSeason',function(v){ state.season=v; applySeason(); });
seg('segRec',function(v){ m.recovery=v==='on'; applySeason(); });
seg('segColor',function(v){ colorMode=v; $('keysStream').hidden=v==='temp'; $('keysTemp').hidden=v!=='temp'; refreshPathColors(m.a); colorRibbons(); colorDuctFlow(); });
/* hazard tests: a powder release at the filler (60 s), or a leaking exhaust-terminal HEPA */
$('btnRelease').addEventListener('click',function(){ m.release=60; });
$('btnLeak').addEventListener('click',function(){ m.hepaLeak=!m.hepaLeak; this.setAttribute('aria-pressed',String(m.hepaLeak)); });
seg('segCase',function(v){ state.casing=v; applyCasing(); applyExplode(); });
seg('segBox',function(v){ applyBox(v); });
seg('segLabels',function(v){ labelMode=v; refreshLabels(); });
function goView(v,instant){
  var d=VIEWS[v]; if(!d) return;
  camGoal.theta=d.theta; camGoal.phi=d.phi; camGoal.r=d.r; targetGoal.fromArray(d.t);
  if(instant){ cam.theta=d.theta; cam.phi=d.phi; cam.r=d.r; target.copy(targetGoal); }
}
seg('segView',function(v){ clearSeg('segZoom'); goView(v); });
seg('segZoom',function(v){ clearSeg('segView'); goView(v); });
var rngExp=$('rngExp'), rngSpd=$('rngSpd'), rngSim=$('rngSim');
rngExp.addEventListener('input',function(){ state.explode=+rngExp.value/100; setText('valExp',rngExp.value+' %'); applyExplode(); });
rngSpd.addEventListener('input',function(){ state.speed=+rngSpd.value/100; setText('valSpd',state.speed.toFixed(1)+'×'); });
rngSim.addEventListener('input',function(){ state.simSpeed=+rngSim.value; setText('valSim',state.simSpeed+'×'); });
function cb(id,fn){ $(id).addEventListener('change',function(e){ fn(e.target.checked); }); }
cb('cbAir',function(v){ airVisible=v; });
cb('cbRibbon',function(v){ ribbons.visible=v && state.explode<0.25; });
cb('cbArrows',function(v){ arrows.visible=v; });
cb('cbTags',function(v){ setReadings(v?(readMode==='off'?'on':readMode):'off'); });
/* live readings in the 3D view: Hide / Show / Large (large tags for presenting to an audience).
   The on-stage control, the R key and the "Live sensor tags" box all drive the same state. */
var readMode='on';
function setReadings(v){
  readMode=v; $('cbTags').checked=v!=='off';
  var k=v==='big'?1.9:1;
  TAGS.forEach(function(t){ var big=t.id==='ACH'; t.sp.scale.set((big?0.15:0.105)*k,(big?0.044:0.031)*k,1); });
  scaleZoneBadges(v==='big'?1.5:1);
  Array.prototype.forEach.call(document.querySelectorAll('#segRead button'),function(x){ x.setAttribute('aria-pressed',String(x.dataset.v===v)); });
  if(v!=='off') updateTags();
}
seg('segRead',setReadings);
document.addEventListener('keydown',function(e){
  var k=(e.key||'').toLowerCase();
  if(e.ctrlKey||e.metaKey||e.altKey||(k!=='r'&&k!=='z'&&k!=='d')) return;
  var tg=e.target, tn=tg&&tg.tagName; if(tn==='INPUT'||tn==='SELECT'||tn==='TEXTAREA'||(tg&&tg.isContentEditable)) return;
  if(k==='r') setReadings({on:'big',big:'off',off:'on'}[readMode]);
  else if(k==='z') setZones(!zoneGroup.visible);
  else setDuctAir(!ductFlowOn);
});
cb('cbPcb',function(v){ traceGroup.visible=v; sigDots.obj.visible=v && $('cbSignals').checked; });
cb('cbSignals',function(v){ sigDots.obj.visible=v && $('cbPcb').checked; });
cb('cbModule',function(v){ modUnit.visible=v; });
cb('cbAux',function(v){ aux.visible=v; });
cb('cbDoors',function(v){ state.doors=v; doors.visible=v && state.casing!=='off'; });
cb('cbRefrig',function(v){ state.refrig=v; refrig.visible=v; refDots.obj.visible=v; });
cb('cbDucts',function(v){ state.ducts=v; ducts.visible=v; rigDucts.visible=v; });
cb('cbSpin',function(v){ state.spin=v; });
cb('cbContam',function(v){ contamVisible=v; });
/* containment zones: the on-stage toggle, the Z key, the "Containment zones" box and the
   Containment screen's button all drive the same state */
function setZones(v){
  zoneGroup.visible=v; $('cbZones').checked=v;
  Array.prototype.forEach.call(document.querySelectorAll('#segZones button'),function(x){ x.setAttribute('aria-pressed',String((x.dataset.v==='on')===v)); });
  var b=$('ctZones'); if(b){ b.textContent=v?'Hide zones in 3D':'Show zones in 3D'; b.setAttribute('aria-pressed',String(v)); }
}
cb('cbZones',setZones);
seg('segZones',function(v){ setZones(v==='on'); });
/* air flow in the ducts: on-stage toggle, the D key and the "Air flow in ducts" box */
function setDuctAir(v){
  ductFlowOn=v; $('cbDuctAir').checked=v;
  Array.prototype.forEach.call(document.querySelectorAll('#segDuct button'),function(x){ x.setAttribute('aria-pressed',String((x.dataset.v==='on')===v)); });
}
cb('cbDuctAir',setDuctAir);
seg('segDuct',function(v){ setDuctAir(v==='on'); });
var btnPlay=$('btnPlay');
btnPlay.addEventListener('click',function(){
  state.playing=!state.playing;
  btnPlay.textContent=state.playing?'Pause':'Play';
  btnPlay.setAttribute('aria-pressed',String(state.playing));
});
var railToggle=$('railToggle'), rail=$('rail');
function syncRail(){
  if(window.innerWidth<=760){ rail.hidden=railToggle.getAttribute('aria-expanded')!=='true'; }
  else { rail.hidden=false; }
}
railToggle.addEventListener('click',function(){
  var open=railToggle.getAttribute('aria-expanded')==='true';
  railToggle.setAttribute('aria-expanded',String(!open));
  railToggle.textContent=!open?'Close':'Controls';
  syncRail();
});

/* ------------------------------------------------- editable design values */
var FIELDS=[
  ['inFlow','flow',false,0.5,20],['inE1','e1',false,0,90],['inTrip','pxTrip',false,10,1e6],['inReset','pxReset',false,1,1e6],
  ['inRh','rh',false,20,70],['inDp','dp',false,0,50],
  ['inGain','gain',false,0,40],['inGen','gen',false,0,200000],['inAmb','amb',false,0,45],['inUa','ua',false,0,20],['inVolt','volt',false,5,60],
  ['inEf','ef',false,0,1.5],['inCop','cop',false,1,8],['inHours','hours',false,100,8760],
  ['inOat','oat',true,-30,55],['inOrh','orh',true,0,100],['inCoil','coil',true,4,40],['inSup','sup',true,8,40]
];
function loadFields(){
  FIELDS.forEach(function(f){ $(f[0]).value=f[2]?P[state.season][f[1]]:P[f[1]]; });
}
FIELDS.forEach(function(f){
  var el=$(f[0]);
  el.addEventListener('input',function(){
    var v=parseFloat(el.value); if(isNaN(v)) return;
    v=Math.max(f[3],Math.min(f[4],v));
    if(f[2]) P[state.season][f[1]]=v; else P[f[1]]=v;
  });
  el.addEventListener('blur',function(){ loadFields(); });
});
$('btnReset').addEventListener('click',function(){
  var d=RigModel.defaults();
  Object.keys(d).forEach(function(k){ if(typeof d[k]==='object') Object.assign(P[k],d[k]); else P[k]=d[k]; });
  loadFields();
});

/* --------------------------------------------------------- orbit input */
var drag=null,pinch=null,down=null;
var ray=new THREE.Raycaster(), ndc=new THREE.Vector2();
canvas.addEventListener('pointerdown',function(e){
  canvas.setPointerCapture(e.pointerId);
  drag={x:e.clientX,y:e.clientY,pan:e.shiftKey||e.button===2}; down={x:e.clientX,y:e.clientY};
});
canvas.addEventListener('pointermove',function(e){
  if(drag){
    var dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    drag.x=e.clientX; drag.y=e.clientY;
    if(drag.pan){
      var right=new THREE.Vector3().setFromMatrixColumn(camera.matrix,0);
      var up=new THREE.Vector3().setFromMatrixColumn(camera.matrix,1);
      var k=cam.r*0.0016;
      target.addScaledVector(right,-dx*k); target.addScaledVector(up,dy*k); targetGoal.copy(target);
    } else {
      camGoal.theta-=dx*0.006;
      camGoal.phi=Math.max(0.08,Math.min(Math.PI-0.08,camGoal.phi-dy*0.006));
    }
    return;
  }
  var r=canvas.getBoundingClientRect();
  ndc.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);
  ray.setFromCamera(ndc,camera);
  canvas.style.cursor=ray.intersectObject(hmiScreenMesh).length?'pointer':'';
});
canvas.addEventListener('pointerup',function(e){
  if(down && Math.abs(e.clientX-down.x)+Math.abs(e.clientY-down.y)<5){
    var r=canvas.getBoundingClientRect();
    ndc.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);
    ray.setFromCamera(ndc,camera);
    if(ray.intersectObject(hmiScreenMesh).length){ setHmiOpen(true); $('hmiTabs').querySelector('[data-p="ov"]').click(); }
  }
  drag=null; down=null;
});
['pointercancel','pointerleave'].forEach(function(ev){ canvas.addEventListener(ev,function(){ drag=null; }); });
canvas.addEventListener('contextmenu',function(e){ e.preventDefault(); });
canvas.addEventListener('wheel',function(e){
  e.preventDefault();
  camGoal.r=Math.max(14,Math.min(320,camGoal.r*(1+Math.sign(e.deltaY)*0.09)));
},{passive:false});
canvas.addEventListener('touchstart',function(e){
  if(e.touches.length===2){
    pinch=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY); drag=null;
  }
},{passive:true});
canvas.addEventListener('touchmove',function(e){
  if(e.touches.length===2&&pinch){
    var d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
    camGoal.r=Math.max(14,Math.min(320,camGoal.r*(pinch/d))); pinch=d;
  }
},{passive:true});
canvas.addEventListener('touchend',function(){ pinch=null; });

function resize(){
  var w=stage.clientWidth,h=stage.clientHeight;
  if(!w||!h) return;
  renderer.setSize(w,h,false);
  camera.aspect=w/h; camera.updateProjectionMatrix();
  syncRail();
}
window.addEventListener('resize',resize);

/* ---------------------------------------------------------------- theme */
function retheme(){
  readTokens(); tuneLights();
  scene.background=T.scene.clone();
  floorGrid.material.color.copy(T.floor);
  M.panel.color=T.metal.clone(); M.frame.color=T.metalDark.clone();
  M.inner.color=T.metal.clone(); M.base.color=T.metalDark.clone();
  M.duct.color=T.metal.clone(); M.refrig.color=T.refrig.clone();
  MR.acrylic.color=T.acrylic.clone(); MR.acrylicEdge.color=T.acrylic.clone(); MR.pvc.color=T.metal.clone();
  MR.pcb.color=T.pcb.clone(); MR.copper.color=T.copper.clone();
  refDots.mat.color=T.refrig.clone(); leaderMat.color=T.metalDark.clone();
  buildRibbons(); buildArrows(); refreshPathColors(m.a); colorRibbons(); colorDuctFlow();
  ribbons.visible=$('cbRibbon').checked && state.explode<0.25;
  arrows.visible=$('cbArrows').checked;
  TAGS.forEach(function(t){ t.last=''; });
  refreshLabels(); buildZones();
}
if(window.matchMedia){
  var mq=window.matchMedia('(prefers-color-scheme:dark)');
  if(mq.addEventListener) mq.addEventListener('change',retheme);
}
new MutationObserver(retheme).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});

/* ------------------------------------------------------- CAD export hook */
/* Serialises every visible solid (world cm) so tools/build_cad.py can rebuild the
   same model as STEP solids for SolidWorks. Lines, sprites and particles are skipped. */
window.__rigExportCAD=function(){
  scene.updateMatrixWorld(true);
  var out=[], pos=new THREE.Vector3(), quat=new THREE.Quaternion(), scl=new THREE.Vector3(), mtx=new THREE.Matrix4();
  function visible(o){ for(var p=o;p;p=p.parent){ if(!p.visible || p.userData.noExport) return false; } return true; }
  function partOf(o){ for(var p=o;p;p=p.parent){ if(p.userData && p.userData.part) return p.userData.part; } return 'Misc'; }
  function asmOf(o){ for(var p=o;p;p=p.parent){ if(p.userData && p.userData.asm) return p.userData.asm; } return 'Rig'; }
  function matOf(mm){ var mt=Array.isArray(mm)?mm[4]||mm[0]:mm; var c=mt.userData&&mt.userData.cadColor?mt.userData.cadColor:((mt.map&&!mt.isMeshBasicMaterial)?T.pcb:(mt.color||new THREE.Color(1,1,1)));
    return {c:[+c.r.toFixed(3),+c.g.toFixed(3),+c.b.toFixed(3)],o:mt.transparent?+mt.opacity.toFixed(2):1}; }
  function push(o,geo,matrix){
    matrix.decompose(pos,quat,scl);
    var g={t:geo.type,p:geo.parameters||{}}, rec={part:partOf(o),asm:asmOf(o),geo:g,
      pos:[pos.x,pos.y,pos.z],quat:[quat.x,quat.y,quat.z,quat.w],scl:[scl.x,scl.y,scl.z],mat:matOf(o.material)};
    if(o.userData.cad) g.cad=o.userData.cad;
    if(geo.type==='TubeGeometry' && !g.cad){
      var path=geo.parameters.path, pts=[];
      for(var i=0;i<=40;i++){ var v=path.getPointAt(i/40); pts.push([v.x,v.y,v.z]); }
      g.cad={type:'sweep',pts:pts,r:geo.parameters.radius,local:true};
    }
    if(g.p.path) g.p={radius:g.p.radius};
    out.push(rec);
  }
  scene.traverse(function(o){
    if(!o.isMesh || !visible(o)) return;
    if(labelGroup===o.parent || ribbons===o.parent || arrows===o.parent) return;
    if(o.isInstancedMesh){
      for(var i=0;i<o.count;i++){ o.getMatrixAt(i,mtx); push(o,o.geometry,new THREE.Matrix4().multiplyMatrices(o.matrixWorld,mtx)); }
      return;
    }
    push(o,o.geometry,o.matrixWorld);
    var st=o.userData.strip;
    if(st){                                    // the copper tracks the strip texture shows
      o.getWorldPosition(pos);
      [-0.16,0,0.16].forEach(function(off){
        var d={x:0.07,y:0.07,z:0.07}, c=[pos.x,pos.y,pos.z];
        d[st.ax]=st.L-0.1; d[st.thin]=0.035;
        var across=['x','y','z'].filter(function(k){ return k!==st.ax && k!==st.thin; })[0];
        var ix={x:0,y:1,z:2};
        c[ix[across]]+=off; c[ix[st.thin]]+=st.Th/2+0.0175;
        out.push({part:partOf(o)+' copper',asm:asmOf(o),geo:{t:'BoxGeometry',p:{width:d.x,height:d.y,depth:d.z}},
          pos:c,quat:[0,0,0,1],scl:[1,1,1],mat:{c:[T.copper.r,T.copper.g,T.copper.b],o:1}});
      });
    }
  });
  return out;
};

/* ----------------------------------------------------------------- loop */
var clock=new THREE.Clock(), time=0, uiT=1, scrT=1, colT=1;
if(window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches){
  state.playing=false; btnPlay.textContent='Play'; btnPlay.setAttribute('aria-pressed','false');
}
function flows(){
  var a=m.a;
  return {ref:Math.max(P.flow,0.5),Qfa:a.Qfa||0,Qhr:a.Qhr||0,Qdir:a.Qdir||0,Qrec:0,
    Qsup:a.Qsup||0,Qret:Math.max(0,(a.Qsup||0)-(a.Qleak||0)),Qex:a.Qex||0,Qcore:a.Qcore||0,Qbyp:a.Qbyp||0,
    // operator contamination rides the room air; how much of it shows follows the room count.
    // The pass box sheds only while its inner door is open.
    Qcont:m.on?(a.Qsup||0):0, contamFrac:Math.max(0.15,Math.min(1,(a.Cp||0)/200000)),
    Qpbx:CR.pb.innerOpen?Math.max(P.flow,0.5)*1.2:0};
}
function frame(){
  requestAnimationFrame(frame);
  var dt=Math.min(clock.getDelta(),0.05);
  time+=dt;
  cam.theta+=(camGoal.theta-cam.theta)*0.12;
  cam.phi  +=(camGoal.phi-cam.phi)*0.12;
  cam.r    +=(camGoal.r-cam.r)*0.12;
  target.lerp(targetGoal,0.12);
  placeCamera();
  var far=cam.r>36;                                       // close-ups (e.g. the HMI view) read better without callouts
  labelGroup.visible = labelMode!=='off' && far;
  tagGroup.visible = $('cbTags').checked && far && cam.r<125;   // whole-box view: values are on the HMI
  ductFlow.visible = ductFlowOn && rigDucts.visible && state.explode<0.25;
  if(state.playing){
    var sdt=dt*state.simSpeed, n=Math.min(400,Math.max(1,Math.ceil(sdt/0.05)));
    m.extGen=CR.pb.innerOpen?15000:0;                    // pass-box inner door open: a short burst of particles
    for(var i=0;i<n;i++) RigModel.step(m,sdt/n);
    var fl=flows();
    for(var j=0;j<STREAMS.length;j++) updateStream(STREAMS[j],dt,state.speed,fl);
    if(ductFlow.visible) updateDuctFlow(dt,state.speed,fl);
    var cmpOn=m.act.cmp>0.01 && (m.recovery || m.season==='summer');
    refDots.obj.visible=state.refrig && cmpOn;
    if(state.refrig && cmpOn) updateRefrig(dt,state.speed*(0.4+m.act.cmp),MODE[state.season].dir);
    if(state.spin){
      spinners.forEach(function(s){
        if(s.obj.visible===false) return;
        var k=SPIN[s.id], u=k==='efc'?m.act.ef*(1-m.act.dv):(k?m.act[k]:1);
        s.obj.rotation[s.axis]+=dt*s.rate*state.speed*u*1.6;
      });
      compRotor.rotation.x+=dt*14*m.act.fa*state.speed;
    }
    if(sigDots.obj.visible) updateSignals(dt);
    updateCleanRoom(dt*state.speed,m.on);
    var ptc=m.alarms.some(function(x){ return x.id==='A11'||x.id==='A12'; })?0xef4444:(m.alarms.some(function(x){ return x.id==='A10'; })?0xf59e0b:0x22c55e);
    CR.ptLed.material.color.setHex(ptc); CR.ptLed.visible=!m.on || (time%1.2)<0.9;   // PT-101 status LED blinks while sampling
    actuatorVisuals();
  }
  uiT+=dt; scrT+=dt; colT+=dt;
  if(uiT>0.25){ uiT=0; updateHMI(); if(tagGroup.visible) updateTags();
    setText('valHaz',(m.release>0?'release '+Math.ceil(m.release)+' s · ':'')+(m.act.dv>0.5?'exhaust → outer HEPA':'exhaust → air pump')); }
  if(scrT>0.5){ scrT=0; drawScreen(); }
  if(colorMode==='temp' && colT>0.4){ colT=0; refreshPathColors(m.a); colorRibbons(); colorDuctFlow(); }
  renderer.render(scene,camera);
}

if(document.fonts && document.fonts.ready) document.fonts.ready.then(function(){ refreshLabels(); buildZones(); TAGS.forEach(function(t){ t.last=''; }); });
for(var w0=0;w0<1800;w0++) RigModel.step(m,0.05);              // 90 s: let the loops and the room particle count settle before the first frame
refreshPathColors(m.a); colorRibbons(); colorDuctFlow();
applySeason(); applyCasing(); applyExplode(); applyBox('clear'); buildZones(); setZones($('cbZones').checked);
if(window.innerHeight<480 || window.innerWidth<760) setHmiOpen(false);   // open by default, also inside the project website's viewer; only phones and very short windows start collapsed
resize();
var fl0=flows(); for(var s0=0;s0<STREAMS.length;s0++) updateStream(STREAMS[s0],0,0,fl0);
updateDuctFlow(0,0,fl0); setDuctAir($('cbDuctAir').checked);
updateRefrig(0,0,1); updateSignals(0); actuatorVisuals(); updateHMI(true); updateTags(); drawScreen();
window.__rig={model:m,goView:goView,state:state,zones:zoneGroup,ductFlow:ductFlow,build:BUILD,setView:function(d){ VIEWS.custom=d; goView('custom',true); }};
frame();
})();
