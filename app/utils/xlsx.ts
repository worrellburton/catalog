// Minimal browser-side XLSX writer. Produces a real Office Open XML
// SpreadsheetML (.xlsx) Blob without any dependencies - Excel, Numbers,
// Google Sheets all open the output natively.
//
// Only what's needed for a single-sheet workbook with text + number cells
// is implemented. Stored (uncompressed) ZIP entries keep the implementation
// small; XLSX files this size are tiny so compression is a non-goal.

export type CellValue = string | number | null | undefined;
export type Row = CellValue[];

export interface Sheet {
  name: string;
  rows: Row[];
  /** Optional column widths in Excel character units. */
  columnWidths?: number[];
}

// ── CRC32 (IEEE) ─────────────────────────────────────────────────────────
// One-time table init; ~3 µs in the worst case, then ~50 MB/s on the body.
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ── ZIP writer (stored / no compression) ─────────────────────────────────
// Just enough of the ZIP spec to satisfy Excel's reader. Uses
// `compressionMethod = 0` (stored) so we don't pull in a DEFLATE
// implementation. XLSX files this size compress poorly anyway.

interface ZipEntry {
  path: string;
  bytes: Uint8Array;
}

function strToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function dosTimeNow(): { time: number; date: number } {
  const d = new Date();
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

function buildZip(entries: ZipEntry[]): Uint8Array {
  const { time, date } = dosTimeNow();
  const localBlocks: Uint8Array[] = [];
  const centralBlocks: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = strToBytes(e.path);
    const data = e.bytes;
    const crc = crc32(data);

    // Local file header (30 + filename + data)
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0,  0x04034b50, true);  // signature
    dv.setUint16(4,  20, true);           // version needed
    dv.setUint16(6,  0, true);            // flags
    dv.setUint16(8,  0, true);            // method = stored
    dv.setUint16(10, time, true);
    dv.setUint16(12, date, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true); // compressed size
    dv.setUint32(22, data.length, true); // uncompressed size
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);           // extra length
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    localBlocks.push(local);

    // Central directory entry (46 + filename)
    const central = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(central.buffer);
    cdv.setUint32(0,  0x02014b50, true);
    cdv.setUint16(4,  20, true);          // version made by
    cdv.setUint16(6,  20, true);          // version needed
    cdv.setUint16(8,  0, true);
    cdv.setUint16(10, 0, true);
    cdv.setUint16(12, time, true);
    cdv.setUint16(14, date, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, data.length, true);
    cdv.setUint32(24, data.length, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint16(30, 0, true);
    cdv.setUint16(32, 0, true);
    cdv.setUint16(34, 0, true);           // disk
    cdv.setUint16(36, 0, true);           // internal attrs
    cdv.setUint32(38, 0, true);           // external attrs
    cdv.setUint32(42, offset, true);      // local header offset
    central.set(nameBytes, 46);
    centralBlocks.push(central);

    offset += local.length;
  }

  const centralSize = centralBlocks.reduce((acc, b) => acc + b.length, 0);
  const centralOffset = offset;

  // End of central directory
  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0,  0x06054b50, true);
  edv.setUint16(4,  0, true);
  edv.setUint16(6,  0, true);
  edv.setUint16(8,  entries.length, true);
  edv.setUint16(10, entries.length, true);
  edv.setUint32(12, centralSize, true);
  edv.setUint32(16, centralOffset, true);
  edv.setUint16(20, 0, true);

  // Concatenate all blocks into one buffer.
  const total = localBlocks.reduce((acc, b) => acc + b.length, 0) + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const b of localBlocks) { out.set(b, p); p += b.length; }
  for (const b of centralBlocks) { out.set(b, p); p += b.length; }
  out.set(eocd, p);
  return out;
}

// ── OpenXML SpreadsheetML ────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colName(zeroIdx: number): string {
  // 0 → A, 1 → B, ..., 25 → Z, 26 → AA
  let n = zeroIdx;
  let s = '';
  while (true) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
    if (n < 0) break;
  }
  return s;
}

function buildSheetXml(sheet: Sheet): string {
  const colDefs = sheet.columnWidths && sheet.columnWidths.length > 0
    ? '<cols>' + sheet.columnWidths.map((w, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`
      ).join('') + '</cols>'
    : '';

  const rowsXml = sheet.rows.map((row, rowIdx) => {
    const r = rowIdx + 1;
    const cells = row.map((value, colIdx) => {
      if (value === null || value === undefined || value === '') return '';
      const ref = `${colName(colIdx)}${r}`;
      if (typeof value === 'number' && Number.isFinite(value)) {
        return `<c r="${ref}"><v>${value}</v></c>`;
      }
      const text = escapeXml(String(value));
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
    }).join('');
    return `<row r="${r}">${cells}</row>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
${colDefs}
<sheetData>${rowsXml}</sheetData>
</worksheet>`;
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

function buildWorkbookXml(sheetName: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
}

const WORKBOOK_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

export function buildXlsx(sheet: Sheet): Uint8Array {
  const entries: ZipEntry[] = [
    { path: '[Content_Types].xml',         bytes: strToBytes(CONTENT_TYPES_XML) },
    { path: '_rels/.rels',                 bytes: strToBytes(ROOT_RELS_XML) },
    { path: 'xl/workbook.xml',             bytes: strToBytes(buildWorkbookXml(sheet.name)) },
    { path: 'xl/_rels/workbook.xml.rels',  bytes: strToBytes(WORKBOOK_RELS_XML) },
    { path: 'xl/worksheets/sheet1.xml',    bytes: strToBytes(buildSheetXml(sheet)) },
  ];
  return buildZip(entries);
}

export function downloadXlsx(sheet: Sheet, filename: string): void {
  const bytes = buildXlsx(sheet);
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
