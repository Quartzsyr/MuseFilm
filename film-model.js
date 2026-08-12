// GitHub Pages serves this module directly, so keep Three.js as a local,
// versioned browser dependency instead of relying on Vite's bare-import resolver.
import * as THREE from "./vendor/three.module.min.js";

function createMetalRoughnessTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 192;
  const context = canvas.getContext("2d");
  const image = context.createImageData(canvas.width, canvas.height);
  for (let index = 0; index < image.data.length; index += 4) {
    const value = 112 + Math.random() * 82;
    image.data[index] = value;
    image.data[index + 1] = value;
    image.data[index + 2] = value;
    image.data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  context.globalAlpha = .16;
  context.strokeStyle = "#ffffff";
  for (let index = 0; index < 28; index += 1) {
    const y = Math.random() * canvas.height;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(canvas.width, y + Math.random() * 2 - 1);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  return texture;
}

const METAL_ROUGHNESS = createMetalRoughnessTexture();

const METAL = new THREE.MeshPhysicalMaterial({
  color: 0x302f2c,
  metalness: 0.88,
  roughness: 0.32,
  roughnessMap: METAL_ROUGHNESS,
  clearcoat: .14,
  clearcoatRoughness: .4,
});
const METAL_EDGE = new THREE.MeshPhysicalMaterial({
  color: 0x78736a,
  metalness: 0.94,
  roughness: 0.24,
  roughnessMap: METAL_ROUGHNESS,
  clearcoat: .22,
  clearcoatRoughness: .28,
});
const DARK = new THREE.MeshStandardMaterial({
  color: 0x090909,
  metalness: 0.22,
  roughness: 0.72,
});
const FILM = new THREE.MeshStandardMaterial({
  color: 0x251711,
  metalness: 0.08,
  roughness: 0.58,
  transparent: true,
  opacity: 0.92,
  side: THREE.DoubleSide,
});
const RED = new THREE.MeshStandardMaterial({
  color: 0xa52f29,
  metalness: 0.42,
  roughness: 0.38,
});

function cylinder(radius, depth, material, segments = 72) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, depth, segments),
    material,
  );
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function createReel() {
  const reel = new THREE.Group();
  const spokeGeometry = new THREE.BoxGeometry(1.65, 0.34, 0.11);

  [-0.34, 0.34].forEach((z) => {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.14, 18, 96), METAL_EDGE);
    rim.position.z = z;
    reel.add(rim);

    const innerRing = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.12, 14, 64), METAL_EDGE);
    innerRing.position.z = z;
    reel.add(innerRing);

    for (let index = 0; index < 6; index += 1) {
      const angle = (index / 6) * Math.PI * 2;
      const spoke = new THREE.Mesh(spokeGeometry, METAL);
      spoke.position.set(Math.cos(angle) * 1.53, Math.sin(angle) * 1.53, z);
      spoke.rotation.z = angle;
      reel.add(spoke);
    }
  });

  const core = cylinder(0.48, 0.82, METAL_EDGE);
  reel.add(core);
  const coreInset = cylinder(0.18, 0.9, DARK);
  reel.add(coreInset);
  const redPin = cylinder(0.075, 0.95, RED, 32);
  reel.add(redPin);

  return reel;
}

function createCanister() {
  const canister = new THREE.Group();
  const body = cylinder(1.55, 0.72, DARK, 96);
  canister.add(body);

  [-0.38, 0.38].forEach((z) => {
    const lip = new THREE.Mesh(new THREE.TorusGeometry(1.48, 0.07, 12, 96), METAL_EDGE);
    lip.position.z = z;
    canister.add(lip);
  });

  const label = new THREE.Mesh(
    new THREE.CircleGeometry(1.3, 96),
    new THREE.MeshStandardMaterial({ color: 0xc8c0b1, metalness: 0.05, roughness: 0.8 }),
  );
  label.position.z = 0.385;
  canister.add(label);

  const labelRing = new THREE.Mesh(new THREE.TorusGeometry(1.03, 0.045, 12, 72), RED);
  labelRing.position.z = 0.405;
  canister.add(labelRing);

  const labelCore = cylinder(0.25, 0.06, RED, 48);
  labelCore.position.z = 0.42;
  canister.add(labelCore);

  const labelLineGeometry = new THREE.BoxGeometry(1.22, 0.055, 0.035);
  [-0.46, 0.49].forEach((y, index) => {
    const line = new THREE.Mesh(labelLineGeometry, index ? METAL : RED);
    line.position.set(0, y, 0.42);
    canister.add(line);
  });

  canister.position.set(2.55, -1.65, -0.9);
  canister.rotation.set(0.16, -0.34, -0.24);
  canister.scale.setScalar(0.92);
  return canister;
}

function createFilmStrip() {
  const strip = new THREE.Group();
  const points = [
    new THREE.Vector3(-2.38, -0.52, -0.15),
    new THREE.Vector3(-3.22, -1.1, -0.08),
    new THREE.Vector3(-2.7, -2.15, 0.08),
    new THREE.Vector3(-1.05, -2.58, 0.14),
    new THREE.Vector3(0.58, -2.35, 0.12),
    new THREE.Vector3(2.05, -2.72, 0.2),
    new THREE.Vector3(3.48, -2.18, 0.28),
  ];
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal", 0.45);
  const edgeMaterial = new THREE.MeshStandardMaterial({
    color: 0x3d2418,
    metalness: 0.06,
    roughness: 0.65,
  });

  const frameGeometry = new THREE.PlaneGeometry(0.36, 0.5);
  const perforationGeometry = new THREE.BoxGeometry(0.065, 0.042, 0.025);
  const perforations = new THREE.InstancedMesh(
    perforationGeometry,
    new THREE.MeshBasicMaterial({ color: 0xb9a997 }),
    52,
  );
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);

  for (let index = 0; index < 26; index += 1) {
    const t = index / 25;
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    const angle = Math.atan2(tangent.y, tangent.x);
    const normal = new THREE.Vector3(-tangent.y, tangent.x, 0).normalize();

    const frame = new THREE.Mesh(frameGeometry, FILM);
    frame.position.copy(point);
    frame.rotation.z = angle - Math.PI / 2;
    strip.add(frame);

    quaternion.setFromEuler(new THREE.Euler(0, 0, angle));
    [-0.31, 0.31].forEach((offset, side) => {
      const hole = point.clone().addScaledVector(normal, offset);
      hole.z += 0.018;
      matrix.compose(hole, quaternion, scale);
      perforations.setMatrixAt(index * 2 + side, matrix);
    });
  }
  perforations.instanceMatrix.needsUpdate = true;
  strip.add(perforations);

  [-0.335, 0.335].forEach((offset) => {
    const edgePoints = [];
    for (let index = 0; index <= 48; index += 1) {
      const t = index / 48;
      const point = curve.getPoint(t);
      const tangent = curve.getTangent(t).normalize();
      point.addScaledVector(new THREE.Vector3(-tangent.y, tangent.x, 0), offset);
      edgePoints.push(point);
    }
    const edgeCurve = new THREE.CatmullRomCurve3(edgePoints, false, "centripetal", 0.4);
    strip.add(new THREE.Mesh(new THREE.TubeGeometry(edgeCurve, 96, 0.028, 8, false), edgeMaterial));
  });

  return strip;
}

export function mountFilmModel(host, { reducedMotion = false, finale = false } = {}) {
  const stage = host.querySelector(".model-stage");
  if (!stage) return;

  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  stage.append(canvas);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x080706, 0.022);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60);
  camera.position.set(0, 0.05, 11.7);

  scene.add(new THREE.HemisphereLight(0xe9dfd0, 0x080808, 1.15));
  const keyLight = new THREE.SpotLight(0xfff1df, 65, 30, Math.PI / 4, 0.65, 1.2);
  keyLight.position.set(-5, 6, 9);
  scene.add(keyLight);
  const redLight = new THREE.PointLight(0xb93a32, 18, 15, 1.8);
  redLight.position.set(4, -2, 5);
  scene.add(redLight);
  const rimLight = new THREE.PointLight(0x6e7b86, 14, 18, 1.7);
  rimLight.position.set(-5, -3, 1);
  scene.add(rimLight);

  const model = new THREE.Group();
  model.position.set(finale ? 1.4 : 2.15, finale ? 0 : 0.38, 0);
  model.rotation.set(0.12, -0.23, -0.08);
  scene.add(model);

  const reel = createReel();
  reel.position.set(-0.62, 0.65, 0.15);
  const canister = createCanister();
  const filmStrip = createFilmStrip();
  model.add(reel, canister, filmStrip);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(3.3, 72),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.38, depthWrite: false }),
  );
  shadow.scale.set(1.6, 0.3, 1);
  shadow.position.set(0.35, -2.95, -1.55);
  model.add(shadow);

  const pointer = new THREE.Vector2();
  let visible = true;
  let animationFrame = 0;
  let previousTime = performance.now();
  let scrollProgress = Number(host.dataset.cinematicProgress || 0);
  let targetScrollProgress = scrollProgress;
  let narrowLayout = false;

  function smoothstep(edge0, edge1, value) {
    const amount = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
    return amount * amount * (3 - 2 * amount);
  }

  function applyScrollDirection(time = performance.now()) {
    scrollProgress += (targetScrollProgress - scrollProgress) * (reducedMotion ? 1 : .075);
    const productPhase = smoothstep(.08, .25, scrollProgress);
    const finalPhase = smoothstep(finale ? .72 : .8, 1, scrollProgress);
    const heroX = narrowLayout ? .1 : 2.15;
    const chapterX = narrowLayout ? -3.7 : -2.55;
    const heroY = narrowLayout ? -1.15 : .38;
    const chapterY = narrowLayout ? -1.8 : -.2;
    const baseScale = narrowLayout ? .9 : 1;
    const chapterScale = narrowLayout ? .58 : .72;

    const finaleX = narrowLayout ? 0 : .65;
    const finaleY = narrowLayout ? -.7 : -.05;
    model.position.x = finale
      ? THREE.MathUtils.lerp(narrowLayout ? -2.4 : 1.25, finaleX, finalPhase)
      : THREE.MathUtils.lerp(heroX, chapterX, productPhase);
    model.position.y = THREE.MathUtils.lerp(heroY, chapterY, productPhase)
      + (finale ? THREE.MathUtils.lerp(0, finaleY - chapterY, finalPhase) : 0)
      + Math.sin(time * .00055) * (reducedMotion || finale ? 0 : .035);
    model.position.z = THREE.MathUtils.lerp(0, finale ? -.35 : -1.1, productPhase);
    model.scale.setScalar(finale
      ? THREE.MathUtils.lerp(narrowLayout ? .72 : .9, narrowLayout ? .48 : .66, finalPhase)
      : THREE.MathUtils.lerp(baseScale, chapterScale, productPhase));
    model.rotation.z = THREE.MathUtils.lerp(-.08, -.24, productPhase) + finalPhase * .08;
    const rollingAngle = -scrollProgress * 8.8 - time * (reducedMotion ? 0 : (finale ? .00011 * (1 - finalPhase) : .00016));
    const detent = Math.round(rollingAngle / (Math.PI / 6)) * (Math.PI / 6);
    reel.rotation.z = THREE.MathUtils.lerp(rollingAngle, detent, finalPhase);
    filmStrip.scale.x = finale ? THREE.MathUtils.lerp(1.3, .045, finalPhase) : 1 + productPhase * .34;
    filmStrip.position.x = finale ? THREE.MathUtils.lerp(.22, -1.35, finalPhase) : productPhase * .22;
    canister.rotation.z = -.24 + productPhase * .55 - finalPhase * .18;
    canvas.style.opacity = String(finale ? THREE.MathUtils.lerp(.78, .52, finalPhase) : THREE.MathUtils.lerp(1, .34, productPhase));
  }

  function resize() {
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    narrowLayout = width < 760;
    camera.position.z = width < 520 ? 13.4 : 11.7;
    applyScrollDirection();
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }

  function animate(time) {
    animationFrame = 0;
    if (!visible) return;
    const delta = Math.min((time - previousTime) / 1000, 0.05);
    previousTime = time;

    applyScrollDirection(time);
    model.rotation.x += (0.12 + pointer.y * 0.1 - model.rotation.x) * 0.045;
    model.rotation.y += (-0.23 + pointer.x * 0.15 - model.rotation.y) * 0.045;
    renderer.render(scene, camera);

    if (!reducedMotion) animationFrame = requestAnimationFrame(animate);
  }

  function start() {
    if (animationFrame || !visible) return;
    previousTime = performance.now();
    animationFrame = requestAnimationFrame(animate);
  }

  host.addEventListener("pointermove", (event) => {
    if (reducedMotion || event.pointerType === "touch") return;
    const bounds = host.getBoundingClientRect();
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width - 0.5) * 2,
      -((event.clientY - bounds.top) / bounds.height - 0.5) * 2,
    );
  }, { passive: true });
  host.addEventListener("pointerleave", () => pointer.set(0, 0), { passive: true });
  host.addEventListener("cinematic-progress", (event) => {
    targetScrollProgress = Number(event.detail?.progress || 0);
    start();
  });

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);

  const visibilityObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) start();
    else if (animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
  }, { rootMargin: "120px" });
  visibilityObserver.observe(host);

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    host.classList.remove("is-model-ready");
  });

  resize();
  renderer.render(scene, camera);
  host.classList.add("is-model-ready");
  start();

  window.addEventListener("pagehide", () => {
    resizeObserver.disconnect();
    visibilityObserver.disconnect();
    if (animationFrame) cancelAnimationFrame(animationFrame);
    renderer.dispose();
    METAL_ROUGHNESS.dispose();
  }, { once: true });
}
