import * as THREE from 'three';
import {OrbitControls} from 'https://cdn.jsdelivr.net/npm/three@0.185.0/examples/jsm/controls/OrbitControls.js';

const viewer=document.querySelector('#viewer');
const status=document.querySelector('#status');
const description=document.querySelector('#description');

let rig=null;
let names=[];
let parents=[];
let neutral=[];
let index=new Map();
let children=[];
let joints=[];
let bones=[];
let currentPose=null;

const scene=new THREE.Scene();scene.background=new THREE.Color(0x070b16);
const camera=new THREE.PerspectiveCamera(38,1,.01,100);camera.position.set(2.7,2.1,3.5);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));viewer.appendChild(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.target.set(0,1,0);
scene.add(new THREE.HemisphereLight(0xc9dcff,0x1a2235,2.5));const light=new THREE.DirectionalLight(0xffffff,2.5);light.position.set(3,5,4);scene.add(light);
scene.add(new THREE.GridHelper(6,24,0x6f83ad,0x29324a));
const group=new THREE.Group();scene.add(group);
const jointGeo=new THREE.SphereGeometry(.032,16,12),headGeo=new THREE.SphereGeometry(.11,22,16),boneGeo=new THREE.CylinderGeometry(.018,.018,1,10);
const jointMat=new THREE.MeshStandardMaterial({color:0x9ad7ff}),headMat=new THREE.MeshStandardMaterial({color:0xe7efff}),boneMat=new THREE.MeshStandardMaterial({color:0x6f8fe0}),accentMat=new THREE.MeshStandardMaterial({color:0xc091ff});

function validateRig(payload){
  const required=['joint_names','joint_parents','neutral_joints','root_idx'];
  for(const key of required)if(!(key in payload))throw new Error(`骨格JSONに ${key} がありません`);
  const count=payload.joint_names.length;
  if(payload.joint_parents.length!==count||payload.neutral_joints.length!==count)throw new Error('骨格JSONの配列長が一致しません');
  if(payload.root_idx<0||payload.root_idx>=count)throw new Error('root_idx が不正です');
  payload.joint_parents.forEach((p,i)=>{if(p>=count||p===i)throw new Error(`joint_parents[${i}] が不正です`)});
}

function installRig(payload,label='rig JSON'){
  validateRig(payload);
  rig=payload;
  names=[...payload.joint_names];
  parents=payload.joint_parents.map(Number);
  neutral=payload.neutral_joints.map(v=>new THREE.Vector3(...v));
  index=new Map(names.map((n,i)=>[n,i]));
  children=names.map(()=>[]);parents.forEach((p,i)=>{if(p>=0)children[p].push(i)});
  group.clear();
  joints=names.map((n)=>{const m=new THREE.Mesh(n==='Head'?headGeo:jointGeo,n==='Head'?headMat:jointMat);group.add(m);return m});
  bones=[];parents.forEach((p,i)=>{if(p>=0){const m=new THREE.Mesh(boneGeo,/Hand|Foot|Toe|Head/.test(names[i])?accentMat:boneMat);m.userData={p,i};group.add(m);bones.push(m)}});
  currentPose=neutral.map(v=>v.clone());
  status.textContent=`${label} / ${names.length} joints`;
  renderPose(currentPose);
}

function descendants(root){const out=[];const stack=[...children[root]];while(stack.length){const i=stack.pop();out.push(i);stack.push(...children[i])}return out}
function quatFromAxis(axis,degrees){return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis).normalize(),THREE.MathUtils.degToRad(degrees))}
function rotateSubtree(pose,joint,q){const j=index.get(joint);if(j===undefined)throw new Error(`関節 ${joint} がありません`);const pivot=pose[j].clone();for(const i of descendants(j))pose[i].sub(pivot).applyQuaternion(q).add(pivot)}
function aimBone(pose,joint,child,direction){const j=index.get(joint),c=index.get(child);if(j===undefined||c===undefined)throw new Error(`aim_bone の関節名が不正です: ${joint} → ${child}`);const from=pose[c].clone().sub(pose[j]).normalize();const to=new THREE.Vector3(...direction).normalize();rotateSubtree(pose,joint,new THREE.Quaternion().setFromUnitVectors(from,to))}

function compileRecipe(payload){
  const frame=payload.frames?.[0];if(!frame)throw new Error('frames[0] がありません');
  const pose=neutral.map(v=>v.clone());
  for(const op of frame.operations||[]){
    if(op.op==='set_root'){const root=Number(rig.root_idx);const off=new THREE.Vector3(...op.position).sub(pose[root]);pose.forEach(v=>v.add(off));}
    else if(op.op==='rotate_subtree')rotateSubtree(pose,op.joint,quatFromAxis(op.axis,op.degrees));
    else if(op.op==='aim_bone')aimBone(pose,op.joint,op.child,op.direction);
    else if(op.op==='translate_all'){const off=new THREE.Vector3(...op.offset);pose.forEach(v=>v.add(off));}
    else if(op.op==='translate_subtree'){const j=index.get(op.joint);if(j===undefined)throw new Error(`関節 ${op.joint} がありません`);const off=new THREE.Vector3(...op.offset);for(const i of [j,...descendants(j)])pose[i].add(off);}
    else if(op.op==='set_joint_position'){const j=index.get(op.joint);if(j===undefined)throw new Error(`関節 ${op.joint} がありません`);pose[j].set(...op.position);}
    else throw new Error(`未対応の操作: ${op.op}`);
  }
  return pose;
}

function positionsFromPayload(payload){
  const source=payload.positions||payload.fitted_positions||payload.requested_positions;
  if(!source)return null;
  const first=Array.isArray(source[0]?.[0])?source[0]:source;
  if(!Array.isArray(first)||!Array.isArray(first[0]))throw new Error('関節座標の形式が不正です');
  const sourceNames=payload.joint_names||names;
  const byName=new Map(sourceNames.map((n,i)=>[n,first[i]]));
  return names.map((n,i)=>new THREE.Vector3(...(byName.get(n)||neutral[i].toArray())));
}

function renderPose(pose){
  pose.forEach((p,i)=>joints[i].position.copy(p));
  const up=new THREE.Vector3(0,1,0);
  for(const b of bones){const a=pose[b.userData.p],c=pose[b.userData.i],d=c.clone().sub(a);b.position.copy(a).addScaledVector(d,.5);b.quaternion.setFromUnitVectors(up,d.clone().normalize());b.scale.set(1,d.length(),1)}
  currentPose=pose;fit(pose);
}
function fit(pose,view='iso'){const box=new THREE.Box3().setFromPoints(pose),sphere=box.getBoundingSphere(new THREE.Sphere()),r=Math.max(sphere.radius,.7),dist=r/Math.sin(THREE.MathUtils.degToRad(camera.fov/2))*1.2;const dirs={iso:[.75,.45,.75],front:[0,.03,1],side:[1,.03,0],top:[0,1,.001]};camera.up.set(0,view==='top'?0:1,view==='top'?-1:0);camera.position.copy(sphere.center).addScaledVector(new THREE.Vector3(...dirs[view]).normalize(),dist);controls.target.copy(sphere.center);controls.update()}

async function loadPayload(payload,label='JSON'){
  if(payload.joint_names&&payload.joint_parents&&payload.neutral_joints){installRig(payload,label);description.textContent=payload.skeleton_name||label;return;}
  const pose=positionsFromPayload(payload)||compileRecipe(payload);
  description.textContent=payload.description||label;
  status.textContent=`${label} / ${names.length} joints / ${rig?.skeleton_name||'rig'}`;
  renderPose(pose);
}
async function loadSample(){const r=await fetch('./poses/happy-wave-pose.json',{cache:'no-cache'});if(!r.ok)throw new Error('サンプルJSONを読めません');await loadPayload(await r.json(),'happy-wave-pose.json')}
async function loadDefaultRig(){const r=await fetch('./skeletons/generic-humanoid.json',{cache:'no-cache'});if(!r.ok)throw new Error('既定リグJSONを読めません');installRig(await r.json(),'generic-humanoid.json')}

function resize(){const w=viewer.clientWidth,h=viewer.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}
new ResizeObserver(resize).observe(viewer);
document.querySelector('#sample').onclick=()=>loadSample().catch(e=>status.textContent=e.message);
document.querySelector('#file').onchange=async e=>{try{const f=e.target.files[0];if(f)await loadPayload(JSON.parse(await f.text()),f.name)}catch(err){status.textContent=err.message}};
document.querySelector('#rig-file').onchange=async e=>{try{const f=e.target.files[0];if(f)installRig(JSON.parse(await f.text()),f.name)}catch(err){status.textContent=err.message}};
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>fit(currentPose||neutral,b.dataset.view));
function animate(){requestAnimationFrame(animate);controls.update();renderer.render(scene,camera)}
resize();animate();
loadDefaultRig().then(loadSample).catch(e=>status.textContent=e.message);
