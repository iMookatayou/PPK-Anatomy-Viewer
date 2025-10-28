import * as THREE from "three";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js";

const canvas = document.getElementById("canvas");
const info = document.getElementById("info");
const selNameEl = document.getElementById("selName");
const selPathEl = document.getElementById("selPath");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = false;
renderer.autoClear = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1220);

const camera = new THREE.PerspectiveCamera(50, 2, 0.01, 5000);
camera.position.set(0.8, 1.5, 2.5);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 1.1, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0x1a1a1a, 1.0));
const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(3, 5, 2);
scene.add(dir);

const loader = new GLTFLoader();
let model;
let pickables = [];             // meshes ที่เลือกได้
const original = new Map();     // mesh -> {material, visible}
let hovered = null;             // mesh ที่กำลัง hover
let selected = null;            // mesh ที่ถูกเลือก
let xrayOn = false;

function setInfo(t){ info.textContent = t || ""; }

function keepOriginal(mesh){
  if (!original.has(mesh)) {
    // เก็บต้นฉบับ material / visible
    original.set(mesh, { material: mesh.material, visible: mesh.visible, transparent: mesh.material?.transparent || false, opacity: mesh.material?.opacity ?? 1 });
  }
}

function restoreAll(){
  pickables.forEach(m => {
    const o = original.get(m);
    if (!o) return;
    m.material = o.material;
    m.visible = o.visible;
    if (m.material?.transparent) m.material.opacity = o.opacity;
  });
}

function labelFor(obj){
  // สร้างชื่ออ่านง่ายจากสายโหนด
  const names = [];
  let p = obj;
  for (let i=0; i<4 && p; i++){ // เอาแค่ 4 ชั้นพออ่าน
    if (p.name) names.push(p.name);
    p = p.parent;
  }
  return names.filter(Boolean).reverse().join(" › ") || obj.type;
}

/* ---------- FIT ---------- */
function fitToView(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const dist = (sphere.radius / Math.sin(fov/2)) * 1.05;

  const dirVec = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
  camera.position.copy(dirVec.multiplyScalar(dist).add(sphere.center));
  controls.target.copy(sphere.center);

  camera.near = Math.max(0.01, dist / 500);
  camera.far  = Math.max(2000, dist * 500);
  camera.updateProjectionMatrix();
  controls.update();
}

/* ---------- LOAD ---------- */
async function loadGLBFromUrl(url) {
  setInfo("Loading " + url + " ...");
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => {
      if (model) { scene.remove(model); restoreAll(); pickables = []; original.clear(); }
      model = gltf.scene;
      scene.add(model);

      // เก็บ meshes ที่เลือกได้
      model.traverse(o => {
        if (o.isMesh) {
          keepOriginal(o);
          o.material = o.material.clone(); // แยก instance เพื่อไฮไลท์ได้ปลอดภัย
          pickables.push(o);
        }
      });

      fitToView(model);
      setInfo("Loaded: " + url);
      setSelected(null);
      resolve();
    }, undefined, (err) => {
      console.error("GLTF load error:", err);
      setInfo("Load failed: " + url);
      reject(err);
    });
  });
}

async function loadGLBFromFile(file) {
  setInfo("Loading file: " + file.name + " ...");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      loader.parse(e.target.result, "", (gltf) => {
        if (model) { scene.remove(model); restoreAll(); pickables = []; original.clear(); }
        model = gltf.scene; scene.add(model);
        model.traverse(o => { if (o.isMesh){ keepOriginal(o); o.material = o.material.clone(); pickables.push(o);} });
        fitToView(model);
        setInfo("Loaded: " + file.name);
        setSelected(null);
        resolve();
      }, (err) => { console.error(err); setInfo("Parse failed"); reject(err); });
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/* ---------- HOVER & SELECT ---------- */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function updatePointer(event){
  const rect = canvas.getBoundingClientRect();
  const x = ( (event.clientX - rect.left) / rect.width ) * 2 - 1;
  const y = ( (event.clientY - rect.top)  / rect.height) * 2 - 1;
  pointer.set(x, -y); // NDC
}

function setHovered(mesh){
  if (hovered === mesh) return;
  // clear hover เดิม
  if (hovered && hovered !== selected){
    const mat = hovered.material;
    mat.emissive?.setHex?.(0x000000);
  }
  hovered = mesh;
  if (hovered && hovered !== selected){
    hovered.material.emissive?.setHex?.(0x3b82f6); // blue highlight
  }
}

function setSelected(mesh){
  // clear hover สี
  if (hovered && hovered !== mesh){
    hovered.material.emissive?.setHex?.(0x000000);
  }
  selected = mesh || null;
  if (selected){
    selNameEl.textContent = selected.name || selected.parent?.name || "(unnamed mesh)";
    selPathEl.textContent = labelFor(selected);
    // ติดสีเลือกชัดกว่า hover
    selected.material.emissive?.setHex?.(0x22c55e); // green
  } else {
    selNameEl.textContent = "—";
    selPathEl.textContent = "";
  }
}

function pick(){
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickables, true);
  setHovered(hits.length ? hits[0].object : null);
}

/* ---------- XRAY / HIDE / UNHIDE ---------- */
function setXray(on){
  xrayOn = on;
  pickables.forEach(m => {
    if (m === selected) {
      m.material.transparent = false;
      m.material.opacity = 1.0;
    } else {
      m.material.transparent = on;
      m.material.opacity = on ? 0.15 : (original.get(m)?.opacity ?? 1);
    }
  });
}

function hideSelected(){
  if (!selected) return;
  selected.visible = false;
}

function unhideAll(){
  pickables.forEach(m => m.visible = true);
  setXray(false);
}

/* ---------- UI & KEYS ---------- */
document.getElementById("btnFit").addEventListener("click", () => { if (model) fitToView(model); });
document.getElementById("btnReset").addEventListener("click", () => {
  camera.position.set(0.8, 1.5, 2.5);
  controls.target.set(0, 1.1, 0);
  camera.near = 0.01; camera.far = 5000; camera.updateProjectionMatrix();
  controls.update();
});
document.getElementById("btnFitSel").addEventListener("click", () => { if (selected) fitToView(selected); });
document.getElementById("btnXray").addEventListener("click", () => setXray(!xrayOn));
document.getElementById("btnHide").addEventListener("click", hideSelected);
document.getElementById("btnUnhide").addEventListener("click", unhideAll);

document.getElementById("file").addEventListener("change", (e) => {
  const f = e.target.files?.[0];
  if (f) loadGLBFromFile(f);
});

window.addEventListener("mousemove", (e) => { updatePointer(e); pick(); });
window.addEventListener("click", () => { if (hovered) setSelected(hovered); });
window.addEventListener("keydown", (e) => {
  if (e.key === "f" || e.key === "F") { if (selected) fitToView(selected); }
  if (e.key === "x" || e.key === "X") { setXray(!xrayOn); }
  if (e.key === "h" || e.key === "H") { hideSelected(); }
  if (e.key === "u" || e.key === "U") { unhideAll(); }
});

/* ---------- RESIZE & RENDER ---------- */
function resize() {
  const headerH = 48;
  const width  = window.innerWidth;
  const height = Math.max(100, window.innerHeight - headerH);
  renderer.setSize(width, height, true);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

function render() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}
render();

/* ---------- LOAD DEFAULT ---------- */
loadGLBFromUrl("assets/anatomy.glb").catch(() => setInfo("Tip: ใช้ปุ่ม Load .glb เพื่อเลือกไฟล์ด้วยตนเอง"));
