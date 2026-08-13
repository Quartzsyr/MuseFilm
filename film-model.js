// Keep the renderer and loaders local so the static build also works without a CDN.
// Large GLB files are fetched as lossless chunks to stay reliable on static hosts.
import * as THREE from "./vendor/three.module.min.js";
import { GLTFLoader } from "./vendor/GLTFLoader.js";
import { MeshoptDecoder } from "./vendor/meshopt_decoder.module.js";

const HERO_MODELS = [
  {
    id: "film",
    url: "./images/generated/musefilm-film-label-base.png?v=20260813-1",
    fit: 3.2,
    rotation: [0.08, -0.18, -0.055],
  },
  {
    id: "camera",
    chunks: [
      "./models/camera.glb.000",
      "./models/camera.glb.001",
      "./models/camera.glb.002",
      "./models/camera.glb.003",
      "./models/camera.glb.004",
      "./models/camera.glb.005",
    ],
    chunkBytes: [500000, 500000, 500000, 500000, 500000, 462404],
    fit: 7.25,
    rotation: [-0.015, -0.08, 0.025],
  },
  {
    id: "archive",
    chunks: [
      "./models/archive.glb.000",
      "./models/archive.glb.001",
      "./models/archive.glb.002",
      "./models/archive.glb.003",
      "./models/archive.glb.004",
      "./models/archive.glb.005",
    ],
    chunkBytes: [500000, 500000, 500000, 500000, 500000, 76020],
    fit: 6.05,
    rotation: [1.12, -0.12, -0.035],
  },
];

THREE.Cache.enabled = true;

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function smoothstep(edge0, edge1, value) {
  const amount = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}

function modelOpacity(index, progress) {
  if (index === 0) return progress < 0.28 ? 1 : 0;
  if (index === 1) {
    if (progress < 0.28) return 0;
    return 1 - smoothstep(0.585, 0.61, progress);
  }
  return smoothstep(0.54, 0.565, progress);
}

function transitionMaskState(progress) {
  const local = clamp((progress - 0.18) / 0.2);
  const active = progress >= 0.18 && progress <= 0.38;
  return { cover: active ? Math.sin(local * Math.PI) : 0, sweep: local * 2 - 1, index: active ? 0 : -1 };
}

function horizontalRelayState(progress) {
  const local = clamp((progress - 0.54) / 0.07);
  return {
    travel: local * local * (3 - 2 * local),
    lift: Math.sin(local * Math.PI),
  };
}

function createRibbonGeometry(curve, width, segments = 240) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const side = new THREE.Vector3(0, width * 0.5, 0);
  for (let index = 0; index <= segments; index += 1) {
    const progress = index / segments;
    const point = curve.getPointAt(progress);
    positions.push(
      point.x + side.x, point.y + side.y, point.z + side.z,
      point.x - side.x, point.y - side.y, point.z - side.z,
    );
    uvs.push(progress, 1, progress, 0);
    if (index < segments) {
      const offset = index * 2;
      indices.push(offset, offset + 1, offset + 2, offset + 1, offset + 3, offset + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.userData.basePositions = Float32Array.from(positions);
  return geometry;
}

const collisionLocalPoint = new THREE.Vector3();
const collisionLocalSide = new THREE.Vector3();
const ribbonSideDirection = new THREE.Vector3();
const ribbonTopPoint = new THREE.Vector3();
const ribbonBottomPoint = new THREE.Vector3();
const pageVertical = new THREE.Vector3(0, 1, 0);

function constrainPointOutsideCylinder(point, collision, radius = collision?.radius) {
  if (!collision) return point;
  collisionLocalPoint.copy(point).applyMatrix4(collision.inverseMatrix);
  if (Math.abs(collisionLocalPoint.y) > collision.halfHeight) return point;
  const deltaX = collisionLocalPoint.x;
  const deltaZ = collisionLocalPoint.z;
  const distance = Math.hypot(deltaX, deltaZ);
  if (distance >= radius) return point;
  if (distance < 0.0001) {
    collisionLocalPoint.x = -radius;
  } else {
    const correction = radius / distance;
    collisionLocalPoint.x = deltaX * correction;
    collisionLocalPoint.z = deltaZ * correction;
  }
  point.copy(collisionLocalPoint).applyMatrix4(collision.matrix);
  return point;
}

function reshapeRibbonGeometry(strip, curve, width, collision) {
  const position = strip.geometry.attributes.position;
  const segmentCount = strip.userData.segmentCount;
  for (let index = 0; index <= segmentCount; index += 1) {
    const progress = index / segmentCount;
    const point = curve.getPointAt(progress);
    collisionLocalPoint.copy(point).applyMatrix4(collision.inverseMatrix);
    const localRadiusBeforeConstraint = Math.hypot(collisionLocalPoint.x, collisionLocalPoint.z);
    const canisterAlignment = 1 - smoothstep(
      collision.radius + collision.clearance,
      collision.radius + collision.clearance + collision.orientationTransition,
      localRadiusBeforeConstraint,
    );
    ribbonSideDirection.copy(collision.worldAxis).lerp(pageVertical, 1 - canisterAlignment).normalize();
    collisionLocalSide
      .copy(ribbonSideDirection)
      .multiplyScalar(width * 0.5)
      .applyMatrix3(collision.inverseLinear);
    const radialHalfWidth = Math.hypot(collisionLocalSide.x, collisionLocalSide.z);
    const safeRadius = collision.radius + radialHalfWidth + collision.clearance;
    const distanceFromSocket = point.distanceTo(collision.socketWorld);
    const exitRamp = smoothstep(0, collision.egressLength, distanceFromSocket);
    const minimumRadius = THREE.MathUtils.lerp(collision.socketRadius, safeRadius, exitRamp);
    constrainPointOutsideCylinder(point, collision, minimumRadius);
    ribbonTopPoint.copy(point).addScaledVector(ribbonSideDirection, width * 0.5);
    ribbonBottomPoint.copy(point).addScaledVector(ribbonSideDirection, -width * 0.5);
    const top = index * 2;
    position.setXYZ(top, ribbonTopPoint.x, ribbonTopPoint.y, ribbonTopPoint.z);
    position.setXYZ(top + 1, ribbonBottomPoint.x, ribbonBottomPoint.y, ribbonBottomPoint.z);
  }
  position.needsUpdate = true;
  strip.geometry.computeVertexNormals();
  strip.geometry.computeBoundingSphere();
}

const FILM_FRAME_SOURCES = [
  "./images/image.avif",
  "./images/app-details/03-film-library.avif",
  "./images/image(2).avif",
  "./images/app-details/06-light-table.avif",
];

function loadFilmFrame(source) {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = new URL(source, document.baseURI).href;
  });
}

function drawImageCover(context, image, x, y, width, height) {
  if (!image?.naturalWidth || !image?.naturalHeight) return;
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = (image.naturalWidth - sourceWidth) * 0.5;
  const sourceY = (image.naturalHeight - sourceHeight) * 0.5;
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

async function createMuseFilmCanister() {
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 2048;
  labelCanvas.height = 1024;
  const context = labelCanvas.getContext("2d");
  context.fillStyle = "#171513";
  context.fillRect(0, 0, labelCanvas.width, labelCanvas.height);
  context.fillStyle = "#0b0b0a";
  context.fillRect(70, 82, 1210, 830);
  context.fillStyle = "#e8ddc9";
  context.fillRect(1280, 82, 698, 830);
  context.fillStyle = "#b63b31";
  context.fillRect(70, 842, 1908, 70);
  context.strokeStyle = "rgba(238, 227, 207, .72)";
  context.lineWidth = 3;
  context.strokeRect(108, 120, 1132, 752);
  context.fillStyle = "#f2eadc";
  // Reserve the left edge for the real felt light-trap/film exit so the brand
  // never disappears behind that raised part of the cartridge.
  context.font = "700 156px Arial, sans-serif";
  context.letterSpacing = "8px";
  context.fillText("MUSEFILM", 276, 360);
  context.fillStyle = "#b63b31";
  context.font = "700 84px Arial, sans-serif";
  context.fillText("QUARTZ", 282, 510);
  context.fillStyle = "#f2eadc";
  context.font = "500 38px Arial, sans-serif";
  context.fillText("COLOR NEGATIVE FILM", 284, 620);
  context.fillText("PROCESS C-41 · 35 mm", 284, 696);
  context.fillStyle = "#181412";
  context.font = "800 132px Arial, sans-serif";
  context.fillText("ISO 400", 1390, 366);
  context.font = "700 64px Arial, sans-serif";
  context.fillText("36 EXP", 1400, 510);
  context.fillText("35 mm", 1400, 604);
  context.font = "500 34px Arial, sans-serif";
  context.fillText("PROCESS C-41", 1400, 720);
  const labelTexture = new THREE.CanvasTexture(labelCanvas);
  labelTexture.colorSpace = THREE.SRGBColorSpace;
  labelTexture.anisotropy = 8;

  const canister = new THREE.Group();
  const darkMetal = new THREE.MeshPhysicalMaterial({
    color: 0x151515,
    metalness: 0.76,
    roughness: 0.3,
    clearcoat: 0.16,
    clearcoatRoughness: 0.38,
  });
  const edgeMetal = new THREE.MeshPhysicalMaterial({
    color: 0x3a3835,
    metalness: 0.9,
    roughness: 0.22,
  });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.16, 1.16, 3.2, 96), darkMetal);
  canister.add(body);

  const label = new THREE.Mesh(
    new THREE.CylinderGeometry(1.178, 1.178, 2.18, 96, 1, true, -Math.PI * 0.62, Math.PI * 1.24),
    new THREE.MeshPhysicalMaterial({
      map: labelTexture,
      roughness: 0.56,
      metalness: 0.025,
      clearcoat: 0.06,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
  );
  label.name = "canister-label";
  label.position.y = -0.06;
  canister.add(label);
  canister.userData.labelHeight = label.geometry.parameters.height;

  [-1.6, 1.6].forEach((y) => {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.16, 0.075, 18, 96), edgeMetal);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = y;
    canister.add(rim);
  });

  const top = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.11, 96), edgeMetal);
  top.position.y = 1.61;
  canister.add(top);
  const spool = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, 0.43, 64), darkMetal);
  spool.position.y = 1.85;
  canister.add(spool);
  const spoolCap = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.06, 64), edgeMetal);
  spoolCap.position.y = 2.09;
  canister.add(spoolCap);
  const filmSlot = new THREE.Mesh(
    new THREE.BoxGeometry(0.11, canister.userData.labelHeight * 1.04, 0.18),
    new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.95, metalness: 0 }),
  );
  filmSlot.position.set(-1.19, -0.06, 0.06);
  filmSlot.name = "felt-film-slot";
  canister.add(filmSlot);
  const filmSocket = new THREE.Object3D();
  filmSocket.name = "film-socket";
  filmSocket.position.set(-1.26, -0.06, 0.06);
  canister.add(filmSocket);

  const collisionProxy = new THREE.Object3D();
  collisionProxy.name = "canister-collision";
  collisionProxy.userData.radius = 1.26;
  collisionProxy.userData.halfHeight = 1.64;
  canister.add(collisionProxy);

  const dxSilver = new THREE.MeshPhysicalMaterial({ color: 0xbeb8aa, metalness: 0.92, roughness: 0.27 });
  const dxBlack = new THREE.MeshStandardMaterial({ color: 0x0b0b0a, metalness: 0.12, roughness: 0.84 });
  // A real 35 mm DX patch is a 2 × 6 contact grid. Its visible top and bottom
  // are derived from the label geometry so the two regions are exactly level.
  const dxPattern = [
    [1, 1],
    [1, 0],
    [0, 1],
    [1, 0],
    [0, 1],
    [1, 0],
  ];
  const dxGroup = new THREE.Group();
  dxGroup.name = "dx-code-iso-400-36";
  const dxContactHeight = canister.userData.labelHeight * 0.115;
  const dxTop = label.position.y + canister.userData.labelHeight * 0.5;
  const dxBottom = label.position.y - canister.userData.labelHeight * 0.5;
  const dxRowStep = (canister.userData.labelHeight - dxContactHeight) / (dxPattern.length - 1);
  dxPattern.forEach((row, rowIndex) => {
    row.forEach((conductive, columnIndex) => {
      const angle = Math.PI * 0.75 + (columnIndex - 0.5) * 0.15;
      const contact = new THREE.Mesh(
        new THREE.PlaneGeometry(0.16, dxContactHeight),
        conductive ? dxSilver : dxBlack,
      );
      const contactY = rowIndex === dxPattern.length - 1
        ? dxBottom + dxContactHeight * 0.5
        : dxTop - dxContactHeight * 0.5 - rowIndex * dxRowStep;
      contact.position.set(Math.sin(angle) * 1.184, contactY, Math.cos(angle) * 1.184);
      contact.rotation.y = angle;
      dxGroup.add(contact);
    });
  });
  canister.add(dxGroup);

  const filmCanvas = document.createElement("canvas");
  filmCanvas.width = 2048;
  filmCanvas.height = 420;
  const filmContext = filmCanvas.getContext("2d");
  const filmGradient = filmContext.createLinearGradient(0, 0, 0, filmCanvas.height);
  filmGradient.addColorStop(0, "#31160f");
  filmGradient.addColorStop(0.18, "#713a25");
  filmGradient.addColorStop(0.5, "#8b5035");
  filmGradient.addColorStop(0.82, "#713a25");
  filmGradient.addColorStop(1, "#31160f");
  filmContext.fillStyle = filmGradient;
  filmContext.fillRect(0, 0, filmCanvas.width, filmCanvas.height);
  filmContext.fillStyle = "rgba(24, 12, 9, .7)";
  for (let x = 18; x < filmCanvas.width; x += 252) filmContext.fillRect(x + 36, 82, 198, 256);
  const filmFrameCanvas = document.createElement("canvas");
  filmFrameCanvas.width = filmCanvas.width;
  filmFrameCanvas.height = filmCanvas.height;
  const filmFrameContext = filmFrameCanvas.getContext("2d");
  filmFrameContext.fillStyle = "#000";
  filmFrameContext.fillRect(0, 0, filmFrameCanvas.width, filmFrameCanvas.height);
  const frameImages = await Promise.all(FILM_FRAME_SOURCES.map(loadFilmFrame));
  let frameIndex = 0;
  for (let x = 18; x < filmCanvas.width; x += 252) {
    const image = frameImages[frameIndex % frameImages.length];
    if (image) {
      filmContext.save();
      filmContext.beginPath();
      filmContext.rect(x + 40, 86, 190, 248);
      filmContext.clip();
      filmContext.filter = "grayscale(1) contrast(.72) brightness(.78) sepia(1) saturate(.8) hue-rotate(326deg)";
      filmContext.globalAlpha = 0.32;
      drawImageCover(filmContext, image, x + 40, 86, 190, 248);
      filmContext.filter = "none";
      filmContext.globalCompositeOperation = "multiply";
      filmContext.globalAlpha = 0.28;
      filmContext.fillStyle = "#4d1c12";
      filmContext.fillRect(x + 40, 86, 190, 248);
      filmContext.restore();
      filmFrameContext.save();
      filmFrameContext.beginPath();
      filmFrameContext.rect(x + 40, 86, 190, 248);
      filmFrameContext.clip();
      filmFrameContext.fillStyle = "#24100b";
      filmFrameContext.fillRect(x + 40, 86, 190, 248);
      filmFrameContext.filter = "grayscale(1) contrast(.78) brightness(.92) sepia(1) saturate(.72) hue-rotate(326deg)";
      filmFrameContext.globalAlpha = 0.86;
      drawImageCover(filmFrameContext, image, x + 40, 86, 190, 248);
      filmFrameContext.filter = "none";
      filmFrameContext.globalCompositeOperation = "multiply";
      filmFrameContext.globalAlpha = 0.34;
      filmFrameContext.fillStyle = "#63291a";
      filmFrameContext.fillRect(x + 40, 86, 190, 248);
      filmFrameContext.restore();
    }
    frameIndex += 1;
  }
  filmContext.strokeStyle = "rgba(221, 135, 76, .38)";
  filmContext.lineWidth = 4;
  for (let x = 18; x < filmCanvas.width; x += 252) filmContext.strokeRect(x + 36, 82, 198, 256);
  filmContext.fillStyle = "rgba(236, 160, 96, .18)";
  filmContext.fillRect(0, 62, filmCanvas.width, 4);
  filmContext.fillRect(0, 354, filmCanvas.width, 4);

  const filmAlphaCanvas = document.createElement("canvas");
  filmAlphaCanvas.width = filmCanvas.width;
  filmAlphaCanvas.height = filmCanvas.height;
  const alphaContext = filmAlphaCanvas.getContext("2d");
  alphaContext.fillStyle = "#fff";
  alphaContext.fillRect(0, 0, filmAlphaCanvas.width, filmAlphaCanvas.height);
  alphaContext.fillStyle = "#000";
  for (let x = 18; x < filmAlphaCanvas.width; x += 92) {
    alphaContext.beginPath();
    alphaContext.roundRect(x, 14, 52, 34, 8);
    alphaContext.roundRect(x, 372, 52, 34, 8);
    alphaContext.fill();
  }
  const filmTexture = new THREE.CanvasTexture(filmCanvas);
  filmTexture.colorSpace = THREE.SRGBColorSpace;
  filmTexture.wrapS = THREE.RepeatWrapping;
  filmTexture.repeat.set(1.2, 1);
  filmTexture.anisotropy = 8;
  const filmAlphaTexture = new THREE.CanvasTexture(filmAlphaCanvas);
  filmAlphaTexture.wrapS = THREE.RepeatWrapping;
  filmAlphaTexture.repeat.copy(filmTexture.repeat);
  const filmFrameTexture = new THREE.CanvasTexture(filmFrameCanvas);
  filmFrameTexture.colorSpace = THREE.SRGBColorSpace;
  filmFrameTexture.wrapS = THREE.RepeatWrapping;
  filmFrameTexture.repeat.copy(filmTexture.repeat);
  filmFrameTexture.anisotropy = 8;
  const filmCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(-0.9, 0.08, -0.04),
    new THREE.Vector3(-1.82, -0.06, -0.07),
    new THREE.Vector3(-2.72, -0.42, -0.02),
    new THREE.Vector3(-3.58, -0.88, 0.08),
    new THREE.Vector3(-4.48, -1.18, 0.12),
    new THREE.Vector3(-5.45, -1.28, 0.05),
  ], false, "centripetal", 0.44);
  const filmMaterial = new THREE.MeshPhysicalMaterial({
    map: filmTexture,
    alphaMap: filmAlphaTexture,
    color: 0xc27a4c,
    emissive: 0x2b0c04,
    emissiveIntensity: 0.16,
    roughness: 0.36,
    metalness: 0,
    transparent: true,
    opacity: 0.68,
    alphaTest: 0.48,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  filmMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.museFrameMap = { value: filmFrameTexture };
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      "#include <common>\nuniform sampler2D museFrameMap;",
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <dithering_fragment>",
      `
        float museTransmissionAngle = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.35);
        vec3 museFrameSample = texture2D(museFrameMap, vMapUv).rgb;
        float museFrameLuma = smoothstep(0.025, 0.48, dot(museFrameSample, vec3(0.299, 0.587, 0.114)));
        vec3 museFrameNegative = mix(vec3(0.12, 0.025, 0.012), vec3(0.88, 0.31, 0.12), museFrameLuma);
        float museFrameReveal = 0.08 + museTransmissionAngle * 0.32;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, museFrameNegative, museFrameReveal);
        #include <dithering_fragment>
      `,
    );
  };
  filmMaterial.userData.museFrameTexture = filmFrameTexture;
  filmMaterial.customProgramCacheKey = () => "musefilm-angle-revealed-frames-v3";
  const strip = new THREE.Mesh(
    createRibbonGeometry(filmCurve, canister.userData.labelHeight, 960),
    filmMaterial,
  );
  strip.name = "flexible-film-strip";
  strip.userData.segmentCount = 960;

  canister.rotation.z = -0.04;
  return { canister, strip };
}

function cloneMaterial(material) {
  const clone = material.clone();
  clone.userData.museOriginalTransparent = material.transparent;
  clone.userData.museOriginalDepthWrite = material.depthWrite;
  clone.userData.museOriginalOpacity = material.opacity;
  clone.needsUpdate = true;
  return clone;
}

function prepareModel(gltf, spec, renderOrder) {
  const content = gltf.scene;
  const bounds = new THREE.Box3().setFromObject(content);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const maximumDimension = Math.max(size.x, size.y, size.z, 0.001);
  const wrapper = new THREE.Group();

  content.position.sub(center);
  content.traverse((child) => {
    if (!child.isMesh) return;
    child.frustumCulled = true;
    child.renderOrder = renderOrder;
    child.material = Array.isArray(child.material)
      ? child.material.map(cloneMaterial)
      : cloneMaterial(child.material);
  });

  wrapper.add(content);
  wrapper.scale.setScalar(spec.fit / maximumDimension);
  wrapper.userData.baseScale = wrapper.scale.x;
  wrapper.rotation.set(...spec.rotation);
  wrapper.userData.baseRotation = new THREE.Euler(...spec.rotation);
  wrapper.userData.materials = [];
  wrapper.userData.filmSocket = null;
  wrapper.userData.collisionProxy = null;
  wrapper.userData.labelHeight = content.userData.labelHeight || 0;
  wrapper.traverse((child) => {
    if (child.name === "film-socket") wrapper.userData.filmSocket = child;
    if (child.name === "canister-collision") wrapper.userData.collisionProxy = child;
    if (!child.isMesh) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    wrapper.userData.materials.push(...materials);
  });
  wrapper.visible = false;
  return wrapper;
}

function setModelOpacity(model, opacity) {
  model.visible = opacity > 0.015;
  if (!model.visible) return;
  model.userData.materials.forEach((material) => {
    const originalOpacity = material.userData.museOriginalOpacity ?? 1;
    material.opacity = originalOpacity * opacity;
    material.transparent = Boolean(material.userData.museOriginalTransparent) || opacity < 0.995;
    material.depthWrite = opacity > 0.82 && material.userData.museOriginalDepthWrite !== false;
    material.needsUpdate = true;
  });
}

function updateFlexibleFilm(strip, retractProgress) {
  if (!strip) return;
  const segmentCount = strip.userData.segmentCount || 240;
  const visibleSegments = Math.max(0, Math.ceil(segmentCount * (1 - retractProgress)));
  strip.geometry.setDrawRange(0, visibleSegments * 6);
  strip.visible = visibleSegments > 0;
}

function disposeModel(model) {
  model.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry?.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      material.userData?.museFrameTexture?.dispose?.();
      Object.values(material).forEach((value) => {
        if (value?.isTexture) value.dispose();
      });
      material.dispose();
    });
  });
}

export function mountFilmModel(host, { reducedMotion = false, finale = false } = {}) {
  const stage = host.querySelector(".model-stage");
  if (!stage) return;

  const loading = finale ? null : host.querySelector("[data-model-loading]");
  const loadingLabel = loading?.querySelector("[data-model-loading-label]");
  const loadingPercent = loading?.querySelector("[data-model-loading-percent]");
  const loadingProgress = loading?.querySelector("[data-model-loading-progress]");
  const loadingLabels = {
    zh: { film: "正在装入胶卷", camera: "正在装入相机", archive: "正在装入档案袋", fallback: "已保留预览图" },
    en: { film: "Loading film roll", camera: "Loading camera", archive: "Loading archive", fallback: "Preview retained" },
  };
  let displayedLoadingProgress = 0;

  function updateLoadingProgress(value, modelId = "film") {
    if (!loading) return;
    const normalized = clamp(value);
    displayedLoadingProgress = Math.max(displayedLoadingProgress, normalized);
    const percent = Math.round(displayedLoadingProgress * 100);
    const language = document.documentElement.lang === "en" ? "en" : "zh";
    if (loadingLabel) {
      loadingLabel.dataset.i18n = `model.loading.${modelId}`;
      loadingLabel.textContent = loadingLabels[language][modelId];
    }
    if (loadingPercent) loadingPercent.textContent = `${percent}%`;
    loading.style.setProperty("--model-progress", `${percent}%`);
    loadingProgress?.setAttribute("aria-valuenow", String(percent));
  }

  function showLoadingFallback() {
    if (!loading) return;
    const language = document.documentElement.lang === "en" ? "en" : "zh";
    if (loadingLabel) {
      loadingLabel.dataset.i18n = "model.loading.fallback";
      loadingLabel.textContent = loadingLabels[language].fallback;
    }
    if (loadingPercent) loadingPercent.textContent = "";
    loadingProgress?.removeAttribute("aria-valuenow");
  }

  const canvas = document.createElement("canvas");
  const transitionMask = document.createElement("div");
  transitionMask.className = "model-transition-mask";
  transitionMask.setAttribute("aria-hidden", "true");
  transitionMask.innerHTML = `
    <span class="model-transition-dark"></span>
    <span class="model-transition-film"><i></i><b></b></span>
  `;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, finale ? 1.35 : 1.6));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = finale ? 1.08 : 1.16;
  stage.append(canvas);
  if (!finale) stage.append(transitionMask);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x080706, 0.018);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60);
  camera.position.set(0, 0.05, 11.7);

  scene.add(new THREE.HemisphereLight(0xfff0df, 0x080808, 1.85));
  scene.add(new THREE.AmbientLight(0x6f655d, 0.7));

  const keyLight = new THREE.SpotLight(0xffead2, 92, 35, Math.PI / 4, 0.62, 1.15);
  keyLight.position.set(-5.5, 7, 8.5);
  scene.add(keyLight);

  const warmLight = new THREE.PointLight(0xc5573f, 31, 18, 1.7);
  warmLight.position.set(5.5, -1.8, 5.5);
  scene.add(warmLight);

  const rimLight = new THREE.PointLight(0x71899a, 24, 20, 1.7);
  rimLight.position.set(-5.5, -2.5, 3);
  scene.add(rimLight);

  const modelRig = new THREE.Group();
  scene.add(modelRig);

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const specs = finale ? [HERO_MODELS[0]] : HERO_MODELS;
  const models = new Array(specs.length).fill(null);
  let heroRibbon = null;
  const pointer = new THREE.Vector2();
  const dragRotation = new THREE.Vector2();
  const ribbonAnchor = new THREE.Vector3();
  const collisionCenter = new THREE.Vector3();
  const collisionScale = new THREE.Vector3();
  const collisionQuaternion = new THREE.Quaternion();
  const collisionMatrix = new THREE.Matrix4();
  const collisionInverseMatrix = new THREE.Matrix4();
  const collisionInverseLinear = new THREE.Matrix3();
  const collisionAxis = new THREE.Vector3();
  const radialDirection = new THREE.Vector3();
  const socketLocal = new THREE.Vector3();
  const targetLocal = new THREE.Vector3();
  const ribbonWorldScale = new THREE.Vector3();
  const ribbonRayPoint = new THREE.Vector3();
  const ribbonRayDirection = new THREE.Vector3();
  const ribbonScreenTargets = [];
  let visible = !finale;
  let destroyed = false;
  let loadStarted = false;
  let animationFrame = 0;
  let scrollProgress = Number(host.dataset.cinematicProgress || 0);
  let targetScrollProgress = scrollProgress;
  let narrowLayout = false;
  let dragPointerId = null;
  let dragLastX = 0;
  let dragLastY = 0;
  let dragVelocityX = 0;
  let dragVelocityY = 0;
  let previousAnimationTime = 0;
  let unwrappedWallAngle = null;
  let previousWallAngle = null;

  function cacheRibbonTargets() {
    if (finale) return;
    const cinematic = host.closest("[data-cinematic]");
    const title = cinematic?.querySelector(".hero-scene h1")?.getBoundingClientRect();
    const description = cinematic?.querySelector(".hero-description")?.getBoundingClientRect();
    const action = cinematic?.querySelector(".hero-actions .primary-button")?.getBoundingClientRect();
    const verified = cinematic?.querySelector(".verified")?.getBoundingClientRect();
    const stageBounds = stage.getBoundingClientRect();
    ribbonScreenTargets.length = 0;
    if (title) ribbonScreenTargets.push([title.right + stageBounds.width * 0.035, title.bottom - title.height * 0.12]);
    if (description) ribbonScreenTargets.push([description.right + stageBounds.width * 0.025, description.bottom + description.height * 0.3]);
    if (action) ribbonScreenTargets.push([action.right + stageBounds.width * 0.035, action.top + action.height * 0.5]);
    if (verified) ribbonScreenTargets.push([verified.left + verified.width * 0.55, verified.bottom + stageBounds.height * 0.035]);
    ribbonScreenTargets.push([stageBounds.left + stageBounds.width * 0.045, stageBounds.top + stageBounds.height * 0.79]);
  }

  function screenToWorld(clientX, clientY, planeZ) {
    const bounds = stage.getBoundingClientRect();
    ribbonRayPoint.set(
      ((clientX - bounds.left) / Math.max(1, bounds.width)) * 2 - 1,
      -((clientY - bounds.top) / Math.max(1, bounds.height)) * 2 + 1,
      0.5,
    ).unproject(camera);
    ribbonRayDirection.copy(ribbonRayPoint).sub(camera.position).normalize();
    const distance = (planeZ - camera.position.z) / ribbonRayDirection.z;
    return camera.position.clone().add(ribbonRayDirection.multiplyScalar(distance));
  }

  function modelUrl(relativeUrl) {
    return new URL(relativeUrl, document.baseURI).href;
  }

  async function fetchChunkWithProgress(chunkUrl, knownBytes, reportProgress) {
    const response = await fetch(modelUrl(chunkUrl));
    if (!response.ok) throw new Error(`Model chunk failed: ${response.status} ${chunkUrl}`);
    const expectedBytes = Number(response.headers.get("content-length")) || knownBytes || 0;
    if (!response.body?.getReader) {
      const buffer = new Uint8Array(await response.arrayBuffer());
      reportProgress(buffer.byteLength, expectedBytes || buffer.byteLength);
      return buffer;
    }

    const reader = response.body.getReader();
    const pieces = [];
    let receivedBytes = 0;
    reportProgress(0, expectedBytes);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pieces.push(value);
      receivedBytes += value.byteLength;
      reportProgress(receivedBytes, expectedBytes || receivedBytes);
    }
    const buffer = new Uint8Array(receivedBytes);
    let offset = 0;
    pieces.forEach((piece) => {
      buffer.set(piece, offset);
      offset += piece.byteLength;
    });
    return buffer;
  }

  async function loadChunkedModel(chunkUrls, chunkBytes = [], reportProgress = () => {}) {
    const chunkState = chunkUrls.map(() => ({ loaded: 0, total: 0 }));
    const chunks = await Promise.all(chunkUrls.map((chunkUrl, chunkIndex) => (
      fetchChunkWithProgress(chunkUrl, chunkBytes[chunkIndex], (loaded, total) => {
        chunkState[chunkIndex] = { loaded, total };
        const aggregate = chunkState.reduce((sum, chunk) => {
          if (chunk.total > 0) return sum + clamp(chunk.loaded / chunk.total);
          return sum + (chunk.loaded > 0 ? 1 : 0);
        }, 0) / chunkState.length;
        reportProgress(aggregate);
      })
    )));
    const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const modelBuffer = new Uint8Array(byteLength);
    let offset = 0;
    chunks.forEach((chunk) => {
      modelBuffer.set(chunk, offset);
      offset += chunk.byteLength;
    });
    return loader.parseAsync(modelBuffer.buffer, document.baseURI);
  }

  async function loadModel(spec, index, reportProgress = () => {}) {
    let gltf;
    let detachedRibbon = null;
    if (spec.id === "film") {
      const generatedFilm = await createMuseFilmCanister();
      gltf = { scene: generatedFilm.canister };
      detachedRibbon = generatedFilm.strip;
      reportProgress(1);
    } else {
      gltf = spec.chunks
        ? await loadChunkedModel(spec.chunks, spec.chunkBytes, reportProgress)
        : await loader.loadAsync(modelUrl(spec.url));
      reportProgress(1);
    }
    if (destroyed) {
      disposeModel(gltf.scene);
      if (detachedRibbon) disposeModel(detachedRibbon);
      return;
    }
    if (detachedRibbon) {
      if (finale) disposeModel(detachedRibbon);
      else {
        heroRibbon = detachedRibbon;
        scene.add(heroRibbon);
      }
    }
    const model = prepareModel(gltf, spec, index);
    models[index] = model;
    modelRig.add(model);
  }

  async function loadModels() {
    try {
      if (finale) {
        await loadModel(specs[0], 0);
      } else {
        updateLoadingProgress(0, "film");
        await loadModel(specs[0], 0, (progress) => updateLoadingProgress(progress * 0.08, "film"));
        let cameraProgress = 0;
        let archiveProgress = 0;
        const reportNetworkProgress = () => {
          const aggregate = 0.08 + cameraProgress * 0.48 + archiveProgress * 0.43;
          updateLoadingProgress(aggregate, aggregate < 0.56 ? "camera" : "archive");
        };
        await Promise.all([
          loadModel(specs[1], 1, (progress) => {
            cameraProgress = progress;
            reportNetworkProgress();
          }),
          loadModel(specs[2], 2, (progress) => {
            archiveProgress = progress;
            reportNetworkProgress();
          }),
        ]);
        updateLoadingProgress(1, "archive");
      }
      host.classList.add("is-model-ready");
      applyScrollDirection();
      start();
    } catch (error) {
      console.error("MuseFilm GLB model failed to load", error);
      host.classList.remove("is-model-ready");
      host.classList.add("model-fallback");
      showLoadingFallback();
    }
  }

  function ensureModels() {
    if (loadStarted || destroyed) return;
    loadStarted = true;
    loadModels();
  }

  function applyScrollDirection(time = performance.now()) {
    const deltaTime = previousAnimationTime
      ? Math.min(0.034, Math.max(0.001, (time - previousAnimationTime) / 1000))
      : 1 / 60;
    previousAnimationTime = time;
    if (dragPointerId === null) {
      if (reducedMotion) {
        dragRotation.set(0, 0);
        dragVelocityX = 0;
        dragVelocityY = 0;
      } else {
        const springStrength = 18;
        const springDamping = 5.6;
        dragVelocityX += -dragRotation.x * springStrength * deltaTime;
        dragVelocityY += -dragRotation.y * springStrength * deltaTime;
        const damping = Math.exp(-springDamping * deltaTime);
        dragVelocityX = clamp(dragVelocityX * damping, -18, 18);
        dragVelocityY = clamp(dragVelocityY * damping, -5, 5);
        dragRotation.x += dragVelocityX * deltaTime;
        dragRotation.y += dragVelocityY * deltaTime;
        if (Math.abs(dragRotation.x) < 0.0005 && Math.abs(dragVelocityX) < 0.002) {
          dragRotation.x = 0;
          dragVelocityX = 0;
        }
        if (Math.abs(dragRotation.y) < 0.0005 && Math.abs(dragVelocityY) < 0.002) {
          dragRotation.y = 0;
          dragVelocityY = 0;
        }
      }
    }
    scrollProgress += (targetScrollProgress - scrollProgress) * (reducedMotion ? 1 : 0.075);
    const productPhase = smoothstep(0.07, 0.27, scrollProgress);
    const finalPhase = smoothstep(0.72, 1, scrollProgress);
    const displayDragX = Math.atan2(Math.sin(dragRotation.x), Math.cos(dragRotation.x));
    const maskState = transitionMaskState(scrollProgress);
    const horizontalRelay = horizontalRelayState(scrollProgress);
    if (!finale) {
      transitionMask.style.setProperty("--mask-cover", maskState.cover.toFixed(4));
      transitionMask.style.setProperty("--mask-x", `${(maskState.sweep * -145).toFixed(2)}%`);
      transitionMask.dataset.transition = String(maskState.index);
    }

    if (finale) {
      modelRig.position.x = THREE.MathUtils.lerp(narrowLayout ? -1.7 : 1.25, narrowLayout ? 0 : 0.55, finalPhase);
      modelRig.position.y = THREE.MathUtils.lerp(narrowLayout ? -0.8 : -0.1, narrowLayout ? -0.45 : -0.25, finalPhase);
      modelRig.position.z = THREE.MathUtils.lerp(-0.35, -0.8, finalPhase);
      modelRig.scale.setScalar(THREE.MathUtils.lerp(narrowLayout ? 0.62 : 0.86, narrowLayout ? 0.46 : 0.64, finalPhase));
      const model = models[0];
      if (model) {
        const base = model.userData.baseRotation;
        model.rotation.set(
          base.x + pointer.y * 0.06 + dragRotation.y,
          base.y - scrollProgress * 0.48 + pointer.x * 0.08 + displayDragX,
          base.z + finalPhase * 0.08,
        );
        setModelOpacity(model, 1);
      }
      return;
    }

    const heroX = narrowLayout ? 0.28 : 2.62;
    const chapterX = narrowLayout ? 0 : -2.45;
    const heroY = narrowLayout ? -1.58 : 0.3;
    const chapterY = narrowLayout ? -0.92 : -0.18;
    const baseScale = narrowLayout ? 0.58 : 1;
    const chapterScale = narrowLayout ? 0.44 : 0.72;
    modelRig.position.set(
      THREE.MathUtils.lerp(heroX, chapterX, productPhase),
      THREE.MathUtils.lerp(heroY, chapterY, productPhase),
      THREE.MathUtils.lerp(0, -1.05, productPhase),
    );
    modelRig.scale.setScalar(THREE.MathUtils.lerp(baseScale, chapterScale, productPhase));

    models.forEach((model, index) => {
      if (!model) return;
      const opacity = modelOpacity(index, scrollProgress);
      const presence = opacity;
      const base = model.userData.baseRotation;
      const anchor = [0.08, 0.44, 0.76][index];
      const passage = clamp((scrollProgress - anchor) * 2.8, -1, 1);
      const float = reducedMotion ? 0 : Math.sin(time * 0.00048 + index * 1.7) * 0.035;
      const modelDragX = index === 0 ? displayDragX : 0;
      const modelDragY = index === 0 ? dragRotation.y : 0;
      const transitionDirection = index % 2 === 0 ? -1 : 1;
      const maskedPush = opacity ? maskState.cover : 0;
      model.position.x = transitionDirection * maskedPush * 0.08;
      model.position.y = -passage * 0.28 + float;
      model.position.z = -Math.abs(passage) * 0.22 - maskedPush * 0.34;
      model.scale.setScalar(model.userData.baseScale * (1 + maskedPush * 0.035));
      let relayYaw = 0;
      if (index === 1) {
        const horizontalTravel = narrowLayout ? 4.8 : 6.2;
        model.position.x -= horizontalRelay.travel * horizontalTravel;
        model.position.y += horizontalRelay.lift * 0.08;
        model.position.z -= horizontalRelay.lift * 0.18;
        relayYaw = -horizontalRelay.travel * 0.1;
      } else if (index === 2) {
        const approach = 1 - horizontalRelay.travel;
        const horizontalTravel = narrowLayout ? 4.8 : 6.2;
        model.position.x += approach * horizontalTravel;
        model.position.y -= horizontalRelay.lift * 0.06;
        model.position.z -= horizontalRelay.lift * 0.14;
        relayYaw = approach * 0.1;
      }
      model.rotation.set(
        base.x + pointer.y * 0.075 + passage * 0.045 + modelDragY,
        base.y + pointer.x * 0.11 - passage * 0.34 + modelDragX
          + transitionDirection * maskedPush * 0.045 + relayYaw,
        base.z - passage * 0.055,
      );
      setModelOpacity(model, opacity);
    });

    if (heroRibbon && models[0]?.userData.filmSocket && models[0]?.userData.collisionProxy) {
      scene.updateMatrixWorld(true);
      models[0].userData.filmSocket.getWorldPosition(ribbonAnchor);
      models[0].getWorldScale(ribbonWorldScale);
      const proxy = models[0].userData.collisionProxy;
      proxy.getWorldPosition(collisionCenter);
      proxy.getWorldScale(collisionScale);
      proxy.getWorldQuaternion(collisionQuaternion);
      collisionMatrix.copy(proxy.matrixWorld);
      collisionInverseMatrix.copy(collisionMatrix).invert();
      collisionInverseLinear.setFromMatrix4(collisionInverseMatrix);
      collisionAxis.set(0, 1, 0).applyQuaternion(collisionQuaternion).normalize();
      const measuredFilmWidth = models[0].userData.labelHeight * ribbonWorldScale.y;
      const radialScale = Math.max(collisionScale.x, collisionScale.z);
      const collision = {
        matrix: collisionMatrix,
        inverseMatrix: collisionInverseMatrix,
        inverseLinear: collisionInverseLinear,
        worldAxis: collisionAxis,
        radius: proxy.userData.radius,
        halfHeight: proxy.userData.halfHeight + measuredFilmWidth / Math.max(0.001, collisionScale.y),
        // The collision shell is the measured cartridge body plus only the
        // felt lip / film thickness allowance — no oversized invisible bubble.
        clearance: 0.028 / Math.max(0.001, radialScale),
        socketWorld: ribbonAnchor.clone(),
        socketRadius: 0,
        egressLength: measuredFilmWidth * 0.16 + 0.18,
        orientationTransition: measuredFilmWidth * 0.28 / Math.max(0.001, radialScale),
      };
      radialDirection.copy(ribbonAnchor).sub(collisionCenter);
      radialDirection.addScaledVector(collisionAxis, -radialDirection.dot(collisionAxis)).normalize();
      const layoutTargets = ribbonScreenTargets.map(([clientX, clientY]) => (
        screenToWorld(
          clientX,
          clientY,
          Math.max(ribbonAnchor.z + 0.12, collisionCenter.z + proxy.userData.radius * radialScale + 0.1),
        )
      ));
      socketLocal.copy(ribbonAnchor).applyMatrix4(collisionInverseMatrix);
      collision.socketRadius = Math.hypot(socketLocal.x, socketLocal.z);
      targetLocal.copy(layoutTargets[0] || ribbonAnchor).applyMatrix4(collisionInverseMatrix);
      const socketAngle = Math.atan2(socketLocal.x, socketLocal.z);
      const targetAngle = Math.atan2(targetLocal.x, targetLocal.z);
      const shortestAngleDelta = Math.atan2(
        Math.sin(targetAngle - socketAngle),
        Math.cos(targetAngle - socketAngle),
      );
      if (unwrappedWallAngle === null || previousWallAngle === null) {
        unwrappedWallAngle = shortestAngleDelta;
      } else {
        unwrappedWallAngle += Math.atan2(
          Math.sin(shortestAngleDelta - previousWallAngle),
          Math.cos(shortestAngleDelta - previousWallAngle),
        );
      }
      previousWallAngle = shortestAngleDelta;
      const accumulatedTurns = Math.trunc(unwrappedWallAngle / (Math.PI * 2));
      const fractionalTurnAngle = unwrappedWallAngle - accumulatedTurns * Math.PI * 2;
      const visibleTurns = clamp(accumulatedTurns, -8, 8);
      const angleDelta = visibleTurns * Math.PI * 2 + fractionalTurnAngle;
      const wallRadius = proxy.userData.radius + collision.clearance;
      const arcSteps = Math.max(3, Math.ceil(Math.abs(angleDelta) / (Math.PI / 18)));
      const pathPoints = [ribbonAnchor.clone()];
      for (let step = 1; step <= arcSteps; step += 1) {
        const amount = step / arcSteps;
        const angle = socketAngle + angleDelta * amount;
        const wrappedTurns = Math.abs(angle - socketAngle) / (Math.PI * 2);
        const layerRadius = wallRadius + wrappedTurns * 0.0025;
        const radius = THREE.MathUtils.lerp(
          collision.socketRadius,
          layerRadius,
          smoothstep(0, Math.min(0.34, 0.8 / Math.max(1, arcSteps)), amount),
        );
        pathPoints.push(new THREE.Vector3(
          Math.sin(angle) * radius,
          socketLocal.y,
          Math.cos(angle) * radius,
        ).applyMatrix4(collisionMatrix));
      }
      pathPoints.push(new THREE.Vector3(
        Math.sin(targetAngle) * (wallRadius + measuredFilmWidth * 0.18 / radialScale),
        socketLocal.y,
        Math.cos(targetAngle) * (wallRadius + measuredFilmWidth * 0.18 / radialScale),
      ).applyMatrix4(collisionMatrix));
      pathPoints.push(...layoutTargets);
      if (pathPoints.length > 2) {
        const layoutCurve = new THREE.CatmullRomCurve3(pathPoints, false, "centripetal", 0.38);
        reshapeRibbonGeometry(heroRibbon, layoutCurve, measuredFilmWidth, collision);
      }
      heroRibbon.position.set(0, 0, 0);
      heroRibbon.scale.setScalar(1);
      heroRibbon.material.opacity = 0.68;
      const scrollWrap = smoothstep(0.035, 0.29, scrollProgress);
      const frameTravel = scrollProgress * 3.6;
      heroRibbon.material.map.offset.x = frameTravel;
      heroRibbon.material.alphaMap.offset.x = frameTravel;
      heroRibbon.material.userData.museFrameTexture.offset.x = frameTravel;
      updateFlexibleFilm(heroRibbon, scrollWrap);
    }
  }

  function resize() {
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    narrowLayout = width < 760;
    camera.position.z = width < 520 ? 13.6 : 11.7;
    camera.updateProjectionMatrix();
    cacheRibbonTargets();
    applyScrollDirection();
    renderer.render(scene, camera);
  }

  function animate(time) {
    animationFrame = 0;
    if (!visible || destroyed) return;
    applyScrollDirection(time);
    renderer.render(scene, camera);
    if (!reducedMotion) animationFrame = requestAnimationFrame(animate);
  }

  function start() {
    if (animationFrame || !visible || destroyed) return;
    animationFrame = requestAnimationFrame(animate);
  }

  function stopDrag(event) {
    if (dragPointerId === null || (event && event.pointerId !== dragPointerId)) return;
    if (event && host.hasPointerCapture?.(event.pointerId)) host.releasePointerCapture(event.pointerId);
    dragPointerId = null;
    host.classList.remove("is-dragging");
  }

  host.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (!models[0]?.visible || modelOpacity(0, scrollProgress) <= 0.4) return;
    dragPointerId = event.pointerId;
    dragLastX = event.clientX;
    dragLastY = event.clientY;
    dragVelocityX = 0;
    dragVelocityY = 0;
    previousAnimationTime = performance.now();
    pointer.set(0, 0);
    host.classList.add("is-dragging");
    host.setPointerCapture?.(event.pointerId);
    start();
  });

  host.addEventListener("pointermove", (event) => {
    if (event.pointerId === dragPointerId) {
      const deltaX = event.clientX - dragLastX;
      const deltaY = event.clientY - dragLastY;
      dragLastX = event.clientX;
      dragLastY = event.clientY;
      const rotationDeltaX = deltaX * 0.006;
      const rotationDeltaY = deltaY * 0.004;
      dragRotation.x += rotationDeltaX;
      dragRotation.y = clamp(dragRotation.y + rotationDeltaY, -0.5, 0.5);
      dragVelocityX = clamp(rotationDeltaX * 60, -18, 18);
      dragVelocityY = clamp(rotationDeltaY * 60, -5, 5);
      pointer.set(0, 0);
      if (event.pointerType !== "touch") event.preventDefault();
      start();
      return;
    }
    if (reducedMotion || event.pointerType === "touch") return;
    const bounds = host.getBoundingClientRect();
    pointer.set(
      ((event.clientX - bounds.left) / Math.max(1, bounds.width) - 0.5) * 2,
      -((event.clientY - bounds.top) / Math.max(1, bounds.height) - 0.5) * 2,
    );
  });
  host.addEventListener("pointerup", stopDrag);
  host.addEventListener("pointercancel", stopDrag);
  host.addEventListener("lostpointercapture", stopDrag);
  host.addEventListener("pointerleave", () => pointer.set(0, 0), { passive: true });
  host.addEventListener("cinematic-progress", (event) => {
    targetScrollProgress = Number(event.detail?.progress || 0);
    start();
  });

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);

  const visibilityObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) {
      ensureModels();
      start();
    }
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
  if (!finale) ensureModels();
  start();

  window.addEventListener("pagehide", () => {
    destroyed = true;
    resizeObserver.disconnect();
    visibilityObserver.disconnect();
    if (animationFrame) cancelAnimationFrame(animationFrame);
    models.filter(Boolean).forEach(disposeModel);
    if (heroRibbon) disposeModel(heroRibbon);
    transitionMask.remove();
    renderer.dispose();
  }, { once: true });
}
