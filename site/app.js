import * as THREE from 'three';
import {OrbitControls} from 'https://cdn.jsdelivr.net/npm/three@0.185.0/examples/jsm/controls/OrbitControls.js';

const viewer = document.querySelector('#viewer');
const status = document.querySelector('#status');
const description = document.querySelector('#description');
const quality = document.querySelector('#quality');
const poseSelect = document.querySelector('#pose-select');

let rig = null;
let names = [];
let parents = [];
let neutral = [];
let index = new Map();
let children = [];
let joints = [];
let bones = [];
let currentPose = null;
let currentPayload = null;
let pelvisMesh = null;
let chestMesh = null;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070b16);

const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
camera.position.set(2.7, 2.1, 3.5);

const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
viewer.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1, 0);

scene.add(new THREE.HemisphereLight(0xc9dcff, 0x1a2235, 2.5));
const light = new THREE.DirectionalLight(0xffffff, 2.5);
light.position.set(3, 5, 4);
scene.add(light);
scene.add(new THREE.GridHelper(6, 24, 0x6f83ad, 0x29324a));

const skeletonGroup = new THREE.Group();
const bodyGroup = new THREE.Group();
const contactGroup = new THREE.Group();
scene.add(bodyGroup, skeletonGroup, contactGroup);

const jointGeo = new THREE.SphereGeometry(0.032, 16, 12);
const headGeo = new THREE.SphereGeometry(0.11, 22, 16);
const boneGeo = new THREE.CylinderGeometry(0.018, 0.018, 1, 10);
const volumeGeo = new THREE.SphereGeometry(1, 24, 16);
const contactGeo = new THREE.SphereGeometry(0.035, 16, 12);

const jointMat = new THREE.MeshStandardMaterial({color: 0x9ad7ff});
const headMat = new THREE.MeshStandardMaterial({color: 0xe7efff});
const boneMat = new THREE.MeshStandardMaterial({color: 0x6f8fe0});
const accentMat = new THREE.MeshStandardMaterial({color: 0xc091ff});
const pelvisMat = new THREE.MeshStandardMaterial({
  color: 0x8f78ff,
  transparent: true,
  opacity: 0.24,
  depthWrite: false
});
const chestMat = new THREE.MeshStandardMaterial({
  color: 0x66b8ff,
  transparent: true,
  opacity: 0.18,
  depthWrite: false
});
const contactMat = new THREE.MeshStandardMaterial({
  color: 0x63ff9a,
  emissive: 0x174d28,
  emissiveIntensity: 1.6
});

function validateRig(payload) {
  const required = ['joint_names', 'joint_parents', 'neutral_joints', 'root_idx'];
  for (const key of required) {
    if (!(key in payload)) throw new Error(`骨格JSONに ${key} がありません`);
  }
  const count = payload.joint_names.length;
  if (payload.joint_parents.length !== count || payload.neutral_joints.length !== count) {
    throw new Error('骨格JSONの配列長が一致しません');
  }
  if (payload.root_idx < 0 || payload.root_idx >= count) throw new Error('root_idx が不正です');
  payload.joint_parents.forEach((parent, joint) => {
    if (parent >= count || parent === joint) throw new Error(`joint_parents[${joint}] が不正です`);
  });
}

function installRig(payload, label = 'rig JSON') {
  validateRig(payload);
  rig = payload;
  names = [...payload.joint_names];
  parents = payload.joint_parents.map(Number);
  neutral = payload.neutral_joints.map((value) => new THREE.Vector3(...value));
  index = new Map(names.map((name, joint) => [name, joint]));
  children = names.map(() => []);
  parents.forEach((parent, joint) => {
    if (parent >= 0) children[parent].push(joint);
  });

  skeletonGroup.clear();
  bodyGroup.clear();

  joints = names.map((name) => {
    const mesh = new THREE.Mesh(name === 'Head' ? headGeo : jointGeo, name === 'Head' ? headMat : jointMat);
    skeletonGroup.add(mesh);
    return mesh;
  });

  bones = [];
  parents.forEach((parent, joint) => {
    if (parent < 0) return;
    const mesh = new THREE.Mesh(
      boneGeo,
      /Hand|Foot|Toe|Head/.test(names[joint]) ? accentMat : boneMat
    );
    mesh.userData = {parent, joint};
    skeletonGroup.add(mesh);
    bones.push(mesh);
  });

  if (index.has('Hips')) {
    pelvisMesh = new THREE.Mesh(volumeGeo, pelvisMat);
    bodyGroup.add(pelvisMesh);
  } else {
    pelvisMesh = null;
  }

  if (index.has('Chest')) {
    chestMesh = new THREE.Mesh(volumeGeo, chestMat);
    bodyGroup.add(chestMesh);
  } else {
    chestMesh = null;
  }

  currentPose = neutral.map((value) => value.clone());
  currentPayload = null;
  quality.textContent = '';
  status.textContent = `${label} / ${names.length} joints`;
  renderPose(currentPose, null);
}

function descendants(root) {
  const found = [];
  const stack = [...children[root]];
  while (stack.length) {
    const joint = stack.pop();
    found.push(joint);
    stack.push(...children[joint]);
  }
  return found;
}

function quatFromAxis(axis, degrees) {
  return new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(...axis).normalize(),
    THREE.MathUtils.degToRad(degrees)
  );
}

function rotateSubtree(pose, jointName, quaternion) {
  const joint = index.get(jointName);
  if (joint === undefined) throw new Error(`関節 ${jointName} がありません`);
  const pivot = pose[joint].clone();
  for (const descendant of descendants(joint)) {
    pose[descendant].sub(pivot).applyQuaternion(quaternion).add(pivot);
  }
}

function aimBone(pose, jointName, childName, direction) {
  const joint = index.get(jointName);
  const child = index.get(childName);
  if (joint === undefined || child === undefined) {
    throw new Error(`aim_bone の関節名が不正です: ${jointName} → ${childName}`);
  }
  const from = pose[child].clone().sub(pose[joint]).normalize();
  const to = new THREE.Vector3(...direction).normalize();
  rotateSubtree(pose, jointName, new THREE.Quaternion().setFromUnitVectors(from, to));
}

function compileRecipe(payload) {
  const frame = payload.frames?.[0];
  if (!frame) throw new Error('frames[0] がありません');
  const pose = neutral.map((value) => value.clone());

  for (const operation of frame.operations || []) {
    if (operation.op === 'set_root') {
      const root = Number(rig.root_idx);
      const offset = new THREE.Vector3(...operation.position).sub(pose[root]);
      pose.forEach((value) => value.add(offset));
    } else if (operation.op === 'rotate_subtree') {
      rotateSubtree(pose, operation.joint, quatFromAxis(operation.axis, operation.degrees));
    } else if (operation.op === 'aim_bone') {
      aimBone(pose, operation.joint, operation.child, operation.direction);
    } else if (operation.op === 'translate_all') {
      const offset = new THREE.Vector3(...operation.offset);
      pose.forEach((value) => value.add(offset));
    } else if (operation.op === 'translate_subtree') {
      const joint = index.get(operation.joint);
      if (joint === undefined) throw new Error(`関節 ${operation.joint} がありません`);
      const offset = new THREE.Vector3(...operation.offset);
      for (const descendant of [joint, ...descendants(joint)]) pose[descendant].add(offset);
    } else if (operation.op === 'set_joint_position') {
      const joint = index.get(operation.joint);
      if (joint === undefined) throw new Error(`関節 ${operation.joint} がありません`);
      pose[joint].set(...operation.position);
    } else {
      throw new Error(`未対応の操作: ${operation.op}`);
    }
  }
  return pose;
}

function positionsFromPayload(payload) {
  const source = payload.positions || payload.fitted_positions || payload.requested_positions;
  if (!source) return null;
  const first = Array.isArray(source[0]?.[0]) ? source[0] : source;
  if (!Array.isArray(first) || !Array.isArray(first[0])) throw new Error('関節座標の形式が不正です');
  const sourceNames = payload.joint_names || names;
  const byName = new Map(sourceNames.map((name, joint) => [name, first[joint]]));
  return names.map((name, joint) => new THREE.Vector3(...(byName.get(name) || neutral[joint].toArray())));
}

function renderContacts(payload) {
  contactGroup.clear();
  const points = payload?.contact_points;
  if (!points || typeof points !== 'object') return;

  for (const [label, value] of Object.entries(points)) {
    if (!Array.isArray(value) || value.length !== 3) continue;
    const marker = new THREE.Mesh(contactGeo, contactMat);
    marker.position.set(...value);
    marker.userData.label = label;
    contactGroup.add(marker);
  }
}

function updateBodyVolumes(pose) {
  const up = new THREE.Vector3(0, 1, 0);

  if (pelvisMesh && index.has('Hips')) {
    const hips = pose[index.get('Hips')];
    pelvisMesh.position.copy(hips);
    pelvisMesh.scale.set(0.18, 0.18, 0.13);

    if (index.has('Spine1')) {
      const spineDirection = pose[index.get('Spine1')].clone().sub(hips).normalize();
      pelvisMesh.quaternion.setFromUnitVectors(up, spineDirection);
    }
  }

  if (chestMesh && index.has('Chest')) {
    const chest = pose[index.get('Chest')];
    chestMesh.position.copy(chest);
    chestMesh.scale.set(0.23, 0.19, 0.14);

    if (index.has('Spine2')) {
      const chestDirection = chest.clone().sub(pose[index.get('Spine2')]).normalize();
      chestMesh.quaternion.setFromUnitVectors(up, chestDirection);
    }
  }
}

function renderPose(pose, payload = null) {
  pose.forEach((position, joint) => joints[joint].position.copy(position));

  const up = new THREE.Vector3(0, 1, 0);
  for (const bone of bones) {
    const start = pose[bone.userData.parent];
    const end = pose[bone.userData.joint];
    const direction = end.clone().sub(start);
    bone.position.copy(start).addScaledVector(direction, 0.5);
    bone.quaternion.setFromUnitVectors(up, direction.clone().normalize());
    bone.scale.set(1, direction.length(), 1);
  }

  updateBodyVolumes(pose);
  renderContacts(payload);
  currentPose = pose;
  currentPayload = payload;
  fit(pose);
}

function fit(pose, view = 'iso') {
  if (!pose?.length) return;
  const box = new THREE.Box3().setFromPoints(pose);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 0.7);
  const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.2;
  const directions = {
    iso: [0.75, 0.45, 0.75],
    front: [0, 0.03, 1],
    side: [1, 0.03, 0],
    top: [0, 1, 0.001]
  };
  const direction = directions[view] || directions.iso;
  camera.up.set(0, view === 'top' ? 0 : 1, view === 'top' ? -1 : 0);
  camera.position.copy(sphere.center).addScaledVector(new THREE.Vector3(...direction).normalize(), distance);
  controls.target.copy(sphere.center);
  controls.update();
}

function qualityText(payload) {
  const review = payload?.review;
  if (!review) return '';
  const viewCount = Array.isArray(review.views_checked) ? review.views_checked.length : 0;
  const boneError = Number(review.max_bone_length_error_percent ?? 0);
  const penetration = Number(review.joint_floor_penetrations ?? 0);
  return `品質ゲート: ${review.status} / ${viewCount}視点確認 / 骨長誤差 ${boneError.toFixed(6)}% / 床下関節 ${penetration}`;
}

async function loadPayload(payload, label = 'JSON') {
  if (payload.joint_names && payload.joint_parents && payload.neutral_joints) {
    installRig(payload, label);
    description.textContent = payload.skeleton_name || label;
    return;
  }
  const pose = positionsFromPayload(payload) || compileRecipe(payload);
  description.textContent = payload.display_name
    ? `${payload.display_name} — ${payload.description || ''}`
    : (payload.description || label);
  quality.textContent = qualityText(payload);
  status.textContent = `${label} / ${names.length} joints / ${rig?.skeleton_name || 'rig'}`;
  renderPose(pose, payload);
}

function normalizePoseParam(value) {
  if (!value) return null;
  const safe = value.replace(/[^A-Za-z0-9._-]/g, '');
  return safe.endsWith('.json') ? safe : `${safe}.json`;
}

function poseFromUrl() {
  const requested = normalizePoseParam(new URL(location.href).searchParams.get('pose'));
  if (!requested) return null;
  const option = [...poseSelect.options].find((item) => item.value === requested);
  return option ? requested : null;
}

function viewFromUrl() {
  const requested = new URL(location.href).searchParams.get('view');
  return ['iso', 'front', 'side', 'top'].includes(requested) ? requested : 'iso';
}

function updateUrl({pose = null, view = null} = {}) {
  const url = new URL(location.href);
  if (pose) url.searchParams.set('pose', pose.replace(/\.json$/i, ''));
  if (view) url.searchParams.set('view', view);
  history.replaceState(null, '', url);
}

async function loadNamedPose(filename) {
  const response = await fetch(`./poses/${filename}`, {cache: 'no-cache'});
  if (!response.ok) throw new Error(`${filename} を読めません`);
  await loadPayload(await response.json(), filename);
}

async function loadSelectedPose(updateAddress = true) {
  await loadNamedPose(poseSelect.value);
  if (updateAddress) updateUrl({pose: poseSelect.value});
}

async function loadDefaultRig() {
  const response = await fetch('./skeletons/generic-humanoid.json', {cache: 'no-cache'});
  if (!response.ok) throw new Error('既定リグJSONを読めません');
  installRig(await response.json(), 'generic-humanoid.json');
}

function resize() {
  const width = viewer.clientWidth;
  const height = viewer.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

new ResizeObserver(resize).observe(viewer);

document.querySelector('#sample').onclick = () => {
  loadSelectedPose().catch((error) => { status.textContent = error.message; });
};

poseSelect.onchange = () => {
  loadSelectedPose().catch((error) => { status.textContent = error.message; });
};

document.querySelector('#file').onchange = async (event) => {
  try {
    const file = event.target.files[0];
    if (file) await loadPayload(JSON.parse(await file.text()), file.name);
  } catch (error) {
    status.textContent = error.message;
  }
};

document.querySelector('#rig-file').onchange = async (event) => {
  try {
    const file = event.target.files[0];
    if (file) installRig(JSON.parse(await file.text()), file.name);
  } catch (error) {
    status.textContent = error.message;
  }
};

document.querySelectorAll('[data-view]').forEach((button) => {
  button.onclick = () => {
    const view = button.dataset.view;
    fit(currentPose || neutral, view);
    updateUrl({view});
  };
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

resize();
animate();

loadDefaultRig()
  .then(async () => {
    const requestedPose = poseFromUrl();
    if (requestedPose) poseSelect.value = requestedPose;
    await loadSelectedPose(false);
    fit(currentPose, viewFromUrl());
  })
  .catch((error) => { status.textContent = error.message; });
