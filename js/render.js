// Composite an ABP certificate. Drawing order is fixed by the frame spec:
// 1. White canvas at the frame's full size.
// 2. Photo, object-fit cover, clipped to the rounded photo window.
// 3. Overlay PNG at (0, 0) — labels, logo, stamp, and decorative QR stay baked in.
// 4. Field values only.

export function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

// zoom 1 = cover. panX/panY are in the same pixel space as boxW/boxH.
export function coverPlacement(imgW, imgH, boxW, boxH, view) {
  const zoom = Math.max(1, view?.zoom || 1);
  const base = Math.max(boxW / imgW, boxH / imgH);
  const scale = base * zoom;
  const w = imgW * scale;
  const h = imgH * scale;
  let x = (boxW - w) / 2 + (view?.panX || 0);
  let y = (boxH - h) / 2 + (view?.panY || 0);
  x = Math.min(0, Math.max(boxW - w, x));
  y = Math.min(0, Math.max(boxH - h, y));
  return { x, y, w, h };
}

export function clampView(imgW, imgH, boxW, boxH, view) {
  const zoom = Math.max(1, view?.zoom || 1);
  const placed = coverPlacement(imgW, imgH, boxW, boxH, { zoom, panX: view?.panX || 0, panY: view?.panY || 0 });
  const base = Math.max(boxW / imgW, boxH / imgH);
  const w = imgW * base * zoom;
  const h = imgH * base * zoom;
  return {
    zoom,
    panX: placed.x - (boxW - w) / 2,
    panY: placed.y - (boxH - h) / 2,
  };
}

export function wrapText(ctx, text, maxWidth) {
  const clean = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!clean) return [];
  const lines = [];
  for (const para of clean.split("\n")) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    let current = words[0];
    for (let i = 1; i < words.length; i += 1) {
      const trial = `${current} ${words[i]}`;
      if (ctx.measureText(trial).width <= maxWidth + 0.5) current = trial;
      else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
  }
  return lines;
}

export function baselineFor(field, size) {
  return field.y + Math.round(1.08 * size);
}

// Shrink toward minSize when the text is wider than the box or needs more
// than maxLines. Baseline follows y + round(1.08 * size). lineHeight stays
// the value in the spec. At minSize, extra lines are dropped.
export function layoutField(ctx, field, text) {
  const clean = String(text ?? "").trim();
  if (!clean) {
    return {
      lines: [],
      size: field.size,
      lineHeight: field.lineHeight,
      baseline: field.baseline,
    };
  }
  let size = field.size;
  let lines = [];
  while (size >= field.minSize) {
    ctx.font = `${field.weight} ${size}px ${field.font}`;
    lines = wrapText(ctx, clean, field.width);
    const tooWide = lines.some((line) => ctx.measureText(line).width > field.width + 0.5);
    const tooMany = lines.length > field.maxLines;
    if (!tooWide && !tooMany) break;
    if (size === field.minSize) {
      lines = lines.slice(0, field.maxLines);
      break;
    }
    size -= 1;
  }
  return {
    lines,
    size,
    lineHeight: field.lineHeight,
    baseline: baselineFor(field, size),
  };
}

function drawField(ctx, field, text, scale) {
  const layout = layoutField(ctx, field, text);
  if (!layout.lines.length) return layout;
  ctx.font = `${field.weight} ${layout.size * scale}px ${field.font}`;
  ctx.fillStyle = field.color;
  ctx.textAlign = field.align || "left";
  ctx.textBaseline = "alphabetic";
  const width = field.width * scale;
  let x = field.x * scale;
  if (ctx.textAlign === "center") x += width / 2;
  else if (ctx.textAlign === "right") x += width;
  for (let i = 0; i < layout.lines.length; i += 1) {
    const y = (layout.baseline + i * layout.lineHeight) * scale;
    ctx.fillText(layout.lines[i], x, y);
  }
  return layout;
}

export function drawFrame(ctx, { frame, overlay, photo, values, view, scale = 1, emptyFill = "#ffffff" }) {
  const width = Math.round(frame.width * scale);
  const height = Math.round(frame.height * scale);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const p = frame.photo;
  const x = p.x * scale;
  const y = p.y * scale;
  const w = p.width * scale;
  const h = p.height * scale;
  const r = p.radius * scale;

  ctx.save();
  roundedRect(ctx, x, y, w, h, r);
  ctx.clip();
  if (photo) {
    const scaledView = {
      zoom: view?.zoom || 1,
      panX: (view?.panX || 0) * scale,
      panY: (view?.panY || 0) * scale,
    };
    const place = coverPlacement(photo.width, photo.height, w, h, scaledView);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(photo, x + place.x, y + place.y, place.w, place.h);
  } else {
    ctx.fillStyle = emptyFill;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(overlay, 0, 0, width, height);

  const layouts = {};
  for (const field of frame.fields) {
    layouts[field.id] = drawField(ctx, field, values?.[field.id] ?? "", scale);
  }
  return layouts;
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`โหลดไฟล์ไม่สำเร็จ: ${src}`));
    img.src = src;
  });
}

export async function whenFontsReady() {
  const weights = [500, 600, 700, 800];
  await Promise.all(weights.map((weight) => document.fonts.load(`${weight} 64px Sarabun`)));
  await document.fonts.ready;
  const missing = weights.filter((weight) => !document.fonts.check(`${weight} 64px Sarabun`));
  if (missing.length) {
    throw new Error(`Sarabun ไม่พร้อม (น้ำหนัก ${missing.join(", ")})`);
  }
}

export const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function formatPassDate(date) {
  const dd = String(date.getDate()).padStart(2, "0");
  return `${dd} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}
