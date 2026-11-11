/* Original Sandworm Skill Doctor engine. No skill execution or remote requests. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SkillDoctor = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const LIMITS = Object.freeze({ fileBytes: 131072, totalBytes: 1048576, files: 64, pathChars: 240, snapshotBytes: 131072, references: 2048 });
  const encoder = new TextEncoder();
  const ERROR = 'ไม่สามารถอ่านข้อมูลได้ โปรดตรวจรูปแบบและขนาดตามคู่มือ';
  function fail() { const error = new Error(ERROR); error.code = 'INVALID_INPUT'; throw error; }
  function bytes(text) { if (typeof text !== 'string') fail(); return encoder.encode(text).byteLength; }
  function validPath(path) {
    return typeof path === 'string' && path.length > 0 && path.length <= LIMITS.pathChars &&
      !/^[/]|[\\:\x00-\x1f\x7f]/.test(path) && !path.split('/').some(part => !part || part === '.' || part === '..');
  }
  function validateFiles(files) {
    if (!Array.isArray(files) || !files.length || files.length > LIMITS.files) fail();
    const seen = new Set(); let total = 0;
    return files.map(file => {
      if (!file || typeof file !== 'object' || !validPath(file.path) || seen.has(file.path)) fail();
      const size = bytes(file.content);
      if (size > LIMITS.fileBytes || (total += size) > LIMITS.totalBytes) fail();
      seen.add(file.path); return { path: file.path, content: file.content, bytes: size };
    }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  }
  async function sha256(content) {
    const data = encoder.encode(content);
    if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    }
    if (typeof module === 'object' && module.exports) return require('node:crypto').createHash('sha256').update(data).digest('hex');
    throw new Error('SHA-256 ต้องใช้ HTTPS หรือ localhost ในเบราว์เซอร์นี้');
  }
  async function createSnapshot(files) {
    const validated = validateFiles(files);
    const entries = [];
    for (const file of validated) entries.push({ path: file.path, bytes: file.bytes, sha256: await sha256(file.content) });
    return { schema: 'sandworm.skill-snapshot.v1', algorithm: 'SHA-256', files: entries };
  }
  function validateSnapshot(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.schema !== 'sandworm.skill-snapshot.v1' || value.algorithm !== 'SHA-256' || !Array.isArray(value.files) || !value.files.length || value.files.length > LIMITS.files) fail();
    let total = 0; const seen = new Set();
    const files = value.files.map(file => {
      if (!file || !validPath(file.path) || seen.has(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > LIMITS.fileBytes || !/^[0-9a-f]{64}$/.test(file.sha256) || (total += file.bytes) > LIMITS.totalBytes) fail();
      seen.add(file.path); return { path: file.path, bytes: file.bytes, sha256: file.sha256 };
    }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    return { schema: 'sandworm.skill-snapshot.v1', algorithm: 'SHA-256', files };
  }
  function parseSnapshot(text) {
    if (bytes(text) > LIMITS.snapshotBytes) fail();
    let parsed; try { parsed = JSON.parse(text); } catch (_) { fail(); }
    return validateSnapshot(parsed);
  }
  function compareSnapshots(before, after) {
    const previous = validateSnapshot(before).files, current = validateSnapshot(after).files;
    const old = new Map(previous.map(file => [file.path, file]));
    const now = new Map(current.map(file => [file.path, file]));
    const result = { added: [], removed: [], changed: [], unchanged: [] };
    for (const file of current) {
      const prior = old.get(file.path);
      if (!prior) result.added.push(file.path);
      else if (file.sha256 !== prior.sha256 || file.bytes !== prior.bytes) result.changed.push(file.path);
      else result.unchanged.push(file.path);
    }
    for (const file of previous) if (!now.has(file.path)) result.removed.push(file.path);
    return result;
  }
  function parseFrontmatter(text) {
    if (bytes(text) > LIMITS.fileBytes) fail();
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
    const fields = Object.create(null); const findings = [];
    const add = (code, level, message) => findings.push({ code, level, message });
    if (lines[0] !== '---') { add('FRONTMATTER_MISSING', 'error', 'ไม่พบ frontmatter เริ่มต้นด้วย ---'); return { fields, findings }; }
    let end = -1;
    for (let i = 1; i < Math.min(lines.length, 130); i++) if (lines[i] === '---') { end = i; break; }
    if (end < 0) { add('FRONTMATTER_UNCLOSED', 'error', 'ไม่พบ --- ปิด frontmatter ภายใน 128 บรรทัด'); return { fields, findings }; }
    let unsupported = false;
    for (let i = 1; i < end; i++) {
      const line = lines[i]; if (!line.trim() || /^\s*#/.test(line)) continue;
      const match = /^([a-zA-Z][a-zA-Z0-9_-]*):[ \t]*(.*)$/.exec(line);
      if (!match) { unsupported = true; continue; }
      const key = match[1]; let value = match[2].trim();
      if (Object.hasOwn(fields, key)) { add('DUPLICATE_FIELD', 'error', 'พบชื่อฟิลด์ซ้ำใน frontmatter'); continue; }
      if (/^[>|[\]{&*!]/.test(value) || /\s#/.test(value)) { unsupported = true; continue; }
      if (value.startsWith('"')) { try { value = JSON.parse(value); } catch (_) { unsupported = true; continue; } if (typeof value !== 'string') { unsupported = true; continue; } }
      else if (value.startsWith("'")) { if (!/^'(?:[^']|'')*'$/.test(value)) { unsupported = true; continue; } value = value.slice(1, -1).replace(/''/g, "'"); }
      fields[key] = value;
    }
    if (unsupported) add('FRONTMATTER_UNSUPPORTED', 'warning', 'มีรูปแบบนอกเหนือ key: value บรรทัดเดียว ตัวตรวจนี้ไม่ใช่ YAML parser เต็มรูปแบบ');
    if (!fields.name || fields.name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fields.name)) add('NAME_INVALID', 'error', 'name ต้องเป็นอักษรเล็ก ตัวเลข และขีดกลาง ไม่เกิน 64 ตัวอักษร');
    if (!fields.description || !fields.description.trim() || fields.description.length > 1024) add('DESCRIPTION_INVALID', 'error', 'description ต้องไม่ว่าง และยาวไม่เกิน 1,024 ตัวอักษร');
    return { fields, findings };
  }
  function resolveReference(target, sourcePath) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) return { kind: 'external' };
    if (target.startsWith('#')) return { kind: 'anchor' };
    let path; try { path = decodeURIComponent(target.split(/[?#]/)[0]); } catch (_) { return { kind: 'unsafe' }; }
    if (!path || /^[\/\\]|[\\:\x00-\x1f\x7f]/.test(path)) return { kind: 'unsafe' };
    const segments = sourcePath.split('/').slice(0, -1);
    for (const part of path.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') { if (!segments.length) return { kind: 'unsafe' }; segments.pop(); }
      else segments.push(part);
    }
    const resolved = segments.join('/');
    return validPath(resolved) ? { kind: 'local', path: resolved } : { kind: 'unsafe' };
  }
  function inspectPackage(files) {
    const validated = validateFiles(files), known = new Set(validated.map(file => file.path));
    const findings = []; let skillCount = 0, references = 0;
    for (const file of validated) {
      if (!/(^|\/)SKILL\.md$/.test(file.path)) continue;
      skillCount++;
      const parsed = parseFrontmatter(file.content);
      for (const finding of parsed.findings) findings.push({ path: file.path, ...finding });
      // Deliberately limited Markdown-link heuristic: no AST or arbitrary code interpretation.
      for (const match of file.content.matchAll(/\[[^\]\n]*\]\(([^\s()]+)\)/g)) {
        references++; if (references > LIMITS.references) fail();
        const reference = resolveReference(match[1], file.path);
        if (reference.kind === 'unsafe') findings.push({ path: file.path, code: 'REFERENCE_ESCAPE', level: 'error', message: 'พบลิงก์ไฟล์ที่ไม่อยู่ในขอบเขตแพ็กเกจหรือรูปแบบพาธไม่ถูกต้อง' });
        else if (reference.kind === 'external') findings.push({ path: file.path, code: 'REFERENCE_EXTERNAL', level: 'info', message: 'มีลิงก์ภายนอก ซึ่งยังไม่ได้เปิดหรือตรวจเนื้อหา' });
        else if (reference.kind === 'local' && !known.has(reference.path)) findings.push({ path: file.path, code: 'REFERENCE_MISSING', level: 'warning', message: 'ลิงก์ไฟล์ภายในไม่พบในชุดไฟล์ที่เลือก อาจเป็นเพราะนำเข้าไม่ครบ' });
      }
      if (/\b(?:curl|wget)\b[^\n]{0,200}\|\s*(?:sh|bash)\b/i.test(file.content)) findings.push({ path: file.path, code: 'REMOTE_SHELL_PATTERN', level: 'warning', message: 'พบรูปแบบดาวน์โหลดแล้วส่งให้ shell ควรอ่านและตรวจต้นทางด้วยตนเอง' });
    }
    if (!skillCount) findings.push({ path: '', code: 'SKILL_MISSING', level: 'error', message: 'ไม่พบไฟล์ที่ชื่อ SKILL.md ตรงตัวในชุดไฟล์' });
    const hasLicense = validated.some(file => /(^|\/)(?:LICENSE|LICENCE|COPYING)(?:\.[a-z0-9]+)?$/i.test(file.path) && file.content.trim());
    if (!hasLicense) findings.push({ path: '', code: 'LICENSE_NOT_INCLUDED', level: 'warning', message: 'ไม่พบไฟล์สัญญาอนุญาตในชุดที่เลือก ต้องตรวจสิทธิ์จากต้นทาง' });
    return { schema: 'sandworm.skill-review.v1', scope: 'Selected text files only; heuristic review, not a security certification', fileCount: validated.length, skillCount, references, licenseFilePresent: hasLicense, findings, counts: { error: findings.filter(f => f.level === 'error').length, warning: findings.filter(f => f.level === 'warning').length, info: findings.filter(f => f.level === 'info').length } };
  }
  return Object.freeze({ LIMITS, ERROR, bytes, validPath, validateFiles, sha256, createSnapshot, validateSnapshot, parseSnapshot, compareSnapshots, parseFrontmatter, resolveReference, inspectPackage });
}));
