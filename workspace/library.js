export const initialLibrary = () => ({
  revision: 0, rolls: [], films: [], cameras: [], books: [], instant: [], theme: "system", recipe: { title: "", seconds: 480 },
});

function openLibrary() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("musefilm-workspace", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("library");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadLibrary() {
  const database = await openLibrary();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction("library").objectStore("library").get("state");
      request.onsuccess = () => resolve({ ...initialLibrary(), ...request.result });
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export async function saveLibrary(library, expectedRevision) {
  const database = await openLibrary();
  try {
    await new Promise((resolve, reject) => {
      const tx = database.transaction("library", "readwrite");
      const store = tx.objectStore("library");
      const current = store.get("state");
      let conflict = false;
      current.onsuccess = () => {
        if ((current.result?.revision ?? 0) !== expectedRevision) {
          conflict = true;
          tx.abort();
        } else {
          store.put(library, "state");
        }
      };
      tx.oncomplete = resolve;
      tx.onabort = () => reject(conflict ? new Error("图库已在另一个标签页中更新，请刷新后重试。") : tx.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    database.close();
  }
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function canvasBlob(canvas, type = "image/png") {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("无法生成图片")),
    type,
    .94,
  ));
}

export async function loadImage(url) {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

export function fitImage(context, image, x, y, width, height) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const w = image.naturalWidth * scale;
  const h = image.naturalHeight * scale;
  context.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h);
}

export function photoQuality(image) {
  const canvas = document.createElement("canvas");
  canvas.width = 180;
  canvas.height = Math.max(1, Math.min(360, Math.round(180 * image.naturalHeight / image.naturalWidth)));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const gray = new Float32Array(pixels.length / 4);
  let shadows = 0;
  let highlights = 0;
  for (let i = 0; i < gray.length; i++) {
    const offset = i * 4;
    gray[i] = .2126 * pixels[offset] + .7152 * pixels[offset + 1] + .0722 * pixels[offset + 2];
    shadows += Number(gray[i] < 10);
    highlights += Number(gray[i] > 245);
  }
  let edges = 0;
  for (let y = 1; y < canvas.height - 1; y++) {
    for (let x = 1; x < canvas.width - 1; x++) {
      const i = y * canvas.width + x;
      const laplacian = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - canvas.width] - gray[i + canvas.width];
      edges += laplacian ** 2;
    }
  }
  return { sharpness: edges / gray.length, shadows: shadows / gray.length, highlights: highlights / gray.length };
}
