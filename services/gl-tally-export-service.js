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

// Sort groups so parents always appear before children in the XML.
function topologicalSort(groupIds, allGroupMap) {
    const result  = [];
    const visited = new Set();

    function visit(id) {
        if (!id || visited.has(id)) return;
        const g = allGroupMap.get(id);
        if (!g) return;
        if (g.parent_group_id) visit(g.parent_group_id);
        visited.add(id);
        result.push(g);
    }

    for (const id of groupIds) visit(id);
    return result;
}

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

    if (!rows.length) return { xml: null, voucherCount: 0, ledgerCount: 0, groupCount: 0 };

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

    // 4. Walk group tree upward — collect all ancestor groups too
    const allGroupRows = await db.sequelize.query(`
        SELECT group_id, group_name, tally_group_name, parent_group_id
        FROM gl_ledger_groups
        WHERE location_code = :locationCode
    `, { replacements: { locationCode }, type: db.Sequelize.QueryTypes.SELECT });

    const allGroupMap = new Map(allGroupRows.map(g => [g.group_id, g]));

    const neededGroupIds = new Set();
    function collectAncestors(id) {
        if (!id || neededGroupIds.has(id)) return;
        neededGroupIds.add(id);
        const g = allGroupMap.get(id);
        if (g && g.parent_group_id) collectAncestors(g.parent_group_id);
    }
    ledgerRows.forEach(l => collectAncestors(l.group_id));

    const sortedGroups = topologicalSort([...neededGroupIds], allGroupMap);

    // 5. Build voucher map
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
    const out = [];
    out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    out.push(`<ENVELOPE>`);
    out.push(`  <HEADER>`);
    out.push(`    <TALLYREQUEST>Import Data</TALLYREQUEST>`);
    out.push(`  </HEADER>`);
    out.push(`  <BODY>`);
    out.push(`    <IMPORTDATA>`);
    out.push(`      <REQUESTDESC>`);
    out.push(`        <REPORTNAME>Vouchers</REPORTNAME>`);
    out.push(`      </REQUESTDESC>`);
    out.push(`      <REQUESTDATA>`);

    // Groups — parents before children, ACTION=CREATE is idempotent in Tally
    for (const g of sortedGroups) {
        const name   = xmlEscape(g.tally_group_name || g.group_name);
        const parent = g.parent_group_id
            ? xmlEscape((allGroupMap.get(g.parent_group_id) || {}).tally_group_name || (allGroupMap.get(g.parent_group_id) || {}).group_name || '')
            : '';
        out.push(`        <TALLYMESSAGE xmlns:UDF="TallyUDF">`);
        out.push(`          <GROUP ACTION="CREATE">`);
        out.push(`            <NAME>${name}</NAME>`);
        if (parent) out.push(`            <PARENT>${parent}</PARENT>`);
        out.push(`          </GROUP>`);
        out.push(`        </TALLYMESSAGE>`);
    }

    // Ledgers — ACTION=CREATE skipped silently if already exists in Tally
    const emittedLedgerIds = new Set();
    for (const l of ledgerRows) {
        if (emittedLedgerIds.has(l.ledger_id)) continue;
        emittedLedgerIds.add(l.ledger_id);
        out.push(`        <TALLYMESSAGE xmlns:UDF="TallyUDF">`);
        out.push(`          <LEDGER ACTION="CREATE">`);
        out.push(`            <NAME>${xmlEscape(l.tally_ledger_name)}</NAME>`);
        out.push(`            <PARENT>${xmlEscape(l.tally_group_name)}</PARENT>`);
        out.push(`          </LEDGER>`);
        out.push(`        </TALLYMESSAGE>`);
    }

    // Vouchers
    for (const v of vouchers) {
        const tallyType = VOUCHER_TYPE_MAP[v.voucher_type] || 'Journal';
        const isRev     = v.is_reversal === 'Y';
        let narr = xmlEscape(v.narration || '');
        if (isRev) narr = '[REVERSAL] ' + narr;

        out.push(`        <TALLYMESSAGE xmlns:UDF="TallyUDF">`);
        out.push(`          <VOUCHER VCHTYPE="${tallyType}" ACTION="CREATE">`);
        out.push(`            <DATE>${tallyDate(v.voucher_date)}</DATE>`);
        out.push(`            <VOUCHERTYPENAME>${tallyType}</VOUCHERTYPENAME>`);
        out.push(`            <VOUCHERNUMBER>${xmlEscape(v.voucher_no || '')}</VOUCHERNUMBER>`);
        if (narr) out.push(`            <NARRATION>${narr}</NARRATION>`);

        for (const line of v.lines) {
            const isDebit = line.dr_amount > 0;
            // Tally convention: DR → ISDEEMEDPOSITIVE=Yes, AMOUNT=negative
            //                   CR → ISDEEMEDPOSITIVE=No,  AMOUNT=positive
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

    return { xml, fileName, voucherCount: vouchers.length, ledgerCount: emittedLedgerIds.size, groupCount: sortedGroups.length };
}

module.exports = { preview, generateAndExport };
