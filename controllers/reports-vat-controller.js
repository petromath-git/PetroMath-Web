const dateFormat = require('dateformat');
const moment = require('moment');
const VatDao = require('../dao/report-vat-dao');
const locationdao = require('../dao/report-dao');
const personDao = require('../dao/person-dao');
const ExcelJS = require('exceljs');

function toTitleCase(ct) {
    return ct.replace(/_/g, ' ').replace(/\w+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

function flattenRows(vatRows, chargeTypes) {
    return vatRows.map((row, idx) => {
        const charges = typeof row.charges_json === 'string'
            ? JSON.parse(row.charges_json)
            : (row.charges_json || {});
        const flat = { 'Sl No': idx + 1, ...row };
        delete flat.charges_json;
        chargeTypes.forEach(ct => {
            flat[ct] = parseFloat(charges[ct] || 0);
        });
        return flat;
    });
}

function computeTotals(rows, chargeTypes) {
    const totals = { total_value: 0 };
    chargeTypes.forEach(ct => { totals[ct] = 0; });
    rows.forEach(row => {
        totals.total_value += parseFloat(row['Value'] || 0);
        chargeTypes.forEach(ct => { totals[ct] += row[ct] || 0; });
    });
    return totals;
}

module.exports = {

    getVatReport: async (req, res, next) => {
        try {
            let locationCode = req.body.locationCode || req.user.location_code;
            const locationDetails = await locationdao.getLocationDetails(locationCode);

            const today = new Date();
            const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            let fromDate = dateFormat(firstDayOfMonth, 'yyyy-mm-dd');
            let toDate = dateFormat(today, 'yyyy-mm-dd');
            let caller = req.body.caller;

            if (req.body.fromClosingDate) fromDate = req.body.fromClosingDate;
            if (req.body.toClosingDate) toDate = req.body.toClosingDate;

            const personId = req.user.Person_id;
            const personLocationPromise = await personDao.findUserLocations(personId);
            const personLocations = personLocationPromise.map(l => ({ LocationCodes: l.location_code }));

            const [chargeTypes, vatRowsRaw] = await Promise.all([
                VatDao.getChargeTypes(locationCode, fromDate, toDate),
                VatDao.getVatDetail(locationCode, fromDate, toDate)
            ]);

            const vatRows = flattenRows(vatRowsRaw, chargeTypes);
            const vatTotals = computeTotals(vatRows, chargeTypes);

            const renderData = {
                title: 'VAT Report',
                user: req.user,
                fromClosingDate: fromDate,
                toClosingDate: toDate,
                personLocations,
                locationName: locationDetails.location_name,
                locationCode,
                formattedFromDate: moment(fromDate).format('DD/MM/YYYY'),
                formattedToDate: moment(toDate).format('DD/MM/YYYY'),
                chargeTypes,
                vatRows,
                vatTotals
            };

            if (caller === 'notpdf') {
                res.render('reports-vat', renderData);
            } else {
                return new Promise((resolve, reject) => {
                    res.render('reports-vat', renderData, (err, html) => {
                        if (err) { reject(err); } else { resolve(html); }
                    });
                });
            }
        } catch (error) {
            console.error('Error generating VAT report:', error);
            res.status(500).send('An error occurred while generating the VAT report.');
        }
    },

    exportVatExcel: async (req, res, next) => {
        try {
            let locationCode = req.body.locationCode || req.user.location_code;
            const locationDetails = await locationdao.getLocationDetails(locationCode);

            const fromDate = req.body.fromClosingDate;
            const toDate = req.body.toClosingDate;

            const [chargeTypes, vatRowsRaw] = await Promise.all([
                VatDao.getChargeTypes(locationCode, fromDate, toDate),
                VatDao.getVatDetail(locationCode, fromDate, toDate)
            ]);

            const vatRows = flattenRows(vatRowsRaw, chargeTypes);
            const vatTotals = computeTotals(vatRows, chargeTypes);

            const toNum = v => parseFloat(v || 0);

            const workbook = new ExcelJS.Workbook();
            const sheet = workbook.addWorksheet('VAT Report');

            sheet.getCell('A1').value = 'VAT REPORT - FUEL PURCHASE';
            sheet.getCell('A1').font = { bold: true, size: 14 };
            sheet.getCell('A2').value = locationDetails.location_name;
            sheet.getCell('A3').value = `Period: ${moment(fromDate).format('DD/MM/YYYY')} to ${moment(toDate).format('DD/MM/YYYY')}`;
            let currentRow = 5;

            // Fixed columns: Sl No, Name, TIN No, HSN Code, Invoice No, Invoice Date, Value, Tax Rate
            // Then one column per charge type
            const fixedHeaders = ['Sl No', 'Name', 'TIN No', 'HSN Code', 'Invoice No', 'Invoice Date', 'Value', 'Tax Rate'];
            const headerValues = [...fixedHeaders, ...chargeTypes.map(toTitleCase)];
            const headerRow = sheet.getRow(currentRow);
            headerRow.values = headerValues;
            headerRow.font = { bold: true };
            headerRow.eachCell(cell => {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } };
                cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
                cell.alignment = { horizontal: 'center' };
            });
            currentRow++;

            const numericColIndices = [7, 8, ...chargeTypes.map((_, i) => 9 + i)]; // Value=7, Tax Rate=8, charges start at 9

            vatRows.forEach((row, idx) => {
                const dr = sheet.getRow(currentRow);
                dr.getCell(1).value = idx + 1;
                dr.getCell(2).value = row['Name'];
                dr.getCell(3).value = row['TIN No'];
                dr.getCell(4).value = row['HSN Code'];
                dr.getCell(5).value = row['Invoice No'];
                dr.getCell(6).value = row['Invoice Date'];
                dr.getCell(7).value = toNum(row['Value']);
                dr.getCell(8).value = toNum(row['Tax Rate']);
                chargeTypes.forEach((ct, i) => {
                    dr.getCell(9 + i).value = toNum(row[ct]);
                });
                numericColIndices.forEach(c => { dr.getCell(c).numFmt = '#,##0.00'; });
                dr.eachCell(cell => {
                    cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
                });
                currentRow++;
            });

            // Total row
            const totalRow = sheet.getRow(currentRow);
            totalRow.getCell(1).value = 'Total';
            totalRow.getCell(7).value = toNum(vatTotals.total_value);
            chargeTypes.forEach((ct, i) => {
                totalRow.getCell(9 + i).value = toNum(vatTotals[ct]);
            });
            [7, ...chargeTypes.map((_, i) => 9 + i)].forEach(c => { totalRow.getCell(c).numFmt = '#,##0.00'; });
            totalRow.font = { bold: true };
            totalRow.eachCell(cell => {
                cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF99' } };
            });

            // Column widths: fixed + dynamic charge columns at width 15
            sheet.columns = [
                { width: 6 }, { width: 28 }, { width: 14 }, { width: 12 },
                { width: 18 }, { width: 14 }, { width: 15 }, { width: 10 },
                ...chargeTypes.map(() => ({ width: 15 }))
            ];

            const buffer = await workbook.xlsx.writeBuffer();
            const filename = `VatReport_${locationCode}_${moment(fromDate).format('DDMMYYYY')}_${moment(toDate).format('DDMMYYYY')}.xlsx`;
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.send(buffer);

        } catch (error) {
            console.error('Error generating VAT Excel:', error);
            res.status(500).send('An error occurred while generating the VAT Excel file.');
        }
    }

};
