# ใช้ Skill Doctor ผ่าน Node CLI

CLI ใช้ `dist/engine.js` ตัวเดิมร่วมกับหน้าเว็บ โดยไม่แก้กติกาการตรวจ ไม่เรียกสคริปต์จากแพ็กเกจ ไม่เปิดลิงก์ และไม่ติดตั้ง dependency ต้องใช้ Node.js 20 ขึ้นไป

รันจากโฟลเดอร์ repository:

```sh
node cli/skill-doctor.cjs check ./path/to/skill --json
node cli/skill-doctor.cjs snapshot ./path/to/skill --output ./before.json
node cli/skill-doctor.cjs compare ./before.json ./after.json --json
npm run doctor -- check ./path/to/skill
```

เลือกโฟลเดอร์ของ skill ที่ต้องการตรวจโดยตรง ไฟล์ผล snapshot ต้องอยู่นอกโฟลเดอร์ที่ตรวจ และต้องเป็นชื่อไฟล์ใหม่ CLI จะไม่เขียนทับไฟล์เดิม ไม่มีตัวเลือก force

## ผลลัพธ์และ exit code

| คำสั่ง | Exit 0 | Exit 1 |
| --- | --- | --- |
| `check <folder> [--json]` | ไม่มี error/warning; อาจมี info | พบ error หรือ warning อย่างน้อยหนึ่งข้อ |
| `snapshot <folder> --output <new-file>` | เขียน snapshot สำเร็จ | ไม่ใช้ |
| `compare <before> <after> [--json]` | ทุกไฟล์เหมือนเดิม | มีไฟล์เพิ่ม ลบ หรือเปลี่ยน |

ทุกคำสั่งใช้ exit **2** เมื่อ argument, พาธ, UTF-8, schema หรือขอบเขตข้อมูลไม่ถูกต้อง และ exit **3** เมื่ออ่าน/เขียนไฟล์หรือ output ไม่สำเร็จ ข้อผิดพลาดออก stderr ด้วยรหัสและข้อความคงที่ ไม่ใส่ค่าพาธ เนื้อหาไฟล์ หรือข้อความ exception จากระบบ

`check` และ `compare` ออกข้อความอ่านง่ายตามค่าเริ่มต้น; เพิ่ม `--json` เพื่อใช้ใน CI ส่วน `snapshot` ออก JSON ยืนยันจำนวนไฟล์ทาง stdout และบันทึกไฟล์ตาม `--output` รูปแบบ snapshot ใช้ร่วมกับหน้าเว็บได้

Snapshot เก็บลายนิ้วมือของชุดไฟล์ ไม่ได้บังคับให้ metadata ผ่านการตรวจ ควรรัน `check` แยกถ้าต้องการใช้เป็นเกณฑ์ CI และ exit 0 ไม่ได้รับรองว่าแพ็กเกจปลอดภัย

## ขอบเขตไฟล์

ตรวจพาธจริงและบรรพบุรุษทุกระดับด้วย `lstat` ปฏิเสธ symlink และ Windows junction รวมถึงลิงก์ที่ยังชี้อยู่ในแพ็กเกจ อ่านเฉพาะ regular file ที่ไม่มี hard link ซ้ำ และปฏิเสธ device, socket, FIFO หรือไฟล์พิเศษก่อนเปิด

ใช้ `O_NOFOLLOW` เมื่อระบบรองรับ ตรวจว่า real path ยังอยู่ใน root และตรวจตัวตนไฟล์ก่อน/หลังอ่าน โดยอ่านไม่เกินงบ byte ที่กำหนด ข้อมูลที่เปลี่ยนระหว่างอ่านและตรวจพบจะถูกปฏิเสธ ควรใช้โฟลเดอร์ที่ไม่มีการแก้พร้อมกัน: Node path API ไม่ใช่ sandbox ที่ต้านการแข่งขันเปลี่ยนพาธทุกจังหวะหรือ snapshot filesystem แบบ atomic จึงไม่รับรองกรณี filesystem ถูกแก้โดยผู้โจมตีพร้อมการอ่าน

ไม่มีรายการ ignore อัตโนมัติ และไม่กรองตามนามสกุล ทุกไฟล์ในชุดต้องเป็น UTF-8 ภายใต้ขอบเขต อย่าเลือก root ของ repository ที่มี `.git`, dependency หรือ binary ที่ไม่เกี่ยวข้อง การผิดเงื่อนไขหนึ่งไฟล์จะปฏิเสธการตรวจทั้งชุด

| ขอบเขต | จำนวนสูงสุด |
| --- | ---: |
| จำนวนไฟล์ | 64 |
| ขนาดต่อไฟล์ | 128 KiB |
| ขนาดรวม | 1 MiB |
| พาธสัมพัทธ์ | 240 ตัวอักษร |
| จำนวน entry รวมโฟลเดอร์ | 256 |
| โฟลเดอร์ซ้อน | 16 ระดับ |
| JSON snapshot ที่นำเข้า | 128 KiB |
| ลิงก์ Markdown ที่ตรง heuristic | 2,048 |

ถอด UTF-8 แบบ fatal จึงไม่แทน byte เสียด้วยอักขระอื่น เก็บ BOM และ CRLF ตามเดิม ทำให้ SHA-256 ตรงกับ byte ที่อ่านจริง พาธใช้ slash และคง case/Unicode ตามต้นฉบับ ไม่ normalize ชื่อ ปฏิเสธพาธไม่ portable, control character และอักขระกลับทิศข้อความ รายงานไม่ใส่เนื้อหาและค่า metadata แต่ชื่อพาธสัมพัทธ์และ hash ยังอาจเปิดเผยข้อมูล จึงควรตรวจก่อนแชร์

ไฟล์ output สร้างแบบ exclusive และใช้ permission 0600 เมื่อรองรับ โฟลเดอร์ปลายทางต้องมีอยู่และไม่ผ่านลิงก์ หากเขียนไม่สำเร็จอาจเหลือไฟล์ใหม่ที่ไม่ครบ CLI จะรายงานล้มเหลวและไม่รับรองไฟล์นั้น ไม่มีการเขียนทับไฟล์เดิม

## สิ่งที่ยังตรวจไม่ได้

engine ยังใช้ frontmatter subset แบบบรรทัดเดียว, heuristic ลิงก์ Markdown, การตรวจว่ามีชื่อไฟล์ license และรูปแบบ remote shell ที่ควรทบทวน ไม่ใช่ YAML/Markdown parser เต็มรูปแบบ ไม่ตัดสินสิทธิ์สัญญาอนุญาต ไม่ตรวจ malware/prompt injection และ hash ไม่ใช่ลายเซ็นผู้เผยแพร่

## การตรวจสอบ

[เทส CLI](../tests/cli.test.cjs) สร้างไฟล์สมมติใน temporary directory แล้วเรียก Node CLI จริง ครอบคลุมผลตรงกับ engine, exit code, BOM/CRLF, diff, การไม่เขียนทับ, symlink/junction/hard link, resource limits, UTF-8 เสีย, error ที่ไม่เผยเนื้อหา และการไม่เรียกสคริปต์ของแพ็กเกจ

รัน `npm run check` เพื่อทดสอบ Node และ static checks workflow ของ branch เตรียมตรวจ Linux/Windows เมื่อ push หรือเปิด PR การรัน native filesystem suite บน hosted runner ยังรอตรวจสอบ ไม่อ้างว่าเทสเหล่านี้ผ่านแล้ว รายงาน validation เดิมอ้างอิงเฉพาะ source digest ในรายงานนั้น
