// Excess/Shortage breakdown popup — shows the working behind a shift's
// excess/shortage (CALCULATE_EXSHORTAGE). Used on the shift list (home) and
// the Summary tab of new/edit closing. Call showExShortBreakdown(closingId).

(function () {
    const MODAL_ID = 'exShortBreakdownModal';

    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function money(v) {
        return '₹' + (Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function ensureModal() {
        let modal = document.getElementById(MODAL_ID);
        if (modal) return modal;
        const wrapper = document.createElement('div');
        wrapper.innerHTML =
            '<div class="modal fade" id="' + MODAL_ID + '" tabindex="-1" role="dialog" aria-hidden="true">' +
            '  <div class="modal-dialog modal-lg modal-dialog-scrollable" role="document">' +
            '    <div class="modal-content">' +
            '      <div class="modal-header">' +
            '        <h5 class="modal-title">How the Excess / Shortage is calculated</h5>' +
            '        <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>' +
            '      </div>' +
            '      <div class="modal-body" id="' + MODAL_ID + 'Body"></div>' +
            '      <div class="modal-footer">' +
            '        <button type="button" class="btn btn-outline-secondary" onclick="printExShortBreakdown()">Print</button>' +
            '        <button type="button" class="btn btn-secondary" data-dismiss="modal">Close</button>' +
            '      </div>' +
            '    </div>' +
            '  </div>' +
            '</div>';
        modal = wrapper.firstChild;
        document.body.appendChild(modal);
        return modal;
    }

    function sectionRows(sec, sign) {
        let html =
            '<tr class="table-light"><td colspan="2"><strong>' + sign + ' ' + esc(sec.label) + '</strong></td>' +
            '<td class="text-right"><strong>' + money(sec.total) + '</strong></td></tr>';
        sec.rows.forEach(function (r) {
            html +=
                '<tr><td class="pl-4">' + esc(r.label || '-') + '</td>' +
                '<td class="text-muted small">' + esc(r.detail) + '</td>' +
                '<td class="text-right">' + money(r.amount) + '</td></tr>';
        });
        return html;
    }

    function totalRow(label, amount, cls) {
        return '<tr class="' + (cls || '') + '"><td colspan="2"><strong>' + label + '</strong></td>' +
               '<td class="text-right"><strong>' + money(amount) + '</strong></td></tr>';
    }

    function render(data) {
        const h = data.header, t = data.totals;
        const resultLabel = t.computed > 0 ? 'Excess' : (t.computed < 0 ? 'Shortage' : 'Balanced');
        const resultCls = t.computed < 0 ? 'text-danger' : 'text-success';

        let html =
            '<div class="mb-2">' +
            '<strong>Shift #' + esc(h.closingId) + '</strong> · ' + esc(h.closingDate) +
            ' · Cashier: ' + esc(h.cashierName) + ' · <span class="badge badge-secondary">' + esc(h.status) + '</span>' +
            '</div>' +
            '<p class="small text-muted mb-2">Excess / Shortage = Cash counted − Cash the cashier should have. ' +
            'Cash the cashier should have = sales and collections, less the parts not received as cash.</p>' +
            '<div class="table-responsive"><table class="table table-sm mb-2"><tbody>';

        html += '<tr><th colspan="3" class="border-top-0">A. Sales and collections</th></tr>';
        data.add.forEach(function (sec) { html += sectionRows(sec, '+'); });
        html += totalRow('Total (A)', t.totalAdd, 'table-info');

        html += '<tr><th colspan="3">B. Not received as cash</th></tr>';
        if (data.less.length) {
            data.less.forEach(function (sec) { html += sectionRows(sec, '−'); });
        } else {
            html += '<tr><td colspan="3" class="text-muted small pl-4">None</td></tr>';
        }
        html += totalRow('Total (B)', t.totalLess, 'table-info');

        html += totalRow('C. Cash the cashier should have (A − B)', t.expected, 'table-warning');

        html += '<tr><th colspan="3">D. Cash counted</th></tr>';
        html += sectionRows(data.counted, '');
        html += totalRow('Total (D)', t.counted, 'table-info');

        html += '<tr class="' + resultCls + '" style="font-size:1.1em;"><td colspan="2"><strong>' +
                resultLabel + ' (D − C)</strong></td><td class="text-right"><strong>' +
                (t.computed > 0 ? '+' : '') + money(t.computed) + '</strong></td></tr>';
        html += '</tbody></table></div>';

        if (!t.matchesFunction) {
            html += '<div class="alert alert-warning small mb-1">This breakdown (' + money(t.computed) +
                    ') does not match the system figure (' + money(t.live) + '). Please report this to support.</div>';
        }
        if (t.stored !== null && Math.abs(t.stored - t.live) >= 0.05) {
            html += '<div class="alert alert-info small mb-1">The figure saved when this shift was closed was ' +
                    money(t.stored) + '. Entries for this shift have changed since then, so it is now ' + money(t.live) + '.</div>';
        }
        return html;
    }

    window.showExShortBreakdown = function (closingId) {
        if (!closingId) return;
        const modal = ensureModal();
        const body = document.getElementById(MODAL_ID + 'Body');
        body.innerHTML = '<div class="text-center text-muted py-4">Loading…</div>';
        $(modal).modal('show');

        fetch('/excess-shortage-breakdown?id=' + encodeURIComponent(closingId), { credentials: 'same-origin' })
            .then(function (res) { return res.json(); })
            .then(function (data) {
                body.innerHTML = data.error
                    ? '<div class="alert alert-danger">' + esc(data.error) + '</div>'
                    : render(data);
            })
            .catch(function () {
                body.innerHTML = '<div class="alert alert-danger">Could not load the breakdown.</div>';
            });
    };

    // Prints only the breakdown (not the page behind the modal) from a hidden
    // iframe with its own minimal styles — so it doesn't depend on Bootstrap.
    const PRINT_CSS =
        'body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#000;margin:16px;}' +
        'h3{font-size:16px;margin:0 0 8px;}' +
        'table{width:100%;border-collapse:collapse;margin-bottom:8px;}' +
        'td,th{padding:3px 6px;border-top:1px solid #ccc;text-align:left;vertical-align:top;}' +
        'th{padding-top:10px;}' +
        '.text-right{text-align:right;white-space:nowrap;}' +
        '.pl-4{padding-left:24px;}' +
        '.small{font-size:11px;}' +
        '.text-muted{color:#555;}' +
        '.text-danger{color:#c00;}' +
        '.text-success{color:#060;}' +
        '.table-light td{background:#f3f3f3;}' +
        '.table-info td{background:#e3f2f7;}' +
        '.table-warning td{background:#fff3cd;}' +
        '.badge{border:1px solid #888;border-radius:3px;padding:0 4px;font-size:11px;}' +
        '.alert{border:1px solid #999;padding:6px;margin-top:6px;}' +
        '.mb-2{margin-bottom:8px;}' +
        'tr{page-break-inside:avoid;}' +
        '*{-webkit-print-color-adjust:exact;print-color-adjust:exact;}';

    window.printExShortBreakdown = function () {
        const body = document.getElementById(MODAL_ID + 'Body');
        if (!body) return;
        let frame = document.getElementById(MODAL_ID + 'PrintFrame');
        if (frame) frame.remove();
        frame = document.createElement('iframe');
        frame.id = MODAL_ID + 'PrintFrame';
        frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
        document.body.appendChild(frame);

        const doc = frame.contentWindow.document;
        doc.open();
        doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Excess / Shortage</title>' +
                  '<style>' + PRINT_CSS + '</style></head><body>' +
                  '<h3>How the Excess / Shortage is calculated</h3>' + body.innerHTML +
                  '</body></html>');
        doc.close();
        frame.contentWindow.focus();
        frame.contentWindow.print();
    };
})();
