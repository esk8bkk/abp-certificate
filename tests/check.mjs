// Headless check for the static ABP certificate page.
// Usage: node tests/check.mjs <artifact-dir> <mockup-dir>
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire("/tmp/abp-test/package.json");
const puppeteer = require("puppeteer-core");

const artifactDir = path.resolve(process.argv[2] || "/tmp/abp-artifacts");
const mockupDir = path.resolve(process.argv[3]);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 8765;
const base = `http://127.0.0.1:${port}`;

const SHORT = {
  name: "สมชาย ใจดี",
  date: "23 NOV 2026",
  round: "1",
  seat: "16C",
  gate: "A1",
};
const LONG = {
  name: "ชยานนท์ มีมารยาตร์ ณ อยุธยาวงศ์ศักดิ์ ศรีสุวรรณภูมิ",
  date: "28 DEC 2026",
  round: "4",
  seat: "32K",
  gate: "D12",
};
const GROUP = { round: "1", date: "23 NOV 2026", classOf: "2026" };

function serve() {
  const child = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return child;
}

async function waitForServer() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const response = await fetch(`${base}/`);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("local server did not start");
}

async function savePng(buffer, name) {
  const file = path.join(artifactDir, name);
  await writeFile(file, Buffer.from(buffer));
  return file;
}

async function main() {
  await mkdir(artifactDir, { recursive: true });
  const server = serve();
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
  });
  const external = [];
  try {
    await waitForServer();
    const page = await browser.newPage();
    page.on("request", (request) => {
      const url = request.url();
      if (!url.startsWith(base) && !url.startsWith("data:") && !url.startsWith("blob:")) external.push(url);
    });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

    await page.goto(`${base}/tests/harness.html`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => window.__render && window.__render.fontsReady);
    const metrics = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const baselines = [];
      for (const frame of window.__render.specs.frames) {
        for (const field of frame.fields) {
          const got = window.__render.baselineFor(field, field.size);
          baselines.push({ frame: frame.id, id: field.id, got, expected: field.baseline, ok: got === field.baseline });
          ctx.font = `${field.weight} ${field.size}px ${field.font}`;
        }
      }
      ctx.font = "800 46px Sarabun";
      const nameWidth = ctx.measureText("สมชาย ใจดี").width;
      const long = window.__render.layoutField(
        ctx,
        window.__render.specs.frames[0].fields[0],
        "ชยานนท์ มีมารยาตร์ ณ อยุธยาวงศ์ศักดิ์ ศรีสุวรรณภูมิ",
      );
      return { baselines, nameWidth, long };
    });
    if (metrics.baselines.some((item) => !item.ok)) {
      throw new Error(`baseline mismatch ${JSON.stringify(metrics.baselines)}`);
    }
    if (metrics.nameWidth < 180 || metrics.nameWidth > 280) {
      throw new Error(`Sarabun measureText unexpected: ${metrics.nameWidth}`);
    }
    if (metrics.long.lines.length !== 2 || metrics.long.size !== 46) {
      throw new Error(`long name layout ${JSON.stringify(metrics.long)}`);
    }
    console.log("font", metrics.nameWidth.toFixed(1), "long lines", metrics.long.lines);

    async function renderCase(name, frameId, values, view) {
      const result = await page.evaluate(async (payload) => {
        const rendered = await window.__render.renderFrame(payload);
        const bytes = new Uint8Array(rendered.png);
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        return {
          width: rendered.width,
          height: rendered.height,
          layouts: rendered.layouts,
          b64: btoa(binary),
        };
      }, { frameId, values, photoUrl: "../tests/fixtures/sample-photo.png", view });
      await savePng(Buffer.from(result.b64, "base64"), `${name}.png`);
      console.log("rendered", name, result.width, result.height, "name lines", result.layouts.name?.lines?.length ?? "-");
      return result;
    }

    await renderCase("personal-portrait", "personal-portrait", SHORT, { zoom: 1, panX: 0, panY: 0 });
    const zoomed = await renderCase("personal-portrait-zoom", "personal-portrait", SHORT, { zoom: 2, panX: 0, panY: 0 });
    await renderCase("personal-portrait-longname", "personal-portrait", LONG, { zoom: 1, panX: 0, panY: 0 });
    await renderCase("personal-story", "personal-story", SHORT, { zoom: 1, panX: 0, panY: 0 });
    await renderCase("group-landscape", "group-landscape", GROUP, { zoom: 1, panX: 0, panY: 0 });
    if (!zoomed) throw new Error("missing zoom render");

    await page.goto(`${base}/?test=1`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => {
      const canvas = document.getElementById("preview");
      return canvas && canvas.width > 100 && window.__abpTest;
    });
    await page.screenshot({ path: path.join(artifactDir, "ui-phone-landing.png") });

    const photoInput = await page.$("#photo");
    await photoInput.uploadFile(path.join(root, "tests/fixtures/sample-photo.png"));
    await page.waitForFunction(() => !document.getElementById("zoom-row").hidden);
    async function fill(values) {
      await page.evaluate((next) => {
        for (const [id, value] of Object.entries(next)) {
          const el = document.getElementById(`field-${id}`);
          if (!el) continue;
          el.value = value;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }, values);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    await fill(SHORT);
    await page.screenshot({ path: path.join(artifactDir, "ui-phone-portrait.png"), fullPage: true });

    await page.click('[data-frame="personal-story"]');
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: path.join(artifactDir, "ui-phone-story.png"), fullPage: true });

    await page.click('[data-frame="group-landscape"]');
    await fill(GROUP);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: path.join(artifactDir, "ui-phone-group.png"), fullPage: true });

    await page.click('[data-frame="personal-portrait"]');
    await fill(LONG);
    await page.$eval("#zoom", (el) => {
      el.value = "2";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const uiPng = await page.evaluate(() => window.__abpTest.exportPNG());
    const uiBytes = Buffer.from(uiPng.split(",")[1], "base64");
    await writeFile(path.join(artifactDir, "ui-export-longname-zoom.png"), uiBytes);
    await page.screenshot({ path: path.join(artifactDir, "ui-phone-longname.png"), fullPage: true });

    await page.click("#share");
    await page.waitForSelector("#sheet:not([hidden])");
    await page.screenshot({ path: path.join(artifactDir, "ui-phone-save.png") });

    if (external.length) {
      throw new Error(`certificate page requested external hosts: ${external.join(", ")}`);
    }

    const deckPage = await browser.newPage();
    const deckStatus = await deckPage.goto(`${base}/deck/`, { waitUntil: "domcontentloaded" });
    if (!deckStatus.ok()) throw new Error(`deck status ${deckStatus.status()}`);
    const deckTitle = await deckPage.title();
    console.log("deck", deckStatus.status(), deckTitle);
    await deckPage.close();
  } finally {
    await browser.close();
    server.kill("SIGTERM");
  }

  const compare = spawn("python3", [path.join(root, "tests/compare_positions.py"), artifactDir, mockupDir], {
    stdio: "inherit",
  });
  const code = await new Promise((resolve) => compare.on("exit", resolve));
  if (code !== 0) process.exit(code);
  console.log("external requests: none");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
