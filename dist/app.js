(function () {
  'use strict';
  const E = window.SkillDoctor, $ = id => document.getElementById(id);
  const source = $('skill-source'), baseline = $('baseline');
  let imported = [], snapshot = null, report = null, comparison = null, revision = 0, sourceEdited = true;
  const SAMPLE = '---\nname: incident-summary\ndescription: Summarize a synthetic incident record before human review.\n---\n\n# Incident summary\n\nRead [the template](templates/summary.md).\nKeep evidence separate from assumptions.\nSee [upstream guidance](https://example.invalid/docs) for context.\n';
  const status = text => { $('status').textContent = text; };
  function error(text) { $('error-box').hidden = false; $('error-box').textContent = text; }
  function empty(element, message) { element.replaceChildren(); element.className = 'empty'; element.textContent = message; }
  function invalidate(message) {
    revision++; snapshot = report = comparison = null;
    $('error-box').hidden = true; $('export-review').checked = false; $('export-review').disabled = true;
    for (const id of ['snapshot-btn', 'report-btn', 'compare-btn']) $(id).disabled = true;
    $('error-count').textContent = $('warning-count').textContent = '—';
    empty($('findings'), 'ข้อมูลเปลี่ยนแล้ว กดตรวจเพื่อดูผลล่าสุด');
    empty($('comparison'), 'ยังไม่มี snapshot ปัจจุบันสำหรับเปรียบเทียบ');
    $('inspection-summary').textContent = 'ตรวจเฉพาะชุดไฟล์ปัจจุบัน';
    updateCount(); if (message) status(message);
  }
  function inputFiles() {
    const files = imported.filter(file => file.path !== 'SKILL.md');
    const original = imported.find(file => file.path === 'SKILL.md');
    if (original && !sourceEdited) files.unshift({ path: 'SKILL.md', content: original.content });
    else if (source.value.trim()) files.unshift({ path: 'SKILL.md', content: source.value });
    return files;
  }
  function updateCount() { $('file-count').textContent = String(inputFiles().length); }
  function cell(tag, text) { const e = document.createElement(tag); e.textContent = text; return e; }
  function renderFindings(value) {
    const area = $('findings'); area.replaceChildren(); area.className = '';
    if (!value.findings.length) { empty(area, 'ไม่พบข้อสังเกตจากกฎชุดนี้ ยังต้องอ่านเนื้อหาและตรวจสิทธิ์ก่อนใช้'); return; }
    const labels = { error: 'โครงสร้าง', warning: 'ตรวจเพิ่มเติม', info: 'ข้อมูล' };
    for (const finding of value.findings) {
      const item = document.createElement('article'); item.className = 'result-card ' + (finding.level === 'error' ? 'fail' : '');
      item.append(cell('strong', labels[finding.level] + ' · ' + finding.code));
      if (finding.path) item.append(cell('p', finding.path));
      item.append(cell('p', finding.message)); area.append(item);
    }
  }
  function renderComparison(diff) {
    const area = $('comparison'); area.replaceChildren(); area.className = 'table-wrap';
    const table = document.createElement('table'), head = document.createElement('thead'), row = document.createElement('tr');
    row.append(cell('th', 'สถานะ'), cell('th', 'ไฟล์')); head.append(row); table.append(head);
    const body = document.createElement('tbody');
    const labels = { added: 'เพิ่ม', removed: 'ลบ', changed: 'เปลี่ยน', unchanged: 'ตรงเดิม' };
    for (const [kind, paths] of Object.entries(diff)) for (const path of paths) { const r = document.createElement('tr'); r.append(cell('td', labels[kind]), cell('td', path)); body.append(r); }
    table.append(body); area.append(table);
  }
  function resetExport() { $('export-review').checked = false; $('snapshot-btn').disabled = $('report-btn').disabled = true; }
  async function inspect() {
    invalidate('กำลังตรวจไฟล์และคำนวณ SHA-256…'); const current = revision;
    try {
      const files = inputFiles(); const checked = E.inspectPackage(files); const hashed = await E.createSnapshot(files);
      if (current !== revision) return;
      snapshot = hashed; report = checked;
      $('error-count').textContent = String(report.counts.error); $('warning-count').textContent = String(report.counts.warning);
      $('file-count').textContent = String(report.fileCount); renderFindings(report);
      $('inspection-summary').textContent = 'ตรวจ ' + report.skillCount + ' SKILL.md · ลิงก์ ' + report.references + ' รายการ · ' + (report.licenseFilePresent ? 'พบไฟล์ license (ยังไม่ตีความสิทธิ์)' : 'ไม่มีไฟล์ license ในชุดนี้');
      $('export-review').disabled = false; $('compare-btn').disabled = false;
      empty($('comparison'), 'เพิ่ม snapshot ก่อนหน้าเพื่อเปรียบเทียบกับชุดปัจจุบัน');
      status('ตรวจและสร้าง snapshot แล้ว ตรวจทานชื่อไฟล์ก่อนส่งออก');
      if (baseline.value.trim()) compare();
    } catch (_) { if (current === revision) { error(E.ERROR); status('ยังไม่มีผลตรวจที่ใช้ส่งออกได้'); } }
  }
  function compare() {
    if (!snapshot) return;
    comparison = null; resetExport(); $('error-box').hidden = true;
    try { comparison = E.compareSnapshots(E.parseSnapshot(baseline.value), snapshot); renderComparison(comparison); status('เปรียบเทียบแล้ว กรุณาตรวจทานผลใหม่ก่อนส่งออก'); }
    catch (_) { error('Snapshot ไม่ถูกต้องหรือเกินขนาด 128 KiB โปรดใช้รูปแบบที่ Skill Doctor ส่งออก'); empty($('comparison'), 'เปรียบเทียบไม่สำเร็จ'); }
  }
  async function readText(file, limit) {
    if (!file || !Number.isSafeInteger(file.size) || file.size > limit) throw new Error(E.ERROR);
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
  }
  async function importFiles(list, folder) {
    invalidate('กำลังอ่านไฟล์ที่เลือก…'); const current = revision;
    try {
      const selected = Array.from(list); if (!selected.length) { status('ไม่ได้เลือกไฟล์'); return; }
      if (selected.length > E.LIMITS.files || selected.reduce((sum, f) => sum + f.size, 0) > E.LIMITS.totalBytes) throw new Error(E.ERROR);
      const files = [];
      for (const file of selected) {
        let path = folder ? file.webkitRelativePath : file.name;
        if (folder) { const slash = path.indexOf('/'); if (slash < 0) throw new Error(E.ERROR); path = path.slice(slash + 1); }
        files.push({ path, content: await readText(file, E.LIMITS.fileBytes) });
      }
      E.validateFiles(files); if (current !== revision) return;
      imported = files;
      const main = files.find(file => file.path === 'SKILL.md'); source.value = main ? main.content : ''; sourceEdited = false;
      $('package-summary').textContent = 'นำเข้า ' + files.length + ' ไฟล์ · พาธยังอยู่ในรายงานที่ส่งออก'; updateCount(); status('อ่านไฟล์แล้ว กดตรวจและสร้าง snapshot');
    } catch (_) { if (current === revision) { imported = []; source.value = ''; updateCount(); $('package-summary').textContent = 'นำเข้าไม่สำเร็จ ไม่มีไฟล์จากการเลือกครั้งนี้'; error('อ่านไฟล์ไม่ได้ ใช้ไฟล์ UTF-8 ไม่เกิน 64 ไฟล์, 128 KiB ต่อไฟล์ และรวม 1 MiB'); } }
  }
  function download(value, name) {
    if (!snapshot || !$('export-review').checked) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    status('ส่งออกแล้ว รายงานมีชื่อไฟล์และแฮช แต่ไม่มีเนื้อหาต้นฉบับ');
  }
  source.addEventListener('input', () => { sourceEdited = true; invalidate('ต้นฉบับเปลี่ยนแล้ว กรุณาตรวจใหม่'); });
  baseline.addEventListener('input', () => { revision++; comparison = null; resetExport(); empty($('comparison'), 'Snapshot ก่อนหน้าเปลี่ยนแล้ว กดเปรียบเทียบอีกครั้ง'); });
  $('inspect-btn').addEventListener('click', inspect); $('compare-btn').addEventListener('click', compare);
  $('package-files').addEventListener('change', event => importFiles(event.target.files, false));
  $('package-folder').addEventListener('change', event => importFiles(event.target.files, true));
  $('baseline-file').addEventListener('change', async event => {
    const current = ++revision; comparison = null; resetExport();
    try { const text = await readText(event.target.files[0], E.LIMITS.snapshotBytes); E.parseSnapshot(text); if (current !== revision) return; baseline.value = text; empty($('comparison'), 'อ่าน snapshot แล้ว กดเปรียบเทียบ'); status('นำเข้า snapshot ก่อนหน้าแล้ว'); }
    catch (_) { if (current === revision) { baseline.value = ''; error('อ่าน snapshot ไม่สำเร็จ ใช้ JSON ที่ Skill Doctor ส่งออก'); } }
  });
  $('export-review').addEventListener('change', () => { const disabled = !snapshot || !$('export-review').checked; $('snapshot-btn').disabled = $('report-btn').disabled = disabled; });
  $('snapshot-btn').addEventListener('click', () => download(snapshot, 'skill-snapshot.json'));
  $('report-btn').addEventListener('click', () => download({ schema: 'sandworm.skill-report.v1', inspection: report, snapshot, comparison }, 'skill-review.json'));
  $('clear-btn').addEventListener('click', () => { imported = []; sourceEdited = true; source.value = baseline.value = ''; for (const id of ['package-files', 'package-folder', 'baseline-file']) $(id).value = ''; $('package-summary').textContent = 'ยังไม่มีไฟล์ประกอบ'; invalidate('ล้างข้อมูลในหน้านี้แล้ว'); });
  $('demo-btn').addEventListener('click', () => { sourceEdited = true; source.value = SAMPLE; baseline.value = ''; imported = [{ path: 'templates/summary.md', content: '# Summary\n\nEvidence:\nOpen questions:\n' }, { path: 'LICENSE', content: 'Synthetic demonstration fixture. CC0-1.0.\n' }]; $('package-summary').textContent = 'ชุดตัวอย่างสมมติ 3 ไฟล์ ไม่มีการดาวน์โหลดจากต้นทาง'; invalidate('ใส่ตัวอย่างแล้ว กดตรวจและสร้าง snapshot'); });
  updateCount();
}());
