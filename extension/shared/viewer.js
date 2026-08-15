const PREVIEW_LIMIT = 1024 * 1024;
const PREVIEW_EXCERPT_LIMIT = 256 * 1024;
const MARKDOWN_LINE_LIMIT = 5000;
const JAVASCRIPT_MIMES = new Set([
  'application/ecmascript',
  'application/javascript',
  'text/ecmascript',
  'text/javascript'
]);

function extensionOf(name = '') {
  const value = String(name).toLowerCase();
  const index = value.lastIndexOf('.');
  return index === -1 ? '' : value.slice(index + 1);
}

function normalizedMime(mime = '') {
  return String(mime).toLowerCase().split(';', 1)[0].trim();
}

export function textViewKind(name = '', mime = '') {
  const extension = extensionOf(name);
  const type = normalizedMime(mime);
  if (['md', 'markdown', 'mdown', 'mkd'].includes(extension) ||
      ['text/markdown', 'text/x-markdown'].includes(type)) return 'markdown';
  if (['js', 'mjs', 'cjs'].includes(extension) || JAVASCRIPT_MIMES.has(type) ||
      type.endsWith('+javascript')) return 'javascript';
  if (['json', 'jsonl', 'ndjson'].includes(extension) || type.includes('json')) return 'json';
  return 'text';
}

function safeLink(value) {
  const href = String(value).trim();
  return /^(?:https?:|mailto:)/i.test(href) ? href : null;
}

function appendText(parent, value) {
  parent.append(parent.ownerDocument.createTextNode(value));
}

const INLINE_PATTERN = /!\[([^\]\n]{0,500})\]\(([^)\n]{1,2048})\)|\[([^\]\n]{1,500})\]\(([^)\n]{1,2048})\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|\*([^*\n]+)\*|_([^_\n]+)_/g;

function inlineMatches(text, offset) {
  INLINE_PATTERN.lastIndex = offset;
  const found = INLINE_PATTERN.exec(text);
  if (!found) return null;
  let kind;
  let primary;
  let secondary;
  if (found[1] !== undefined) {
    [kind, primary, secondary] = ['image', found[1], found[2]];
  } else if (found[3] !== undefined) {
    [kind, primary, secondary] = ['link', found[3], found[4]];
  } else if (found[5] !== undefined) {
    [kind, primary] = ['code', found[5]];
  } else if (found[6] !== undefined || found[7] !== undefined) {
    [kind, primary] = ['strong', found[6] ?? found[7]];
  } else if (found[8] !== undefined) {
    [kind, primary] = ['strike', found[8]];
  } else {
    [kind, primary] = ['emphasis', found[9] ?? found[10]];
  }
  const match = [found[0], primary, secondary];
  match.index = found.index;
  return { kind, match };
}

function appendInline(parent, value, depth = 0) {
  const text = String(value);
  if (depth > 4) {
    appendText(parent, text);
    return;
  }
  let offset = 0;
  while (offset < text.length) {
    const token = inlineMatches(text, offset);
    if (!token) {
      appendText(parent, text.slice(offset));
      break;
    }
    if (token.match.index > offset) appendText(parent, text.slice(offset, token.match.index));
    const documentNode = parent.ownerDocument;
    if (token.kind === 'image') {
      const blocked = documentNode.createElement('span');
      blocked.className = 'blocked-markdown-image';
      blocked.textContent = `Image blocked: ${token.match[1] || 'unnamed image'}`;
      blocked.title = 'Markdown images are not loaded automatically.';
      parent.append(blocked);
    } else if (token.kind === 'link') {
      const href = safeLink(token.match[2]);
      if (href) {
        const link = documentNode.createElement('a');
        link.href = href;
        link.referrerPolicy = 'no-referrer';
        link.rel = 'noopener noreferrer';
        link.target = '_blank';
        appendInline(link, token.match[1], depth + 1);
        parent.append(link);
      } else {
        appendInline(parent, token.match[1], depth + 1);
      }
    } else if (token.kind === 'code') {
      const code = documentNode.createElement('code');
      code.textContent = token.match[1];
      parent.append(code);
    } else {
      const tag = token.kind === 'strong' ? 'strong' : token.kind === 'strike' ? 's' : 'em';
      const element = documentNode.createElement(tag);
      appendInline(element, token.match[1] || token.match[2] || '', depth + 1);
      parent.append(element);
    }
    offset = token.match.index + token.match[0].length;
  }
}

function isFenceClose(line, marker) {
  const trimmed = line.trim();
  return trimmed.length >= marker.length &&
    [...trimmed].every((character) => character === marker[0]);
}

function isBlockStart(line) {
  return /^\s{0,3}(?:#{1,6}\s+|>|[-+*]\s+|\d+[.)]\s+|`{3,}|~{3,}|(?:-{3,}|\*{3,}|_{3,})\s*$)/.test(line);
}

function appendMarkdownBlocks(parent, source, depth = 0) {
  const documentNode = parent.ownerDocument;
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)\s*$/);
    if (fence) {
      const marker = fence[1];
      const body = [];
      index += 1;
      while (index < lines.length && !isFenceClose(lines[index], marker)) {
        body.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const pre = documentNode.createElement('pre');
      const code = documentNode.createElement('code');
      if (fence[2]) code.dataset.language = fence[2].slice(0, 48);
      code.textContent = body.join('\n');
      pre.append(code);
      parent.append(pre);
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const element = documentNode.createElement(`h${heading[1].length}`);
      appendInline(element, heading[2]);
      parent.append(element);
      index += 1;
      continue;
    }

    if (/^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line)) {
      parent.append(documentNode.createElement('hr'));
      index += 1;
      continue;
    }

    if (/^\s{0,3}>/.test(line)) {
      const quoted = [];
      while (index < lines.length && /^\s{0,3}>/.test(lines[index])) {
        quoted.push(lines[index].replace(/^\s{0,3}>\s?/, ''));
        index += 1;
      }
      const blockquote = documentNode.createElement('blockquote');
      if (depth >= 12) {
        const paragraph = documentNode.createElement('p');
        appendInline(paragraph, quoted.join(' '));
        blockquote.append(paragraph);
      } else {
        appendMarkdownBlocks(blockquote, quoted.join('\n'), depth + 1);
      }
      parent.append(blockquote);
      continue;
    }

    const listItem = line.match(/^\s{0,3}([-+*]|\d+[.)])\s+(.+)$/);
    if (listItem) {
      const ordered = /^\d/.test(listItem[1]);
      const list = documentNode.createElement(ordered ? 'ol' : 'ul');
      while (index < lines.length) {
        const itemMatch = lines[index].match(/^\s{0,3}([-+*]|\d+[.)])\s+(.+)$/);
        if (!itemMatch || /^\d/.test(itemMatch[1]) !== ordered) break;
        const item = documentNode.createElement('li');
        const task = itemMatch[2].match(/^\[([ xX])\]\s+(.*)$/);
        if (task) {
          const checkbox = documentNode.createElement('input');
          checkbox.checked = task[1].toLowerCase() === 'x';
          checkbox.disabled = true;
          checkbox.type = 'checkbox';
          checkbox.setAttribute('aria-label', checkbox.checked ? 'Completed task' : 'Incomplete task');
          item.append(checkbox, documentNode.createTextNode(' '));
          appendInline(item, task[2]);
        } else {
          appendInline(item, itemMatch[2]);
        }
        list.append(item);
        index += 1;
      }
      parent.append(list);
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    const paragraph = documentNode.createElement('p');
    appendInline(paragraph, paragraphLines.join(' '));
    parent.append(paragraph);
  }
}

function appendNotice(target, message) {
  const notice = target.ownerDocument.createElement('p');
  notice.className = 'viewer-notice';
  notice.textContent = message;
  target.append(notice);
}

export function renderMarkdown(target, source) {
  const text = String(source ?? '');
  target.replaceChildren();
  target.classList.add('markdown-preview');
  target.dataset.viewKind = 'markdown';
  let lineCount = 1;
  for (let index = 0; index < text.length && lineCount <= MARKDOWN_LINE_LIMIT; index += 1) {
    if (text[index] === '\n') lineCount += 1;
  }
  if (text.length > PREVIEW_LIMIT || lineCount > MARKDOWN_LINE_LIMIT) {
    appendNotice(target, 'This Markdown record is too large to render safely. Showing a source excerpt instead.');
    const pre = target.ownerDocument.createElement('pre');
    const code = target.ownerDocument.createElement('code');
    code.textContent = text.slice(0, PREVIEW_EXCERPT_LIMIT);
    pre.append(code);
    target.append(pre);
    return { kind: 'markdown', truncated: true };
  }
  appendMarkdownBlocks(target, text);
  return { kind: 'markdown', truncated: false };
}

function token(type, value) {
  return { type, value };
}

function canStartRegex(previous) {
  if (!previous) return true;
  if (previous.afterControl) return true;
  return ['(', '[', '{', ',', ';', ':', '?', '=', '=>', '!', '&&', '||', '??'].includes(previous.value) ||
    ['return', 'throw', 'case', 'delete', 'typeof', 'void', 'new', 'in', 'of', 'yield', 'await', 'else', 'do'].includes(previous.value);
}

function tokenizeJavaScript(source) {
  const tokens = [];
  let index = 0;
  let previous = null;
  const parenthesisContexts = [];
  const push = (entry) => {
    tokens.push(entry);
    if (!entry.type.startsWith('comment')) previous = entry;
  };
  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === '/' && source[index + 1] === '/') {
      const end = source.indexOf('\n', index + 2);
      const stop = end === -1 ? source.length : end;
      push(token('comment-line', source.slice(index, stop)));
      index = stop;
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      if (end === -1) throw new Error('Unterminated block comment');
      push(token('comment-block', source.slice(index, end + 2)));
      index = end + 2;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      const quote = character;
      let cursor = index + 1;
      let escaped = false;
      while (cursor < source.length) {
        const next = source[cursor];
        if (escaped) escaped = false;
        else if (next === '\\') escaped = true;
        else if (next === quote) break;
        else if (quote !== '`' && (next === '\n' || next === '\r')) throw new Error('Unterminated string');
        cursor += 1;
      }
      if (cursor >= source.length) throw new Error('Unterminated string or template');
      push(token(quote === '`' ? 'template' : 'string', source.slice(index, cursor + 1)));
      index = cursor + 1;
      continue;
    }
    if (character === '/' && canStartRegex(previous)) {
      let cursor = index + 1;
      let escaped = false;
      let characterClass = false;
      while (cursor < source.length) {
        const next = source[cursor];
        if (escaped) escaped = false;
        else if (next === '\\') escaped = true;
        else if (next === '[') characterClass = true;
        else if (next === ']') characterClass = false;
        else if (next === '/' && !characterClass) break;
        else if (next === '\n' || next === '\r') throw new Error('Unterminated regular expression');
        cursor += 1;
      }
      if (cursor >= source.length) throw new Error('Unterminated regular expression');
      cursor += 1;
      while (/[a-z]/i.test(source[cursor] || '')) cursor += 1;
      push(token('regex', source.slice(index, cursor)));
      index = cursor;
      continue;
    }
    const remainder = source.slice(index);
    const number = remainder.match(/^(?:0[xX][\dA-Fa-f](?:_?[\dA-Fa-f])*n?|0[bB][01](?:_?[01])*n?|0[oO][0-7](?:_?[0-7])*n?|(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?n?)/);
    if (number) {
      const value = number[0];
      push(token('number', value));
      index += value.length;
      continue;
    }
    const identifier = remainder.match(/^[A-Za-z_$][\w$]*/);
    if (identifier) {
      push(token('word', identifier[0]));
      index += identifier[0].length;
      continue;
    }
    const operator = [
      '>>>=', '**=', '===', '!==', '>>>', '<<=', '>>=', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=',
      '++', '--', '&&', '||', '??', '?.', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '**', '...',
      '{', '}', '(', ')', '[', ']', ';', ',', '.', ':', '?', '+', '-', '*', '/', '%', '&', '|', '^', '!', '~', '<', '>', '='
    ].find((candidate) => source.startsWith(candidate, index));
    if (!operator) throw new Error(`Unsupported token at ${index}`);
    const punctuation = token('punctuation', operator);
    if (operator === '(') {
      parenthesisContexts.push(previous?.value || '');
    } else if (operator === ')') {
      punctuation.afterControl = ['if', 'for', 'while', 'switch', 'catch', 'with'].includes(
        parenthesisContexts.pop()
      );
    }
    push(punctuation);
    index += operator.length;
  }
  return tokens;
}

function formatJavaScriptTokens(tokens) {
  let output = '';
  let indent = 0;
  let lineStart = true;
  let parentheses = 0;
  let brackets = 0;
  let braces = 0;
  const delimiters = [];
  const indentation = () => '  '.repeat(Math.max(0, indent));
  const trimSpaces = () => { output = output.replace(/[ \t]+$/g, ''); };
  const write = (value) => {
    if (lineStart) {
      output += indentation();
      lineStart = false;
    }
    output += value;
  };
  const space = () => {
    if (!lineStart && output && !/[\s]$/.test(output)) output += ' ';
  };
  const newline = () => {
    trimSpaces();
    if (!output.endsWith('\n')) output += '\n';
    lineStart = true;
  };
  const isWordLike = (entry) => entry && ['word', 'number', 'string', 'template', 'regex'].includes(entry.type);
  const binaryOperators = new Set(['=', '==', '===', '!=', '!==', '<', '>', '<=', '>=', '+', '-', '*', '/', '%', '&', '|', '^', '&&', '||', '??', '=>', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '>>>', '<<=', '>>=', '>>>=', '**', '**=', 'in', 'of']);

  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index];
    const previous = tokens[index - 1];
    const next = tokens[index + 1];
    const value = current.value;
    if (current.type === 'comment-line') {
      space();
      write(value);
      newline();
      continue;
    }
    if (current.type === 'comment-block') {
      space();
      write(value);
      space();
      continue;
    }
    if (value === '{') {
      if (!['(', '[', '{', ','].includes(previous?.value)) space();
      write('{');
      braces += 1;
      delimiters.push('{');
      indent += 1;
      if (next?.value === '}') space(); else newline();
      continue;
    }
    if (value === '}') {
      braces -= 1;
      if (delimiters.pop() !== '{') throw new Error('Unbalanced braces');
      indent -= 1;
      if (braces < 0) throw new Error('Unbalanced braces');
      if (next && previous?.value !== '{') newline();
      write('}');
      if ([';', ',', ')', ']', '.', '?.'].includes(next?.value)) {
        // The next token closes or continues the current expression.
      } else if (['else', 'catch', 'finally'].includes(next?.value)) {
        space();
      } else {
        newline();
      }
      continue;
    }
    if (value === '(') {
      if (['if', 'for', 'while', 'switch', 'catch', 'with'].includes(previous?.value)) space();
      write('(');
      parentheses += 1;
      delimiters.push('(');
      continue;
    }
    if (value === ')') {
      trimSpaces();
      write(')');
      parentheses -= 1;
      if (delimiters.pop() !== '(') throw new Error('Unbalanced parentheses');
      if (parentheses < 0) throw new Error('Unbalanced parentheses');
      continue;
    }
    if (value === '[') {
      write('[');
      brackets += 1;
      delimiters.push('[');
      continue;
    }
    if (value === ']') {
      trimSpaces();
      write(']');
      brackets -= 1;
      if (delimiters.pop() !== '[') throw new Error('Unbalanced brackets');
      if (brackets < 0) throw new Error('Unbalanced brackets');
      continue;
    }
    if (value === ';') {
      trimSpaces();
      write(';');
      if (parentheses > 0) space(); else newline();
      continue;
    }
    if (value === ',') {
      trimSpaces();
      write(',');
      if (delimiters.at(-1) === '{') newline(); else space();
      continue;
    }
    if (value === '.' || value === '?.') {
      trimSpaces();
      write(value);
      continue;
    }
    if (value === ':') {
      trimSpaces();
      write(':');
      space();
      continue;
    }
    if (value === '?' || binaryOperators.has(value)) {
      space();
      write(value);
      space();
      continue;
    }
    if (value === '!' || value === '~' || value === '++' || value === '--') {
      write(value);
      continue;
    }
    if (value === '...') {
      write(value);
      continue;
    }
    if (isWordLike(current)) {
      if (isWordLike(previous) || [')', ']'].includes(previous?.value) && current.type === 'word') space();
      write(value);
      if (['return', 'throw', 'const', 'let', 'var', 'new', 'typeof', 'void', 'delete', 'yield', 'await', 'import', 'export', 'from', 'as', 'class', 'extends', 'function'].includes(value)) space();
      continue;
    }
    write(value);
  }
  if (parentheses !== 0 || brackets !== 0 || braces !== 0) throw new Error('Unbalanced JavaScript delimiters');
  trimSpaces();
  return output.trim();
}

function javascriptDisplay(source) {
  const text = String(source ?? '');
  if (!text.trim() || text.length > PREVIEW_LIMIT || /[\r\n\u2028\u2029]/.test(text) ||
      (text.includes('`') && text.includes('${'))) {
    return { formatted: false, text };
  }
  try {
    const sourceTokens = tokenizeJavaScript(text);
    if (sourceTokens.some((entry) => entry.value === '/')) {
      return { formatted: false, text };
    }
    const formatted = formatJavaScriptTokens(sourceTokens);
    const formattedTokens = tokenizeJavaScript(formatted);
    const unchangedTokens = sourceTokens.length === formattedTokens.length &&
      sourceTokens.every((entry, index) => entry.type === formattedTokens[index].type &&
        entry.value === formattedTokens[index].value);
    if (!unchangedTokens) return { formatted: false, text };
    return { formatted: formatted !== text, text: formatted };
  } catch {
    return { formatted: false, text };
  }
}

export function beautifyJavaScript(source) {
  return javascriptDisplay(source).text;
}

function appendCodePreview(target, text) {
  const pre = target.ownerDocument.createElement('pre');
  pre.className = 'code-preview';
  const code = target.ownerDocument.createElement('code');
  code.textContent = text;
  pre.append(code);
  target.append(pre);
}

function formatJsonSource(source) {
  JSON.parse(source);
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === '"') {
      let cursor = index + 1;
      let escaped = false;
      while (cursor < source.length) {
        const next = source[cursor];
        if (escaped) escaped = false;
        else if (next === '\\') escaped = true;
        else if (next === '"') break;
        cursor += 1;
      }
      tokens.push(source.slice(index, cursor + 1));
      index = cursor + 1;
      continue;
    }
    if ('{}[],:'.includes(character)) {
      tokens.push(character);
      index += 1;
      continue;
    }
    let cursor = index + 1;
    while (cursor < source.length && !/[\s{}\[\],:]/.test(source[cursor])) cursor += 1;
    tokens.push(source.slice(index, cursor));
    index = cursor;
  }

  let output = '';
  let indent = 0;
  let lineStart = true;
  const write = (value) => {
    if (lineStart) {
      output += '  '.repeat(indent);
      lineStart = false;
    }
    output += value;
  };
  const newline = () => {
    if (!output.endsWith('\n')) output += '\n';
    lineStart = true;
  };

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const current = tokens[tokenIndex];
    const previous = tokens[tokenIndex - 1];
    const next = tokens[tokenIndex + 1];
    if (current === '{' || current === '[') {
      write(current);
      if ((current === '{' && next === '}') || (current === '[' && next === ']')) continue;
      indent += 1;
      newline();
    } else if (current === '}' || current === ']') {
      const opensEmptyValue = (current === '}' && previous === '{') ||
        (current === ']' && previous === '[');
      if (!opensEmptyValue) {
        indent = Math.max(0, indent - 1);
        newline();
      }
      write(current);
    } else if (current === ',') {
      write(',');
      newline();
    } else if (current === ':') {
      write(': ');
    } else {
      write(current);
    }
  }
  return output;
}

export function renderTextPreview(target, options = {}) {
  const text = String(options.text ?? '');
  const kind = textViewKind(options.name, options.mime);
  target.replaceChildren();
  target.classList.remove('markdown-preview');
  target.dataset.viewKind = kind;
  if (text.length > PREVIEW_LIMIT) {
    appendNotice(target, `This ${kind} record is too large to format safely. Showing the first ${PREVIEW_EXCERPT_LIMIT.toLocaleString()} characters.`);
    appendCodePreview(target, text.slice(0, PREVIEW_EXCERPT_LIMIT));
    return { kind, truncated: true };
  }
  if (kind === 'markdown') return renderMarkdown(target, text);
  if (kind === 'javascript') {
    const display = javascriptDisplay(text);
    if (!display.formatted && text.trim()) {
      appendNotice(target, 'Exact source is shown because safe JavaScript formatting could not be guaranteed.');
    }
    appendCodePreview(target, display.text);
  } else if (kind === 'json') {
    try {
      appendCodePreview(target, formatJsonSource(text));
    } catch {
      appendNotice(target, 'This JSON is not valid, so the exact source is shown.');
      appendCodePreview(target, text);
    }
  } else {
    appendCodePreview(target, text);
  }
  return { kind, truncated: false };
}
