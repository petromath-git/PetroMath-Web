const pdfParse = require('pdf-parse');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile, exec } = require('child_process');
const moment = require('moment');

const SUPPLIER_MAP = {
    'IOCL': 'IOCL',
    'INDIAN OIL': 'IOCL',
    'INDIANOIL': 'IOCL',
    'BPCL': 'BPCL',
    'BHARAT PETROLEUM': 'BPCL',
    'HPCL': 'HPCL',
    'HINDUSTAN PETROLEUM': 'HPCL'
};

function resolveSupplier(companyName) {
    if (!companyName) return null;
    return SUPPLIER_MAP[companyName.toUpperCase().trim()] || null;
}

const SUPPLIER_DETECT_PATTERNS = [
    { pattern: /INDIAN OIL CORPORATION/i,       supplier: 'IOCL' },
    { pattern: /BHARAT PETROLEUM CORPORATION/i,  supplier: 'BPCL' },
    { pattern: /HINDUSTAN PETROLEUM CORPORATION/i, supplier: 'HPCL' },
    { pattern: /\bINDIAN OIL\b/i,               supplier: 'IOCL' },
    { pattern: /\bBHARAT PETROLEUM\b/i,          supplier: 'BPCL' },
    { pattern: /\bHINDUSTAN PETROLEUM\b/i,       supplier: 'HPCL' },
];

function detectSupplierFromText(text) {
    for (const { pattern, supplier } of SUPPLIER_DETECT_PATTERNS) {
        if (pattern.test(text)) return supplier;
    }
    return null;
}

function loadConfig(supplierKey) {
    const configPath = path.join(__dirname, '..', 'config', 'invoice-parsers', `${supplierKey}.json`);
    if (!fs.existsSync(configPath)) {
        throw new Error(`No invoice parser config found for supplier: ${supplierKey}`);
    }
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

async function extractText(pdfBuffer) {
    const data = await pdfParse(pdfBuffer);
    const text = data.text || '';
    if (text.trim().length >= 50) return text;
    return await extractTextViaOcr(pdfBuffer);
}

function fixOcrText(text) {
    return text
        // "KL" commonly misread as "Ku" by OCR
        .replace(/(\d)\s+Ku\b/g, '$1 KL')
        // Colon ":" commonly misread as "2" after "No " → "No 2497884734" → "No :497884734"
        .replace(/\b(No|No\.)\s+2(\d{6,})/g, '$1 :$2');
}

async function extractTextViaOcr(pdfBuffer) {
    const uid = crypto.randomBytes(8).toString('hex');
    const tmpDir = os.tmpdir();
    const pdfPath = path.join(tmpDir, `pm_inv_${uid}.pdf`);
    const imgPrefix = path.join(tmpDir, `pm_inv_${uid}`);

    fs.writeFileSync(pdfPath, pdfBuffer);

    try {
        // Convert each PDF page to a PNG image at 300 DPI
        const pdftoppmBin = process.env.PDFTOPPM_PATH || 'pdftoppm';
        await new Promise((resolve, reject) => {
            exec(`"${pdftoppmBin}" -r 300 -png "${pdfPath}" "${imgPrefix}"`, (err) => {
                if (err) reject(new Error('PDF→image conversion failed. Is poppler-utils installed? ' + err.message));
                else resolve();
            });
        });

        const imgFiles = fs.readdirSync(tmpDir)
            .filter(f => f.startsWith(`pm_inv_${uid}`) && f.endsWith('.png'))
            .sort()
            .map(f => path.join(tmpDir, f));

        if (imgFiles.length === 0) throw new Error('No pages extracted from PDF during OCR.');

        // OCR each page with tesseract
        const pageTexts = await Promise.all(imgFiles.map(imgPath =>
            new Promise((resolve, reject) => {
                const tesseractBin = process.env.TESSERACT_PATH || 'tesseract';
                exec(
                    `"${tesseractBin}" "${imgPath}" stdout -l eng --oem 1 --psm 3`,
                    { maxBuffer: 4 * 1024 * 1024 },
                    (err, stdout) => {
                        if (err) reject(new Error('Tesseract OCR failed. Is tesseract-ocr installed? ' + err.message));
                        else resolve(stdout);
                    }
                );
            })
        ));

        return fixOcrText(pageTexts.join('\n'));
    } finally {
        try { fs.unlinkSync(pdfPath); } catch {}
        fs.readdirSync(tmpDir)
            .filter(f => f.startsWith(`pm_inv_${uid}`))
            .forEach(f => { try { fs.unlinkSync(path.join(tmpDir, f)); } catch {} });
    }
}

function cleanNumber(raw, cleanType) {
    if (raw == null) return null;
    let s = String(raw).trim();
    if (cleanType === 'remove_commas' || true) {
        s = s.replace(/,/g, '');
    }
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
}

function normaliseDate(raw, formats) {
    if (!raw) return null;
    const cleaned = raw.trim();
    for (const fmt of formats) {
        const m = moment(cleaned, fmt, true);
        if (m.isValid()) return m.format('YYYY-MM-DD');
    }
    // Loose parse as fallback
    const m = moment(cleaned);
    return m.isValid() ? m.format('YYYY-MM-DD') : null;
}

// Return all lines of text as array, with their positions
function getLines(text) {
    return text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
}

// Find the first line index that contains the keyword (case-insensitive)
function findLineIndex(lines, keyword, startFrom = 0, exactLine = false) {
    const kw = keyword.toLowerCase();
    for (let i = startFrom; i < lines.length; i++) {
        const l = lines[i].toLowerCase();
        if (exactLine ? l === kw : l.includes(kw)) return i;
    }
    return -1;
}

// Extract all numeric tokens from a line (strips commas)
function numbersOnLine(line) {
    const matches = line.replace(/,/g, '').match(/\d+\.?\d*/g);
    return matches ? matches.map(Number) : [];
}

function applyStrategy(lines, fieldConfig, blockStart, blockEnd) {
    const { keyword, strategy, pattern, position, clean, exact_match } = fieldConfig;

    if (strategy === 'value_after_keyword') {
        let searchFrom = blockStart;
        while (true) {
            const idx = findLineIndex(lines, keyword, searchFrom);
            if (idx < 0 || idx > blockEnd) return null;
            const line = lines[idx];
            const kwPos = line.toLowerCase().indexOf(keyword.toLowerCase());
            const after = line.slice(kwPos + keyword.length).trim().replace(/^[:\s]+/, '');
            if (pattern) {
                const m = after.match(new RegExp(pattern));
                if (m) return m[0].trim();
                searchFrom = idx + 1;
                continue;
            }
            return after.split(/\s+/)[0] || null;
        }
    }

    if (strategy === 'value_at_keyword') {
        const idx = findLineIndex(lines, keyword, blockStart);
        if (idx < 0 || idx > blockEnd) return null;
        const line = lines[idx];
        if (pattern) {
            const m = line.match(new RegExp(pattern));
            if (!m) return null;
            return (m[1] != null ? m[1] : m[0]).trim();
        }
        return null;
    }

    if (strategy === 'nth_number_on_line') {
        const idx = findLineIndex(lines, keyword, blockStart);
        if (idx < 0 || idx > blockEnd) return null;
        const nums = numbersOnLine(lines[idx]);
        const val = nums[position - 1] != null ? nums[position - 1] : null;
        return val;
    }

    if (strategy === 'last_number_on_line') {
        const idx = findLineIndex(lines, keyword, blockStart);
        if (idx < 0 || idx > blockEnd) return null;
        const nums = numbersOnLine(lines[idx]);
        return nums.length > 0 ? nums[nums.length - 1] : null;
    }

    if (strategy === 'value_before_keyword') {
        // Value appears on the same line BEFORE the keyword: "7005531183SAP Entry no."
        const idx = findLineIndex(lines, keyword, blockStart);
        if (idx < 0 || idx > blockEnd) return null;
        const line = lines[idx];
        const kwPos = line.toLowerCase().indexOf(keyword.toLowerCase());
        const before = line.slice(0, kwPos).trim();
        if (pattern) {
            const m = before.match(new RegExp(pattern));
            if (m) return m[0].trim();
        }
        if (before) return before.split(/\s+/).pop() || null;
        // Fallback: value is on the previous line
        if (idx > 0 && pattern) {
            const m = lines[idx - 1].match(new RegExp(pattern));
            if (m) return m[0].trim();
        }
        return idx > 0 ? lines[idx - 1].trim() : null;
    }

    if (strategy === 'value_on_prev_line') {
        // Value is on the line before the keyword
        const idx = findLineIndex(lines, keyword, blockStart, !!exact_match);
        if (idx < 1 || idx > blockEnd) return null;
        const prev = lines[idx - 1];
        if (pattern) {
            const m = prev.match(new RegExp(pattern));
            return m ? m[0].trim() : null;
        }
        return prev.trim();
    }

    if (strategy === 'nth_number_on_next_line') {
        // Keyword on one line, values on the next: "A/R Vat Payable\n13.000%39683.59"
        const idx = findLineIndex(lines, keyword, blockStart, !!exact_match);
        if (idx < 0 || idx > blockEnd || idx + 1 >= lines.length) return null;
        const nextLine = lines[idx + 1];
        const nums = numbersOnLine(nextLine);
        return nums[position - 1] != null ? nums[position - 1] : null;
    }

    if (strategy === 'number_before_keyword') {
        // Scan the block for a line containing keyword, extract the number right before it
        const idx = findLineIndex(lines, keyword, blockStart);
        if (idx < 0 || idx > blockEnd) return null;
        const line = lines[idx];
        const kwPos = line.toLowerCase().indexOf(keyword.toLowerCase());
        const before = line.slice(0, kwPos).replace(/,/g, '').trim();
        const m = before.match(/[\d.]+$/);
        return m ? parseFloat(m[0]) : null;
    }

    if (strategy === 'number_before_keyword_on_prev_line') {
        // BPCL: qty is on the line before DLY/TAXABLE CHARGE, before "KL"
        const idx = findLineIndex(lines, keyword, blockStart);
        if (idx < 0 || idx > blockEnd || idx === 0) return null;
        const prevLine = lines[idx - 1];
        const ukw = fieldConfig.unit_keyword || 'KL';
        const ukwPos = prevLine.toUpperCase().indexOf(ukw);
        if (ukwPos < 0) return null;
        const before = prevLine.slice(0, ukwPos).replace(/,/g, '').trim();
        const m = before.match(/[\d.]+$/);
        return m ? parseFloat(m[0]) : null;
    }

    if (strategy === 'hsn_from_prev_line') {
        // IOCL: "1016730   EBMS4.000KL2710 12 42." — HSN is "2710 12 42" at end of prev line
        if (blockStart <= 0) return null;
        for (let i = blockStart - 1; i >= Math.max(0, blockStart - 3); i--) {
            const l = lines[i];
            if (!l) continue;
            const m = l.match(/(2710[\s\d]+)/);
            if (m) return m[1].trim().replace(/\s+/g, ' ').replace(/\.$/, '');
        }
        return null;
    }

    if (strategy === 'line_before_block_start') {
        // Product name: walk back from blockStart, find line containing product name
        // IOCL format: "1016730   EBMS4.000KL2710 12 42." → extract "EBMS"
        if (blockStart <= 0) return null;
        for (let i = blockStart - 1; i >= Math.max(0, blockStart - 5); i--) {
            const l = lines[i];
            if (!l || l.length < 2) continue;
            // Strip leading item number (digits + spaces)
            const stripped = l.replace(/^\d+\s+/, '').trim();
            if (!stripped) continue;
            // Extract text up to the first digit sequence (product name ends before qty)
            const nameMatch = stripped.match(/^([A-Z][A-Z0-9\s\-]*?)(?=\d|\s*$)/);
            if (nameMatch && nameMatch[1].trim().length > 1) {
                return nameMatch[1].trim();
            }
            // Fallback: if line doesn't start with digit and isn't just numbers
            if (!/^\d/.test(l)) {
                return l.replace(/^\d+[.\s]+/, '').split(/\s{2,}/)[0].trim();
            }
        }
        return null;
    }

    return null;
}

function parseHeaderFields(lines, headerConfig, dateFormats) {
    const result = {};
    const totalLines = lines.length;

    for (const [fieldName, fieldConfig] of Object.entries(headerConfig)) {
        let raw = applyStrategy(lines, fieldConfig, 0, totalLines - 1);
        if (raw == null) { result[fieldName] = null; continue; }

        if (fieldName === 'invoice_date') {
            result[fieldName] = normaliseDate(String(raw), dateFormats);
        } else if (['total_invoice_amount'].includes(fieldName)) {
            result[fieldName] = cleanNumber(raw);
        } else {
            result[fieldName] = String(raw).trim();
        }
    }
    return result;
}

function parseProductLines(lines, linesConfig, dateFormats) {
    const { product_block_start, product_block_end, fields } = linesConfig;
    if (!product_block_start || !fields) return [];

    const results = [];
    let searchFrom = 0;

    while (true) {
        const blockStartIdx = findLineIndex(lines, product_block_start, searchFrom);
        if (blockStartIdx < 0) break;

        const blockEndIdx = findLineIndex(lines, product_block_end, blockStartIdx);
        const effectiveEnd = blockEndIdx >= 0 ? blockEndIdx : Math.min(blockStartIdx + 20, lines.length - 1);

        const lineResult = {};
        for (const [fieldName, fieldConfig] of Object.entries(fields)) {
            if (fieldConfig._skip) continue;
            let raw = applyStrategy(lines, fieldConfig, blockStartIdx, effectiveEnd);
            if (raw == null) { lineResult[fieldName] = null; continue; }

            if (['quantity', 'rate_per_kl', 'vat_pct', 'vat_amount',
                 'additional_vat_amount', 'delivery_charge', 'density',
                 'total_line_amount'].includes(fieldName)) {
                lineResult[fieldName] = cleanNumber(raw);
            } else {
                lineResult[fieldName] = String(raw).trim();
            }
        }

        // Only add if we got at least quantity or total
        if (lineResult.quantity || lineResult.total_line_amount) {
            results.push(lineResult);
        }

        searchFrom = effectiveEnd + 1;
        if (searchFrom >= lines.length) break;
    }

    return results;
}

function parseTotalAmount(lines, totalConfig) {
    if (!totalConfig || !totalConfig.keyword) return null;
    const totalLines = lines.length;
    let raw = applyStrategy(lines, totalConfig, 0, totalLines - 1);
    return cleanNumber(raw);
}

async function parseInvoice(pdfBuffer, companyName) {
    const supplierKey = resolveSupplier(companyName);
    if (!supplierKey) {
        throw new Error(`Unknown supplier: "${companyName}". Add to SUPPLIER_MAP in invoice-parser-service.js`);
    }

    const rawText = await extractText(pdfBuffer);
    if (process.env.DEBUG_OCR === '1') console.log('=== RAW OCR TEXT ===\n', rawText, '\n=== END OCR TEXT ===');

    if (!rawText || rawText.trim().length < 50) {
        throw new Error('No readable text found in PDF even after OCR attempt. Check if tesseract-ocr and poppler-utils are installed on the server.');
    }

    // Reject if PDF is from a different oil company than this location
    const detectedSupplier = detectSupplierFromText(rawText);
    if (detectedSupplier && detectedSupplier !== supplierKey) {
        throw new Error(`This PDF is a ${detectedSupplier} invoice but this location uses ${supplierKey}. Please upload the correct invoice.`);
    }

    // Auto-detect CNG variant for BPCL
    let configKey = supplierKey;
    if (supplierKey === 'BPCL' && /COMPRESSED NATURAL GAS|CNG/i.test(rawText)) {
        configKey = 'BPCL_CNG';
    }

    const config = loadConfig(configKey);

    const lines = getLines(rawText);

    const header = parseHeaderFields(lines, config.header || {}, config.dateFormats || []);
    const productLines = config.lines ? parseProductLines(lines, config.lines, config.dateFormats || []) : [];
    const totalAmount = parseTotalAmount(lines, config.total_amount);

    if (totalAmount) header.total_invoice_amount = totalAmount;

    return {
        supplier: supplierKey,
        header,
        lines: productLines,
        rawText
    };
}

// ---------------------------------------------------------------------------
// BPCL Lube Invoice Parser (scanned PDF via OCR)
//
// Scanned PDFs are read column-by-column, so the multi-column table is
// completely shattered. Product names are garbled.
//
// Strategy: extract L29 quantities, packing UOMs, rates, HSN codes as
// ordered lists, then zip them into product records.
// Taxable value is computed as qty_litres × rate (reliable).
// ---------------------------------------------------------------------------

function parseBpclLubeInvoice(rawText) {
    // --- OCR fixes for common BPCL lube misreads ---
    const fixed = rawText
        .replace(/\bERL\b/g, 'BRL')                              // E/B confusion: "ERL" → "BRL"
        .replace(/\b(\d+\.?\d*)\s+129\b/g, '$1 L29')             // "210 129" → "210 L29" (missing L)
        .replace(/\/129\b/g, '/L29')                              // "55.00/129" → "55.00/L29"
        .replace(/\bSS\b/g, '55')                                 // "SS" → "55" (digit 5 read as S)
        .replace(/\b(5[0-9])\s+\.([\d]{2}\/L29)/g, '$1.$2');     // "55 .00/L29" → "55.00/L29"

    const lines = fixed.split('\n').map(l => l.trim());

    // === HEADER ===
    const header = {};

    // Invoice number: standalone 9-11 digit number anywhere in first 25 lines
    // (In scanned OCR the number appears in its own text run before the "INVOICE No." label)
    for (let i = 0; i < Math.min(25, lines.length); i++) {
        const m = lines[i].match(/^(\d{9,11})$/);
        if (m) { header.invoice_number = m[1]; break; }
    }

    // Invoice date: from the digital signature block at the bottom
    // OCR gives e.g. "Thu.\nsep\n25,\n2025 IST" — \s+ spans the newlines
    const dateM = fixed.match(
        /(?:mon|tue|wed|thu|fri|sat|sun)\.?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+(\d{1,2})[,.]?\s+(20\d{2})/i
    );
    if (dateM) {
        const d = moment(`${dateM[1]} ${dateM[2]} ${dateM[3]}`, 'MMM D YYYY');
        header.invoice_date = d.isValid() ? d.format('YYYY-MM-DD') : null;
    }

    // E-way bill: long digit sequence after "Bill No"
    const ewayM = fixed.match(/Bill\s+No\s*[\s:]+(\d{10,})/i);
    header.e_way_bill_no = ewayM ? ewayM[1] : null;

    // Total invoice amount: number on line after TOTAL / OCR variants / "VAUJE RS"
    const totalM = fixed.match(/(?:VAUJE|VALUE)\s*[\s:]+RS?\s*([\d,\s]+\.?\d*)/i) ||
                   fixed.match(/(?:'IVrAL|1VrAL|TOTAL)\s*\n\s*([\d,\s]+\.?\d*)/i);
    if (totalM) {
        const cleaned = totalM[1].replace(/,\s+/g, ',').replace(/\s/g, '');
        header.total_invoice_amount = cleanNumber(cleaned);
    }

    // Delivery doc no: digits after "DOC No" or "roc No" (OCR variant of "DOC")
    const delivM = fixed.match(/(?:roc|DOC)\s*No\s*[\s:]+(\d+)/i);
    header.delivery_doc_no = delivM ? delivM[1] : null;

    // === PRODUCT LINES — sequential (column-by-column) extraction ===
    // Scanned PDFs are read column-by-column. Each field type appears as a
    // group; we extract all instances in order and zip them per product.

    // 1. L29 quantities — most reliable; count defines number of products
    const l29List = [...fixed.matchAll(/([\d,]+\.?\d*)\s+L29\b/gi)]
        .map(m => cleanNumber(m[1]));

    if (l29List.length === 0) return { header, lines: [] };
    const n = l29List.length;

    // 2. Packing quantities + UOM  e.g. "15 BRL", "3 CS"
    const packingList = [...fixed.matchAll(/\b(\d+)\s+(BRL|CS|PKT|TIN|CAN|BTL|KG|LTR)\b/gi)]
        .map(m => ({ qty: parseFloat(m[1]), uom: m[2].toUpperCase() }));

    // 3. Rates  e.g. "55.00/L29"  — after OCR fixes "SS .00/L29" → "55.00/L29"
    const rateList = [...fixed.matchAll(/([\d,]+\.?\d*)\/L29\b/gi)]
        .map(m => cleanNumber(m[1]));

    // 4. HSN codes: 6-8 digit numbers after ":"
    //    Filter: must be >= 270000 to skip non-HSN codes (supply plant codes etc.)
    //    Petroleum/lube HSNs: 2710xx, 2712xx, 3102xx, 3403xx etc.
    const hsnList = [...rawText.matchAll(/:\s*(\d{6,8})\b/g)]
        .map(m => m[1])
        .filter(h => parseInt(h) >= 270000);

    // 5. Batch numbers: 7-digit numbers in parentheses
    const batchList = [...rawText.matchAll(/\((\d{7})\)/g)].map(m => m[1]);

    // 6. Taxable values: comma-formatted amounts (NNN,NNN.NN) that are > 5000
    //    These are reliably OCR'd even in scans; used to fill gaps when rate is null
    const taxableFromText = [...fixed.matchAll(/\b(\d{1,3},\d{3}\.\d{2})\b/g)]
        .map(m => cleanNumber(m[1]))
        .filter(v => v > 5000)
        .sort((a, b) => b - a)           // largest first — taxable values dominate
        .slice(0, n * 2);                // take at most 2× product count

    // Build product records — pair each field list in order
    return {
        header,
        lines: l29List.map((qty_litres, i) => {
            const rate = rateList[i] != null ? rateList[i] : null;
            // Taxable: prefer computed (qty × rate); fall back to largest unassigned amount from text
            let taxable = (qty_litres && rate) ? Math.round(qty_litres * rate * 100) / 100 : null;
            if (taxable == null && taxableFromText[i] != null) taxable = taxableFromText[i];
            // If we have taxable but not rate, back-compute rate
            const effectiveRate = rate != null ? rate : (taxable && qty_litres ? Math.round(taxable / qty_litres * 100) / 100 : null);
            return {
                product_name:  null,   // unreadable from scanned OCR
                invoice_qty:   packingList[i] ? packingList[i].qty : null,
                invoice_uom:   packingList[i] ? packingList[i].uom : null,
                qty_litres,
                rate:          effectiveRate,
                hsn_code:      hsnList[i] || null,
                batch_no:      batchList[i] || null,
                taxable_value: taxable,
                discount_amount: null,
                cgst_pct: null, cgst_amount: null,
                sgst_pct: null, sgst_amount: null
            };
        })
    };
}

module.exports = { parseInvoice, resolveSupplier, parseBpclLubeInvoice, extractText };
