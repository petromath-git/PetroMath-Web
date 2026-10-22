// Shift closing > Credit Sales > Import bills (CREDIT_BILL_IMPORT).
//
// Check file: uploads the Excel to /credit-bill-import/preview, which reports the
// bills found, names that still need a customer/product, bills already in PetroMath
// (skipped) and anything that rejects the whole file (bad dates, rate mismatch).
// Import: sends the same file again with the chosen matches; the server re-checks
// everything, saves the lines into this draft closing, and the page reloads on the
// Credit Sales tab.

var creditBillImportState = { preview: null };

function cbiEscape(text) {
    return String(text === null || text === undefined ? '' : text)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cbiClosingId() {
    var el = document.getElementById('closing_hiddenId');
    return el && el.value ? el.value : '';
}

function openCreditBillImport() {
    if (!cbiClosingId()) {
        alert('Save the closing first, then import the bills.');
        return;
    }
    creditBillImportState.preview = null;
    document.getElementById('cbi-file').value = '';
    document.getElementById('cbi-result').innerHTML = '';
    document.getElementById('cbi-import-btn').disabled = true;
    $('#creditBillImportModal').modal('show');
}

// Products offered on this closing and the rate the page shows for each
function cbiProductRates() {
    var ids = [], rates = {};
    (window.productValuesData || []).forEach(function (p) {
        ids.push(p.productId);
        var rate = parseFloat(getShiftProductPrice(p.productId));
        if (!isNaN(rate)) rates[p.productId] = rate;
    });
    return { ids: ids, rates: rates };
}

function cbiFormData(extra) {
    var file = document.getElementById('cbi-file').files[0];
    var products = cbiProductRates();
    var fd = new FormData();
    fd.append('file', file);
    fd.append('closing_id', cbiClosingId());
    fd.append('product_ids', JSON.stringify(products.ids));
    fd.append('rates', JSON.stringify(products.rates));
    Object.keys(extra || {}).forEach(function (k) { fd.append(k, JSON.stringify(extra[k])); });
    return fd;
}

function cbiPost(url, fd) {
    return fetch(url, { method: 'POST', body: fd, credentials: 'same-origin' })
        .then(function (res) {
            return res.json().catch(function () { return { error: 'Server error (' + res.status + ')' }; });
        });
}

function checkCreditBillFile() {
    var fileEl = document.getElementById('cbi-file');
    if (!fileEl.files.length) {
        alert('Choose the Excel file first.');
        return;
    }
    var result = document.getElementById('cbi-result');
    var btn = document.getElementById('cbi-check-btn');
    btn.disabled = true;
    document.getElementById('cbi-import-btn').disabled = true;
    result.innerHTML = '<div class="text-muted mt-3">Checking...</div>';

    cbiPost('/credit-bill-import/preview', cbiFormData())
        .then(function (data) {
            btn.disabled = false;
            if (data.error) {
                result.innerHTML = cbiErrorBox(data.error, data.details);
                return;
            }
            creditBillImportState.preview = data;
            cbiRenderPreview(data);
        })
        .catch(function (err) {
            btn.disabled = false;
            result.innerHTML = cbiErrorBox('Could not check the file: ' + err.message);
        });
}

function cbiErrorBox(message, details) {
    var html = '<div class="alert alert-danger mt-3 mb-0"><strong>' + cbiEscape(message) + '</strong>';
    if (details && details.length) {
        html += '<ul class="cbi-list mt-2">' + details.map(function (d) { return '<li>' + cbiEscape(d) + '</li>'; }).join('') + '</ul>';
    }
    return html + '</div>';
}

function cbiListSection(title, cls, items) {
    if (!items.length) return '';
    return '<div class="cbi-section alert ' + cls + ' mb-0"><h6>' + cbiEscape(title) + '</h6><ul class="cbi-list">'
        + items.map(function (i) { return '<li>' + cbiEscape(i) + '</li>'; }).join('') + '</ul></div>';
}

function cbiSelect(kind, row, options, allowNew) {
    var html = '<select class="form-control form-control-sm cbi-choice" data-kind="' + kind + '" data-source="' + cbiEscape(row.source) + '">';
    html += '<option value="">-- choose --</option>';
    if (allowNew) {
        html += '<option value="NEW">+ Create new customer "' + cbiEscape(row.source) + '"</option>';
    }
    var suggested = {};
    if (row.suggestions && row.suggestions.length) {
        html += '<optgroup label="Closest matches">';
        row.suggestions.forEach(function (s) {
            suggested[s.id] = true;
            html += '<option value="' + s.id + '"' + (row.id === s.id ? ' selected' : '') + '>'
                + cbiEscape(s.name) + ' (' + Math.round(s.score * 100) + '%)</option>';
        });
        html += '</optgroup>';
    }
    html += '<optgroup label="All">';
    options.forEach(function (o) {
        if (!suggested[o.id]) html += '<option value="' + o.id + '">' + cbiEscape(o.name) + '</option>';
    });
    return html + '</optgroup></select>';
}

function cbiMappingSection(title, kind, rows, options, allowNew) {
    var toChoose = rows.filter(function (r) { return r.status === 'choose'; });
    var known = rows.filter(function (r) { return r.status !== 'choose'; });
    var html = '<div class="cbi-section"><h6>' + cbiEscape(title) + '</h6>';
    if (toChoose.length) {
        html += '<p class="small text-muted mb-1">Choose once - the choice is remembered for future files.</p>'
            + '<table class="table table-sm table-bordered cbi-map mb-1"><thead class="thead-light"><tr><th>Name in file</th>'
            + (kind === 'party' ? '<th class="text-center">Bills</th>' : '') + '<th>PetroMath</th></tr></thead><tbody>';
        toChoose.forEach(function (r) {
            html += '<tr><td>' + cbiEscape(r.source) + '</td>'
                + (kind === 'party' ? '<td class="text-center">' + r.bills + '</td>' : '')
                + '<td>' + cbiSelect(kind, r, options, allowNew) + '</td></tr>';
        });
        html += '</tbody></table>';
    }
    if (known.length) {
        html += '<details class="small"><summary>' + known.length + ' already matched</summary><ul class="cbi-list">'
            + known.map(function (r) { return '<li>' + cbiEscape(r.source) + ' &rarr; ' + cbiEscape(r.name) + '</li>'; }).join('')
            + '</ul></details>';
    }
    return html + '</div>';
}

function cbiRenderPreview(data) {
    var blocking = [].concat(data.problems, data.dateErrors, data.rateErrors);
    var html = '<div class="cbi-section"><strong>' + data.billCount + '</strong> bills, '
        + '<strong>' + data.lineCount + '</strong> lines, total <strong>'
        + data.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        + '</strong> for this closing.'
        + (data.skippedOtherTypes ? ' ' + data.skippedOtherTypes + ' non-credit bills ignored.' : '') + '</div>';

    if (blocking.length) {
        html += cbiListSection('The file will be rejected - fix these and check again', 'alert-danger', blocking);
    }
    html += cbiListSection(data.duplicates.length + ' bills already in PetroMath - will be skipped', 'alert-warning',
        data.duplicates.map(function (d) { return d.billNo + ' (closing ' + d.closingDate + ')'; }));
    html += cbiMappingSection('Customers', 'party', data.parties, data.partyOptions, true);
    html += cbiMappingSection('Products', 'product', data.products, data.productOptions, false);

    document.getElementById('cbi-result').innerHTML = html;
    document.getElementById('cbi-import-btn').disabled = blocking.length > 0;
}

function cbiCollectChoices() {
    var parties = {}, products = {}, missing = 0;
    document.querySelectorAll('#cbi-result select.cbi-choice').forEach(function (sel) {
        if (!sel.value) missing++;
        (sel.getAttribute('data-kind') === 'party' ? parties : products)[sel.getAttribute('data-source')] = sel.value;
    });
    return { parties: parties, products: products, missing: missing };
}

function importCreditBillFile() {
    var choices = cbiCollectChoices();
    if (choices.missing) {
        alert('Choose a customer or product for every name in the list (' + choices.missing + ' left).');
        return;
    }
    var newCount = Object.keys(choices.parties).filter(function (k) { return choices.parties[k] === 'NEW'; }).length;
    if (!confirm('Import these bills into this closing?' + (newCount ? '\n' + newCount + ' new customer(s) will be created.' : ''))) {
        return;
    }

    var btn = document.getElementById('cbi-import-btn');
    btn.disabled = true;
    btn.textContent = 'Importing...';
    cbiPost('/credit-bill-import/import', cbiFormData({ party_choices: choices.parties, product_choices: choices.products }))
        .then(function (data) {
            btn.textContent = 'Import';
            if (data.error) {
                btn.disabled = false;
                document.getElementById('cbi-result').insertAdjacentHTML('afterbegin', cbiErrorBox(data.error, data.details));
                return;
            }
            var msg = data.imported + ' bills (' + data.lines + ' lines) imported.';
            if (data.skipped.length) msg += '\n' + data.skipped.length + ' already in PetroMath, skipped.';
            if (data.createdParties.length) msg += '\nNew customers: ' + data.createdParties.length + '.';
            if (data.createdVehicles.length) msg += '\nNew vehicles: ' + data.createdVehicles.length + '.';
            alert(msg);
            try { sessionStorage.setItem('openCreditTabAfterImport', '1'); } catch (e) { /* page still reloads */ }
            window.location.href = '/edit-draft-closing?closingId=' + encodeURIComponent(cbiClosingId());
        })
        .catch(function (err) {
            btn.disabled = false;
            btn.textContent = 'Import';
            alert('Import failed: ' + err.message);
        });
}

// After the reload, land on the Credit Sales tab
$(function () {
    var reopen = false;
    try {
        reopen = sessionStorage.getItem('openCreditTabAfterImport') === '1';
        sessionStorage.removeItem('openCreditTabAfterImport');
    } catch (e) { /* storage unavailable */ }
    if (reopen) {
        var tab = document.getElementById('credit_sales_tab');
        if (tab) tab.click();
    }
});
