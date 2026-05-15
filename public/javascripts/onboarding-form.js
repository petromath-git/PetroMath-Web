'use strict';

// TOKEN injected by server in the Pug template
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

// ── Build HTML for a new empty row ────────────────────────────────────────────
function buildNewRow(section, id) {
    const del = `<button type="button" class="btn btn-outline-danger btn-sm" onclick="deleteRow('${section}',${id},this)">×</button>`;

    const productOpts = () => '<option value="">-- Select --</option>' +
        getProductOptions().map(p => `<option value="${escHtml(p)}">${escHtml(p)}</option>`).join('');

    const tankOpts = () => '<option value="">-- Select --</option>' +
        getTankOptions().map(t => `<option value="${escHtml(t)}">${escHtml(t)}</option>`).join('');

    const attr = `data-section="${section}" data-row-id="${id}"`;

    const rows = {
        'employees': `<tr ${attr}>
            <td><input class="form-control form-control-sm" type="text" data-field="employee_name" placeholder="Name with Initial"></td>
            <td><select class="form-control form-control-sm" data-field="designation">
                <option value="">-- Select --</option>
                <option>Manager</option><option>Cashier</option><option>Attendant</option>
                <option>DSM</option><option>DSW</option><option>Owner</option>
            </select></td>
            <td class="text-center align-middle">${del}</td></tr>`,

        'metered-products': `<tr ${attr}>
            <td><input class="form-control form-control-sm" type="text" data-field="product_name" placeholder="As per Invoice e.g. EBMS"></td>
            <td><input class="form-control form-control-sm" type="text" data-field="short_name" placeholder="e.g. MS / HSD"></td>
            <td class="text-center align-middle">${del}</td></tr>`,

        'tanks': `<tr ${attr}>
            <td><input class="form-control form-control-sm" type="text" data-field="tank_name" placeholder="Tank Name"></td>
            <td><input class="form-control form-control-sm" type="number" data-field="tank_capacity" placeholder="15000"></td>
            <td><input class="form-control form-control-sm" type="text" data-field="tank_short_name" placeholder="e.g. MS1"></td>
            <td><select class="form-control form-control-sm" data-field="product_short_name">${productOpts()}</select></td>
            <td class="text-center align-middle">${del}</td></tr>`,

        'nozzles': `<tr ${attr}>
            <td><input class="form-control form-control-sm" type="text" data-field="nozzle_name" placeholder="e.g. MS 1.1"></td>
            <td><input class="form-control form-control-sm" type="text" data-field="nozzle_product" placeholder="Short Name"></td>
            <td><input class="form-control form-control-sm" type="text" data-field="du_make" placeholder="Tokheim / Gilbarco"></td>
            <td><select class="form-control form-control-sm" data-field="tank_connected">${tankOpts()}</select></td>
            <td><input class="form-control form-control-sm" type="date" data-field="next_stamping_date"></td>
            <td class="text-center align-middle">${del}</td></tr>`,

        'lubes': `<tr ${attr}>
            <td><input class="form-control form-control-sm" type="text" data-field="product_name" placeholder="e.g. Servo 10W-40 1L"></td>
            <td><select class="form-control form-control-sm" data-field="unit">
                <option value="">-- Select --</option>
                <option>Litres</option><option>Nos</option><option>Kgs</option>
            </select></td>
            <td><input class="form-control form-control-sm" type="number" step="0.01" data-field="selling_price" placeholder="0.00"></td>
            <td class="text-center align-middle">${del}</td></tr>`,

        'banks': `<tr ${attr}>
            <td><input class="form-control form-control-sm" type="text" data-field="bank_name" placeholder="Bank Name"></td>
            <td><input class="form-control form-control-sm" type="text" data-field="short_name" placeholder="Short Name"></td>
            <td><input class="form-control form-control-sm" type="text" data-field="branch" placeholder="Branch"></td>
            <td><input class="form-control form-control-sm" type="text" data-field="account_name" placeholder="Account Name"></td>
            <td><input class="form-control form-control-sm" type="text" data-field="account_last4" placeholder="Last 4" maxlength="4"></td>
            <td><select class="form-control form-control-sm" data-field="account_type">
                <option value="">-- Select --</option>
                <option>Current</option><option>Savings</option><option>Cash Credit</option><option>EDFS</option>
            </select></td>
            <td class="text-center align-middle">${del}</td></tr>`,

        'digital': `<tr ${attr}>
            <td><input class="form-control form-control-sm" type="text" data-field="platform_name" placeholder="e.g. Paytm / PhonePe / XTRAREWARDS"></td>
            <td class="text-center align-middle">${del}</td></tr>`,

        'customers': `<tr ${attr}>
            <td><input class="form-control form-control-sm" type="text" data-field="customer_name" placeholder="Trade Name"></td>
            <td><input class="form-control form-control-sm" type="text" data-field="address" placeholder="Billing Address"></td>
            <td><input class="form-control form-control-sm" type="text" data-field="gstin" placeholder="GSTIN" maxlength="15"></td>
            <td><input class="form-control form-control-sm" type="text" data-field="owner_name" placeholder="Owner Name"></td>
            <td><input class="form-control form-control-sm" type="tel" data-field="owner_mobile" placeholder="10-digit" maxlength="10"></td>
            <td><input class="form-control form-control-sm" type="text" data-field="manager_name" placeholder="Manager Name"></td>
            <td><input class="form-control form-control-sm" type="tel" data-field="manager_mobile" placeholder="10-digit" maxlength="10"></td>
            <td><select class="form-control form-control-sm" data-field="customer_type">
                <option value="">-- Select --</option>
                <option>Credit</option><option>Cash</option>
            </select></td>
            <td class="text-center align-middle">${del}</td></tr>`,

        'suppliers': `<tr ${attr}>
            <td><input class="form-control form-control-sm" type="text" data-field="supplier_name" placeholder="As per Invoice"></td>
            <td><input class="form-control form-control-sm" type="text" data-field="short_name" placeholder="Short Name"></td>
            <td class="text-center align-middle">${del}</td></tr>`,
    };
    return rows[section] || '';
}

// ── Init ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Set initial save indicator
    const el = _indicator();
    if (el) { el.className = 'save-indicator saved'; el.textContent = 'All changes saved ✓'; }

    // Init cross-ref dropdowns from server-rendered rows
    refreshProductDropdowns();
    refreshTankDropdowns();

    // RO tab inputs
    document.getElementById('tab-ro')?.addEventListener('input', scheduleRoSave);

    // All section table inputs (event delegation on the whole page)
    document.getElementById('onboarding-sections')?.addEventListener('input', e => {
        const tr = e.target.closest('tr[data-row-id]');
        if (!tr) return;
        scheduleRowSave(tr.dataset.section, tr.dataset.rowId);
    });

    // Add-row buttons
    document.querySelectorAll('[data-add-section]').forEach(btn => {
        btn.addEventListener('click', () => addRow(btn.dataset.addSection));
    });
});
