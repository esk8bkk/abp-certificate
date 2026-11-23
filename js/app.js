import {
  clampView,
  drawFrame,
  formatPassDate,
  loadImage,
  whenFontsReady,
} from "./render.js";

const FRAME_COPY = {
  "personal-portrait": { th: "ส่วนตัว · แนวตั้ง", en: "Personal" },
  "personal-story": { th: "สตอรี่", en: "Story" },
  "group-landscape": { th: "รูปหมู่", en: "Group" },
};

const FULL_WIDTH = new Set(["name", "date", "classOf"]);

const state = {
  specs: null,
  frameId: "personal-portrait",
  overlays: new Map(),
  photo: null,
  view: { zoom: 1, panX: 0, panY: 0 },
  values: {},
  ready: false,
};

const preview = document.getElementById("preview");
const previewCtx = preview.getContext("2d", { alpha: false });
const framesEl = document.getElementById("frames");
const fieldsEl = document.getElementById("fields");
const photoInput = document.getElementById("photo");
const photoTitle = document.getElementById("photo-title");
const photoSub = document.getElementById("photo-sub");
const zoomRow = document.getElementById("zoom-row");
const zoomSlider = document.getElementById("zoom");
const resetView = document.getElementById("reset-view");
const statusEl = document.getElementById("status");
const downloadBtn = document.getElementById("download");
const shareBtn = document.getElementById("share");
const sheet = document.getElementById("sheet");
const sheetHelp = document.getElementById("sheet-help");
const sheetImg = document.getElementById("sheet-img");
const sheetDownload = document.getElementById("sheet-download");
const sheetShare = document.getElementById("sheet-share");
const sheetClose = document.getElementById("sheet-close");

const pointers = new Map();
let pinch = null;
let raf = 0;
let previewScale = 1;
let lastBlob = null;
let sheetUrl = "";

function frameById(id) {
  return state.specs.frames.find((frame) => frame.id === id);
}

function currentFrame() {
  return frameById(state.frameId);
}

function setStatus(message) {
  statusEl.textContent = message || "";
}

function today() {
  return formatPassDate(new Date());
}

function isIOS() {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function filename() {
  const raw = (state.values.date || "card").toUpperCase();
  const slug = raw.replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `ABP-certificate-${slug || "card"}.png`;
}

function fieldList() {
  const seen = new Set();
  const fields = [];
  for (const frame of state.specs.frames) {
    for (const field of frame.fields) {
      if (seen.has(field.id)) continue;
      seen.add(field.id);
      fields.push(field);
    }
  }
  return fields;
}

function splitLabel(label) {
  const parts = String(label).split(/\s+\/\s+/);
  if (parts.length < 2) return { en: label, th: label };
  return { en: parts[0], th: parts.slice(1).join(" / ") };
}

function buildFrames() {
  for (const frame of state.specs.frames) {
    const copy = FRAME_COPY[frame.id] || { th: frame.id, en: frame.id };
    const button = document.createElement("button");
    button.type = "button";
    button.className = "frame-card";
    button.role = "radio";
    button.dataset.frame = frame.id;
    button.setAttribute("aria-checked", frame.id === state.frameId ? "true" : "false");
    button.innerHTML = `<span class="thumb"><img alt="" src="assets/frames/${frame.file}"></span><span class="th"></span><span class="en"></span>`;
    button.querySelector(".th").textContent = copy.th;
    button.querySelector(".en").textContent = copy.en;
    button.addEventListener("click", () => selectFrame(frame.id));
    framesEl.appendChild(button);
  }
}

function selectFrame(id) {
  state.frameId = id;
  for (const button of framesEl.querySelectorAll(".frame-card")) {
    button.setAttribute("aria-checked", button.dataset.frame === id ? "true" : "false");
  }
  const frame = currentFrame();
  const visible = new Set(frame.fields.map((field) => field.id));
  for (const field of frame.fields) {
    const wrap = fieldsEl.querySelector(`.field[data-id="${field.id}"]`);
    if (wrap) fieldsEl.appendChild(wrap);
  }
  for (const wrap of fieldsEl.querySelectorAll(".field")) {
    wrap.hidden = !visible.has(wrap.dataset.id);
  }
  if (state.photo) state.view = clampView(state.photo.width, state.photo.height, currentFrame().photo.width, currentFrame().photo.height, state.view);
  scheduleDraw();
}

function buildFields() {
  for (const field of fieldList()) {
    const { en, th } = splitLabel(field.label);
    const wrap = document.createElement("div");
    wrap.className = "field";
    wrap.dataset.id = field.id;
    if (FULL_WIDTH.has(field.id)) wrap.dataset.span = "full";
    const label = document.createElement("label");
    const inputId = `field-${field.id}`;
    label.htmlFor = inputId;
    label.innerHTML = `<span class="th"></span><span class="en"></span>`;
    label.querySelector(".th").textContent = th;
    label.querySelector(".en").textContent = en;
    const control = field.maxLines > 1 ? document.createElement("textarea") : document.createElement("input");
    control.id = inputId;
    control.dataset.field = field.id;
    if (control.tagName === "TEXTAREA") {
      control.rows = field.maxLines;
      control.maxLength = 80;
    } else {
      control.type = "text";
      control.maxLength = field.id === "date" ? 24 : 16;
      if (field.id === "round" || field.id === "classOf") control.inputMode = "numeric";
      if (field.id === "seat" || field.id === "gate" || field.id === "date") control.autocapitalize = "characters";
    }
    control.autocomplete = field.id === "name" ? "name" : "off";
    control.spellcheck = false;
    control.placeholder = field.sample || "";
    if (field.id === "date") control.value = today();
    state.values[field.id] = control.value;
    control.addEventListener("input", () => {
      let value = control.value;
      if (field.id === "date" || field.id === "seat" || field.id === "gate") {
        const upper = value.replace(/[a-z]/g, (ch) => ch.toUpperCase());
        if (upper !== value) {
          const pos = control.selectionStart;
          control.value = upper;
          if (pos != null) control.setSelectionRange(pos, pos);
          value = upper;
        }
      }
      state.values[field.id] = value;
      setStatus("");
      scheduleDraw();
    });
    wrap.append(label, control);
    fieldsEl.appendChild(wrap);
  }
  selectFrame(state.frameId);
}

function layoutPreview() {
  const frame = currentFrame();
  const wrap = preview.parentElement;
  const maxW = Math.max(160, wrap.clientWidth);
  const maxH = Math.max(220, Math.min(window.innerHeight * 0.5, 720));
  const cssScale = Math.min(maxW / frame.width, maxH / frame.height);
  const cssW = Math.max(1, Math.round(frame.width * cssScale));
  const cssH = Math.max(1, Math.round(frame.height * cssScale));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  preview.style.width = `${cssW}px`;
  preview.style.height = `${cssH}px`;
  const bw = Math.max(1, Math.round(cssW * dpr));
  const bh = Math.max(1, Math.round(cssH * dpr));
  if (preview.width !== bw || preview.height !== bh) {
    preview.width = bw;
    preview.height = bh;
  }
  previewScale = bw / frame.width;
}

function scheduleDraw() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    drawPreview();
  });
}

function drawPreview() {
  if (!state.ready) return;
  layoutPreview();
  const frame = currentFrame();
  drawFrame(previewCtx, {
    frame,
    overlay: state.overlays.get(frame.id),
    photo: state.photo,
    values: state.values,
    view: state.view,
    scale: previewScale,
    emptyFill: "#e7dfF0",
  });
}

async function bitmapFromFile(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* fall through to Image decode */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await loadImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function screenToFull(dx, dy) {
  const rect = preview.getBoundingClientRect();
  const frame = currentFrame();
  return [(dx * frame.width) / rect.width, (dy * frame.height) / rect.height];
}

function applyClampedView() {
  if (!state.photo) return;
  const photoBox = currentFrame().photo;
  state.view = clampView(state.photo.width, state.photo.height, photoBox.width, photoBox.height, state.view);
  zoomSlider.value = String(state.view.zoom);
}

function pointerDistance() {
  const pts = [...pointers.values()];
  if (pts.length < 2) return 0;
  return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
}

preview.addEventListener("pointerdown", (event) => {
  if (!state.photo) return;
  preview.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 2) pinch = { dist: pointerDistance(), zoom: state.view.zoom };
});

preview.addEventListener("pointermove", (event) => {
  if (!pointers.has(event.pointerId) || !state.photo) return;
  const prev = pointers.get(event.pointerId);
  const next = { x: event.clientX, y: event.clientY };
  pointers.set(event.pointerId, next);
  if (pointers.size >= 2 && pinch && pinch.dist > 0) {
    const dist = pointerDistance();
    state.view.zoom = Math.min(3, Math.max(1, pinch.zoom * (dist / pinch.dist)));
    applyClampedView();
    scheduleDraw();
    return;
  }
  if (pointers.size > 1) return;
  const [dx, dy] = screenToFull(next.x - prev.x, next.y - prev.y);
  state.view.panX += dx;
  state.view.panY += dy;
  applyClampedView();
  scheduleDraw();
});

function endPointer(event) {
  pointers.delete(event.pointerId);
  if (pointers.size < 2) pinch = null;
}

preview.addEventListener("pointerup", endPointer);
preview.addEventListener("pointercancel", endPointer);

zoomSlider.addEventListener("input", () => {
  state.view.zoom = Number(zoomSlider.value);
  applyClampedView();
  scheduleDraw();
});

resetView.addEventListener("click", () => {
  state.view = { zoom: 1, panX: 0, panY: 0 };
  zoomSlider.value = "1";
  scheduleDraw();
});

photoInput.addEventListener("change", async () => {
  const file = photoInput.files && photoInput.files[0];
  if (!file) return;
  try {
    const bitmap = await bitmapFromFile(file);
    if (state.photo && typeof state.photo.close === "function") state.photo.close();
    state.photo = bitmap;
    state.view = { zoom: 1, panX: 0, panY: 0 };
    zoomSlider.value = "1";
    zoomRow.hidden = false;
    photoTitle.textContent = "เปลี่ยนรูปถ่าย";
    photoSub.textContent = "Change photo";
    setStatus("");
    scheduleDraw();
  } catch {
    setStatus("เปิดรูปไม่สำเร็จ ลองเลือกไฟล์ JPG หรือ PNG");
  }
});

function renderFullCanvas() {
  const frame = currentFrame();
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext("2d", { alpha: false });
  drawFrame(ctx, {
    frame,
    overlay: state.overlays.get(frame.id),
    photo: state.photo,
    values: state.values,
    view: state.view,
    scale: 1,
  });
  return canvas;
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("สร้างไฟล์ PNG ไม่สำเร็จ"));
    }, "image/png");
  });
}

async function exportBlob() {
  if (!state.ready) throw new Error("กำลังเตรียมแบบบัตร");
  if (!state.photo) {
    setStatus("เลือกรูปถ่ายก่อนดาวน์โหลด");
    throw new Error("missing photo");
  }
  const personal = currentFrame().fields.some((field) => field.id === "name");
  if (personal && !String(state.values.name || "").trim()) {
    setStatus("ใส่ชื่อผู้เข้าอบรมก่อนดาวน์โหลด");
    document.getElementById("field-name")?.focus();
    throw new Error("missing name");
  }
  setStatus("");
  return canvasToBlob(renderFullCanvas());
}

function triggerDownload(blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename();
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

function closeSheet() {
  sheet.hidden = true;
  if (sheetUrl) {
    URL.revokeObjectURL(sheetUrl);
    sheetUrl = "";
  }
  sheetImg.removeAttribute("src");
  downloadBtn.focus();
}

function openSheet(blob) {
  if (sheetUrl) URL.revokeObjectURL(sheetUrl);
  sheetUrl = URL.createObjectURL(blob);
  lastBlob = blob;
  sheetImg.src = sheetUrl;
  sheetDownload.href = sheetUrl;
  sheetDownload.download = filename();
  sheetHelp.textContent = isIOS()
    ? "บน iPhone การดาวน์โหลดอาจไม่เริ่มเอง กด «แชร์ / บันทึกรูปภาพ» แล้วเลือกบันทึกรูป หรือกดค้างที่รูปแล้วเลือกเพิ่มในรูปภาพ"
    : "กดดาวน์โหลดได้เลย ถ้าไฟล์ไม่เข้าคลังรูป ให้กดแชร์หรือกดค้างที่รูปแล้วบันทึก";
  sheet.hidden = false;
  sheetClose.focus();
}

async function shareBlob(blob) {
  const file = new File([blob], filename(), { type: "image/png" });
  if (!navigator.canShare || !navigator.canShare({ files: [file] })) return false;
  await navigator.share({
    files: [file],
    title: "ABP Certificate",
    text: "บัตรรับรอง ABP · THAI Flight Training",
  });
  return true;
}

async function onDownload() {
  downloadBtn.disabled = true;
  try {
    const blob = await exportBlob();
    if (isIOS()) openSheet(blob);
    else triggerDownload(blob);
  } catch (error) {
    if (error.message !== "missing photo" && error.message !== "missing name") {
      setStatus("สร้างรูปไม่สำเร็จ ลองอีกครั้ง");
    }
  } finally {
    downloadBtn.disabled = false;
  }
}

async function onShare() {
  shareBtn.disabled = true;
  try {
    const blob = await exportBlob();
    openSheet(blob);
    try {
      await shareBlob(blob);
    } catch (error) {
      if (error && error.name === "AbortError") return;
    }
  } catch (error) {
    if (error.message !== "missing photo" && error.message !== "missing name") {
      setStatus("สร้างรูปไม่สำเร็จ ลองอีกครั้ง");
    }
  } finally {
    shareBtn.disabled = false;
  }
}

downloadBtn.addEventListener("click", onDownload);
shareBtn.addEventListener("click", onShare);
sheetClose.addEventListener("click", closeSheet);
sheet.addEventListener("click", (event) => {
  if (event.target === sheet) closeSheet();
});
sheetShare.addEventListener("click", async () => {
  if (!lastBlob) return;
  try {
    const shared = await shareBlob(lastBlob);
    if (!shared) {
      sheetHelp.textContent = "เครื่องนี้ไม่เปิดแผงแชร์ไฟล์ กดค้างที่รูปแล้วเลือกบันทึกรูปภาพ";
    }
  } catch (error) {
    if (!error || error.name !== "AbortError") {
      sheetHelp.textContent = "แชร์ไม่สำเร็จ กดค้างที่รูปแล้วเลือกบันทึกรูปภาพ";
    }
  }
});

fieldsEl.addEventListener("submit", (event) => event.preventDefault());

window.addEventListener("resize", scheduleDraw);

async function init() {
  try {
    const response = await fetch("specs.json");
    if (!response.ok) throw new Error("specs");
    state.specs = await response.json();
    await whenFontsReady();
    await Promise.all(state.specs.frames.map(async (frame) => {
      const image = await loadImage(`assets/frames/${frame.file}`);
      state.overlays.set(frame.id, image);
    }));
    buildFrames();
    buildFields();
    state.ready = true;
    drawPreview();
    if (new URLSearchParams(location.search).has("test")) {
      window.__abpTest = {
        exportPNG() {
          const canvas = renderFullCanvas();
          return canvas.toDataURL("image/png");
        },
        state,
      };
    }
  } catch {
    setStatus("โหลดแบบบัตรไม่สำเร็จ ลองเปิดหน้านี้ใหม่อีกครั้ง");
    downloadBtn.disabled = true;
    shareBtn.disabled = true;
  }
}

init();
