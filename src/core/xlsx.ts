import type { Tester } from './supabase'
import type { ProjectConfig } from '../projects.config'

const encoder = new TextEncoder()
const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
function safeCell(value: unknown): string {
  let text = String(value ?? '')
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return text
}
function col(index: number): string {
  let result = ''; let n = index
  while (n > 0) { const r = (n - 1) % 26; result = String.fromCharCode(65 + r) + result; n = Math.floor((n - 1) / 26) }
  return result
}
function worksheet(rows: string[][]): string {
  const xmlRows = rows.map((row, ri) => `<row r="${ri + 1}">${row.map((v, ci) => {
    const text = esc(safeCell(v))
    return `<c r="${col(ci + 1)}${ri + 1}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`
  }).join('')}</row>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlRows}</sheetData></worksheet>`
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function u16(view: DataView, offset: number, value: number) { view.setUint16(offset, value, true) }
function u32(view: DataView, offset: number, value: number) { view.setUint32(offset, value >>> 0, true) }
function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Uint8Array(length); let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.length }
  return result
}
function zipStore(files: { path: string; content: string }[]): Uint8Array {
  const local: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0
  for (const file of files) {
    const name = encoder.encode(file.path); const data = encoder.encode(file.content); const crc = crc32(data)
    const localHeader = new Uint8Array(30 + name.length); const lv = new DataView(localHeader.buffer)
    u32(lv, 0, 0x04034b50); u16(lv, 4, 20); u16(lv, 6, 0x0800); u16(lv, 8, 0); u16(lv, 10, 0); u16(lv, 12, 0)
    u32(lv, 14, crc); u32(lv, 18, data.length); u32(lv, 22, data.length); u16(lv, 26, name.length); u16(lv, 28, 0); localHeader.set(name, 30)
    local.push(localHeader, data)
    const centralHeader = new Uint8Array(46 + name.length); const cv = new DataView(centralHeader.buffer)
    u32(cv, 0, 0x02014b50); u16(cv, 4, 20); u16(cv, 6, 20); u16(cv, 8, 0x0800); u16(cv, 10, 0); u16(cv, 12, 0); u16(cv, 14, 0)
    u32(cv, 16, crc); u32(cv, 20, data.length); u32(cv, 24, data.length); u16(cv, 28, name.length); u16(cv, 30, 0); u16(cv, 32, 0); u16(cv, 34, 0); u16(cv, 36, 0); u32(cv, 38, 0); u32(cv, 42, offset); centralHeader.set(name, 46)
    central.push(centralHeader); offset += localHeader.length + data.length
  }
  const centralBytes = concat(central); const centralOffset = offset
  const end = new Uint8Array(22); const ev = new DataView(end.buffer)
  u32(ev, 0, 0x06054b50); u16(ev, 4, 0); u16(ev, 6, 0); u16(ev, 8, files.length); u16(ev, 10, files.length); u32(ev, 12, centralBytes.length); u32(ev, 16, centralOffset); u16(ev, 20, 0)
  return concat([...local, centralBytes, end])
}
function rowsFor(project: ProjectConfig, testers: Tester[]): string[][] {
  const extra = project.extraColumns.map((key) => key === 'use_case' ? 'À tester' : key === 'test_target' ? 'Cible' : key)
  const header = ['Nom complet', 'E-mail', 'WhatsApp', 'Pays / ville', 'Appareil', ...extra, 'Consentement le', 'Inscrit le']
  const rows = testers.map((tester) => [tester.full_name, tester.email, tester.whatsapp, tester.country_city, tester.device, ...project.extraColumns.map((key) => String(tester.extra?.[key] ?? '')), tester.consent_at, tester.created_at])
  return [header, ...rows]
}
export function createWorkbook(sheets: { project: ProjectConfig; testers: Tester[] }[]): Uint8Array {
  const safeNames = sheets.map(({ project }) => project.label.replace(/[\\/*?:\[\]]/g, '').slice(0, 31))
  const sheetXml = sheets.map(({ project, testers }, i) => ({ path: `xl/worksheets/sheet${i + 1}.xml`, content: worksheet(rowsFor(project, testers)) }))
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${safeNames.map((name, i) => `<sheet name="${esc(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`
  return zipStore([
    { path: '[Content_Types].xml', content: contentTypes }, { path: '_rels/.rels', content: rootRels },
    { path: 'xl/workbook.xml', content: workbook }, { path: 'xl/_rels/workbook.xml.rels', content: rels },
    { path: 'xl/styles.xml', content: styles }, ...sheetXml,
  ])
}
