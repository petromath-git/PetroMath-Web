// Credit sales tab: Add/Edit via a shared modal instead of cramped inline table editing.
//
// The credit table (see +addCredits in new-closing-mixins.pug) renders two rows per
// line: a compact, read-only summary row that's always visible, and a hidden detail
// row holding the real, submitted form fields (same ids/names as before, unchanged).
// Opening a row for add/edit moves its actual field elements into the shared
// #creditEntryModal; closing the modal moves them back. Nothing about how the fields
// are collected/saved (saveCreditSales, calculateTotal, hideRow, etc.) changes.

var creditModalState = { rowNo: null, isNew: false, savedThisSession: false, deleteRequested: false, moved: {} };

var CREDIT_MODAL_SIMPLE_FIELDS = ['bill-date', 'product', 'billno', 'creditparty', 'odometer', 'price', 'discount', 'qty', 'amt', 'notes'];

function creditFieldEl(rowNo, field) {
    return document.getElementById('credit-' + field + '-' + rowNo);
}

function moveCreditFieldToSlot(rowNo, field, slotId) {
    var el = creditFieldEl(rowNo, field);
    var slot = document.getElementById(slotId);
    if (el && slot) {
        creditModalState.moved[field] = { el: el, parent: el.parentNode, next: el.nextSibling };
        slot.appendChild(el);
    }
}

function moveCreditVehicleWrapToSlot(rowNo) {
    var wrap = document.getElementById('credit-vehicle-wrap-' + rowNo);
    var slot = document.getElementById('creditModalSlot-vehiclewrap');
    if (wrap && slot) {
        creditModalState.moved.vehiclewrap = { el: wrap, parent: wrap.parentNode, next: wrap.nextSibling };
        slot.appendChild(wrap);
    }
}

function moveCreditOffMeterToSlot(rowNo) {
    var el = document.getElementById('credit-off-meter-' + rowNo);
    var slot = document.getElementById('creditModalSlot-off-meter');
    if (el && slot) {
        creditModalState.moved['off-meter'] = { el: el, parent: el.parentNode, next: el.nextSibling };
        slot.appendChild(el);
    }
}

function restoreCreditModalFields() {
    Object.keys(creditModalState.moved).forEach(function (field) {
        var info = creditModalState.moved[field];
        if (!info) return;
        if (info.next && info.next.parentNode === info.parent) {
            info.parent.insertBefore(info.el, info.next);
        } else {
            info.parent.appendChild(info.el);
        }
    });
    creditModalState.moved = {};
}

// Vehicle select2 is initialized lazily here (rather than eagerly on page load) because
// the detail row stays off-screen (display:none) until it's opened in this modal, and
// select2 mis-measures its width when initialized on a hidden element.
function initVehicleSelect2ForModal(rowNo) {
    var select = document.getElementById('credit-vehicle-' + rowNo);
    if (!select || typeof $ === 'undefined') return;
    var $select = $(select);
    if ($select.hasClass('select2-hidden-accessible')) {
        $select.select2('destroy');
    }
    $select.select2({
        placeholder: 'Search vehicle number...',
        allowClear: true,
        width: '100%',
        minimumInputLength: 0,
        theme: 'default',
        dropdownParent: $('#creditEntryModal')
    });
}

// Same lazy-init reasoning as the vehicle dropdown above, applied to the credit
// party dropdown so Company is also type-to-search rather than a long scrolling list.
function initCreditPartySelect2ForModal(rowNo) {
    var select = document.getElementById('credit-creditparty-' + rowNo);
    if (!select || typeof $ === 'undefined') return;
    var $select = $(select);
    if ($select.hasClass('select2-hidden-accessible')) {
        $select.select2('destroy');
    }
    $select.select2({
        placeholder: 'Search company...',
        allowClear: true,
        width: '100%',
        minimumInputLength: 0,
        theme: 'default',
        dropdownParent: $('#creditEntryModal')
    });
}

function findNextAvailableCreditRow() {
    var table = document.getElementById('credit-table');
    if (!table) return null;
    var rowsCnt = table.rows.length;
    for (var i = 0; i < rowsCnt; i++) {
        var tr = document.getElementById('credit-table-row-' + i);
        if (tr && tr.className === 'd-md-none') return i;
    }
    return null;
}

// "Add credits" button: reuses the existing showAddedCreditRow() to find/enable the
// next free row and keep its side effects (default product price, total, etc.), then
// immediately opens that row in the modal.
function handleAddCreditRowClick() {
    var rowNo = findNextAvailableCreditRow();
    showAddedCreditRow();
    if (rowNo === null) return; // showAddedCreditRow already alerted "max reached"
    openCreditRowModal(rowNo, true);
}

function openCreditRowModal(rowNo, isNew) {
    creditModalState.rowNo = rowNo;
    creditModalState.isNew = !!isNew;
    creditModalState.savedThisSession = false;
    creditModalState.deleteRequested = false;

    var titleEl = document.getElementById('creditEntryModalTitleText');
    if (titleEl) titleEl.textContent = isNew ? 'Add Credit Sale' : 'Edit Credit Sale';
    var deleteBtn = document.getElementById('creditModalDeleteBtn');
    if (deleteBtn) deleteBtn.style.display = isNew ? 'none' : '';

    $('#creditEntryModal').modal('show');

    CREDIT_MODAL_SIMPLE_FIELDS.forEach(function (field) {
        moveCreditFieldToSlot(rowNo, field, 'creditModalSlot-' + field);
    });
    moveCreditVehicleWrapToSlot(rowNo);
    moveCreditOffMeterToSlot(rowNo);
    initVehicleSelect2ForModal(rowNo);
    initCreditPartySelect2ForModal(rowNo);
}

function saveCreditRowModal() {
    var rowNo = creditModalState.rowNo;
    if (rowNo === null || rowNo === undefined) return;

    var amtEl = creditFieldEl(rowNo, 'amt');
    var creditPartyEl = creditFieldEl(rowNo, 'creditparty');
    var amt = amtEl && amtEl.value ? currenciesAsFloat(amtEl.value) : 0;

    if (amt > 0 && creditPartyEl && !creditPartyEl.value) {
        alert('Please select a Company before saving this credit sale.');
        return;
    }

    if (creditModalState.isNew && amt <= 0) {
        // Nothing meaningful entered - closing without data discards the row.
        $('#creditEntryModal').modal('hide');
        return;
    }

    creditModalState.savedThisSession = true;
    var detailTr = document.getElementById('credit-table-row-' + rowNo);
    if (detailTr) detailTr.className = '';
    $('#creditEntryModal').modal('hide');
}

function deleteCreditRowModal() {
    var rowNo = creditModalState.rowNo;
    if (rowNo === null || rowNo === undefined) return;
    if (!confirm('Delete this credit sale entry?')) return;
    creditModalState.deleteRequested = true;
    $('#creditEntryModal').modal('hide');
}

// Delete button on the compact summary row (row isn't open in the modal).
function deleteCreditRow(rowNo) {
    if (!confirm('Delete this credit sale entry?')) return;
    performCreditRowDelete(rowNo);
}

function performCreditRowDelete(rowNo) {
    hideRow('credit-table-row-' + rowNo, 'remove-credit-sale', function () {
        calculateCreditTotal();
        refreshCreditSummaryRow(rowNo);
    });
}

$(document).on('hidden.bs.modal', '#creditEntryModal', function () {
    var rowNo = creditModalState.rowNo;
    if (rowNo === null || rowNo === undefined) return;

    restoreCreditModalFields();

    if (creditModalState.deleteRequested) {
        performCreditRowDelete(rowNo);
    } else if (creditModalState.isNew && !creditModalState.savedThisSession) {
        // Closed (X / Close / Esc) without saving a newly added row - discard it.
        performCreditRowDelete(rowNo);
    } else {
        refreshCreditSummaryRow(rowNo);
        calculateCreditTotal();
    }

    creditModalState.rowNo = null;
    creditModalState.isNew = false;
    creditModalState.savedThisSession = false;
    creditModalState.deleteRequested = false;
});

function refreshCreditSummaryRow(rowNo) {
    var detailTr = document.getElementById('credit-table-row-' + rowNo);
    var summaryTr = document.getElementById('credit-summary-row-' + rowNo);
    if (!detailTr || !summaryTr) return;

    var isUsed = detailTr.className !== 'd-md-none';
    summaryTr.classList.toggle('d-md-none', !isUsed);

    if (!isUsed) {
        ['date', 'product', 'billno', 'company', 'vehicle', 'amt'].forEach(function (field) {
            setCreditSummaryText('credit-summary-' + field + '-' + rowNo, '');
        });
        return;
    }

    var dateEl = creditFieldEl(rowNo, 'bill-date');
    setCreditSummaryText('credit-summary-date-' + rowNo, dateEl ? dateEl.value : '');
    setCreditSummaryText('credit-summary-product-' + rowNo, selectedCreditOptionText(creditFieldEl(rowNo, 'product')));
    var billNoEl = creditFieldEl(rowNo, 'billno');
    setCreditSummaryText('credit-summary-billno-' + rowNo, billNoEl ? billNoEl.value : '');
    setCreditSummaryText('credit-summary-company-' + rowNo, selectedCreditOptionText(creditFieldEl(rowNo, 'creditparty')));
    setCreditSummaryText('credit-summary-vehicle-' + rowNo, selectedCreditOptionText(document.getElementById('credit-vehicle-' + rowNo)));
    var amtEl = creditFieldEl(rowNo, 'amt');
    var amtVal = amtEl && amtEl.value ? currenciesAsFloat(amtEl.value) : 0;
    setCreditSummaryText('credit-summary-amt-' + rowNo, formatCurrencies(amtVal || 0, toFixedValue));
}

function setCreditSummaryText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text || '';
}

function selectedCreditOptionText(select) {
    if (!select || select.selectedIndex < 0) return '';
    var opt = select.options[select.selectedIndex];
    return opt ? opt.text : '';
}

function initCreditSummaryRows() {
    var rows = document.querySelectorAll('[id^="credit-table-row-"]');
    rows.forEach(function (tr) {
        var rowNo = tr.id.replace('credit-table-row-', '');
        refreshCreditSummaryRow(rowNo);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCreditSummaryRows);
} else {
    initCreditSummaryRows();
}
