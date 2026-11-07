import * as XLSX from 'xlsx'

// Build a workbook with a data sheet and an optional "Instructions" sheet
export function makeWorkbook(headers, dataRows, sheetName, instructions) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows])
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(12, Math.min(h.length + 4, 24)) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  if (instructions) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(instructions), 'Instructions')
  return wb
}

// Read an uploaded .xlsx / .csv into an array of row objects.
// cb(rows, errorMessage)
export function readSheet(file, cb) {
  const isCsv = /\.csv$/i.test(file.name)
  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const wb = isCsv
        ? XLSX.read(e.target.result, { type: 'string' })
        : XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true })
      const sn = wb.SheetNames.find((n) => /product|store|template|data/i.test(n)) || wb.SheetNames[0]
      cb(XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: '' }), null)
    } catch (err) {
      cb(null, err.message)
    }
  }
  if (isCsv) reader.readAsText(file)
  else reader.readAsArrayBuffer(file)
}

export function writeFile(wb, filename) {
  XLSX.writeFile(wb, filename)
}

// Template for dispatch uploads (admin reference list or branch received list)
export function downloadDispatchTemplate(mode) {
  const headers = ['sku', 'qty']
  const rows = [
    ['EXAMPLE-SKU-001 (delete this row)', 1],
    ['EXAMPLE-SKU-002 (delete this row)', 1],
  ]
  const instr =
    mode === 'admin'
      ? [
          ['How to use the Admin Reference template'],
          [''],
          ['1. One row = one SKU that should be in this dispatch batch.'],
          ["2. 'sku' is required. 'qty' is optional (defaults to 1 if blank)."],
          ['3. Delete the EXAMPLE rows before uploading.'],
          ["4. This becomes the master list every branch's upload is compared against."],
        ]
      : [
          ['How to use the Branch Upload template'],
          [''],
          ['1. One row = one SKU your branch actually received.'],
          ["2. 'sku' is required. 'qty' is optional (defaults to 1 if blank)."],
          ['3. Delete the EXAMPLE rows before uploading.'],
          ["4. This gets compared against the admin's reference list to find missing/extra SKUs."],
        ]
  writeFile(
    makeWorkbook(headers, rows, 'SKUs', instr),
    mode === 'admin' ? 'dispatch_admin_reference_template.xlsx' : 'dispatch_branch_received_template.xlsx'
  )
}