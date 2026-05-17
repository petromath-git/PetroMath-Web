'use strict';

const TOKEN = window.ONBOARD_TOKEN;

// ── Save indicator ─────────────────────────────────────────────────────────────
let _pendingSaves = 0;
const _indicator = () => document.getElementById('save-indicator');

function setSaving() {
    _pendingSaves++;
    const el = _indicator();
    el.className = 'save-indicator saving';
    el.textContent = 'Saving…';
}

function setSaved() {
    _pendingSaves = Math.max(0, _pendingSaves - 1);
    if (_pendingSaves === 0) {
        const el = _indicator();
        el.className = 'save-indicator saved';
        el.textContent = 'All changes saved ✓';
    }
}

function setSaveError() {
    _pendingSaves = Math.max(0, _pendingSaves - 1);
    const el = _indicator();
    el.className = 'save-indicator error';
    el.textContent = 'Save failed – check connection';
}

// ── RO save (debounced) ────────────────────────────────────────────────────────
let _roTimer = null;

function scheduleRoSave() {
    clearTimeout(_roTimer);
    _roTimer = setTimeout(saveRo, 800);
}

async function saveRo() {
    const data = {};
    document.querySelectorAll('#tab-ro [data-field]').forEach(el => {
        data[el.dataset.field] = el.value;
    });
    setSaving();
    try {
        const r = await fetch(`/onboard/${TOKEN}/ro`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!r.ok) throw new Error();
        setSaved();
    } catch {
        setSaveError();
    }
}

// ── Row save (debounced) ───────────────────────────────────────────────────────
const _rowTimers = {};

function scheduleRowSave(section, rowId) {
    const key = `${section}:${rowId}`;
    clearTimeout(_rowTimers[key]);
    _rowTimers[key] = setTimeout(() => saveRow(section, rowId), 800);
}

async function saveRow(section, rowId) {
    const tr = document.querySelector(`tr[data-section="${section}"][data-row-id="${rowId}"]`);
    if (!tr) return;
    const data = {};
    tr.querySelectorAll('[data-field]').forEach(el => { data[el.dataset.field] = el.value; });
    setSaving();
    try {
        const r = await fetch(`/onboard/${TOKEN}/${section}/${rowId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!r.ok) throw new Error();
        setSaved();
        if (section === 'metered-products') refreshProductDropdowns();
        if (section === 'tanks') refreshTankDropdowns();
        if (section === 'banks') refreshBankDatalist();
    } catch {
        setSaveError();
    }
}

// ── Add row ────────────────────────────────────────────────────────────────────
async function addRow(section) {
    try {
        const r = await fetch(`/onboard/${TOKEN}/${section}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        if (!r.ok) throw new Error();
        const { id } = await r.json();
        const tbody = document.getElementById(`tbody-${section}`);
        tbody.insertAdjacentHTML('beforeend', buildNewRow(section, id));
        if (section === 'tanks') refreshProductDropdowns();
        if (section === 'nozzles') refreshTankDropdowns();
        if (section === 'banks') refreshBankDatalist();
    } catch {
        alert('Failed to add row. Please try again.');
    }
}

// ── Delete row ─────────────────────────────────────────────────────────────────
async function deleteRow(section, rowId, btn) {
    if (!confirm('Remove this row?')) return;
    try {
        const r = await fetch(`/onboard/${TOKEN}/${section}/${rowId}`, { method: 'DELETE' });
        if (!r.ok) throw new Error();
        btn.closest('tr').remove();
        if (section === 'metered-products') refreshProductDropdowns();
        if (section === 'tanks') refreshTankDropdowns();
        if (section === 'banks') refreshBankDatalist();
    } catch {
        alert('Failed to delete row. Please try again.');
    }
}

// ── Cross-reference helpers ────────────────────────────────────────────────────
function getProductOptions() {
    const opts = [];
    document.querySelectorAll('#tbody-metered-products tr').forEach(tr => {
        const v = tr.querySelector('[data-field="short_name"]')?.value?.trim();
        if (v) opts.push(v);
    });
    return opts;
}

function getTankOptions() {
    const opts = [];
    document.querySelectorAll('#tbody-tanks tr').forEach(tr => {
        const v = tr.querySelector('[data-field="tank_name"]')?.value?.trim();
        if (v) opts.push(v);
    });
    return opts;
}

function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function refreshProductDropdowns() {
    const products = getProductOptions();
    document.querySelectorAll('#tbody-tanks [data-field="product_short_name"]').forEach(sel => {
        const cur = sel.value;
        sel.innerHTML = '<option value="">-- Select --</option>' +
            products.map(p => `<option value="${escHtml(p)}"${cur === p ? ' selected' : ''}>${escHtml(p)}</option>`).join('');
    });
}

function refreshTankDropdowns() {
    const tanks = getTankOptions();
    document.querySelectorAll('#tbody-nozzles [data-field="tank_connected"]').forEach(sel => {
        const cur = sel.value;
        sel.innerHTML = '<option value="">-- Select --</option>' +
            tanks.map(t => `<option value="${escHtml(t)}"${cur === t ? ' selected' : ''}>${escHtml(t)}</option>`).join('');
    });
}

function refreshBankDatalist() {
    const dl = document.getElementById('bank-datalist');
    if (!dl) return;
    const banks = [];
    document.querySelectorAll('#tbody-banks tr').forEach(tr => {
        const sn = tr.querySelector('[data-field="short_name"]')?.value?.trim();
        const bn = tr.querySelector('[data-field="bank_name"]')?.value?.trim();
        const val = sn || bn;
        if (val) banks.push(val);
    });
    dl.innerHTML = banks.map(b => `<option value="${escHtml(b)}">`).join('');
}

// ── Build HTML for a new empty row ────────────────────────────────────────────
function buildNewRow(section, id) {
    const del = `<button type="button" class="btn btn-outline-danger btn-sm" onclick="deleteRow('${section}',${id},this)">×</button>`;
    const a = `data-section="${section}" data-row-id="${id}"`;

    const productOpts = () => '<option value="">-- Select --</option>' +
        getProductOptions().map(p => `<option value="${escHtml(p)}">${escHtml(p)}</option>`).join('');
    const tankOpts = () => '<option value="">-- Select --</option>' +
        getTankOptions().map(t => `<option value="${escHtml(t)}">${escHtml(t)}</option>`).join('');

    const rows = {
        'employees': `<tr ${a}>
            <td data-label="Name"><input class="form-control form-control-sm" type="text" data-field="employee_name" placeholder="Name with Initial"></td>
            <td data-label="Designation"><select class="form-control form-control-sm" data-field="designation">
                <option value="">-- Select --</option>
                <option>Manager</option><option>Cashier</option><option>Attendant</option>
                <option>DSM</option><option>DSW</option><option>Owner</option>
            </select></td>
            <td class="text-center align-middle">${del}</td></tr>`,

        'metered-products': `<tr ${a}>
            <td data-label="Product Name"><input class="form-control form-control-sm" type="text" data-field="product_name" placeholder="As per Invoice e.g. EBMS"></td>
            <td data-label="Short Name"><input class="form-control form-control-sm" type="text" data-field="short_name" placeholder="e.g. MS / HSD"></td>
            <td data-label="HSN Code"><input class="form-control form-control-sm" type="text" data-field="hsn_code" placeholder="e.g. 27101290" maxlength="20"></td>
            <td data-label="CGST %"><input class="form-control form-control-sm" type="number" step="0.01" min="0" max="50" data-field="cgst_percent" placeholder="e.g. 9"></td>
            <td data-label="SGST %"><input class="form-control form-control-sm" type="number" step="0.01" min="0" max="50" data-field="sgst_percent" placeholder="e.g. 9"></td>
            <td class="text-center align-middle">${del}</td></tr>`,

        'tanks': `<tr ${a}>
            <td data-label="Tank Name"><input class="form-control form-control-sm" type="text" data-field="tank_name" data-no-space="true" placeholder="No spaces e.g. TANK1"></td>
            <td data-label="Capacity (L)"><input class="form-control form-control-sm" type="number" data-field="tank_capacity" placeholder="15000"></td>
            <td data-label="Short Name"><input class="form-control form-control-sm" type="text" data-field="tank_short_name" placeholder="e.g. MS1"></td>
            <td data-label="Product"><select class="form-control form-control-sm" data-field="product_short_name">${productOpts()}</select></td>
            <td class="text-center align-middle">${del}</td></tr>`,

        'nozzles': `<tr ${a}>
            <td data-label="Nozzle Name"><input class="form-control form-control-sm" type="text" data-field="nozzle_name" data-no-space="true" placeholder="No spaces e.g. MS1.1"></td>
            <td data-label="Product"><input class="form-control form-control-sm" type="text" data-field="nozzle_product" placeholder="Short Name"></td>
            <td data-label="DU Make"><input class="form-control form-control-sm" type="text" data-field="du_make" placeholder="Tokheim / Gilbarco"></td>
            <td data-label="Tank"><select class="form-control form-control-sm" data-field="tank_connected">${tankOpts()}</select></td>
            <td data-label="Stamping Date"><input class="form-control form-control-sm" type="date" data-field="next_stamping_date"></td>
            <td class="text-center align-middle">${del}</td></tr>`,

        'lubes': `<tr ${a}>
            <td data-label="Product Name"><input class="form-control form-control-sm" type="text" data-field="product_name" placeholder="e.g. Servo 10W-40 1L"></td>
            <td data-label="Unit"><select class="form-control form-control-sm" data-field="unit">
                <option value="">-- Select --</option>
                <option>Litres</option><option>Nos</option><option>Kgs</option>
            </select></td>
            <td data-label="Price (₹)"><input class="form-control form-control-sm" type="number" step="0.01" data-field="selling_price" placeholder="0.00"></td>
            <td data-label="HSN Code"><input class="form-control form-control-sm" type="text" data-field="hsn_code" placeholder="e.g. 27101290" maxlength="20"></td>
            <td data-label="CGST %"><input class="form-control form-control-sm" type="number" step="0.01" min="0" max="50" data-field="cgst_percent" placeholder="e.g. 9"></td>
            <td data-label="SGST %"><input class="form-control form-control-sm" type="number" step="0.01" min="0" max="50" data-field="sgst_percent" placeholder="e.g. 9"></td>
            <td class="text-center align-middle">${del}</td></tr>`,

        'banks': `<tr ${a}>
            <td data-label="Bank Name"><input class="form-control form-control-sm" type="text" data-field="bank_name" placeholder="Bank Name"></td>
            <td data-label="Short Name"><input class="form-control form-control-sm" type="text" data-field="short_name" placeholder="Short Name"></td>
            <td data-label="Branch"><input class="form-control form-control-sm" type="text" data-field="branch" placeholder="Branch"></td>
            <td data-label="Account Name"><input class="form-control form-control-sm" type="text" data-field="account_name" placeholder="Account Name"></td>
            <td data-label="Last 4 Digits"><input class="form-control form-control-sm" type="text" data-field="account_last4" placeholder="Last 4" maxlength="4"></td>
            <td data-label="Account Number"><input class="form-control form-control-sm" type="text" data-field="account_number" placeholder="Full account number"></td>
            <td data-label="IFSC Code"><input class="form-control form-control-sm" type="text" data-field="ifsc_code" placeholder="e.g. SBIN0001234" maxlength="15"></td>
            <td data-label="Account Type"><select class="form-control form-control-sm" data-field="account_type">
                <option value="">-- Select --</option>
                <option>Current</option><option>Savings</option><option>Cash Credit</option><option>EDFS</option>
            </select></td>
            <td class="text-center align-middle">${del}</td></tr>`,

        'digital': `<tr ${a}>
            <td data-label="Platform"><input class="form-control form-control-sm" type="text" data-field="platform_name" placeholder="e.g. Paytm / PhonePe / XTRAREWARDS"></td>
            <td class="text-center align-middle">${del}</td></tr>`,

        'customers': `<tr ${a}>
            <td data-label="Customer Name"><input class="form-control form-control-sm" type="text" data-field="customer_name" placeholder="Trade Name"></td>
            <td data-label="Address"><input class="form-control form-control-sm" type="text" data-field="address" placeholder="Billing Address"></td>
            <td data-label="GSTIN"><input class="form-control form-control-sm" type="text" data-field="gstin" placeholder="GSTIN" maxlength="15"></td>
            <td data-label="Remittance Bank"><input class="form-control form-control-sm" type="text" list="bank-datalist" data-field="remittance_bank" placeholder="Bank short name"></td>
            <td data-label="Type"><select class="form-control form-control-sm" data-field="customer_type">
                <option value="">-- Select --</option>
                <option>Credit</option><option>Cash</option>
            </select></td>
            <td class="text-center align-middle">${del}</td></tr>`,

        'suppliers': `<tr ${a}>
            <td data-label="Supplier Name"><input class="form-control form-control-sm" type="text" data-field="supplier_name" placeholder="As per Invoice"></td>
            <td data-label="Short Name"><input class="form-control form-control-sm" type="text" data-field="short_name" placeholder="Short Name"></td>
            <td class="text-center align-middle">${del}</td></tr>`,
    };
    return rows[section] || '';
}

// ── CAPS enforcement ──────────────────────────────────────────────────────────
function enforceUppercase(el) {
    if (!el || el.tagName !== 'INPUT') return;
    const t = (el.type || '').toLowerCase();
    if (t === 'url' || t === 'date' || t === 'number' || t === 'email' || t === 'tel') return;
    let val = el.value.toUpperCase();
    if (el.dataset.noSpace) val = val.replace(/\s+/g, '');
    if (el.value !== val) {
        const start = el.selectionStart;
        const end   = el.selectionEnd;
        el.value = val;
        try { el.setSelectionRange(start, end); } catch (_) {}
    }
}

// ── Init ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const el = _indicator();
    if (el) { el.className = 'save-indicator saved'; el.textContent = 'All changes saved ✓'; }

    refreshProductDropdowns();
    refreshTankDropdowns();
    refreshBankDatalist();

    // CAPS: run before save listeners so saved value is already uppercased
    ['tab-ro', 'onboarding-sections'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', e => enforceUppercase(e.target), true);
    });

    document.getElementById('tab-ro')?.addEventListener('input', scheduleRoSave);

    document.getElementById('onboarding-sections')?.addEventListener('input', e => {
        const tr = e.target.closest('tr[data-row-id]');
        if (!tr) return;
        scheduleRowSave(tr.dataset.section, tr.dataset.rowId);
    });

    document.querySelectorAll('[data-add-section]').forEach(btn => {
        btn.addEventListener('click', () => addRow(btn.dataset.addSection));
    });
});
