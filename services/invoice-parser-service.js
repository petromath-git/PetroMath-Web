const _pdfParseModule = require('pdf-parse');
const pdfParse = typeof _pdfParseModule === 'function' ? _pdfParseModule : _pdfParseModule.default;
const path = require('path');
const fs = require('fs');
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

function loadConfig(supplierKey) {
    const configPath = path.join(__dirname, '..', 'config', 'invoice-parsers', `${supplierKey}.json`);
    if (!fs.existsSync(configPath)) {
        throw new Error(`No invoice parser config found for supplier: ${supplierKey}`);
    }
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

async function extractText(pdfBuffer) {
    const data = await pdfParse(pdfBuffer);
    return data.text || '';
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
        const idx = findLineIndex(lines, keyword, blockStart);
        if (idx < 0 || idx > blockEnd) return null;
        const line = lines[idx];
        const kwPos = line.toLowerCase().indexOf(keyword.toLowerCase());
        const after = line.slice(kwPos + keyword.length).trim().replace(/^[:\s]+/, '');
        if (pattern) {
            const m = after.match(new RegExp(pattern));
            return m ? m[0].trim() : null;
        }
        return after.split(/\s+/)[0] || null;
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

    const config = loadConfig(supplierKey);
    const rawText = await extractText(pdfBuffer);

    if (!rawText || rawText.trim().length < 50) {
        throw new Error('No readable text found in PDF. File may be a scanned image or password-protected.');
    }

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

module.exports = { parseInvoice, resolveSupplier };
