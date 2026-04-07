// bowser-intercompany.js
// Handles the Intercompany tab in the SFS shift closing screens (new + edit).
// All bowser-related data for this tab is provided via window.bowserIntercompanyData
// which must be set by the Pug template before this script runs.

(function () {
    'use strict';

    // ── Row management ────────────────────────────────────────────

    function getBowsers() {
        return window.bowserIntercompanyData || [];
    }

    function buildBowserOptions(selectedId) {
        return getBowsers().map(b =>
            `<option value="${b.bowser_id}"
                data-product_id="${b.product_id}"
                data-product_name="${b.product_name}"
                ${String(b.bowser_id) === String(selectedId) ? 'selected' : ''}>
                ${b.bowser_name}
             </option>`
        ).join('');
    }

    window.addIntercompanyRow = function (bowserId, productId, productName, qty) {
        const tbody = document.getElementById('intercompany-tbody');
        if (!tbody) return;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <select class="form-control form-control-sm ic-bowser" onchange="onBowserChange(this)">
                    <option value="">-- Select --</option>
                    ${buildBowserOptions(bowserId || '')}
                </select>
            </td>
            <td>
                <input class="form-control form-control-sm ic-product-name" type="text" readonly
                    value="${productName || ''}" placeholder="auto-filled">
                <input class="ic-product-id" type="hidden" value="${productId || ''}">
            </td>
            <td>
                <input class="form-control form-control-sm ic-qty" type="number"
                    min="0" step="0.001" value="${qty || ''}">
            </td>
            <td>
                <button class="btn btn-sm btn-outline-danger" type="button"
                    onclick="this.closest('tr').remove()">
                    &times;
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    };

    window.onBowserChange = function (sel) {
        const opt         = sel.options[sel.selectedIndex];
        const row         = sel.closest('tr');
        const productName = opt.dataset.product_name || '';
        const productId   = opt.dataset.product_id   || '';
        row.querySelector('.ic-product-name').value = productName;
        row.querySelector('.ic-product-id').value   = productId;
    };

    // ── Save ──────────────────────────────────────────────────────

    window.saveIntercompany = function () {
        const closingId = getClosingId();
        if (!closingId) {
            alert('Please save the Closing tab first before saving intercompany entries.');
            return Promise.resolve(false);
        }

        const closingDate = getClosingDate();
        const rows        = document.querySelectorAll('#intercompany-tbody tr');
        const entries     = [];

        rows.forEach(row => {
            const bowserId  = row.querySelector('.ic-bowser')?.value;
            const productId = row.querySelector('.ic-product-id')?.value;
            const qty       = parseFloat(row.querySelector('.ic-qty')?.value) || 0;
            if (bowserId && productId && qty > 0) {
                entries.push({ bowser_id: bowserId, product_id: productId, quantity: qty });
            }
        });

        return fetch('/bowser/api/intercompany', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ closing_id: closingId, closing_date: closingDate, entries })
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                showToastIfAvailable(data.message || 'Intercompany entries saved.');
                return true;
            } else {
                alert(data.error || 'Error saving intercompany entries.');
                return false;
            }
        })
        .catch(() => {
            alert('Network error saving intercompany entries.');
            return false;
        });
    };

    window.saveAndNextIntercompany = function () {
        ajaxLoading('d-md-block');
        window.saveIntercompany().then(success => {
            ajaxLoading('d-md-none');
            if (success) {
                trackMenuWithName('summary_tab');
            }
        });
    };

    // ── Summary section population ────────────────────────────────

    window.populateIntercompanySummary = function () {
        const tbody = document.getElementById('summary-intercompany-tbody');
        const totalEl = document.getElementById('val-intercompany-total');
        if (!tbody || !totalEl) return;

        const rows = document.querySelectorAll('#intercompany-tbody tr');
        let totalQty = 0;
        const summaryRows = [];

        rows.forEach(row => {
            const bowserSel  = row.querySelector('.ic-bowser');
            const productEl  = row.querySelector('.ic-product-name');
            const qtyEl      = row.querySelector('.ic-qty');
            if (!bowserSel || !qtyEl) return;

            const qty = parseFloat(qtyEl.value) || 0;
            if (qty <= 0) return;

            const bowserName  = bowserSel.options[bowserSel.selectedIndex]?.text || '—';
            const productName = productEl ? (productEl.value || '—') : '—';
            totalQty += qty;
            summaryRows.push(`<tr><td>${bowserName}</td><td>${productName}</td><td>${qty.toFixed(3)}</td></tr>`);
        });

        tbody.innerHTML = summaryRows.join('');
        totalEl.textContent = totalQty.toFixed(3);
    };

    // ── Load existing entries (edit screen) ───────────────────────

    window.loadIntercompanyEntries = function (entries) {
        if (!entries || entries.length === 0) return;
        entries.forEach(e => {
            window.addIntercompanyRow(e.bowser_id, e.product_id, e.product_name, e.quantity);
        });
    };

    // ── Helpers ───────────────────────────────────────────────────

    function getClosingId() {
        const el = document.getElementById('closing_hiddenId');
        return el && parseInt(el.value) > 0 ? el.value : null;
    }

    function getClosingDate() {
        const el = document.getElementById('cashierDate');
        return el ? el.value : '';
    }

    function showToastIfAvailable(msg) {
        if (typeof showToastMessage === 'function') {
            showToastMessage({ message: msg });
        } else {
            alert(msg);
        }
    }

})();
