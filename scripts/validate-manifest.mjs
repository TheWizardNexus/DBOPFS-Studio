import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  extensionRoot,
  isMainModule,
  pathExists,
  readJson,
  relativePath,
  walkFiles
} from './project.mjs';

function addIssue(issues, condition, message) {
  if (!condition) {
    issues.push(message);
  }
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringsOnly(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function addIconReferences(references, label, icons) {
  if (!plainObject(icons)) {
    return;
  }
  for (const [size, iconPath] of Object.entries(icons)) {
    references.push([`${label}.${size}`, iconPath]);
  }
}

async function manifestReferences(manifest, root) {
  const references = [];
  const add = (label, value) => {
    if (typeof value === 'string' && value) {
      references.push([label, value]);
    }
  };

  add('action.default_popup', manifest.action?.default_popup);
  addIconReferences(references, 'action.default_icon', manifest.action?.default_icon);
  add('background.service_worker', manifest.background?.service_worker);
  add('chrome_url_overrides.newtab', manifest.chrome_url_overrides?.newtab);
  add('devtools_page', manifest.devtools_page);
  add('options_page', manifest.options_page);
  add('options_ui.page', manifest.options_ui?.page);
  add('side_panel.default_path', manifest.side_panel?.default_path);
  addIconReferences(references, 'icons', manifest.icons);

  for (const [index, contentScript] of (manifest.content_scripts || []).entries()) {
    for (const [scriptIndex, scriptPath] of (contentScript.js || []).entries()) {
      add(`content_scripts[${index}].js[${scriptIndex}]`, scriptPath);
    }
    for (const [styleIndex, stylePath] of (contentScript.css || []).entries()) {
      add(`content_scripts[${index}].css[${styleIndex}]`, stylePath);
    }
  }

  for (const [index, exposure] of (manifest.web_accessible_resources || []).entries()) {
    for (const [resourceIndex, resourcePath] of (exposure.resources || []).entries()) {
      add(`web_accessible_resources[${index}].resources[${resourceIndex}]`, resourcePath);
    }
  }

  if (manifest.devtools_page) {
    const devtoolsScript = path.join(root, 'devtools', 'devtools.js');
    if (await pathExists(devtoolsScript)) {
      const source = await readFile(devtoolsScript, 'utf8');
      for (const match of source.matchAll(/chrome\.devtools\.panels\.create\(\s*['"][^'"]*['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*(?:`([^`]+)`|['"]([^'"]+)['"])/g)) {
        const iconPath = match[1];
        const pagePath = (match[2] || match[3] || '').split(/[?#$]/, 1)[0];
        add(`devtools.panel.icon`, iconPath);
        add(`devtools.panel.page`, pagePath);
      }
    }
  }

  for (const [index, page] of (manifest.sandbox?.pages || []).entries()) {
    add(`sandbox.pages[${index}]`, page);
  }
  return references;
}

function attributeValue(attributes, name) {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? match[1] ?? match[2] ?? match[3] : '';
}

function localAssetPath(root, ownerPath, reference) {
  const trimmed = reference.trim();
  if (!trimmed || trimmed.startsWith('#') || /^(?:data|blob|mailto|tel):/i.test(trimmed)) {
    return null;
  }
  if (/^(?:https?:)?\/\//i.test(trimmed) || /^[a-z][a-z\d+.-]*:/i.test(trimmed)) {
    return 'remote';
  }
  const withoutSuffix = trimmed.split(/[?#]/, 1)[0];
  let decoded;
  try {
    decoded = decodeURIComponent(withoutSuffix);
  } catch {
    return 'invalid';
  }
  return decoded.startsWith('/')
    ? path.resolve(root, decoded.replace(/^\/+/, ''))
    : path.resolve(path.dirname(ownerPath), decoded);
}

async function inspectHtml(root, htmlPath, issues) {
  const source = await readFile(htmlPath, 'utf8');
  const scripts = source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi);
  for (const script of scripts) {
    const attributes = script[1];
    const sourceReference = attributeValue(attributes, 'src');
    const type = attributeValue(attributes, 'type').toLowerCase();
    if (!sourceReference) {
      const isDataBlock = type === 'application/json' || type === 'application/ld+json';
      addIssue(
        issues,
        isDataBlock || !script[2].trim(),
        `${relativePath(htmlPath)} contains inline executable JavaScript; Manifest V3 requires packaged scripts.`
      );
      continue;
    }
    const assetPath = localAssetPath(root, htmlPath, sourceReference);
    addIssue(
      issues,
      assetPath !== 'remote',
      `${relativePath(htmlPath)} loads a remote script: ${sourceReference}`
    );
    if (typeof assetPath === 'string' && assetPath !== 'remote' && assetPath !== 'invalid') {
      addIssue(
        issues,
        await pathExists(assetPath),
        `${relativePath(htmlPath)} references missing script ${sourceReference}.`
      );
    }
  }

  const links = source.matchAll(/<link\b([^>]*)>/gi);
  for (const link of links) {
    const attributes = link[1];
    const relation = attributeValue(attributes, 'rel').toLowerCase().split(/\s+/);
    if (!relation.some((value) => ['stylesheet', 'icon', 'manifest'].includes(value))) {
      continue;
    }
    const reference = attributeValue(attributes, 'href');
    const assetPath = localAssetPath(root, htmlPath, reference);
    addIssue(
      issues,
      assetPath !== 'remote',
      `${relativePath(htmlPath)} loads a remote ${relation.join(' ')} asset: ${reference}`
    );
    if (typeof assetPath === 'string' && assetPath !== 'remote' && assetPath !== 'invalid') {
      addIssue(
        issues,
        await pathExists(assetPath),
        `${relativePath(htmlPath)} references missing asset ${reference}.`
      );
    }
  }
}

function validateVersion(version, issues) {
  const pattern = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}$/;
  addIssue(issues, typeof version === 'string' && pattern.test(version),
    'manifest.version must contain one to four dot-separated integers.');
  if (typeof version === 'string' && pattern.test(version)) {
    addIssue(issues, version.split('.').every((part) => Number(part) <= 65535),
      'Each manifest.version component must be at most 65535.');
  }
}

export async function validateManifest(root = extensionRoot) {
  const manifestPath = path.join(root, 'manifest.json');
  const issues = [];
  addIssue(issues, await pathExists(manifestPath), 'extension/manifest.json is required.');
  if (issues.length) {
    throw new Error(issues.join('\n'));
  }

  const manifest = await readJson(manifestPath);
  addIssue(issues, plainObject(manifest), 'manifest.json must contain a JSON object.');
  addIssue(issues, manifest.manifest_version === 3, 'The extension must use Manifest V3.');
  addIssue(issues, typeof manifest.name === 'string' && manifest.name.trim().length > 0,
    'manifest.name is required.');
  addIssue(issues, typeof manifest.name === 'string' && manifest.name.length <= 75,
    'manifest.name must not exceed 75 characters.');
  addIssue(issues,
    typeof manifest.description === 'string' && manifest.description.trim().length > 0,
    'manifest.description is required.');
  addIssue(issues, typeof manifest.description === 'string' && manifest.description.length <= 132,
    'manifest.description must not exceed 132 characters.');
  validateVersion(manifest.version, issues);

  for (const key of ['permissions', 'optional_permissions', 'host_permissions', 'optional_host_permissions']) {
    if (manifest[key] !== undefined) {
      addIssue(issues, stringsOnly(manifest[key]), `manifest.${key} must be an array of strings.`);
      if (stringsOnly(manifest[key])) {
        addIssue(issues, new Set(manifest[key]).size === manifest[key].length,
          `manifest.${key} must not contain duplicates.`);
      }
    }
  }
  const approvedPermissions = new Set(['storage']);
  for (const permission of manifest.permissions || []) {
    addIssue(issues, approvedPermissions.has(permission),
      `manifest.permissions contains unreviewed permission ${permission}.`);
  }
  const approvedHosts = new Set(['http://*/*', 'https://*/*']);
  for (const host of manifest.host_permissions || []) {
    addIssue(issues, approvedHosts.has(host),
      `manifest.host_permissions contains unreviewed match pattern ${host}.`);
  }
  addIssue(issues,
    approvedHosts.size === (manifest.host_permissions || []).length &&
      (manifest.host_permissions || []).every((host) => approvedHosts.has(host)),
    'manifest.host_permissions must declare only the reviewed HTTP(S) origin access.'
  );

  const csp = typeof manifest.content_security_policy === 'string'
    ? manifest.content_security_policy
    : manifest.content_security_policy?.extension_pages;
  if (csp) {
    addIssue(issues, !/['"]unsafe-eval['"]/i.test(csp),
      'The extension content security policy must not allow unsafe-eval.');
    addIssue(issues, !/script-src[^;]*https?:/i.test(csp),
      'The extension content security policy must not allow remote scripts.');
  }

  for (const [label, reference] of await manifestReferences(manifest, root)) {
    addIssue(issues, typeof reference === 'string', `${label} must be a path string.`);
    if (typeof reference !== 'string') {
      continue;
    }
    addIssue(issues, !/^(?:https?:)?\/\//i.test(reference), `${label} must be packaged locally.`);
    const resolved = path.resolve(root, reference.replace(/^\/+/, ''));
    const relative = path.relative(root, resolved);
    addIssue(issues, !relative.startsWith('..') && !path.isAbsolute(relative),
      `${label} escapes the extension directory.`);
    addIssue(issues, await pathExists(resolved), `${label} references missing file ${reference}.`);
  }

  const files = await walkFiles(root);
  for (const filePath of files) {
    const extension = path.extname(filePath).toLowerCase();
    addIssue(issues, !['.ts', '.tsx', '.pem', '.crx'].includes(extension),
      `${relativePath(filePath)} is not allowed in the unpacked extension.`);
    if (extension === '.html') {
      await inspectHtml(root, filePath, issues);
    }
    if (extension === '.js' || extension === '.mjs') {
      const source = await readFile(filePath, 'utf8');
      addIssue(
        issues,
        !/(?:import\s*(?:[^'";]*?\sfrom\s*)?|export\s+[^'";]*?\sfrom\s*|import\s*\()\s*['"](?:https?:|\/\/)/m.test(source),
        `${relativePath(filePath)} imports executable code from a remote URL.`
      );
    }
  }

  if (issues.length) {
    throw new Error(`Manifest validation failed:\n- ${issues.join('\n- ')}`);
  }

  return { files, manifest, manifestPath, root };
}

if (isMainModule(import.meta.url)) {
  validateManifest()
    .then(({ files, manifest }) => {
      console.log(`Manifest ${manifest.version} is valid (${files.length} packaged files).`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
