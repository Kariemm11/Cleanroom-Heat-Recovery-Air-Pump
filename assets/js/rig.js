/* Clean-room test rig — 3D scene, HMI and control wiring.
   World units are centimetres: x along the 1.0 m box (−50 … +50, partition at 0),
   y up (0 … 50), z across (−25 … +25, front face at +25).
   The plant room (x < 0) holds the AHU and the parallel heat-recovery air-pump unit
   exactly as in the earlier model; the clean room is x > 0. */
(function(){
"use strict";
if(!window.THREE){document.querySelector('.legend').insertAdjacentHTML('beforeend','<p class="sub" style="margin-top:8px">3D library could not load.</p>');return;}

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
  T.sigIn=col('--sig-in'); T.sigOut=col('--sig-out');
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
var dmpRA=[], dmpOA=[], mixGroup=null, humGroup=null, bypassGroup=null;

/* ======================================================================
   AHU + heat-recovery air-pump unit — the geometry of the earlier 3D model,
   unchanged in shape. It is built in that model's own units and the whole
   group is scaled into the plant-room half of the box (see K, XO, YO, ZO).
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
var YS=-1.12, YE=1.12;          // supply deck / extract deck centre lines
var MIXX=-3.4;                  // where return air drops into the mixing box

/* the parallel heat-recovery air-pump unit, standing behind the AHU */
var MX0=-20.5, MX1=-9.0, MXC=(MX0+MX1)/2;
var MY=-0.6, MZ=-8.5, MH=2.6, MD=3.2;
var MZU=MZ+0.85, MZL=MZ-0.85;   // the two lanes that cross inside the core

function box(w,h,d,mat){ return new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat); }
function at(o,x,y,z){ o.position.set(x,y,z); return o; }

(function frame(){
  var t=0.14, g=new THREE.Group();
  function bar(w,h,d,x,y,z){ g.add(at(box(w,h,d,M.frame),x,y,z)); }
  [[Y0,Z0],[Y0,Z1],[Y1,Z0],[Y1,Z1]].forEach(function(p){ bar(L,t,t,0,p[0],p[1]); });
  [[X0,Z0],[X0,Z1],[X1,Z0],[X1,Z1]].forEach(function(p){ bar(t,H,t,p[0],0,p[1]); });
  [[X0,Y0],[X0,Y1],[X1,Y0],[X1,Y1]].forEach(function(p){ bar(t,t,D,p[0],p[1],0); });
  [-9.2,-8.0,-4.1,-2.6,-1.5,1.2,3.0,5.0,6.9,8.2].forEach(function(x){
    bar(t*0.8,H,t*0.8,x,0,Z0); bar(t*0.8,H,t*0.8,x,0,Z1);
  });
  bar(L,t,t,0,0,Z0); bar(L,t,t,0,0,Z1);
  tag(g,'AHU frame'); unit.add(g);
})();

function panel(w,h,d,x,y,z,dir){
  var m=box(w,h,d,M.panel.clone()); at(m,x,y,z);
  tag(m,'AHU casing panel'); unit.add(m); casingParts.push(m);
  explodables.push({obj:m, dir:dir.clone(), base:m.position.clone(), scale:3.6});
}
panel(L,H,0.06, 0,0,Z1, new THREE.Vector3(0,0,1));
panel(L,H,0.06, 0,0,Z0, new THREE.Vector3(0,0,-1));
panel(L,0.06,D, 0,Y1,0, new THREE.Vector3(0,1,0));
panel(L,0.06,D, 0,Y0,0, new THREE.Vector3(0,-1,0));

/* deck divider, with an opening at the mixing box */
(function(){
  var g=new THREE.Group();
  g.add(at(box(L/2+MIXX-0.75-0.15,0.09,D-0.3,M.inner), (X0+(MIXX-0.75))/2, 0, 0));
  g.add(at(box(X1-(MIXX+0.75)-0.15,0.09,D-0.3,M.inner), ((MIXX+0.75)+X1)/2, 0, 0));
  tag(g,'AHU deck divider'); unit.add(g);
})();

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
preFilter(-2.0, YS, 'Panel filter', 'after the mixing box');
bagFilter( 0.3, YS, 'Bag filter');
hepaFilter( 7.0, YS, 'HEPA final filter');
preFilter( 8.6, YE, 'Extract pre-filter');
bagFilter( 6.6, YE, 'Extract bag filter');

/* --- heat recovery: plate core or thermal wheel --- */
var HRVX=-5.7;
var plateHX=new THREE.Group();
(function(){
  var w=2.8,h=4.0,d=D-0.6;
  plateHX.add(at(box(w,h,d,std(T.glass.clone(),{m:0.3,r:0.6,t:true,o:0.14,side:THREE.DoubleSide,dw:false})),0,0,0));
  var pm=std(T.glass.clone(),{m:0.6,r:0.35,t:true,o:0.5,side:THREE.DoubleSide});
  for(var i=0;i<17;i++) plateHX.add(at(box(w-0.1,0.035,d-0.1,pm),0,-1.85+i*0.2313,0));
  [-1,1].forEach(function(s){ plateHX.add(at(box(0.10,h,d,M.frame),s*(w/2),0,0)); });
  // diagonal stiffeners on the front face, as drawn on a crossflow core
  var dm=new THREE.LineBasicMaterial({color:T.metalDark.clone(),transparent:true,opacity:0.75});
  [[-1,1],[1,1]].forEach(function(s){
    var gg=new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-w/2*s[0],-h/2,d/2+0.02), new THREE.Vector3(w/2*s[0],h/2,d/2+0.02)]);
    plateHX.add(new THREE.Line(gg,dm));
  });
  plateHX.add(at(box(w+0.4,0.12,d,M.inner),0,-2.08,0));
  plateHX.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.09,1.5,14),M.frame),0,-2.8,Z1-0.4));
  plateHX.position.x=HRVX; tag(plateHX,'Plate heat-recovery core');
  unit.add(plateHX);
  explodables.push({obj:plateHX, dir:new THREE.Vector3(0,0,1), base:new THREE.Vector3(HRVX,0,0), scale:3.2});
})();

var wheel=new THREE.Group();
(function(){
  var rotor=new THREE.Group();
  var core=new THREE.Mesh(new THREE.CylinderGeometry(2.0,2.0,0.55,56,1,true),
    std(T.metal.clone(),{m:0.6,r:0.45,t:true,o:0.5,side:THREE.DoubleSide}));
  core.rotation.z=Math.PI/2; rotor.add(core);
  var sm=std(T.metal.clone(),{m:0.7,r:0.35,t:true,o:0.75,side:THREE.DoubleSide});
  for(var i=0;i<28;i++){
    var s=box(0.5,2.0,0.035,sm);
    s.position.set(0, Math.cos(i/28*Math.PI*2)*1.0, Math.sin(i/28*Math.PI*2)*1.0);
    s.rotation.x=-i/28*Math.PI*2; rotor.add(s);
  }
  var rim=new THREE.Mesh(new THREE.TorusGeometry(2.0,0.07,10,56),M.frame);
  rim.rotation.y=Math.PI/2; rotor.add(rim);
  wheel.add(rotor);
  spinners.push({obj:rotor, axis:'x', rate:0.55, id:'wheel'});
  wheel.add(at(box(0.9,4.3,D-0.5,std(T.glass.clone(),{m:0.3,r:0.6,t:true,o:0.12,side:THREE.DoubleSide,dw:false})),0,0,0));
  var mot=new THREE.Mesh(new THREE.CylinderGeometry(0.22,0.22,0.5,18),M.frame);
  mot.rotation.z=Math.PI/2; at(mot,0,-2.35,0.9); wheel.add(mot);
  wheel.position.x=HRVX; wheel.visible=false; tag(wheel,'Thermal wheel'); unit.add(wheel);
  explodables.push({obj:wheel, dir:new THREE.Vector3(0,0,1), base:new THREE.Vector3(HRVX,0,0), scale:3.2});
})();
var hrvLabel={text:'Plate heat-recovery core', sub:'counterflow · 75 % sensible',
  anchor:new THREE.Vector3(HRVX,2.1,0), off:new THREE.Vector3(0,1.5,1.4)};
labels.push(hrvLabel);

/* --- mixing section --- */
(function(){
  var g=new THREE.Group();
  var bm=std(T.metalDark.clone(),{m:0.7,r:0.4,side:THREE.DoubleSide});
  // recirculation damper sitting in the divider opening
  for(var i=0;i<5;i++){
    var b=box(0.26,0.05,D-0.9,bm); at(b,MIXX-0.55+i*0.28,0,0); b.rotation.z=0.0;
    g.add(b); dmpRA.push(b);
  }
  g.add(at(box(1.5,0.1,0.1,M.frame),MIXX,0,(D-0.9)/2));
  g.add(at(box(1.5,0.1,0.1,M.frame),MIXX,0,-(D-0.9)/2));
  // outdoor-air damper on the mixing-box inlet face
  for(var j=0;j<5;j++){
    var c=box(0.05,0.30,D-0.9,bm); at(c,MIXX-0.9,YS-0.7+j*0.36,0); c.rotation.z=0.78; g.add(c); dmpOA.push(c);
  }
  // mixing baffles
  var vm=std(T.glass.clone(),{m:0.4,r:0.6,t:true,o:0.4,side:THREE.DoubleSide});
  g.add(at(box(0.06,1.1,D-0.8,vm),MIXX+0.2,YS+0.45,0));
  g.add(at(box(0.06,1.1,D-0.8,vm),MIXX+0.55,YS-0.45,0));
  // damper actuators outside the skin
  g.add(at(box(0.3,0.3,0.3,M.frame),MIXX,0.15,Z1+0.25));
  g.add(at(box(0.3,0.3,0.3,M.frame),MIXX-0.9,YS,Z1+0.25));
  tag(g,'Mixing section + servo dampers'); unit.add(g); mixGroup=g;
  explodables.push({obj:g, dir:new THREE.Vector3(0,-0.5,1).normalize(), base:new THREE.Vector3(0,0,0), scale:2.4});
  labels.push({text:'Mixing section', sub:'70 % outdoor / 30 % recirculated',
    anchor:new THREE.Vector3(MIXX,YS+0.6,0), off:new THREE.Vector3(-1.4,-2.0,1.5)});
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
fan(-8.9, YE, -1, 'Extract transfer fan');

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
damper(X0+0.2, YS, 'Outdoor air intake', 'motorised damper');
damper(X0+0.2, YE, 'Exhaust air outlet', 'motorised damper');
damper(X1-0.2, YS, 'Supply air to building', 'duct connection');
damper(X1-0.2, YE, 'Return air from building', 'duct connection');

/* --- ductwork --- */
var ducts=new THREE.Group(); tag(ducts,'AHU duct connections');
[[-1,YS],[-1,YE],[1,YS],[1,YE]].forEach(function(p){
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
attenuator( 3.4, YE, 'Extract attenuator');

(function bypass(){
  var g=new THREE.Group();
  var bm=std(T.metalDark.clone(),{m:0.7,r:0.4,side:THREE.DoubleSide});
  for(var i=0;i<5;i++){
    var b=box(0.05,0.28,D-0.9,bm); at(b,-4.4,YS-0.72+i*0.36,0); b.rotation.z=0.78; g.add(b);
  }
  g.add(at(box(0.10,0.10,D-0.8,M.frame),-4.4,YS+0.95,0));
  g.add(at(box(0.10,0.10,D-0.8,M.frame),-4.4,YS-0.95,0));
  g.add(at(box(0.3,0.3,0.3,M.frame),-4.4,YS,Z1+0.25));
  tag(g,'Recovery bypass damper'); aux.add(g); bypassGroup=g;
  labels.push({text:'Recovery bypass damper',sub:'free cooling + frost control',tier:'aux',
    anchor:new THREE.Vector3(-4.4,YS,0),off:new THREE.Vector3(-2.3,-2.1,1.2)});
})();

function sensor(x,y,z,text,sub){
  var g=new THREE.Group();
  g.add(at(box(0.17,0.28,0.17,M.frame),x,y,z));
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.03,0.8,8),M.frame),x,y-0.5,z));
  tag(g,'Sensor: '+text); aux.add(g);
  labels.push({text:text,sub:sub,tier:'aux',anchor:new THREE.Vector3(x,y,z),
    off:new THREE.Vector3(0,y>0?1.3:-1.4,1.1)});
}
sensor( 7.2, YS+0.85, 0.75, 'Supply T + RH', 'cascade control');
sensor( 9.4, YE+0.85, 0.75, 'Return T + RH + CO₂', 'demand-controlled ventilation');
sensor(-9.4, YS+0.85, 0.75, 'AHU intake T + RH', 'after the recovery unit');
sensor(-2.3, YS+0.85, -0.75,'Mixed-air sensor', 'damper modulation');
sensor(-4.3, YE+0.85, -0.75,'Frost thermostat', 'exhaust side of core');
/* rig additions in the same style: the two coil-leaving sensors */
sensor(-0.25, YS+0.85, 0.75, 'TT-103 after pre-heat', 'pre-heat coil control');
sensor( 3.35, YS+0.85,-0.75, 'TT-104 off cooling coil', 'cooling coil control');

(function gauges(){
  var gm=std(new THREE.Color('#d7dde3'),{m:0.2,r:0.7});
  [[-8.7,YS+0.55],[0.3,YS+0.55],[7.0,YS+0.55],[8.6,YE+0.55],[6.6,YE+0.55]].forEach(function(p){
    var d=new THREE.Mesh(new THREE.CylinderGeometry(0.17,0.17,0.08,18),gm);
    d.rotation.x=Math.PI/2; at(d,p[0],p[1],Z1+0.08); tag(d,'Filter ΔP gauge'); aux.add(d);
  });
  labels.push({text:'Filter ΔP gauges',sub:'5 × 0–500 Pa',tier:'aux',
    anchor:new THREE.Vector3(0.3,YS+0.55,Z1+0.08),off:new THREE.Vector3(-0.8,-2.6,1.3)});
})();

(function controlPanel(){
  var g=new THREE.Group();
  g.add(at(box(1.7,2.3,0.26,M.frame),9.0,0.1,Z1+0.22));
  g.add(at(box(1.5,2.1,0.03,std(T.metalDark.clone(),{m:0.4,r:0.6})),9.0,0.1,Z1+0.37));
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,0.4,10),M.inner),9.7,0.1,Z1+0.4));
  tag(g,'AHU control panel'); aux.add(g);
  labels.push({text:'Control panel',sub:'BMS + EC fan drives',tier:'aux',
    anchor:new THREE.Vector3(9.0,0.1,Z1+0.3),off:new THREE.Vector3(1.6,1.6,1.0)});
})();

(function weatherLouvres(){
  var bm=std(T.metalDark.clone(),{m:0.6,r:0.5,side:THREE.DoubleSide});
  [[LZU,LYU],[MZL,MY]].forEach(function(q){
    var z=q[0], yy=q[1], lg=new THREE.Group(); tag(lg,z===MZL?'Exhaust louvre + bird mesh':'Fresh-air louvre + bird mesh');
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
  [[-1,YS],[-1,YE],[1,YS],[1,YE]].forEach(function(p){
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
    .forEach(function(s){ door(s[0],YS,s[1]); door(s[0],YE,s[1]); });
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

  // crossflow heat-exchange core, set on the diagonal
  var coreG=new THREE.Group();
  // separating plates stack horizontally: one stream takes the odd layers,
  // the other the even layers, so the two airstreams never touch
  var cm=std(T.glass.clone(),{m:0.55,r:0.4,t:true,o:0.40,side:THREE.DoubleSide});
  for(var i=0;i<11;i++) coreG.add(at(box(2.2,0.035,2.2,cm),0,-0.95+i*0.19,0));
  coreG.add(at(box(2.2,MH-0.5,2.2,std(T.glass.clone(),{m:0.3,r:0.6,t:true,o:0.10,side:THREE.DoubleSide,dw:false})),0,0,0));
  coreG.rotation.y=Math.PI/4; at(coreG,MXC,MY,MZ); tag(coreG,'Crossflow recovery core'); modUnit.add(coreG);
  explodables.push({obj:coreG,dir:new THREE.Vector3(0,1,0),base:new THREE.Vector3(MXC,MY,MZ),scale:2.6});
  labels.push({text:'Crossflow recovery core',sub:'separated plates · no air contact',
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
  modFan(MX0+1.4, MZL, -1, 'Exhaust fan');

  // control box and power feed, drawn on top as on the reference
  modUnit.add(tag(at(box(1.1,0.55,0.8,M.frame),MXC+2.2,MY+MH/2+0.3,MZ+0.4),'Recovery unit control box'));
  modUnit.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,1.0,10),M.frame),MXC+3.1,MY+MH/2+0.5,MZ+0.4));
  labels.push({text:'Recovery unit control',sub:'interlocked with the AHU',tier:'aux',
    anchor:new THREE.Vector3(MXC+2.2,MY+MH/2+0.3,MZ+0.4),off:new THREE.Vector3(1.9,1.4,-0.6)});

  // spigots at both ends
  [[MX0-0.5,MZU],[MX0-0.5,MZL],[MX1+0.5,MZU],[MX1+0.5,MZL]].forEach(function(p){
    modUnit.add(tag(at(box(1.0,MH-0.6,1.5,M.duct),p[0],MY,p[1]),'Recovery unit spigot'));
  });

  labels.push({text:'Heat-recovery air-pump unit',sub:'runs in parallel with the AHU',
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
  // liquid line crossing to the recovery unit's exhaust coil
  run([[3.8,YS,Z1-0.1],[3.0,YS-1.3,zf],[0.9,Y0-1.3,zf],[-3.2,Y0-1.5,zf],
       [-7.6,Y0-1.3,0.4],[-10.5,Y0-0.9,-3.4],[-14.5,MY-1.0,-6.6],[-17.3,MY-0.9,MZL+0.5],[-17.3,MY,MZL+0.4]]);
  // suction line back from the recovery unit to the compressor
  run([[-17.3,MY+0.5,MZL+0.4],[-19.8,MY+0.4,-6.4],[-15.0,MY-1.3,-4.2],
       [-9.4,Y0-1.4,-1.4],[-7.2,Y0-1.0,0.9],[-6.2,Y0-0.55,0.35]],0.09);
  refrig.add(at(box(0.34,0.34,0.34,M.frame),-3.2,Y0-1.5,zf));
  labels.push({text:'Electronic expansion valve', sub:'superheat control', tier:'aux',
    anchor:new THREE.Vector3(-3.2,Y0-1.5,zf), off:new THREE.Vector3(0.4,-1.1,0.9)});
  tag(refrig,'R32 refrigerant pipework'); unit.add(refrig);
})();

/* earlier-model labels live in model units; flag them so they are mapped to the world */
labels.forEach(function(l){ l.space='c'; });
/* link the two damper actuators: one servo (SV-101) drives the outdoor-air and the
   recirculation blades in opposition through a linkage rod */
(function servoLinkage(){
  var g=new THREE.Group(); tag(g,'SV-101 servo linkage');
  var horn=new THREE.Group();
  horn.add(at(box(0.62,0.08,0.05,std(new THREE.Color('#f2f2f2'),{m:0.1,r:0.6})),0.24,0,0));
  horn.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.07,0.08,12),M.frame),0,0,0));
  horn.children[1].rotation.x=Math.PI/2;
  horn.position.set(MIXX-0.9,YS,Z1+0.43); g.add(horn);
  var rod=new THREE.Mesh(new THREE.CylinderGeometry(0.025,0.025,1.0,8),M.frame);
  g.add(rod);
  unit.add(g);
  window.__servo={horn:horn,rod:rod};
})();

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

/* clean-room door on the front face */
(function door(){
  var g=new THREE.Group(); tag(g,'Clean-room access door'); g.userData.asm='Acrylic enclosure';
  var z=BZ+0.05, x0=7, x1=43, y0=3, y1=37;
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
function duct(name,pts,r,mat,group,bend){
  var cv=roundedPath(pts,bend||r*1.6);
  var len=cv.getLength();
  var m=new THREE.Mesh(new THREE.TubeGeometry(cv,Math.max(24,Math.round(len*2)),r,18,false),mat||MR.pvc);
  m.userData.cad={type:'duct',pts:pts.map(function(p){return [p[0],p[1],p[2]];}),r:r,wall:0.15,bend:bend||r*1.6};
  m.renderOrder=2; tag(m,name); (group||rigDucts).add(m);
  return m;
}
function rectDuct(name,w,h,d,x,y,z){
  var m=at(box(w,h,d,MR.pvc),x,y,z); m.renderOrder=2; tag(m,name);
  var e=new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry),
    new THREE.LineBasicMaterial({color:T.metalDark.clone(),transparent:true,opacity:0.55}));
  m.add(e); rigDucts.add(m); return m;
}
function flangeRing(name,x,y,z,r,axis){
  var t=new THREE.Mesh(new THREE.TorusGeometry(r+0.25,0.22,8,28),MR.steel);
  if(axis==='x') t.rotation.y=Math.PI/2; else if(axis==='y') t.rotation.x=Math.PI/2;
  at(t,x,y,z); tag(t,name); rigDucts.add(t); return t;
}

/* key world points from the earlier model */
var P_AHU_OA = C2W(-13.4,YS,0), P_AHU_SUP=C2W(13.4,YS,0), P_AHU_RET=C2W(13.4,YE,0);
var P_HR_FRESH=C2W(MX0-1.0,MY,MZU), P_HR_EXH=C2W(MX0-1.0,MY,MZL);
var HX=-46.5, HY=11;                                   // fresh-air header line
var COMP={x:-42.5,y:22,z:-14};                         // fresh-air compressor (volute centre)

/* fresh-air header: compressor → recovery air-pump unit + AHU */
duct('Compressor discharge',[[COMP.x,17.6,-11.3],[COMP.x,13.6,-11.3],[COMP.x-2.6,HY,-11.3],[HX+0.2,HY,-11.3]],1.1);
duct('Fresh-air header',[[HX,HY,-12.4],[HX,HY,3.4]],1.15);
duct('Header → recovery unit (fresh lane)',[[HX,HY,P_HR_FRESH.z],[HX,P_HR_FRESH.y,P_HR_FRESH.z],[P_HR_FRESH.x-0.2,P_HR_FRESH.y,P_HR_FRESH.z]],0.75);
duct('Header → AHU outdoor-air intake',[[HX,HY,P_AHU_OA.z],[HX,P_AHU_OA.y,P_AHU_OA.z],[P_AHU_OA.x+0.3,P_AHU_OA.y,P_AHU_OA.z]],1.0);
/* the connections the earlier model drew only as air: recovery unit ⇄ AHU, and the exhaust run */
(function transfer(){
  var LNr=0.62;
  function cduct(name,pts,r){
    var w=pts.map(function(p){ var v=C2W(p[0],p[1],p[2]); return [v.x,v.y,v.z]; });
    return duct(name,w,r*K);
  }
  cduct('Tempered-air duct: recovery unit → AHU',[[MX1+0.5,MY,MZL],[MX1+1.8,MY-0.3,MZL+0.3],[-6.9,MY-0.6,-6.6],[-7.8,YS,-3.6],[-10.4,YS,-1.4],[-12.6,YS,-0.1]],LNr);
  cduct('Extract transfer duct: AHU → recovery unit',[[-12.6,YE,-0.1],[-10.6,1.5,-1.6],[-8.2,1.2,-4.2],[-7.0,0.2,-6.6],[MX1+1.8,MY+0.3,MZU-0.2],[MX1+0.5,MY,MZU]],LNr);
  cduct('Exhaust duct: recovery unit → louvre',[[MX0-1.0,MY,MZL],[MX0-5.3,MY,MZL]],0.6);
})();
/* supply: AHU supply connection → boot → riser → through the partition → ceiling void */
var RZ=8.5, RX=-4.5, RY=44.5;
rectDuct('Supply boot',3.0,2.32,8.7, -4.5,P_AHU_SUP.y,5.7);
duct('Supply riser',[[RX,P_AHU_SUP.y+1.1,RZ],[RX,RY,RZ],[0.6,RY,RZ],[8,RY,RZ],[8,RY,0],[36,RY,0],[36,CEIL+1.4,0]],1.4);
duct('Diffuser drop 1',[[14,RY,0],[14,CEIL+1.4,0]],1.25);
flangeRing('Partition sleeve: supply',0,RY,RZ,1.4,'x');
/* return: low-level grilles → through the partition → AHU return connection */
rectDuct('Return duct',P_AHU_RET.x*-1-0.25,2.31,3.3,(P_AHU_RET.x-0.25)/2,P_AHU_RET.y,P_AHU_RET.z);
duct('Return branch (grille 2)',[[-0.3,P_AHU_RET.y,-13],[-1.6,P_AHU_RET.y,-13],[-1.6,P_AHU_RET.y,1.3]],1.0);
flangeRing('Partition sleeve: return 2',0,P_AHU_RET.y,-13,1.0,'x');

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
  var intake=new THREE.Mesh(new THREE.CylinderGeometry(1.9,1.9,5.0,28,1,true),MR.pvc); intake.rotation.z=Math.PI/2;
  at(intake,COMP.x-4.5,COMP.y,COMP.z); g.add(intake);
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
var DIFF=[[14,0],[36,0]], GRILLE=[[P_AHU_RET.y,P_AHU_RET.z],[P_AHU_RET.y,-13]];
DIFF.forEach(function(d,i){
  var g=new THREE.Group(); tag(g,'Ceiling diffuser '+(i+1));
  g.add(at(box(9,0.3,9,MR.white),d[0],CEIL-0.15,d[1]));
  [7.2,5.4,3.6].forEach(function(s,k){
    var fr=new THREE.Group();
    [[0,s/2],[0,-s/2]].forEach(function(o){ fr.add(at(box(s,0.25,0.35,MR.steel),0,0,o[1])); });
    [[s/2,0],[-s/2,0]].forEach(function(o){ fr.add(at(box(0.35,0.25,s,MR.steel),o[0],0,0)); });
    fr.position.set(d[0],CEIL-0.4-k*0.35,d[1]); g.add(fr);
  });
  g.add(at(box(2.4,0.3,2.4,MR.steel),d[0],CEIL-1.5,d[1]));
  g.add(at(box(3.6,1.2,3.6,MR.white),d[0],CEIL+0.9,d[1]));            // neck / plenum box
  clean.add(g);
});
GRILLE.forEach(function(gr,i){
  var g=new THREE.Group(); tag(g,'Low-level return grille '+(i+1));
  var y=gr[0], z=gr[1];
  g.add(at(box(0.4,5.2,0.4,MR.white),TH/2+0.2,y,z-3.3)); g.add(at(box(0.4,5.2,0.4,MR.white),TH/2+0.2,y,z+3.3));
  g.add(at(box(0.4,0.4,7,MR.white),TH/2+0.2,y+2.6,z)); g.add(at(box(0.4,0.4,7,MR.white),TH/2+0.2,y-2.6,z));
  for(var k=0;k<6;k++){ var b=box(0.9,0.12,6.4,MR.steel); b.rotation.z=-0.6; at(b,TH/2+0.45,y-2.0+k*0.8,z); g.add(b); }
  clean.add(g);
});
(function bench(){
  var g=new THREE.Group(); tag(g,'Stainless bench + product tray');
  var x=31, z=-11, h=14;
  g.add(at(box(18,0.6,10,MR.steel),x,h,z));
  g.add(at(box(16,0.4,8,MR.steel),x,4,z));
  [[-8.3,-4.3],[-8.3,4.3],[8.3,-4.3],[8.3,4.3]].forEach(function(p){
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.45,0.45,h-0.5,12),MR.steel),x+p[0],(h-0.5)/2+0.5,z+p[1]));
  });
  g.add(at(box(8,0.5,5,MR.white),x-2,h+0.55,z));
  for(var i=0;i<4;i++) for(var j=0;j<2;j++){
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.55,0.55,2.0,14),
      std(new THREE.Color('#bfe6ff'),{m:0.1,r:0.1,t:true,o:0.6})),x-4.6+i*1.7,h+1.8,z-1.1+j*2.2));
  }
  clean.add(g);
})();
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
   colourKey f/r/m = fresh/return/mixed; temperatureKey names an air state of the model */
var RW=1.12, RN=0.72, LN=0.58;
function cw(list){ return list.map(function(p){ var v=C2W(p[0],p[1],p[2]); return [v.x,v.y,v.z,p[3]*K,p[4],p[5]]; }); }
var TRAIN_C=[
  [-2.6,YS,0,0.88,'m','mix'],[-2.0,YS,0,0.86,'m','mix'],[-0.9,YS,0,0.80,'m','mix'],[0.3,YS,0,0.86,'m','ph'],
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
         [MX1-2.2,MY,MZL,LN,'f','t1'],[MX1-1.5,MY,MZL,0.42,'f','t1'],[MX1+0.6,MY,MZL,0.5,'f','t1'],
         [MX1+1.8,MY-0.3,MZL+0.3,0.5,'f','t1'],[-6.9,MY-0.6,-6.6,0.5,'f','t1'],[-7.8,YS,-3.6,0.5,'f','t1'],
         [-10.4,YS,-1.4,0.5,'f','t1'],[-13.2,YS,-0.1,0.9,'f','t1']])),
  direct:[[HX,HY,P_HR_FRESH.z,0.85,'f','oa'],[HX,HY,P_AHU_OA.z,0.85,'f','oa'],[HX,P_AHU_OA.y,P_AHU_OA.z,0.8,'f','oa'],
         [P_AHU_OA.x+0.2,P_AHU_OA.y,P_AHU_OA.z,0.8,'f','oa']],
  supply: cw([[-13.2,YS,0,RW,'f','tin'],[-10.6,YS,0,RW,'f','tin'],[-9.8,YS,0,1.00,'f','tin'],[-8.7,YS,0,0.90,'f','tin'],
         [-7.1,YS,0,0.84,'f','tin'],[-5.7,YS,0,0.80,'f','tin'],[-4.3,YS,0,0.84,'f','t2'],[-3.9,YS,0,0.88,'f','t2']].concat(TRAIN_C)),
  recirc: cw([[9.6,YE,0,RW,'r','ret'],[8.6,YE,0,0.90,'r','ret'],[7.0,YE,0,0.90,'r','ret'],[5.4,YE,0,RW,'r','ret'],
         [3.4,YE,0,0.82,'r','ret'],[0.5,YE,0,RW,'r','ret'],[-2.4,YE,0,RW,'r','ret'],[-3.0,YE-0.2,0,0.70,'r','ret'],
         [-3.4,0.0,0,0.62,'r','ret'],[-3.4,YS+0.55,0,0.66,'r','ret']].concat(TRAIN_C)),
  extract: cw([[13.2,YE,0,RW,'r','ret'],[10.6,YE,0,RW,'r','ret'],[9.6,YE,0,1.00,'r','ret'],[8.6,YE,0,0.90,'r','ret'],
         [7.0,YE,0,0.90,'r','ret'],[5.4,YE,0,RW,'r','ret'],[3.4,YE,0,0.82,'r','ret'],[0.5,YE,0,RW,'r','ret'],
         [-2.4,YE,0,RW,'r','ret'],[-4.3,YE,0,0.84,'r','ret'],[-5.7,YE,0,0.80,'r','ret'],[-7.1,YE,0,0.84,'r','r1'],
         [-7.9,YE,0,0.84,'r','r1'],[-8.5,YE,0,RN,'r','r1'],[-8.9,YE,0,0.45,'r','r1'],[-9.8,YE,0,0.95,'r','r1'],
         [-10.6,YE,0,RW,'r','r1'],[-13.2,YE,-0.1,0.9,'r','r1']]),
  stale: cw([[-13.2,YE,-0.1,0.5,'r','r1'],[-10.6,1.5,-1.6,0.5,'r','r1'],[-8.2,1.2,-4.2,0.5,'r','r1'],[-7.0,0.2,-6.6,0.5,'r','r1'],
         [MX1+1.8,MY+0.3,MZU-0.2,0.5,'r','r1'],[MX1+0.6,MY,MZU,0.5,'r','r1'],[MX1-1.5,MY,MZU,LN,'r','r1'],
         [MXC+1.9,MY,MZU,LN,'r','r1'],[MXC+1.1,MY-0.50,MZ+0.60,0.34,'r','r1'],[MXC,MY-0.50,MZ,0.34,'r','r1'],
         [MXC-1.1,MY-0.50,MZ-0.60,0.34,'r','r2'],[MXC-1.9,MY,MZL,LN,'r','r2'],[-17.3,MY,MZL,0.46,'r','r2'],
         [MX0+1.4,MY,MZL,0.42,'r','exh'],[MX0-1.2,MY,MZL,0.55,'r','exh'],[MX0-5.6,MY,MZL,0.55,'r','exh'],[MX0-9.5,MY,MZL,1.3,'r','exh']])
};
var RISER0=[[P_AHU_SUP.x-0.2,P_AHU_SUP.y,P_AHU_SUP.z,1.0,'m','sup'],[RX,P_AHU_SUP.y,4.6,1.0,'m','sup'],[RX,P_AHU_SUP.y,RZ,1.0,'m','sup'],
  [RX,P_AHU_SUP.y+2.5,RZ,1.1,'m','sup'],[RX,RY,RZ,1.1,'m','sup'],[0.5,RY,RZ,1.1,'m','sup'],[8,RY,RZ,1.1,'m','sup'],
  [8,RY,0,1.1,'m','sup'],[14,RY,0,1.0,'m','sup']];
PATHS.riserA=RISER0.concat([[14,CEIL+1.4,0,0.9,'m','sup'],[14,CEIL+0.2,0,1.1,'m','sup']]);
PATHS.riserB=RISER0.concat([[36,RY,0,1.0,'m','sup'],[36,CEIL+1.4,0,0.9,'m','sup'],[36,CEIL+0.2,0,1.1,'m','sup']]);
PATHS.room=[];
DIFF.forEach(function(d){
  [[1,0],[-1,0],[0,1],[0,-1]].forEach(function(dr){
    var xd=d[0], zd=d[1], dist;
    if(dr[0]>0) dist=BX-TH-xd; else if(dr[0]<0) dist=xd-TH/2; else dist=BZ-TH;
    var reach=Math.max(3,dist-3.5);
    var x2=xd+dr[0]*reach, z2=zd+dr[1]*reach;
    var gz=z2>-5?GRILLE[0][1]:GRILLE[1][1], gy=GRILLE[0][0];
    PATHS.room.push([[xd,CEIL-0.6,zd,1.4,'m','sup'],[xd+dr[0]*5.5,CEIL-1.6,zd+dr[1]*5.5,2.2,'m','sup'],
      [x2,CEIL-5,z2,3.0,'m','room'],[x2,24,z2,3.6,'m','room'],[x2,9,z2,3.4,'r','room'],
      [Math.min(7,Math.max(x2,4)),5.0,(z2+gz)/2,2.6,'r','room'],[3.2,gy,gz,1.8,'r','ret'],[0.6,gy,gz,1.4,'r','ret']]);
  });
});
PATHS.retA=[[0.6,GRILLE[0][0],GRILLE[0][1],1.0,'r','ret'],[-3,P_AHU_RET.y,P_AHU_RET.z,1.0,'r','ret'],[P_AHU_RET.x-0.2,P_AHU_RET.y,P_AHU_RET.z,1.0,'r','ret']];
PATHS.retB=[[0.6,GRILLE[1][0],GRILLE[1][1],0.7,'r','ret'],[-1.6,GRILLE[1][0],-13,0.7,'r','ret'],[-1.6,P_AHU_RET.y,1.0,0.7,'r','ret'],
  [-3.4,P_AHU_RET.y,P_AHU_RET.z,1.0,'r','ret'],[P_AHU_RET.x-0.2,P_AHU_RET.y,P_AHU_RET.z,1.0,'r','ret']];

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
  stream('recirc',[PATHS.recirc],620,'Qrec',{size:0.42}),
  stream('riser',[PATHS.riserA,PATHS.riserB],700,'Qsup',{vk:9}),
  stream('room',PATHS.room,1500,'Qsup',{size:0.85,vk:11}),
  stream('ret',[PATHS.retA,PATHS.retA,PATHS.retB],420,'Qret'),
  stream('extract',[PATHS.extract],560,'Qex',{size:0.42}),
  stream('stale',[PATHS.stale],420,'Qex',{size:0.42,fadeOut:true})
];
var _v=new THREE.Vector3(), _c=new THREE.Color();
function tempColor(t,out){
  if(t<=21){ var a=Math.max(0,Math.min(1,(t+5)/26)); return out.copy(T.tCold).lerp(T.tMid,a); }
  var b=Math.max(0,Math.min(1,(t-21)/24)); return out.copy(T.tMid).lerp(T.tHot,b);
}
var colorMode='stream';
function streamColor(k,out){ return out.copy(k==='f'?T.fresh:(k==='r'?T.ret:T.mix)); }
function refreshPathColors(states){
  ALLPATHS.forEach(function(p){
    for(var i=0;i<p.v.length;i++){
      if(colorMode==='temp' && states) tempColor(states[p.tk[i]]!==undefined?states[p.tk[i]]:21,p.col[i]);
      else streamColor(p.ck[i],p.col[i]);
    }
  });
}
function updateStream(st,dt,speed,flows){
  var pos=st.geo.attributes.position.array, cols=st.geo.attributes.color.array;
  var q=flows[st.flow]||0, ff=Math.max(0,Math.min(3,q/flows.ref));
  st.obj.visible=airVisible && q>0.02;
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
var airVisible=true;

/* ---------------------------------------------- coloured air columns */
var ribbons=new THREE.Group(); scene.add(ribbons);
var RIBS=['comp','hr','direct','supply','recirc','riserA','riserB','retA','retB','extract','stale'];
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
  {p:[-55.5,P_HR_EXH.y,P_HR_EXH.z], rz:Math.PI/2, c:'ret'},
  {p:[14,35.6,0], rz:Math.PI, c:'mix'},
  {p:[36,35.6,0], rz:Math.PI, c:'mix'},
  {p:[3.4,GRILLE[0][0]+4.6,GRILLE[0][1]], rz:Math.PI/2, c:'ret'},
  {p:[3.4,GRILLE[1][0]+4.6,GRILLE[1][1]], rz:Math.PI/2, c:'ret'}
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
  ['SV-101','out',aw(MIXX-0.9,0,0).x,5.6,aw(0,YS,0).y],
  ['TT-102','in', aw(-2.3,0,0).x,5.2,aw(0,YS+0.85,0).y],
  ['EEV-101','out',aw(-3.2,0,0).x,5.7,aw(0,Y0-1.5,0).y],
  ['TT-103','in', aw(-0.25,0,0).x,5.2,aw(0,YS+0.85,0).y],
  ['CMP-101','out',aw(-6.2,0,0).x,4.9,aw(0,Y0-1.15,0).y],
  ['TT-104','in', aw(3.35,0,0).x,5.2,aw(0,YS+0.85,0).y],
  ['HTR-101','out',aw(3.8,0,0).x+0.6,5.2,aw(0,YS,0).y],
  ['HUM-101','out',aw(4.8,0,0).x+0.2,5.9,aw(0,Y0-0.55,0).y],
  ['FAN-102','out',aw(6.35,0,0).x-0.3,5.2,aw(0,YS,0).y],
  ['PDT-102','in', aw(7.0,0,0).x+0.5,5.3,aw(0,YS+0.55,0).y],
  ['TT-105','in', aw(7.2,0,0).x+1.0,5.2,aw(0,YS+0.85,0).y],
  ['TT-107','in', aw(9.4,0,0).x,5.2,aw(0,YE+0.85,0).y],
  ['FT-102','in', RX,11.3,20],
  ['FAN-103','out',aw(-9.35,0,0).x,5.2,aw(0,YE,0).y],
  ['FAN-103B','out',aw(MX0+1.02,0,0).x,-4.2,aw(0,MY,0).y],
  ['TT-108','in', aw(-18.3,0,0).x+0.3,-4.2,aw(0,MY+MH/2,0).y+0.4],
  ['TT-106','in', 44,-BZ+TH+0.6,20,'z'],
  ['PDT-101','in', TH/2+0.25,-17.5,28.5,'x'],
  ['PSU','in', -37.2,-17.3,TH+3.2]
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
  {text:'Fresh-air compressor',sub:'FAN-101 · supplies the AHU + air pump',a:W(COMP.x,COMP.y+4.2,COMP.z),o:W(-3,9,3)},
  {text:'Fresh-air header',sub:'one branch to each unit',a:W(HX,HY+1.2,-4),o:W(-9,6,10)},
  {text:'AHU',sub:'same unit as the earlier model',a:C2W(1,Y1,0),o:W(9,6,13)},
  {text:'Heat-recovery air-pump unit',sub:'runs in parallel with the AHU',a:C2W(MXC,MY+MH/2,MZ),o:W(-6,13,-8)},
  {text:'Supply riser',sub:'FT-102 airflow → clean room',a:W(RX,32,RZ),o:W(5,5,9)},
  {text:'Ceiling supply diffusers',sub:'4-way square · ×2',a:W(36,CEIL-0.4,0),o:W(5,-6,13)},
  {text:'Low-level return grilles',sub:'back to the AHU extract deck',a:W(0.6,GRILLE[0][0]+2,GRILLE[0][1]),o:W(9,-1,12)},
  {text:'Clean room',sub:'ACH = supply airflow ÷ room volume',a:W(26,30,-16),o:W(-4,14,-6)},
  {text:'HMI-101 touch screen',sub:'7-inch · every set point',a:W(-38,46.8,BZ+2),o:W(-6,6,6)},
  {text:'Main controller PCB',sub:'ESP32-S3 · 3 × ACS712 current',a:W(-21,PCB.y1,PCB.z+0.3),o:W(3,7,3)},
  {text:'PCB wiring harness',sub:'flat FR4 strips, no loose wires',a:W(-8,TH+0.3,-14),o:W(18,-4,-6)},
  {text:'Exhaust outlet',sub:'after the air-pump evaporator',a:W(-50.2,P_HR_EXH.y,P_HR_EXH.z),o:W(-12,-8,4)},
  {text:'Acrylic enclosure',sub:'1000 × 500 × 500 mm · 5 mm PMMA',a:W(BX,BY,BZ),o:W(8,2,8)},
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
  ['TT-102',C2W(-2.3,Y1+1.4,0),'in'], ['TT-103',C2W(-0.25,Y1+3.1,0),'in'],
  ['TT-104',C2W(3.35,Y1+1.4,0),'in'], ['TT-105',C2W(7.2,Y1+3.1,0),'in'],
  ['TT-107',C2W(10.2,Y1+1.4,0),'in'], ['PDT-102',C2W(7.6,Y0-1.4,Z1+0.8),'in'],
  ['SV-101',C2W(MIXX-1.2,Y0-1.6,Z1+0.9),'out'], ['FAN-102',C2W(5.0,Y0-2.9,Z1+0.9),'out'],
  ['CMP-101',C2W(-6.6,Y0-3.3,Z1+1.2),'out'], ['FAN-103',C2W(-8.9,Y1+3.1,0),'out'],
  ['TT-108',C2W(-18.3,MY+MH/2+2.6,MZL),'in'],
  ['FT-102',W(RX+0.5,24,RZ+3.4),'in'], ['TT-106',W(42,28,-21),'in'], ['PDT-101',W(4,35,-19),'in'],
  ['ACH',W(25,25,4),'calc'], ['CT',W(-21,PCB.y0-2.4,PCB.z+1.2),'in']
];
var TAGS=TAGDEF.map(function(d){
  var cv=document.createElement('canvas'); cv.width=300; cv.height=88;
  var tex=new THREE.CanvasTexture(cv); tex.anisotropy=4;
  // constant on-screen size, so tags stay readable from the whole-box view to close-ups
  var sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false,depthWrite:false,sizeAttenuation:false}));
  var big=d[0]==='ACH'; sp.scale.set(big?0.15:0.105,big?0.044:0.031,1); sp.position.copy(d[1]); sp.renderOrder=11;
  tagGroup.add(sp);
  return {id:d[0],kind:d[2],cv:cv,tex:tex,sp:sp,last:''};
});
function drawTag(t,line1,line2,state){
  var key=line1+'|'+line2+'|'+state+'|'+T.dark; if(key===t.last) return; t.last=key;
  var c=t.cv.getContext('2d'), w=t.cv.width, h=t.cv.height;
  c.clearRect(0,0,w,h);
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
function applyHrv(){
  var plate=m.hrv==='plate';
  plateHX.visible=plate; wheel.visible=!plate;
  hrvLabel.text=plate?'Plate heat-recovery core':'Rotary thermal wheel';
  hrvLabel.sub =plate?'counterflow · sensible':'sorption rotor · sensible + latent';
  refreshLabels();
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
function esc(s){ return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }

/* ====================================================================== HMI */
var $=function(id){ return document.getElementById(id); };
var hmiEl=$('hmi');
/* sensors and actuators, with the board channel each one uses */
var IO=[
  ['TT-101','Fresh-air temperature',function(){return sgn(m.s.TT101)+' °C';},'SHT31 on the fresh-air header','I²C mux ch0 · 0x44','in'],
  ['MT-101','Fresh-air humidity',function(){return f0(m.s.MT101)+' %';},'SHT31','I²C mux ch0','in'],
  ['FT-101','Fresh-air flow',function(){return f2(m.s.FT101)+' m³/h';},'Omron D6F-W04A1 air velocity','ADC1_CH0 · GPIO1','in'],
  ['TT-102','Mixed-air temperature',function(){return sgn(m.s.TT102)+' °C';},'DS18B20 probe','1-Wire A · GPIO15','in'],
  ['TT-103','Air after pre-heat',function(){return sgn(m.s.TT103)+' °C';},'DS18B20 probe','1-Wire A · GPIO15','in'],
  ['TT-104','Air off the cooling coil',function(){return sgn(m.s.TT104)+' °C';},'DS18B20 probe','1-Wire A · GPIO15','in'],
  ['TT-105','Final supply-air temperature',function(){return sgn(m.s.TT105)+' °C';},'SHT31 after the HEPA','I²C mux ch1 · 0x44','in'],
  ['MT-105','Final supply-air humidity',function(){return f0(m.s.MT105)+' %';},'SHT31','I²C mux ch1','in'],
  ['FT-102','Final supply airflow',function(){return f2(m.s.FT102)+' m³/h';},'Omron D6F-W04A1 in the riser','ADC1_CH1 · GPIO2','in'],
  ['PDT-101','Clean-room pressure',function(){return sgn(m.s.PDT101)+' Pa';},'Sensirion SDP810-125Pa','I²C mux ch2 · 0x25','in'],
  ['PDT-102','HEPA filter ΔP',function(){return f0(m.s.PDT102)+' Pa';},'Sensirion SDP810-500Pa','I²C mux ch3 · 0x25','in'],
  ['TT-106','Clean-room temperature',function(){return sgn(m.s.TT106)+' °C';},'SHT31','I²C mux ch4 · 0x44','in'],
  ['MT-106','Clean-room humidity',function(){return f0(m.s.MT106)+' %';},'SHT31','I²C mux ch4','in'],
  ['TT-107','Return-air temperature',function(){return sgn(m.s.TT107)+' °C';},'DS18B20 probe','1-Wire B · GPIO16','in'],
  ['TT-108','Exhaust after the air-pump coil',function(){return sgn(m.s.TT108)+' °C';},'DS18B20 probe','1-Wire B · GPIO16','in'],
  ['CT-101','Current: air-pump compressor',function(){return f2(m.s.CT101)+' A';},'ACS712-05B on the PCB','ADC1_CH3 · GPIO4','in'],
  ['CT-102','Current: fans',function(){return f2(m.s.CT102)+' A';},'ACS712-05B on the PCB','ADC1_CH4 · GPIO5','in'],
  ['CT-103','Current: reheat + humidifier',function(){return f2(m.s.CT103)+' A';},'ACS712-05B on the PCB','ADC1_CH5 · GPIO6','in'],
  ['VT-101','DC bus voltage',function(){return f1(m.s.VT101)+' V';},'100 k / 10 k divider','ADC1_CH6 · GPIO7','in'],
  ['ACH','Air changes per hour',function(){return f1(m.kpi.ach)+' /h';},'FT-102 ÷ clean-room volume','calculated','calc'],
  ['FAN-101','Fresh-air compressor speed',function(){return f0(m.act.fa*100)+' %';},'24 V BLDC centrifugal blower','PWM GPIO38 · tach GPIO10','out'],
  ['FAN-102','Supply fan speed',function(){return f0(m.act.sf*100)+' %';},'24 V EC plug fan','PWM GPIO39 · tach GPIO11','out'],
  ['FAN-103','Exhaust fans speed',function(){return f0(m.act.ef*100)+' %';},'2 × 24 V EC fan (AHU + air-pump unit)','PWM GPIO40 · tach GPIO12','out'],
  ['SV-101','Mixing-damper servo',function(){return f0(m.act.dmp*90)+'°';},'MG996R servo, outdoor + recirc blades linked','50 Hz PWM GPIO21','out'],
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
  ['q','Supply airflow','m'],['fa','Fresh air','f'],['pw','Power now','p'],['red','Energy saving','g'],['co2','CO₂ footprint','r']
];
$('kbar').innerHTML=KPIS.map(function(k){
  return '<div class="kp '+k[2]+'"><div class="n">'+k[1]+'</div><div class="v" id="k-'+k[0]+'">–</div><div class="d" id="kd-'+k[0]+'">&nbsp;</div></div>';
}).join('');

/* Overview mimic */
$('pane-ov').innerHTML='<svg class="mimic" viewBox="0 0 1110 252" role="img" aria-label="Rig overview mimic">'+
 /* lines: fresh */
 '<path class="ln lf" d="M50 110H76M108 110H400"/><path class="ln lf" d="M190 110V165H215"/><path class="ln lf" d="M355 165H375V110"/>'+
 /* supply */
 '<path class="ln lm" d="M400 110H880"/><path class="ln lm" d="M880 110H902V40H1060V60M972 40V60"/>'+
 /* return + exhaust */
 '<path class="ln lr" d="M930 196H905V205H355"/><path class="ln lr" d="M490 205V112"/><path class="ln lr" d="M215 205H40"/>'+
 '<path class="flow" id="fl-f" d="M50 110H400"/><path class="flow" id="fl-s" d="M400 110H880H902V40H1060"/><path class="flow" id="fl-r" d="M930 196H905V205H40"/>'+
 /* compressor */
 '<circle cx="92" cy="110" r="16" class="box"/><path d="M82 104l20 12M82 116l20-12" stroke="var(--ink-dim)" stroke-width="2"/>'+
 '<text x="92" y="146" text-anchor="middle" class="lb">FAN-101</text><text x="92" y="161" text-anchor="middle" class="val" id="m-fan101">–</text>'+
 '<text x="8" y="96" class="lb">Outdoor</text>'+
 '<rect class="tag" x="118" y="62" width="104" height="32" rx="4"/><text x="126" y="75" class="lb">TT-101 · MT-101</text><text x="126" y="89" class="val" id="m-tt101">–</text>'+
 '<rect class="tag" x="226" y="62" width="84" height="32" rx="4"/><text x="234" y="75" class="lb">FT-101</text><text x="234" y="89" class="val" id="m-ft101">–</text>'+
 /* recovery unit */
 '<rect class="box" x="215" y="146" width="140" height="78" rx="4"/><text x="285" y="140" text-anchor="middle" class="lb">Air-pump unit</text>'+
 '<path d="M265 160l40 40M305 160l-40 40" stroke="var(--ink-dim)" stroke-width="2"/>'+
 '<rect x="238" y="194" width="12" height="22" fill="var(--refrig)" opacity=".55"/>'+
 '<text x="322" y="182" class="val" id="m-hr">–</text>'+
 '<text x="8" y="196" class="lb">Exhaust</text>'+
 '<rect class="tag" x="46" y="214" width="96" height="32" rx="4"/><text x="54" y="227" class="lb">TT-108</text><text x="54" y="241" class="val" id="m-tt108">–</text>'+
 /* AHU */
 '<rect class="unit" x="400" y="66" width="480" height="96" rx="6"/><text x="408" y="60" class="lb">AHU</text>'+
 '<path d="M418 98l24 24M442 98l-24 24" stroke="var(--ink-dim)" stroke-width="2"/><text x="430" y="152" text-anchor="middle" class="lb">Core</text>'+
 '<path d="M480 100l10 20M490 100l10 20M500 100l10 20" stroke="var(--ink)" stroke-width="2"/><text x="510" y="152" text-anchor="middle" class="lb">Mix</text>'+
 '<rect x="550" y="96" width="16" height="28" fill="var(--return)" opacity=".7" id="m-phc"/><text x="558" y="152" text-anchor="middle" class="lb">Pre-heat</text>'+
 '<rect x="602" y="96" width="16" height="28" fill="var(--fresh)" opacity=".7" id="m-ccc"/><text x="610" y="152" text-anchor="middle" class="lb">Cool</text>'+
 '<rect x="652" y="96" width="16" height="28" fill="var(--return)" opacity=".7" id="m-rhc"/><text x="660" y="152" text-anchor="middle" class="lb">Reheat</text>'+
 '<path d="M704 98v24M712 98v24M720 98v24" stroke="var(--fresh)" stroke-width="2"/><text x="712" y="152" text-anchor="middle" class="lb">Hum</text>'+
 '<circle cx="768" cy="110" r="14" class="box"/><path d="M760 104l16 12M760 116l16-12" stroke="var(--ink-dim)" stroke-width="2"/><text x="768" y="152" text-anchor="middle" class="lb">Fan</text>'+
 '<rect x="814" y="94" width="18" height="32" class="box"/><path d="M818 98l10 4-10 4 10 4-10 4 10 4-10 4" stroke="var(--ink-dim)" fill="none"/><text x="823" y="152" text-anchor="middle" class="lb">HEPA</text>'+
 '<text x="500" y="138" text-anchor="middle" class="val" id="m-dmp">–</text><text x="558" y="138" text-anchor="middle" class="val" id="m-ph">–</text>'+
 '<text x="610" y="138" text-anchor="middle" class="val" id="m-cc">–</text><text x="660" y="138" text-anchor="middle" class="val" id="m-rh">–</text>'+
 '<text x="712" y="138" text-anchor="middle" class="val" id="m-hum">–</text><text x="768" y="138" text-anchor="middle" class="val" id="m-sf">–</text>'+
 '<text x="823" y="138" text-anchor="middle" class="val" id="m-hepa">–</text>'+
 '<rect class="tag" x="440" y="14" width="84" height="32" rx="4"/><text x="448" y="27" class="lb">TT-102 mix</text><text x="448" y="41" class="val" id="m-tt102">–</text>'+
 '<rect class="tag" x="530" y="14" width="84" height="32" rx="4"/><text x="538" y="27" class="lb">TT-103 pre</text><text x="538" y="41" class="val" id="m-tt103">–</text>'+
 '<rect class="tag" x="620" y="14" width="84" height="32" rx="4"/><text x="628" y="27" class="lb">TT-104 coil</text><text x="628" y="41" class="val" id="m-tt104">–</text>'+
 '<rect class="tag" x="752" y="14" width="124" height="32" rx="4"/><text x="760" y="27" class="lb">TT-105 · MT-105 final</text><text x="760" y="41" class="val" id="m-tt105">–</text>'+
 '<path d="M482 46V100M572 46V100M662 46V100M840 46V100" stroke="var(--line)" stroke-dasharray="2 3"/>'+
 '<rect class="tag" x="910" y="4" width="84" height="30" rx="4"/><text x="918" y="16" class="lb">FT-102</text><text x="918" y="29" class="val" id="m-ft102">–</text>'+
 '<rect class="tag" x="800" y="214" width="96" height="32" rx="4"/><text x="808" y="227" class="lb">TT-107 return</text><text x="808" y="241" class="val" id="m-tt107">–</text>'+
 /* clean room */
 '<rect class="box" x="930" y="60" width="172" height="150" rx="4"/>'+
 '<rect x="962" y="60" width="20" height="5" fill="var(--mix)"/><rect x="1050" y="60" width="20" height="5" fill="var(--mix)"/>'+
 '<text x="1016" y="86" text-anchor="middle" class="lb">Clean room</text>'+
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
  {k:'L2',pv:function(){return f2(m.s.FT101)+' m³/h';},sp:function(){return f2(m.loops.L3.out*m.s.FT102)+' m³/h';},out:'FAN-101 fresh-air compressor',sens:'FT-101'},
  {k:'L3',pv:function(){return tC(m.s.TT102);},sp:function(){return tC(P[m.season].mix)+' · min '+P.oa+' % OA';},out:'SV-101 mixing-damper servo',sens:'TT-102'},
  {k:'L4',pv:function(){return tC(m.season==='winter'?m.s.TT103:m.s.TT104);},sp:function(){return tC(m.coilSP||P[m.season].coil);},out:'CMP-101 air-pump compressor',sens:'TT-103 / TT-104'},
  {k:'L5',pv:function(){return tC(m.s.TT105);},sp:function(){return tC(P[m.season].sup);},out:'HTR-101 reheat coil',sens:'TT-105'},
  {k:'L6',pv:function(){return f0(m.s.MT106)+' % RH';},sp:function(){return f0(P.rh)+' % RH';},out:'HUM-101 humidifier (winter) · coil reset (summer)',sens:'MT-106'},
  {k:'L7',pv:function(){return sgn(m.s.PDT101)+' Pa';},sp:function(){return '+'+f0(P.dp)+' Pa';},out:'FAN-103 exhaust fans',sens:'PDT-101'}
];
$('pane-lp').innerHTML='<div class="loops">'+LOOPS.map(function(l){
  var L=m.loops[l.k];
  return '<div class="loop" data-k="'+l.k+'"><h4>'+l.k+' · '+esc(L.name)+'</h4>'+
    '<div class="meta">sensor '+l.sens+' → '+esc(l.out)+' · PI Kp '+L.kp+' Ti '+L.ti+' s</div>'+
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
    '<p class="note">Baseline = the same rig, same airflow and set points, with the recovery cores bypassed: electric pre-heat in winter, a plain chiller (COP <span id="e-copb">–</span>) in summer, electric reheat.</p></div>'+
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
    '<div class="kv"><span>Recovered by the two cores</span><b id="e-qrec">–</b></div>'+
    '<div class="kv"><span>Desuperheater reheat (free)</span><b id="e-dsh">–</b></div>'+
    '<div class="kv"><span>To outdoor condenser</span><b id="e-out">–</b></div></div>'+
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
  {id:'tc',title:'Air temperatures (°C)',ser:[['TT101','TT-101 fresh','--s1'],['TT102','TT-102 mix','--s2'],['TT103','TT-103 pre-heat','--s3'],['TT105','TT-105 final','--s4'],['TT106','TT-106 room','--s5']],unit:'°C',dec:1},
  {id:'rh',title:'Relative humidity (%)',ser:[['MT105','MT-105 supply','--s1'],['MT106','MT-106 room','--s2']],unit:'%',dec:0},
  {id:'pw',title:'Electrical power (W)',ser:[['P','This rig','--s3'],['Pb','Baseline (no recovery)','--s2']],unit:'W',dec:1},
  {id:'ach',title:'Clean-room ACH (1/h)',ser:[['ACH','ACH','--s1']],unit:'/h',dec:1},
  {id:'dp',title:'Clean-room pressure (Pa)',ser:[['DP','PDT-101','--s1']],unit:'Pa',dec:1}
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
    if(c.id==='ach'||c.id==='pw'){ lo=Math.min(lo,0); }
    var pad=(hi-lo)*0.12||1; lo-=pad; hi+=pad;
    if(c.id==='ach'||c.id==='pw') lo=Math.max(0,lo);
    var X0=30,X1=316,Y0=8,Y1=106, t0=d[0].t, t1=d[d.length-1].t;
    function X(t){ return X0+(X1-X0)*(t-t0)/Math.max(t1-t0,1); }
    function Y(v){ return Y1-(Y1-Y0)*(v-lo)/(hi-lo); }
    var h='';
    for(var g=0;g<=3;g++){ var v=lo+(hi-lo)*g/3, y=Y(v);
      h+='<line x1="'+X0+'" x2="'+X1+'" y1="'+y+'" y2="'+y+'" stroke="var(--line-soft)" stroke-width="1"/>'+
         '<text x="'+(X0-4)+'" y="'+(y+3)+'" text-anchor="end">'+(Math.abs(hi-lo)<10?v.toFixed(1):Math.round(v))+'</text>'; }
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
      return '<div><i style="display:inline-block;width:10px;height:2px;background:var('+s[2]+');vertical-align:middle;margin-right:5px"></i>'+s[1]+' <b>'+best[s[0]].toFixed(c.dec)+' '+c.unit+'</b></div>'; }).join('');
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
  hmiEl.classList.toggle('collapsed',!open);
  $('btnHmi').textContent=open?'Collapse':'Open HMI';
  $('btnHmi').setAttribute('aria-expanded',String(open));
  setTimeout(resize,30);
}
$('btnHmi').addEventListener('click',function(){ setHmiOpen(hmiEl.classList.contains('collapsed')); });
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
  setText('k-q',f2(s.FT102)+' m³/h'); setText('kd-q','set '+f2(P.flow));
  setText('k-fa',f0(k.f*100)+' %'); setText('kd-fa',f2(s.FT101)+' m³/h');
  setText('k-pw',f1(pw.total)+' W'); setText('kd-pw',f2(pw.total/P.volt)+' A @ '+f0(P.volt)+' V');
  setText('k-red',(m.recovery?f0(k.red*100):'0')+' %'); setText('kd-red','baseline '+f1(pw.base)+' W');
  setText('k-co2',f1(k.co2h)+' g/h'); setText('kd-co2','saves '+f1(Math.max(0,k.co2hBase-k.co2h))+' g/h');
  var al=m.alarms.length; $('pAl').hidden=!al; setText('pAlT',al+' alarm'+(al===1?'':'s')); $('pAl').className='pill al';
  if(hmiEl.classList.contains('collapsed') && !force) return;
  if(activePane==='ov'){
    setText('m-fan101',f0(m.act.fa*100)+' %'); setText('m-tt101',tC(s.TT101)+' · '+f0(s.MT101)+' %'); setText('m-ft101',f2(s.FT101)+' m³/h');
    setText('m-hr',m.recovery?f0(P.e1)+' %':'bypass');
    setText('m-tt108',tC(s.TT108));
    setText('m-dmp',f0(m.act.dmp*90)+'°'); setText('m-ph',f0((m.season==='winter'?m.act.cmp:0)*100)+'%');
    setText('m-cc',f0((m.season==='summer'?m.act.cmp:0)*100)+'%'); setText('m-rh',f0(m.act.rh*100)+'%');
    setText('m-hum',f0(m.act.hum*100)+'%'); setText('m-sf',f0(m.act.sf*100)+'%'); setText('m-hepa',f0(s.PDT102)+' Pa');
    setText('m-tt102',tC(s.TT102)); setText('m-tt103',tC(s.TT103)); setText('m-tt104',tC(s.TT104));
    setText('m-tt105',tC(s.TT105)+' · '+f0(s.MT105)+' %'); setText('m-ft102',f2(s.FT102)+' m³/h'); setText('m-tt107',tC(s.TT107));
    setText('m-ach',f1(k.ach)+' ACH'); setText('m-room',tC(s.TT106)+' · '+f0(s.MT106)+' % RH');
    setText('m-dp',sgn(s.PDT101)+' Pa'); setText('m-vol','V = '+RigModel.ROOM.V.toFixed(4)+' m³');
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
  var chain=[['OA',s.TT101],['MIX',s.TT102],['PRE',s.TT103],['COIL',s.TT104],['SUP',s.TT105],['ROOM',s.TT106]];
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
    'FAN-101':['FAN-101 comp.',f0(A.fa*100)+' %'], 'TT-102':['TT-102 mix',sgn(s.TT102)+' °C'],
    'TT-103':['TT-103 pre-heat',sgn(s.TT103)+' °C'], 'TT-104':['TT-104 coil',sgn(s.TT104)+' °C'],
    'TT-105':['TT-105 final',sgn(s.TT105)+'° '+f0(s.MT105)+'%'], 'TT-107':['TT-107 return',sgn(s.TT107)+' °C'],
    'PDT-102':['PDT-102 HEPA',f0(s.PDT102)+' Pa'], 'SV-101':['SV-101 damper',f0(A.dmp*90)+'°'],
    'FAN-102':['FAN-102 supply',f0(A.sf*100)+' %'], 'CMP-101':['CMP-101 R32',f0(A.cmp*100)+' %'],
    'FAN-103':['FAN-103 exhaust',f0(A.ef*100)+' %'], 'TT-108':['TT-108 exhaust',sgn(s.TT108)+' °C'],
    'FT-102':['FT-102 supply',f2(s.FT102)+' m³/h'], 'TT-106':['TT-106 · MT-106',sgn(s.TT106)+'° '+f0(s.MT106)+'%'],
    'PDT-101':['PDT-101 room',sgn(s.PDT101)+' Pa'], 'ACH':['ACH = Q ÷ V',f1(m.kpi.ach)+' /h'],
    'CT':['CT-101…103',f2(s.CT101+s.CT102+s.CT103)+' A']
  };
  TAGS.forEach(function(t){
    var d=map[t.id]; if(!d) return;
    var al=(t.id==='PDT-101'&&(alarmIds.A02||alarmIds.A03))||(t.id==='TT-108'&&alarmIds.A05)||(t.id==='FT-102'&&alarmIds.A01);
    drawTag(t,d[0],d[1],al?'alarm':'');
  });
}

/* actuator visuals: fans, damper blades, coils, refrigerant, bypass */
var _q=new THREE.Quaternion(), _up=new THREE.Vector3(0,1,0);
var raBase=new THREE.Vector3(MIXX,0.15,Z1+0.43);
function actuatorVisuals(){
  var A=m.act, f=A.dmp;
  dmpOA.forEach(function(b){ b.rotation.z=0.1+f*(Math.PI/2-0.1); });
  dmpRA.forEach(function(b){ b.rotation.z=(1-f)*(Math.PI/2); });
  var sv=window.__servo; if(sv){
    var ang=-Math.PI/4+f*Math.PI/2; sv.horn.rotation.z=ang;
    var tip=new THREE.Vector3(Math.cos(ang)*0.5,Math.sin(ang)*0.5,0).add(sv.horn.position);
    var dv=raBase.clone().sub(tip), L=dv.length();
    sv.rod.position.copy(tip).addScaledVector(dv,0.5); sv.rod.scale.set(1,L,1);
    sv.rod.quaternion.copy(_q.setFromUnitVectors(_up,dv.normalize()));
  }
  if(bypassGroup){ for(var i=0;i<5;i++) bypassGroup.children[i].rotation.z=m.recovery?0.06:1.5; }
  var roles=coilRoles();
  var out={preheat:m.season==='winter'?A.cmp:0,cooling:m.season==='summer'?A.cmp:0,reheat:A.rh,
           extract:m.recovery?A.cmp:0};
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
var SPIN={'Supply fan':'sf','Extract transfer fan':'ef','Tempered-air fan':'fa','Exhaust fan':'ef'};

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
seg('segColor',function(v){ colorMode=v; $('keysStream').hidden=v==='temp'; $('keysTemp').hidden=v!=='temp'; refreshPathColors(m.a); colorRibbons(); });
seg('segHrv',function(v){ m.hrv=v; applyHrv(); });
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
cb('cbTags',function(v){ tagGroup.visible=v; });
cb('cbPcb',function(v){ traceGroup.visible=v; sigDots.obj.visible=v && $('cbSignals').checked; });
cb('cbSignals',function(v){ sigDots.obj.visible=v && $('cbPcb').checked; });
cb('cbModule',function(v){ modUnit.visible=v; });
cb('cbAux',function(v){ aux.visible=v; });
cb('cbDoors',function(v){ state.doors=v; doors.visible=v && state.casing!=='off'; });
cb('cbRefrig',function(v){ state.refrig=v; refrig.visible=v; refDots.obj.visible=v; });
cb('cbDucts',function(v){ state.ducts=v; ducts.visible=v; rigDucts.visible=v; });
cb('cbSpin',function(v){ state.spin=v; });
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
  ['inFlow','flow',false,0.5,20],['inOa','oa',false,0,100],['inSplit','split',false,0,100],
  ['inE1','e1',false,0,90],['inE2','e2',false,0,90],['inRh','rh',false,20,70],['inDp','dp',false,0,50],
  ['inGain','gain',false,0,40],['inAmb','amb',false,0,45],['inUa','ua',false,0,20],['inVolt','volt',false,5,60],
  ['inEf','ef',false,0,1.5],['inCop','cop',false,1,8],['inHours','hours',false,100,8760],
  ['inOat','oat',true,-30,55],['inOrh','orh',true,0,100],['inMix','mix',true,0,40],['inCoil','coil',true,4,40],['inSup','sup',true,8,40]
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
  M.panel.color=T.metal.clone(); M.frame.color=T.metalDark.clone();
  M.inner.color=T.metal.clone(); M.base.color=T.metalDark.clone();
  M.duct.color=T.metal.clone(); M.refrig.color=T.refrig.clone();
  MR.acrylic.color=T.acrylic.clone(); MR.acrylicEdge.color=T.acrylic.clone(); MR.pvc.color=T.metal.clone();
  MR.pcb.color=T.pcb.clone(); MR.copper.color=T.copper.clone();
  refDots.mat.color=T.refrig.clone(); leaderMat.color=T.metalDark.clone();
  buildRibbons(); buildArrows(); refreshPathColors(m.a); colorRibbons();
  ribbons.visible=$('cbRibbon').checked && state.explode<0.25;
  arrows.visible=$('cbArrows').checked;
  TAGS.forEach(function(t){ t.last=''; });
  refreshLabels();
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
  function visible(o){ for(var p=o;p;p=p.parent){ if(!p.visible) return false; } return true; }
  function partOf(o){ for(var p=o;p;p=p.parent){ if(p.userData && p.userData.part) return p.userData.part; } return 'Misc'; }
  function asmOf(o){ for(var p=o;p;p=p.parent){ if(p.userData && p.userData.asm) return p.userData.asm; } return 'Rig'; }
  function matOf(mm){ var mt=Array.isArray(mm)?mm[4]||mm[0]:mm; var c=(mt.map&&!mt.isMeshBasicMaterial)?T.pcb:(mt.color||new THREE.Color(1,1,1));
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
  return {ref:Math.max(P.flow,0.5),Qfa:a.Qfa||0,Qhr:(a.Qhr||0)*1.6,Qdir:(a.Qdir||0)*1.6,Qrec:a.Qrec||0,
    Qsup:a.Qsup||0,Qret:Math.max(0,(a.Qsup||0)-(a.Qleak||0)),Qex:a.Qex||0};
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
  if(state.playing){
    var sdt=dt*state.simSpeed, n=Math.min(400,Math.max(1,Math.ceil(sdt/0.05)));
    for(var i=0;i<n;i++) RigModel.step(m,sdt/n);
    var fl=flows();
    for(var j=0;j<STREAMS.length;j++) updateStream(STREAMS[j],dt,state.speed,fl);
    var cmpOn=m.act.cmp>0.01 && (m.recovery || m.season==='summer');
    refDots.obj.visible=state.refrig && cmpOn;
    if(state.refrig && cmpOn) updateRefrig(dt,state.speed*(0.4+m.act.cmp),MODE[state.season].dir);
    if(state.spin){
      spinners.forEach(function(s){
        if(s.obj.visible===false) return;
        var u=s.id==='wheel'?(m.recovery?1:0):(SPIN[s.id]?m.act[SPIN[s.id]]:1);
        s.obj.rotation[s.axis]+=dt*s.rate*state.speed*u*1.6;
      });
      compRotor.rotation.x+=dt*14*m.act.fa*state.speed;
    }
    if(sigDots.obj.visible) updateSignals(dt);
    actuatorVisuals();
  }
  uiT+=dt; scrT+=dt; colT+=dt;
  if(uiT>0.25){ uiT=0; updateHMI(); if(tagGroup.visible) updateTags(); }
  if(scrT>0.5){ scrT=0; drawScreen(); }
  if(colorMode==='temp' && colT>0.4){ colT=0; refreshPathColors(m.a); colorRibbons(); }
  renderer.render(scene,camera);
}

if(document.fonts && document.fonts.ready) document.fonts.ready.then(function(){ refreshLabels(); TAGS.forEach(function(t){ t.last=''; }); });
for(var w0=0;w0<200;w0++) RigModel.step(m,0.05);               // let the loops settle before the first frame
refreshPathColors(m.a); colorRibbons();
applySeason(); applyHrv(); applyCasing(); applyExplode(); applyBox('clear');
if(window.innerHeight<700 || window.innerWidth<760) setHmiOpen(false);
resize();
var fl0=flows(); for(var s0=0;s0<STREAMS.length;s0++) updateStream(STREAMS[s0],0,0,fl0);
updateRefrig(0,0,1); updateSignals(0); actuatorVisuals(); updateHMI(true); updateTags(); drawScreen();
window.__rig={model:m,goView:goView,state:state};
frame();
})();
