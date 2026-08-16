import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { findChromium } from './test-browser.mjs';
import { isMainModule, projectRoot, relativePath } from './project.mjs';

const width = 1920;
const height = 1080;
const fps = 30;
const transitionDuration = 0.65;
const outputRoot = path.join(projectRoot, 'promo-video');
const videoPath = path.join(outputRoot, 'dbopfs-studio-promo-1080p.mp4');
const posterPath = path.join(outputRoot, 'dbopfs-studio-promo-poster.png');
const jinglePath = path.join(outputRoot, 'source', 'dbopfs-studio-retro-jingle.wav');

const sourcePaths = Object.freeze({
  connect: path.join(projectRoot, 'store-assets', 'chrome', 'screenshots', '02-connect-to-site-1280x800.png'),
  dashboard: path.join(projectRoot, 'store-assets', 'chrome', 'screenshots', '01-dashboard-1280x800.png'),
  json: path.join(projectRoot, 'store-assets', 'chrome', 'screenshots', '03-json-inspector-1280x800.png'),
  markdown: path.join(projectRoot, 'store-assets', 'chrome', 'screenshots', '04-markdown-preview-1280x800.png'),
  pdf: path.join(projectRoot, 'store-assets', 'chrome', 'screenshots', '05-pdf-workflow-1280x800.png')
});

const scenePlan = Object.freeze([
  { duration: 4.2, transition: 'fade' },
  { duration: 4.5, transition: 'fade' },
  { duration: 4.5, transition: 'fade' },
  { duration: 4.8, transition: 'fade' },
  { duration: 5.1, transition: 'fade' },
  { duration: 4.4, transition: 'fade' },
  { duration: 5.0, transition: 'fade' }
]);

function totalDuration() {
  return scenePlan.reduce((total, scene) => total + scene.duration, 0) -
    transitionDuration * (scenePlan.length - 1);
}

function asDataUrl(bytes, mimeType = 'image/png') {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
}

async function loadVisualSources() {
  const entries = await Promise.all(
    Object.entries(sourcePaths).map(async ([name, filePath]) => [name, asDataUrl(await readFile(filePath))])
  );
  return Object.fromEntries(entries);
}

function brandLockup(markSvg, size = 'regular') {
  return `<div class="brand-lockup ${size}"><div class="brand-mark">${markSvg}</div>` +
    `<div><div class="brand-name">DBOPFS</div><div class="brand-studio">STUDIO</div></div></div>`;
}

function browserWindow(imageUrl, label, className = '') {
  return `<figure class="browser-window ${className}"><div class="window-bar">` +
    `<span class="dot red"></span><span class="dot gold"></span><span class="dot green"></span>` +
    `<span class="window-label">${label}</span></div><img src="${imageUrl}" alt="">` +
    `<span class="safe-ui-note">LOCAL BY DESIGN</span>` +
    `<span class="connection-note connection-note-left">NO AUTOMATIC EXTERNAL TRANSMISSION</span>` +
    `<span class="connection-note connection-note-right">NO AUTOMATIC EXTERNAL TRANSMISSION</span></figure>`;
}

function sceneDocument(body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
    :root{color-scheme:dark}
    *{box-sizing:border-box}
    html,body{width:${width}px;height:${height}px;margin:0;overflow:hidden}
    body{font-family:"Segoe UI",Arial,sans-serif;background:#030811;color:#f4ecd7}
    .stage{position:relative;width:100%;height:100%;overflow:hidden;background:
      radial-gradient(circle at 10% 0%,rgba(74,190,178,.20),transparent 36%),
      radial-gradient(circle at 94% 100%,rgba(171,148,255,.17),transparent 39%),
      linear-gradient(135deg,#030811 0%,#06101b 50%,#111526 100%)}
    .stage:before{content:"";position:absolute;inset:0;background-image:
      linear-gradient(rgba(174,184,204,.045) 1px,transparent 1px),
      linear-gradient(90deg,rgba(174,184,204,.045) 1px,transparent 1px);
      background-size:52px 52px;mask-image:linear-gradient(to bottom,black 0%,transparent 88%)}
    .stage:after{content:"";position:absolute;left:-310px;bottom:-450px;width:1040px;height:720px;
      border:2px solid rgba(76,51,88,.56);border-radius:50%;transform:rotate(14deg)}
    .orbital{position:absolute;right:-170px;top:-200px;width:780px;height:520px;border-radius:50%;
      border:2px solid rgba(74,190,178,.14);transform:rotate(-17deg)}
    .orbital:before{content:"";position:absolute;left:118px;bottom:36px;width:13px;height:13px;border-radius:50%;
      background:#d7a84d;box-shadow:0 0 28px rgba(215,168,77,.8)}
    .orbital:after{content:"";position:absolute;right:92px;top:82px;width:10px;height:10px;border-radius:50%;
      background:#4abeb2;box-shadow:0 0 24px rgba(74,190,178,.75)}
    .content{position:relative;z-index:2;width:100%;height:100%;padding:78px 92px}
    .kicker{margin:0 0 22px;color:#d7a84d;font-size:18px;font-weight:800;letter-spacing:5px;text-transform:uppercase}
    h1{margin:0;color:#f4ecd7;font:400 72px/1.05 Georgia,"Times New Roman",serif;letter-spacing:-2.8px}
    .subhead{margin:28px 0 0;color:#b8c4d8;font-size:26px;line-height:1.5;max-width:760px}
    .accent{color:#4abeb2}.gold{color:#d7a84d}
    .brand-lockup{display:flex;align-items:center;gap:24px}.brand-lockup .brand-mark{width:94px;height:94px;flex:none}
    .brand-lockup .brand-mark svg{display:block;width:100%;height:100%}.brand-name{font:400 52px/1 Georgia,"Times New Roman",serif}
    .brand-studio{margin-top:10px;color:#d7a84d;font-size:16px;font-weight:600;letter-spacing:11px}
    .brand-lockup.large{gap:32px}.brand-lockup.large .brand-mark{width:130px;height:130px}
    .brand-lockup.large .brand-name{font-size:76px}.brand-lockup.large .brand-studio{font-size:19px;letter-spacing:15px}
    .browser-window{position:relative;margin:0;border:1px solid rgba(174,184,204,.38);border-radius:22px;padding:12px;
      background:#151c2d;box-shadow:0 42px 90px rgba(0,0,0,.54);overflow:visible}
    .browser-window img{display:block;width:100%;height:auto;border-radius:11px}.window-bar{position:absolute;left:0;right:0;top:-42px;height:42px;
      display:flex;align-items:center;gap:12px;padding-left:24px}.dot{width:12px;height:12px;border-radius:50%}.red{background:#ef8383}.gold{background:#e6b75c}.green{background:#63c996}
    .window-label{margin-left:14px;color:#8493aa;font-size:13px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase}
    .safe-ui-note,.connection-note{display:none;position:absolute;z-index:3;background:#07111d;color:#b9c7da;border:1px solid rgba(74,190,178,.28);
      font-size:9px;font-weight:800;letter-spacing:1px;white-space:nowrap}
    .scrub-local .safe-ui-note{display:flex;align-items:center;justify-content:center;left:12px;bottom:3.5%;width:24%;height:6.4%;border-radius:0 7px 0 9px}
    .scrub-connection .connection-note{display:flex;align-items:center;justify-content:center;height:5.8%;border-radius:5px;font-size:8px;letter-spacing:.8px}
    .scrub-connection .connection-note-left{left:33.4%;top:55.1%;width:27.3%}.scrub-connection .connection-note-right{left:66.1%;top:51.3%;width:28.1%}
    .split{display:grid;grid-template-columns:660px 1fr;align-items:center;gap:78px;height:100%}.split.reverse{grid-template-columns:1fr 660px}
    .split.reverse .copy{order:2}.split.reverse .visual{order:1}.visual{min-width:0}.copy{position:relative;z-index:2}
    .feature-window{width:100%;transform:translateY(20px)}
    .pills{display:flex;flex-wrap:wrap;gap:12px;margin-top:34px}.pill{border:1px solid rgba(74,190,178,.38);border-radius:999px;
      padding:11px 17px;background:rgba(3,8,17,.54);color:#d5dfed;font-size:14px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase}
    .pill.emphasis{border-color:rgba(215,168,77,.48);color:#f4ecd7;background:rgba(215,168,77,.08)}
    .scene-number{position:absolute;right:92px;bottom:46px;color:#738197;font-size:14px;font-weight:800;letter-spacing:4px}
    .hero .content{display:grid;grid-template-columns:780px 1fr;align-items:center;gap:65px}.hero h1{margin-top:42px;font-size:88px;max-width:760px}
    .hero .subhead{max-width:670px}.hero .visual{transform:translate(0,30px)}.hero .browser-window{width:890px}
    .hero .browser-window:after{content:"SHIPPED UI · FICTIONAL DEMO DATA";position:absolute;right:26px;bottom:-42px;color:#6f7e95;font-size:12px;font-weight:800;letter-spacing:2.5px}
    .connection .split{grid-template-columns:635px 1fr}.connection .feature-window{width:1030px}
    .dashboard .split{grid-template-columns:1fr 610px;gap:72px}.dashboard .feature-window{width:1070px;transform:translate(-28px,22px)}
    .json-scene .feature-window{width:990px}.json-scene .signal{display:inline-flex;align-items:center;gap:12px;margin-top:30px;color:#d7a84d;font-weight:800}
    .json-scene .signal:before{content:"";width:9px;height:9px;border-radius:50%;background:#63c996;box-shadow:0 0 18px rgba(99,201,150,.8)}
    .preview .content{padding-top:66px}.preview header{display:flex;align-items:flex-end;justify-content:space-between;gap:60px}.preview header h1{font-size:66px;max-width:1060px}
    .preview header .subhead{max-width:600px;margin:0 0 4px;font-size:22px}.preview-grid{display:grid;grid-template-columns:1fr 1fr;gap:38px;margin-top:86px}
    .preview-grid .browser-window{width:100%}.preview-grid .window-label{font-size:12px}.preview-grid .browser-window:after{position:absolute;right:26px;bottom:22px;
      padding:9px 13px;border:1px solid rgba(215,168,77,.35);border-radius:999px;background:rgba(3,8,17,.85);color:#f4ecd7;font-size:12px;font-weight:800;letter-spacing:1.5px}
    .preview-grid .markdown:after{content:"LOCAL MARKDOWN RENDERER"}.preview-grid .pdf:after{content:"CHROMIUM-NATIVE PDF HANDOFF"}
    .local .content{display:grid;place-items:center;text-align:center}.local-card{position:relative;width:1240px;padding:72px 90px;border:1px solid rgba(174,184,204,.28);
      border-radius:34px;background:linear-gradient(145deg,rgba(5,12,23,.92),rgba(19,23,42,.88));box-shadow:0 40px 100px rgba(0,0,0,.48)}
    .local-card .brand-mark{width:116px;height:116px;margin:0 auto 28px}.local-card .brand-mark svg{width:100%;height:100%}.local-card h1{font-size:78px}
    .local-card .subhead{max-width:none}.assurances{display:flex;justify-content:center;gap:20px;margin-top:44px}.assurance{display:flex;align-items:center;gap:11px;
      padding:14px 21px;border:1px solid rgba(74,190,178,.33);border-radius:999px;color:#d9e3f2;font-size:17px;font-weight:700}.assurance:before{content:"✓";color:#63c996}
    .end .content{display:grid;place-items:center;text-align:center}.end-card{position:relative;width:1380px}.end .brand-lockup{justify-content:center}.end h1{margin-top:48px;font-size:76px}
    .url{display:inline-flex;margin-top:42px;padding:18px 30px;border:1px solid rgba(215,168,77,.43);border-radius:999px;background:rgba(215,168,77,.08);
      color:#f4ecd7;font-size:23px;font-weight:700;letter-spacing:.5px}.compat{margin-top:28px;color:#8998ae;font-size:16px;font-weight:700;letter-spacing:2px;text-transform:uppercase}
  </style></head><body>${body}</body></html>`;
}

function createScenes(markSvg, images) {
  const shell = (className, inner, number) => `<main class="stage ${className}"><div class="orbital"></div>` +
    `<div class="content">${inner}</div><div class="scene-number">${String(number).padStart(2, '0')} / 07</div></main>`;

  return [
    shell('hero',
      `<section class="copy">${brandLockup(markSvg)}<h1>Your <span class="accent">DBOPFS data</span>,<br>made legible.</h1>` +
      `<p class="subhead">A focused, browser-native workspace for the DBOPFS applications, tables, and records in the selected origin.</p>` +
      `<div class="pills"><span class="pill emphasis">Local-first</span><span class="pill">Chrome</span><span class="pill">Edge</span><span class="pill">Compatible Chromium</span></div></section>` +
      `<section class="visual">${browserWindow(images.dashboard, 'DBOPFS Studio · storage observatory', 'scrub-local')}</section>`, 1),

    shell('connection',
      `<div class="split"><section class="copy"><p class="kicker">Start where you work</p><h1>Connect to the site you’re debugging.</h1>` +
      `<p class="subhead">Open Studio from the toolbar for the current site—or launch it beside the page inspected in DevTools.</p>` +
      `<div class="pills"><span class="pill emphasis">Toolbar</span><span class="pill emphasis">DevTools</span></div></section>` +
      `<section class="visual">${browserWindow(images.connect, 'Two precise entry paths', 'feature-window scrub-connection')}</section></div>`, 2),

    shell('dashboard',
      `<div class="split reverse"><section class="copy"><p class="kicker">A storage observatory</p><h1>See the selected origin at a glance.</h1>` +
      `<p class="subhead">Review usage, quota, persistence, applications, tables, and records in one focused view.</p>` +
      `<div class="pills"><span class="pill">Usage + quota</span><span class="pill">Persistence</span><span class="pill">DBOPFS totals</span></div></section>` +
      `<section class="visual">${browserWindow(images.dashboard, 'Origin storage health', 'feature-window scrub-local')}</section></div>`, 3),

    shell('json-scene',
      `<div class="split"><section class="copy"><p class="kicker">Inspect · edit · validate</p><h1>Work with supported text and JSON records where they live.</h1>` +
      `<p class="subhead">Move between exact source and readable formatted views, then validate JSON before saving.</p>` +
      `<div class="signal">Saved through DBOPFS</div></section>` +
      `<section class="visual">${browserWindow(images.json, 'Record inspector · field-notes.json', 'feature-window scrub-local')}</section></div>`, 4),

    shell('preview',
      `<header><div><p class="kicker">Preview without the detour</p><h1>Render Markdown. Open PDFs in Chromium.</h1></div>` +
      `<p class="subhead">Text, images, audio, and video stay close to the record workflow. PDF controls come from the browser build.</p></header>` +
      `<section class="preview-grid">${browserWindow(images.markdown, 'Rendered Markdown', 'markdown scrub-local')}${browserWindow(images.pdf, 'Native PDF workflow', 'pdf scrub-local')}</section>`, 5),

    shell('local',
      `<section class="local-card"><div class="brand-mark">${markSvg}</div><p class="kicker">Local by design</p>` +
      `<h1>No account. No analytics.<br><span class="accent">No automatic cloud sync.</span></h1>` +
      `<p class="subhead">DBOPFS Studio processes the selected origin’s data in the browser.</p>` +
      `<div class="assurances"><span class="assurance">Selected live origin</span><span class="assurance">Browser-local workspace</span><span class="assurance">No remote DBOPFS service</span></div></section>`, 6),

    shell('end',
      `<section class="end-card">${brandLockup(markSvg, 'large')}<h1>Make DBOPFS data understandable.</h1>` +
      `<p class="subhead" style="margin-left:auto;margin-right:auto">Explore and manage DBOPFS records; edit, preview, and print supported formats in one local-first workspace.</p>` +
      `<div class="url">thewizardnexus.github.io/DBOPFS-Studio</div>` +
      `<div class="compat">Chrome · Microsoft Edge · compatible Chromium browsers</div></section>`, 7)
  ];
}

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, (image) => {
      if (image.complete) return undefined;
      return new Promise((resolve, reject) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', reject, { once: true });
      });
    }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function renderSceneFrames(directory) {
  const [markSvg, images, executablePath] = await Promise.all([
    readFile(path.join(projectRoot, 'extension', 'assets', 'icons', 'mark.svg'), 'utf8'),
    loadVisualSources(),
    findChromium()
  ]);
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    pipe: true,
    args: ['--force-color-profile=srgb', '--lang=en-US']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    const scenes = createScenes(markSvg, images);
    const paths = [];
    for (let index = 0; index < scenes.length; index += 1) {
      const scenePath = path.join(directory, `scene-${String(index + 1).padStart(2, '0')}.png`);
      await page.setContent(sceneDocument(scenes[index]), { waitUntil: 'load' });
      await settle(page);
      await page.screenshot({ path: scenePath, type: 'png', captureBeyondViewport: false });
      paths.push(scenePath);
    }
    await page.close();
    return paths;
  } finally {
    await browser.close();
  }
}

async function run(command, arguments_, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: options.cwd ?? projectRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-40_000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} exited with code ${code}.\n${stderr}`));
      }
    });
  });
}

function buildVideoFilter() {
  const filters = scenePlan.map((scene, index) => {
    return `[${index}:v]tpad=stop_mode=clone:stop_duration=${scene.duration},` +
      `fps=${fps},trim=duration=${scene.duration},setpts=PTS-STARTPTS[v${index}]`;
  });

  let elapsed = scenePlan[0].duration;
  let previous = 'v0';
  for (let index = 1; index < scenePlan.length; index += 1) {
    const output = index === scenePlan.length - 1 ? 'video' : `x${index}`;
    const offset = elapsed - transitionDuration;
    filters.push(`[${previous}][v${index}]xfade=transition=${scenePlan[index - 1].transition}:` +
      `duration=${transitionDuration}:offset=${offset.toFixed(3)}[${output}]`);
    previous = output;
    elapsed += scenePlan[index].duration - transitionDuration;
  }
  filters.push('[video]format=yuv420p[final]');
  filters.push(
    `[${scenePlan.length}:a]aresample=48000,` +
    'aecho=0.96:0.94:900|1800|2700|4200:0.15|0.12|0.09|0.07,' +
    `apad=whole_dur=${totalDuration().toFixed(3)},atrim=duration=${totalDuration().toFixed(3)},` +
    `afade=t=out:st=${(totalDuration() - 1.4).toFixed(3)}:d=1.4[audio]`
  );
  return filters.join(';');
}

async function encodeVideo(scenePaths) {
  const arguments_ = ['-hide_banner', '-loglevel', 'warning', '-y'];
  for (const scenePath of scenePaths) arguments_.push('-i', scenePath);
  arguments_.push('-i', jinglePath);
  arguments_.push(
    '-filter_complex', buildVideoFilter(),
    '-map', '[final]',
    '-map', '[audio]',
    '-t', totalDuration().toFixed(3),
    '-r', String(fps),
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-tune', 'stillimage',
    '-crf', '16',
    '-profile:v', 'high',
    '-level', '4.2',
    '-pix_fmt', 'yuv420p',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-colorspace', 'bt709',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '48000',
    '-movflags', '+faststart',
    '-metadata', 'title=DBOPFS Studio — Your DBOPFS data, made legible',
    '-metadata', 'comment=Shipped DBOPFS Studio demo interface with the owner-supplied retro jingle',
    videoPath
  );
  await run(process.env.FFMPEG_PATH || 'ffmpeg', arguments_);
}

async function renderPoster() {
  await run(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', videoPath,
    '-ss', '0.5',
    '-frames:v', '1',
    posterPath
  ]);
}

async function probeVideo() {
  const result = await run(process.env.FFPROBE_PATH || 'ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration,size:stream=index,codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels',
    '-of', 'json',
    videoPath
  ]);
  const probe = JSON.parse(result.stdout);
  const video = probe.streams.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
  const duration = Number(probe.format.duration);
  if (video?.codec_name !== 'h264' || video.width !== width || video.height !== height || video.r_frame_rate !== `${fps}/1`) {
    throw new Error(`Unexpected video stream: ${JSON.stringify(video)}`);
  }
  if (audio?.codec_name !== 'aac' || audio.sample_rate !== '48000' || audio.channels !== 2) {
    throw new Error(`Unexpected audio stream: ${JSON.stringify(audio)}`);
  }
  if (Math.abs(duration - totalDuration()) > 0.15) {
    throw new Error(`Unexpected duration ${duration}; expected approximately ${totalDuration()}.`);
  }
  return probe;
}

async function sha256(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function safeCleanup(directory) {
  const resolvedDirectory = path.resolve(directory);
  const resolvedTempRoot = path.resolve(os.tmpdir());
  const relative = path.relative(resolvedTempRoot, resolvedDirectory);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(resolvedDirectory).startsWith('dbopfs-promo-')) {
    throw new Error(`Refusing to remove unexpected temporary directory: ${resolvedDirectory}`);
  }
  await rm(resolvedDirectory, { recursive: true, force: true });
}

export async function renderPromoVideo() {
  await mkdir(outputRoot, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'dbopfs-promo-'));
  try {
    console.log('Rendering seven 1920×1080 scene plates from tracked product artwork…');
    const scenePaths = await renderSceneFrames(temporaryDirectory);
    console.log('Encoding the H.264/AAC promo video with the supplied retro jingle…');
    await encodeVideo(scenePaths);
    await renderPoster();
    const probe = await probeVideo();
    const details = await stat(videoPath);
    return {
      duration: Number(probe.format.duration),
      filePath: videoPath,
      posterPath,
      sha256: await sha256(videoPath),
      size: details.size
    };
  } finally {
    await safeCleanup(temporaryDirectory);
  }
}

if (isMainModule(import.meta.url)) {
  renderPromoVideo()
    .then((result) => {
      console.log(`Rendered ${relativePath(result.filePath)} (${result.duration.toFixed(2)}s, ${(result.size / 1024 / 1024).toFixed(2)} MiB).`);
      console.log(`Poster: ${relativePath(result.posterPath)}`);
      console.log(`SHA-256: ${result.sha256}`);
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}
