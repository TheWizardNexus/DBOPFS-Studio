import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  isMainModule,
  pagesRoot,
  pathExists,
  projectRoot,
  readJson,
  relativePath,
  walkFiles
} from './project.mjs';
import { packageExtension } from './package-extension.mjs';
import { validateManifest } from './validate-manifest.mjs';

const PACKAGED_LEGAL_FILES = Object.freeze([
  'LICENSE',
  'NOTICE',
  'COMMERCIAL-LICENSE.md',
  'SOURCE_PROVENANCE.md',
  'THIRD_PARTY_NOTICES.md'
]);

const REQUIRED_NOTICE_LINES = Object.freeze([
  'Required Notice: Copyright 2026 The Wizard Nexus.',
  'Required Notice: Commercial use is not granted by the public license. See COMMERCIAL-LICENSE.md.'
]);

function addIssue(issues, condition, message) {
  if (!condition) {
    issues.push(message);
  }
}

function attributeValue(attributes, name) {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? match[1] ?? match[2] ?? match[3] : '';
}

function resolveLocalAsset(root, ownerPath, reference) {
  const trimmed = reference.trim();
  if (!trimmed || trimmed.startsWith('#') || /^(?:data|blob|mailto|tel):/i.test(trimmed)) {
    return null;
  }
  if (/^(?:https?:)?\/\//i.test(trimmed) || /^[a-z][a-z\d+.-]*:/i.test(trimmed)) {
    return 'remote';
  }
  const clean = trimmed.split(/[?#]/, 1)[0];
  if (clean.startsWith('/')) {
    return null;
  }
  return path.resolve(path.dirname(ownerPath), decodeURIComponent(clean));
}

async function inspectPagesHtml(root, htmlPath, issues) {
  const source = await readFile(htmlPath, 'utf8');
  const references = [];

  for (const match of source.matchAll(/<script\b([^>]*)>/gi)) {
    const reference = attributeValue(match[1], 'src');
    if (reference) {
      references.push(['script', reference]);
    }
  }
  for (const match of source.matchAll(/<link\b([^>]*)>/gi)) {
    const relation = attributeValue(match[1], 'rel').toLowerCase().split(/\s+/);
    if (relation.some((item) => ['stylesheet', 'icon', 'manifest'].includes(item))) {
      references.push([relation.join(' '), attributeValue(match[1], 'href')]);
    }
  }
  for (const match of source.matchAll(/<(?:img|source)\b([^>]*)>/gi)) {
    const reference = attributeValue(match[1], 'src');
    if (reference) {
      references.push(['media', reference]);
    }
  }

  for (const [kind, reference] of references) {
    const assetPath = resolveLocalAsset(root, htmlPath, reference);
    addIssue(issues, kind !== 'script' || assetPath !== 'remote',
      `${relativePath(htmlPath)} loads a remote script: ${reference}`);
    if (typeof assetPath === 'string' && assetPath !== 'remote') {
      addIssue(issues, await pathExists(assetPath),
        `${relativePath(htmlPath)} references missing ${kind} asset ${reference}.`);
    }
  }
}

async function inspectCss(root, cssPath, issues) {
  const source = await readFile(cssPath, 'utf8');
  for (const match of source.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
    const reference = match[2];
    const assetPath = resolveLocalAsset(root, cssPath, reference);
    if (typeof assetPath === 'string' && assetPath !== 'remote') {
      addIssue(issues, await pathExists(assetPath),
        `${relativePath(cssPath)} references missing asset ${reference}.`);
    }
  }
}

function checkJavaScriptSyntax(filePath, issues) {
  const result = spawnSync(process.execPath, ['--check', filePath], {
    encoding: 'utf8',
    windowsHide: true
  });
  addIssue(
    issues,
    result.status === 0,
    `${relativePath(filePath)} has invalid JavaScript syntax:\n${(result.stderr || result.stdout).trim()}`
  );
}

async function validatePages(issues) {
  for (const required of ['index.html', 'privacy.html']) {
    addIssue(issues, await pathExists(path.join(pagesRoot, required)),
      `docs/${required} is required for GitHub Pages.`);
  }
  if (!(await pathExists(pagesRoot))) {
    return [];
  }

  const files = await walkFiles(pagesRoot);
  for (const filePath of files) {
    const extension = path.extname(filePath).toLowerCase();
    addIssue(issues, !['.ts', '.tsx'].includes(extension),
      `${relativePath(filePath)} violates the plain-JavaScript requirement.`);
    if (extension === '.html') {
      await inspectPagesHtml(pagesRoot, filePath, issues);
    } else if (extension === '.css') {
      await inspectCss(pagesRoot, filePath, issues);
    } else if (extension === '.js' || extension === '.mjs') {
      checkJavaScriptSyntax(filePath, issues);
    }
  }
  return files;
}

async function validatePackageMetadata(manifest, issues) {
  const packageJson = await readJson(path.join(projectRoot, 'package.json'));
  const packageLock = await readJson(path.join(projectRoot, 'package-lock.json'));
  addIssue(issues, packageJson.type === 'module', 'package.json must use native ES modules.');
  addIssue(issues, packageJson.version === manifest.version,
    'package.json and manifest.json versions must match.');
  addIssue(issues, packageLock.lockfileVersion === 3, 'package-lock.json must use lockfileVersion 3.');
  addIssue(issues, packageLock.packages?.['']?.version === packageJson.version,
    'package-lock.json is out of sync with package.json.');
  addIssue(issues, packageJson.devDependencies?.['vanilla-test'] === '1.4.9',
    'vanilla-test must remain pinned for reproducible browser tests.');
}

async function validatePackagedLegalFiles(issues) {
  const legalRoot = path.join(projectRoot, 'extension', 'legal');

  for (const fileName of PACKAGED_LEGAL_FILES) {
    const rootPath = path.join(projectRoot, fileName);
    const packagedPath = path.join(legalRoot, fileName);

    addIssue(issues, await pathExists(rootPath), `${fileName} is required at the repository root.`);
    addIssue(issues, await pathExists(packagedPath),
      `extension/legal/${fileName} is required in the packaged extension.`);

    if (!(await pathExists(rootPath)) || !(await pathExists(packagedPath))) {
      continue;
    }

    const [rootBytes, packagedBytes] = await Promise.all([
      readFile(rootPath),
      readFile(packagedPath)
    ]);
    addIssue(issues, rootBytes.equals(packagedBytes),
      `extension/legal/${fileName} must exactly equal the root ${fileName}, including line endings.`);
  }

  const noticePath = path.join(projectRoot, 'NOTICE');
  if (await pathExists(noticePath)) {
    const noticeLines = (await readFile(noticePath, 'utf8'))
      .split(/\r?\n/)
      .filter((line) => line.length > 0);
    addIssue(issues, JSON.stringify(noticeLines) === JSON.stringify(REQUIRED_NOTICE_LINES),
      'NOTICE must contain only the two exact required notice lines in their required order.');
  }
}

async function validatePngIcons(manifest, issues) {
  for (const [declaredSize, reference] of Object.entries(manifest.icons || {})) {
    if (!reference.toLowerCase().endsWith('.png')) {
      issues.push(`Manifest icon ${declaredSize} must use a PNG file.`);
      continue;
    }
    const iconPath = path.join(projectRoot, 'extension', reference);
    if (!(await pathExists(iconPath))) {
      continue;
    }
    const bytes = await readFile(iconPath);
    const isPng = bytes.length >= 24 && bytes.subarray(1, 4).toString('ascii') === 'PNG';
    addIssue(issues, isPng, `${relativePath(iconPath)} is not a valid PNG file.`);
    if (!isPng) {
      continue;
    }
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    addIssue(issues, width === Number(declaredSize) && height === Number(declaredSize),
      `${relativePath(iconPath)} is ${width}x${height}; the manifest declares ${declaredSize}x${declaredSize}.`);
  }
}

async function findForbiddenSources(issues) {
  const ignoredDirectories = new Set(['.git', 'artifacts', 'coverage', 'node_modules']);

  async function visit(directory) {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
        continue;
      }
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(filePath);
      } else if (entry.isFile() && ['.ts', '.tsx'].includes(path.extname(entry.name).toLowerCase())) {
        issues.push(`${relativePath(filePath)} violates the repository's plain-JavaScript requirement.`);
      }
    }
  }

  await visit(projectRoot);
}

export async function validateRelease(options = {}) {
  const issues = [];
  let manifestValidation;
  try {
    manifestValidation = await validateManifest();
  } catch (error) {
    issues.push(error.message);
  }

  const pagesFiles = await validatePages(issues);
  await validatePackagedLegalFiles(issues);
  if (manifestValidation) {
    await validatePackageMetadata(manifestValidation.manifest, issues);
    await validatePngIcons(manifestValidation.manifest, issues);
    for (const filePath of manifestValidation.files) {
      if (['.js', '.mjs'].includes(path.extname(filePath).toLowerCase())) {
        checkJavaScriptSyntax(filePath, issues);
      }
    }
  }
  await findForbiddenSources(issues);

  if (issues.length) {
    throw new Error(`Release validation failed:\n- ${issues.join('\n- ')}`);
  }

  const result = {
    extensionFiles: manifestValidation.files.length,
    manifest: manifestValidation.manifest,
    pagesFiles: pagesFiles.length
  };
  if (options.package) {
    result.package = await packageExtension();
  }
  return result;
}

if (isMainModule(import.meta.url)) {
  validateRelease({ package: process.argv.includes('--package') })
    .then((result) => {
      console.log(
        `Release ${result.manifest.version} is valid ` +
        `(${result.extensionFiles} extension files, ${result.pagesFiles} Pages files).`
      );
      if (result.package) {
        console.log(`Verified package: ${relativePath(result.package.outputPath)}`);
        console.log(`SHA-256 ${result.package.digest}`);
        console.log(`Checksum: ${relativePath(result.package.checksumPath)}`);
      }
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
