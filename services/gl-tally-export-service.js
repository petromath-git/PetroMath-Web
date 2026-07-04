'use strict';
const db = require('../db/db-connection');

function xmlEscape(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function tallyDate(d) {
    // YYYY-MM-DD → YYYYMMDD
    return String(d).replace(/-/g, '').substring(0, 8);
}

const VOUCHER_TYPE_MAP = {
    SALES:    'Sales',
    PURCHASE: 'Purchase',
    PAYMENT:  'Payment',
    RECEIPT:  'Receipt',
    JOURNAL:  'Journal',
    CONTRA:   'Contra'
};

// Returns a count of what would be exported — no writes.
async function preview(locationCode, fromDate, toDate, includeExported) {
    const exportedClause = includeExported ? '' : "AND h.is_exported = 'N'";
    const [row] = await db.sequelize.query(`
        SELECT
            COUNT(DISTINCT h.voucher_id) AS voucher_count,
            COUNT(DISTINCT l.ledger_id)  AS ledger_count
        FROM gl_journal_headers h
        JOIN gl_journal_lines l ON l.voucher_id = h.voucher_id
        WHERE h.location_code = :locationCode
          AND h.voucher_date  BETWEEN :fromDate AND :toDate
          ${exportedClause}
    `, { replacements: { locationCode, fromDate, toDate }, type: db.Sequelize.QueryTypes.SELECT });
    return { voucher_count: parseInt(row.voucher_count), ledger_count: parseInt(row.ledger_count) };
}

// Generates Tally XML, marks vouchers as exported, logs gl_export_batches row.
async function generateAndExport(locationCode, fromDate, toDate, includeExported, exportedBy) {
    const exportedClause = includeExported ? '' : "AND h.is_exported = 'N'";

    // 1. All voucher lines in range
    const rows = await db.sequelize.query(`
        SELECT
            h.voucher_id,
            h.voucher_type,
            DATE_FORMAT(h.voucher_date, '%Y-%m-%d') AS voucher_date,
            h.voucher_no,
            h.narration,
            h.is_reversal,
            l.line_no,
            l.ledger_id,
            l.dr_amount,
            l.cr_amount,
            COALESCE(gl.tally_ledger_name, gl.ledger_name) AS tally_ledger_name,
            gl.group_id
        FROM gl_journal_headers h
        JOIN gl_journal_lines l  ON l.voucher_id = h.voucher_id
        JOIN gl_ledgers gl       ON gl.ledger_id  = l.ledger_id
        WHERE h.location_code = :locationCode
          AND h.voucher_date  BETWEEN :fromDate AND :toDate
          ${exportedClause}
        ORDER BY h.voucher_date, h.voucher_id, l.line_no
    `, { replacements: { locationCode, fromDate, toDate }, type: db.Sequelize.QueryTypes.SELECT });

    if (!rows.length) return { xml: null, voucherCount: 0, ledgerCount: 0 };

    // 2. Unique ledger_ids used in these vouchers
    const ledgerIds = [...new Set(rows.map(r => r.ledger_id))];

    // 3. Full ledger + group info for those ledgers
    const ledgerRows = await db.sequelize.query(`
        SELECT
            l.ledger_id,
            COALESCE(l.tally_ledger_name, l.ledger_name) AS tally_ledger_name,
            l.group_id,
            COALESCE(g.tally_group_name, g.group_name)   AS tally_group_name,
            g.parent_group_id
        FROM gl_ledgers l
        JOIN gl_ledger_groups g ON g.group_id = l.group_id
        WHERE l.ledger_id IN (:ledgerIds)
    `, { replacements: { ledgerIds }, type: db.Sequelize.QueryTypes.SELECT });

    // 4. Build voucher map
    const voucherMap = new Map();
    for (const r of rows) {
        if (!voucherMap.has(r.voucher_id)) {
            voucherMap.set(r.voucher_id, {
                voucher_id:   r.voucher_id,
                voucher_type: r.voucher_type,
                voucher_date: r.voucher_date,
                voucher_no:   r.voucher_no,
                narration:    r.narration,
                is_reversal:  r.is_reversal,
                lines:        []
            });
        }
        voucherMap.get(r.voucher_id).lines.push({
            ledger_name: r.tally_ledger_name,
            dr_amount:   parseFloat(r.dr_amount || 0),
            cr_amount:   parseFloat(r.cr_amount || 0)
        });
    }
    const vouchers = [...voucherMap.values()];

    // 6. Generate XML
    // Two-block structure verified working with Tally Prime:
    //   Block 1 (All Masters): ledger upserts — "Altered" for existing, "Created" for new, no errors
    //   Block 2 (Vouchers): vouchers with ACTION="Create"
    const out = [];
    out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    out.push(`<ENVELOPE>`);
    out.push(`  <HEADER>`);
    out.push(`    <TALLYREQUEST>Import Data</TALLYREQUEST>`);
    out.push(`  </HEADER>`);
    out.push(`  <BODY>`);

    // Block 1: Masters — idempotent upsert in All Masters mode
    out.push(`    <IMPORTDATA>`);
    out.push(`      <REQUESTDESC>`);
    out.push(`        <REPORTNAME>All Masters</REPORTNAME>`);
    out.push(`      </REQUESTDESC>`);
    out.push(`      <REQUESTDATA>`);

    const emittedLedgerIds = new Set();
    for (const l of ledgerRows) {
        if (emittedLedgerIds.has(l.ledger_id)) continue;
        emittedLedgerIds.add(l.ledger_id);
        out.push(`        <TALLYMESSAGE xmlns:UDF="TallyUDF">`);
        out.push(`          <LEDGER NAME="${xmlEscape(l.tally_ledger_name)}" RESERVEDNAME="">`);
        out.push(`            <NAME>${xmlEscape(l.tally_ledger_name)}</NAME>`);
        out.push(`            <PARENT>${xmlEscape(l.tally_group_name)}</PARENT>`);
        out.push(`          </LEDGER>`);
        out.push(`        </TALLYMESSAGE>`);
    }

    out.push(`      </REQUESTDATA>`);
    out.push(`    </IMPORTDATA>`);

    // Block 2: Vouchers
    out.push(`    <IMPORTDATA>`);
    out.push(`      <REQUESTDESC>`);
    out.push(`        <REPORTNAME>Vouchers</REPORTNAME>`);
    out.push(`      </REQUESTDESC>`);
    out.push(`      <REQUESTDATA>`);

    for (const v of vouchers) {
        const tallyType = VOUCHER_TYPE_MAP[v.voucher_type] || 'Journal';
        const isRev     = v.is_reversal === 'Y';
        let narr = xmlEscape(v.narration || '');
        if (isRev) narr = '[REVERSAL] ' + narr;

        out.push(`        <TALLYMESSAGE xmlns:UDF="TallyUDF">`);
        out.push(`          <VOUCHER VCHTYPE="${tallyType}" ACTION="Create">`);
        out.push(`            <DATE>${tallyDate(v.voucher_date)}</DATE>`);
        out.push(`            <VOUCHERTYPENAME>${tallyType}</VOUCHERTYPENAME>`);
        out.push(`            <VOUCHERNUMBER>${xmlEscape(v.voucher_no || '')}</VOUCHERNUMBER>`);
        if (narr) out.push(`            <NARRATION>${narr}</NARRATION>`);

        for (const line of v.lines) {
            const isDebit = line.dr_amount > 0;
            const amount  = isDebit ? -(line.dr_amount) : line.cr_amount;
            out.push(`            <ALLLEDGERENTRIES.LIST>`);
            out.push(`              <LEDGERNAME>${xmlEscape(line.ledger_name)}</LEDGERNAME>`);
            out.push(`              <ISDEEMEDPOSITIVE>${isDebit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>`);
            out.push(`              <AMOUNT>${amount.toFixed(2)}</AMOUNT>`);
            out.push(`            </ALLLEDGERENTRIES.LIST>`);
        }

        out.push(`          </VOUCHER>`);
        out.push(`        </TALLYMESSAGE>`);
    }

    out.push(`      </REQUESTDATA>`);
    out.push(`    </IMPORTDATA>`);
    out.push(`  </BODY>`);
    out.push(`</ENVELOPE>`);

    const xml = out.join('\n');

    // 7. Mark all exported vouchers as is_exported='Y'
    const voucherIds = vouchers.map(v => v.voucher_id);
    const chunkSize  = 100;
    for (let i = 0; i < voucherIds.length; i += chunkSize) {
        const chunk        = voucherIds.slice(i, i + chunkSize);
        const placeholders = chunk.map((_, j) => `:vid${i + j}`).join(', ');
        const rpl          = { locationCode };
        chunk.forEach((id, j) => { rpl[`vid${i + j}`] = id; });
        await db.sequelize.query(`
            UPDATE gl_journal_headers
            SET is_exported = 'Y'
            WHERE voucher_id IN (${placeholders}) AND location_code = :locationCode
        `, { replacements: rpl, type: db.Sequelize.QueryTypes.UPDATE });
    }

    // 8. Log export batch
    const fileName = `tally_export_${locationCode}_${fromDate}_${toDate}.xml`;
    await db.sequelize.query(`
        INSERT INTO gl_export_batches (location_code, from_date, to_date, voucher_count, exported_by, file_name)
        VALUES (:locationCode, :fromDate, :toDate, :voucherCount, :exportedBy, :fileName)
    `, {
        replacements: { locationCode, fromDate, toDate, voucherCount: vouchers.length, exportedBy, fileName },
        type: db.Sequelize.QueryTypes.INSERT
    });

    return { xml, fileName, voucherCount: vouchers.length, ledgerCount: emittedLedgerIds.size };
}

module.exports = { preview, generateAndExport };
