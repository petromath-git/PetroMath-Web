/*
 * Purchase invoice screen.
 * The user types what is printed on the invoice; LubeInvoiceCalc
 * (lube-invoice-calc.js, also used by the server on save) derives the rest.
 */
document.addEventListener('DOMContentLoaded', function () {
    const D = window.PI_DATA;
    const Calc = window.LubeInvoiceCalc;
    const closed = D.closed;
    const productById = new Map(D.products.map(p => [String(p.product_id), p]));

    const form = document.getElementById('lubesInvoiceForm');
    const tbody = document.querySelector('#invoice-items-table tbody');
    const supplierSelect = document.getElementById('supplier_id');
    const invoiceDateInput = document.getElementById('invoice_date');
    const cashDiscountInput = document.getElementById('cash_discount');
    const printedTotalInput = document.getElementById('printed_total');
    const totalLineDiscInput = document.getElementById('total_line_discount');
    const saveBtn = document.getElementById('save-btn');
    const closeBtn = document.getElementById('close-btn');
    const errorsBox = document.getElementById('pi-errors');

    let lastResult = null;
    let chosenFormat = null;   // set when the user picks an invoice type in the help panel

    const fmt = v => (Math.round((parseFloat(v) || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function taxType() {
        const r = form.querySelector('input[name="tax_type"]:checked');
        return r ? r.value : 'CGST_SGST';
    }
    function discountMode() {
        const r = form.querySelector('input[name="discount_mode"]:checked');
        return r ? r.value : 'LINE';
    }

    // ── Rows ────────────────────────────────────────────────────────────────
    function productOptions(selectedId) {
        return '<option value="">Select product</option>' + D.products.map(p =>
            `<option value="${p.product_id}"${String(p.product_id) === String(selectedId) ? ' selected' : ''}>${esc(p.product_name)}</option>`
        ).join('');
    }
    function gstOptions(selected) {
        return D.gstRates.map(r => `<option value="${r}"${Number(r) === Number(selected) ? ' selected' : ''}>${r}%</option>`).join('');
    }

    function addRow(line) {
        line = line || {};
        const tr = document.createElement('tr');
        tr.className = 'pi-row';
        // data-label / m-* classes: on phones each line is a card (style.css .m-stack)
        tr.innerHTML = `
            <td class="pi-idx m-hide"></td>
            <td class="m-title">
                <select class="form-control form-control-sm pi-product">${productOptions(line.product_id)}</select>
                <div class="pi-warn pi-row-warn"></div>
            </td>
            <td class="m-wide" data-label="Quantity">
                <div class="pi-qty-wrap">
                    <input class="form-control form-control-sm pi-qty" type="number" step="0.001" min="0" value="${line.entered_qty != null && !isNaN(line.entered_qty) ? line.entered_qty : ''}">
                    <select class="form-control form-control-sm pi-uom"></select>
                </div>
                <div class="pi-pack" style="display:none">
                    <div class="input-group input-group-sm mt-1">
                        <div class="input-group-prepend"><span class="input-group-text">1 piece =</span></div>
                        <input class="form-control pi-packsize" type="number" step="0.001" min="0">
                        <div class="input-group-append"><span class="input-group-text pi-pack-unit">L</span></div>
                    </div>
                </div>
                <div class="pi-calc text-muted"></div>
            </td>
            <td data-label="Amount"><input class="form-control form-control-sm pi-gross" type="number" inputmode="decimal" step="0.01" min="0" value="${line.gross_amount != null ? line.gross_amount : ''}">
                <div class="pi-free" style="display:none">Free stock (no charge)</div></td>
            <td class="pi-col-disc" data-label="Discount"><input class="form-control form-control-sm pi-disc" type="number" inputmode="decimal" step="0.01" min="0" value="${line.discount_amount ? line.discount_amount : ''}">
                <div class="pi-calc text-muted pi-disc-alloc"></div></td>
            <td data-label="GST %"><select class="form-control form-control-sm pi-gst">${gstOptions(line.gst_pct)}</select></td>
            <td class="pi-ro pi-taxable" data-label="Taxable"></td>
            <td class="pi-ro pi-gstamt" data-label="GST"></td>
            <td class="pi-ro font-weight-bold pi-amount" data-label="Total"></td>
            ${closed ? '' : '<td class="m-actions"><button type="button" class="btn btn-sm btn-outline-danger pi-remove" title="Remove"><i class="bi bi-x-lg"></i><span class="d-md-none ml-1">Remove</span></button></td>'}`;
        tbody.appendChild(tr);

        tr._line = line;   // stored values (closed invoices display these as-is)
        tr._mrp = line.mrp || 0;
        tr._notes = line.notes || '';

        const productSel = tr.querySelector('.pi-product');
        const gstSel = tr.querySelector('.pi-gst');

        // Legacy drafts can carry an impossible GST % (e.g. 180) — fall back to the product's
        if (line.product_id && D.gstRates.indexOf(Number(line.gst_pct)) < 0) {
            const p = productById.get(String(line.product_id));
            if (p) gstSel.value = String(p.gst);
            tr._badLegacyGst = line.gst_pct;
        }

        configureUom(tr, line.entered_uom);

        if (closed) {
            tr.querySelectorAll('input, select').forEach(el => { el.disabled = true; });
        } else {
            if (window.jQuery && jQuery.fn.select2) {
                jQuery(productSel).select2({ width: '100%' }).on('select2:select', () => onProductChange(tr));
            } else {
                productSel.addEventListener('change', () => onProductChange(tr));
            }
            tr.querySelectorAll('input, select').forEach(el => el.addEventListener('input', recalc));
            tr.querySelector('.pi-uom').addEventListener('change', () => { updatePackPrompt(tr); recalc(); });
            tr.querySelector('.pi-remove').addEventListener('click', () => {
                if (tbody.querySelectorAll('tr.pi-row').length > 1) { tr.remove(); renumber(); recalc(); }
            });
        }
        renumber();
        return tr;
    }

    function renumber() {
        tbody.querySelectorAll('tr.pi-row').forEach((tr, i) => { tr.querySelector('.pi-idx').textContent = i + 1; });
    }

    function onProductChange(tr) {
        const p = productById.get(tr.querySelector('.pi-product').value);
        if (p) tr.querySelector('.pi-gst').value = String(p.gst);
        tr._badLegacyGst = null;
        configureUom(tr, null);
        recalc();
    }

    // Unit choices for the quantity box, by product:
    //   counted in litres/kg (loose, barrels) → that unit only, no conversion
    //   counted in pieces → Pieces, or Litres/Kg converted using the pack size
    function configureUom(tr, preferred) {
        const p = productById.get(tr.querySelector('.pi-product').value);
        const uomSel = tr.querySelector('.pi-uom');
        let opts;
        if (!p) opts = [['PCS', 'Pieces']];
        else if (p.measure === 'L') opts = [['LTR', 'Litres']];
        else if (p.measure === 'KG') opts = [['KG', 'Kg']];
        else opts = [['PCS', 'Pieces'], p.pack_measure === 'KG' ? ['KG', 'Kg'] : ['LTR', 'Litres']];
        const current = preferred || uomSel.value;
        uomSel.innerHTML = opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
        uomSel.value = opts.some(o => o[0] === current) ? current : opts[0][0];
        uomSel.style.display = opts.length > 1 ? '' : 'none';
        if (opts.length === 1 && p) {
            tr.querySelector('.pi-calc').textContent = p.measure ? `in ${opts[0][1].toLowerCase()}` : '';
        }
        updatePackPrompt(tr);
    }

    // Litres chosen but the product name doesn't say its pack size — ask once
    // (saved on the product, never asked again)
    function updatePackPrompt(tr) {
        const p = productById.get(tr.querySelector('.pi-product').value);
        const uom = tr.querySelector('.pi-uom').value;
        const need = !closed && p && !p.measure && uom !== 'PCS' && !p.pack_size;
        tr.querySelector('.pi-pack').style.display = need ? '' : 'none';
        tr.querySelector('.pi-pack-unit').textContent = uom === 'KG' ? 'kg' : 'L';
    }

    function rowPackSize(tr, p) {
        if (!p) return null;
        if (p.pack_size) return p.pack_size;
        const told = parseFloat(tr.querySelector('.pi-packsize').value);
        return told > 0 ? told : null;
    }

    // Pieces (or product-unit qty) for a row, plus the line to show under the box
    function rowQty(tr) {
        const p = productById.get(tr.querySelector('.pi-product').value);
        const entered = parseFloat(tr.querySelector('.pi-qty').value);
        const uom = tr.querySelector('.pi-uom').value;
        if (!p || !(entered > 0)) return { qty: 0, note: '', warn: '' };
        if (p.measure || uom === 'PCS') return { qty: entered, note: '', warn: '' };
        const size = rowPackSize(tr, p);
        if (!size) return { qty: 0, note: '', warn: `Tell us how many ${uom === 'KG' ? 'kg' : 'litres'} one piece is, or enter pieces.` };
        const r = Calc.toPieces(entered, uom, size);
        const unit = uom === 'KG' ? 'kg' : 'L';
        const sizeLabel = size < 1 ? `${Math.round(size * 1000)} ${uom === 'KG' ? 'g' : 'ml'}` : `${size} ${unit}`;
        return {
            qty: r.qty,
            note: `${entered} ${unit} ÷ ${sizeLabel} = <b>${r.qty} pieces</b>`,
            warn: r.whole ? '' : `${entered} ${unit} is not a whole number of ${sizeLabel} pieces — check the quantity.`
        };
    }

    // ── Calculation & display ───────────────────────────────────────────────
    function recalc() {
        const rows = [...tbody.querySelectorAll('tr.pi-row')];
        const mode = discountMode();
        document.getElementById('pi-disc-total-note') && (document.getElementById('pi-disc-total-note').style.display = mode === 'TOTAL' ? '' : 'none');
        if (totalLineDiscInput) totalLineDiscInput.style.display = mode === 'TOTAL' ? '' : 'none';
        rows.forEach(tr => {
            const d = tr.querySelector('.pi-disc');
            d.style.display = mode === 'TOTAL' ? 'none' : '';
        });

        const qtyInfo = rows.map(rowQty);
        const input = {
            tax_type: taxType(),
            discount_mode: mode,
            total_line_discount: totalLineDiscInput ? totalLineDiscInput.value : 0,
            cash_discount: cashDiscountInput.value,
            printed_total: printedTotalInput.value,
            lines: rows.map((tr, i) => ({
                qty: qtyInfo[i].qty,
                gross: tr.querySelector('.pi-gross').value,
                line_discount: tr.querySelector('.pi-disc').value,
                gst_pct: tr.querySelector('.pi-gst').value
            }))
        };
        const r = Calc.compute(input);
        lastResult = r;

        rows.forEach((tr, i) => {
            const c = r.lines[i];
            const p = productById.get(tr.querySelector('.pi-product').value);
            const info = qtyInfo[i];
            const calcEl = tr.querySelector('.pi-calc');
            if (p && !p.measure) calcEl.innerHTML = info.note;

            tr.querySelector('.pi-taxable').textContent = fmt(c.taxable_value);
            tr.querySelector('.pi-gstamt').textContent = fmt(c.gst_amount);
            tr.querySelector('.pi-amount').textContent = fmt(c.amount);
            const grossEntered = tr.querySelector('.pi-gross').value !== '';
            tr.querySelector('.pi-free').style.display = grossEntered && c.is_free && c.qty > 0 ? '' : 'none';
            tr.querySelector('.pi-disc-alloc').innerHTML =
                (mode === 'TOTAL' && c.discount_amount ? `est. ₹${fmt(c.discount_amount)}` : '') +
                (c.cash_discount_amount ? `${mode === 'TOTAL' && c.discount_amount ? '<br>' : ''}cash disc. ₹${fmt(c.cash_discount_amount)}` : '');

            const warns = [];
            if (info.warn) warns.push(info.warn);
            if (tr._badLegacyGst != null) warns.push(`Old entry had GST ${tr._badLegacyGst}% — changed to the product's ${tr.querySelector('.pi-gst').value}%. Check against the invoice.`);
            if (p) {
                if (Number(tr.querySelector('.pi-gst').value) !== Number(p.gst)) {
                    warns.push(`GST differs from the product master (${p.gst}%). If the invoice is right, update the product's GST in Products so sales bills match.`);
                }
                if (!c.is_free && c.qty > 0) {
                    const unitLabel = p.measure === 'L' ? 'litre' : p.measure === 'KG' ? 'kg' : 'piece';
                    const w = Calc.priceWarning(c.cost_per_unit, p.price, unitLabel);
                    if (w) warns.push(w);
                }
            }
            tr.querySelector('.pi-row-warn').innerHTML = warns.map(w => `<div><i class="bi bi-exclamation-triangle mr-1"></i>${esc(w)}</div>`).join('');
        });

        renderTotals(r);
    }

    function renderTotals(r) {
        const t = r.totals;
        document.getElementById('t-gross').textContent = fmt(t.gross);
        document.getElementById('t-disc').textContent = fmt(t.discount);
        document.getElementById('t-taxable').textContent = fmt(t.taxable);
        document.getElementById('t-gst-label').textContent = r.tax_type === 'IGST' ? 'IGST' : 'GST (CGST + SGST)';
        document.getElementById('t-gst').textContent = fmt(t.gst);
        document.getElementById('t-lines').textContent = fmt(t.lines_total);

        const status = document.getElementById('t-status');
        let canClose = false;
        if (t.printed_total == null) {
            status.className = 'pi-total-status text-muted';
            status.textContent = 'Enter the total printed on the invoice to check your entry.';
        } else if (t.matches) {
            status.className = 'pi-total-status ok';
            status.innerHTML = `<i class="bi bi-check-circle-fill mr-1"></i>Matches the invoice` + (t.round_off ? ` (round-off ₹${fmt(t.round_off)})` : '');
            canClose = r.errors.length === 0;
        } else {
            status.className = 'pi-total-status bad';
            status.innerHTML = `<i class="bi bi-x-circle-fill mr-1"></i>Differs from the invoice by ₹${fmt(Math.abs(t.diff))}. Check quantities, amounts, discounts and GST.`;
        }
        if (closeBtn) closeBtn.disabled = !canClose;
    }

    // Closed invoices: show exactly what was saved, never recompute
    function renderClosed() {
        const rows = [...tbody.querySelectorAll('tr.pi-row')];
        let gross = 0, disc = 0, taxable = 0, gst = 0, amount = 0;
        rows.forEach(tr => {
            const l = tr._line;
            const p = productById.get(String(l.product_id));
            tr.querySelector('.pi-taxable').textContent = l.taxable_value != null ? fmt(l.taxable_value) : '';
            tr.querySelector('.pi-gstamt').textContent = fmt(l.gst_amount);
            tr.querySelector('.pi-amount').textContent = fmt(l.amount);
            if (p && !p.measure && l.entered_uom && l.entered_uom !== 'PCS') {
                tr.querySelector('.pi-calc').innerHTML = `= <b>${l.qty} pieces</b>`;
            }
            if (l.cash_discount_amount) tr.querySelector('.pi-disc-alloc').textContent = `cash disc. ₹${fmt(l.cash_discount_amount)}`;
            gross += l.gross_amount || 0; disc += l.discount_amount || 0;
            taxable += l.taxable_value || 0; gst += l.gst_amount || 0; amount += l.amount || 0;
        });
        document.getElementById('t-gross').textContent = fmt(gross);
        document.getElementById('t-disc').textContent = fmt(disc);
        document.getElementById('t-taxable').textContent = fmt(taxable);
        document.getElementById('t-gst').textContent = fmt(gst);
        document.getElementById('t-lines').textContent = fmt(amount);
        const status = document.getElementById('t-status');
        const inv = D.invoice || {};
        if (inv.printed_total != null) {
            status.className = 'pi-total-status ok';
            status.textContent = 'Closed — matched the printed invoice' + (parseFloat(inv.round_off) ? ` (round-off ₹${fmt(inv.round_off)})` : '');
        } else {
            status.className = 'pi-total-status text-muted';
            status.textContent = `Invoice amount saved: ₹${fmt(inv.invoice_amount)}`;
        }
    }

    // ── Help panel (per oil company) ────────────────────────────────────────
    const helpPanel = document.getElementById('pi-help');
    const formatSel = document.getElementById('pi-format');

    function currentFormat() {
        if (chosenFormat) return chosenFormat;
        const sid = supplierSelect.value;
        return (sid && D.supplierFormats[sid]) || D.locationOmc || 'GENERIC';
    }

    function renderHelp() {
        const f = currentFormat();
        const h = D.formatHelp[f] || D.formatHelp.GENERIC;
        if (!h) return;
        document.querySelectorAll('[data-hint]').forEach(el => { el.textContent = (h.hints && h.hints[el.dataset.hint]) || ''; });
        if (!helpPanel) return;
        formatSel.value = f;
        document.getElementById('pi-help-title').textContent = h.title;
        document.getElementById('pi-help-subtitle').textContent = h.subtitle || '';
        const cell = c => {
            if (c && typeof c === 'object') return `<td class="pi-marked"><span class="pi-mark">${c.mark}</span>${esc(c.text)}</td>`;
            return `<td>${esc(c)}</td>`;
        };
        document.getElementById('pi-help-sample').innerHTML =
            `<thead class="thead-light"><tr>${h.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>` +
            `<tbody>${h.rows.map(r => `<tr>${r.map(cell).join('')}</tr>`).join('')}</tbody>`;
        document.getElementById('pi-help-footer').innerHTML = (h.footer || []).map(f =>
            `<div class="ml-3 mb-1"><span class="pi-mark">${f.mark}</span>${esc(f.label)}: <b>${esc(f.value)}</b></div>`).join('');
        // Step text is our own config (allows <b>), not user data
        document.getElementById('pi-help-steps').innerHTML = (h.steps || []).map(s =>
            `<li><span class="pi-mark">${s.n}</span>${s.text}</li>`).join('');
    }

    // Help opens by itself on new invoices until the user hides it; only the
    // user's own Hide/Show choice is remembered (per browser)
    function setHelpOpen(open, remember) {
        if (!helpPanel) return;
        helpPanel.style.display = open ? '' : 'none';
        if (remember) {
            try { localStorage.setItem('pi-help-hidden', open ? '0' : '1'); } catch (e) { /* storage unavailable */ }
        }
    }

    if (helpPanel) {
        let hidden = false;
        try { hidden = localStorage.getItem('pi-help-hidden') === '1'; } catch (e) { /* storage unavailable */ }
        setHelpOpen(D.isNew && !hidden, false);
        document.getElementById('pi-help-toggle').addEventListener('click', () => setHelpOpen(helpPanel.style.display === 'none', true));
        document.getElementById('pi-help-close').addEventListener('click', () => setHelpOpen(false, true));
        formatSel.addEventListener('change', () => { chosenFormat = formatSel.value; renderHelp(); });
    }
    supplierSelect.addEventListener('change', () => { chosenFormat = null; renderHelp(); });

    // ── Supplier list filtered by invoice date (unchanged behaviour) ────────
    let allSuppliers = [];
    function filterSuppliersByDate(dateStr) {
        if (!dateStr || !allSuppliers.length) return;
        const selectedDate = new Date(dateStr);
        const current = supplierSelect.value;
        while (supplierSelect.options.length > 1) supplierSelect.remove(1);
        allSuppliers.forEach(s => {
            const start = s.effective_start_date ? new Date(s.effective_start_date) : null;
            const end = s.effective_end_date ? new Date(s.effective_end_date) : null;
            if ((!start || selectedDate >= start) && (!end || selectedDate <= end)) {
                const o = document.createElement('option');
                o.value = s.supplier_id; o.text = s.supplier_name;
                if (String(current) === String(s.supplier_id)) o.selected = true;
                supplierSelect.add(o);
            }
        });
        if (current && supplierSelect.value !== String(current)) {
            supplierSelect.value = '';
            showErrors(['The selected supplier is not active on this invoice date.']);
        }
    }
    if (!closed) {
        fetch('/lubes-invoice/suppliers-with-dates')
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (data && data.success) { allSuppliers = data.suppliers || []; filterSuppliersByDate(invoiceDateInput.value); }
            })
            .catch(() => { /* keep the server-rendered list */ });
        invoiceDateInput.addEventListener('change', () => filterSuppliersByDate(invoiceDateInput.value));
    }

    // ── Save / Close ────────────────────────────────────────────────────────
    function showErrors(list) {
        if (!list || !list.length) { errorsBox.style.display = 'none'; return; }
        errorsBox.innerHTML = '<ul class="mb-0 pl-3">' + list.map(e => `<li>${esc(e)}</li>`).join('') + '</ul>';
        errorsBox.style.display = '';
        errorsBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function collect() {
        const rows = [...tbody.querySelectorAll('tr.pi-row')];
        const hdrIdEl = document.getElementById('lubes_hdr_id');
        return {
            lubes_hdr_id: hdrIdEl ? hdrIdEl.value : null,
            invoice_number: document.getElementById('invoice_number').value,
            invoice_date: invoiceDateInput.value,
            supplier_id: supplierSelect.value,
            tax_type: taxType(),
            discount_mode: discountMode(),
            total_line_discount: totalLineDiscInput ? totalLineDiscInput.value : '',
            cash_discount: cashDiscountInput.value,
            printed_total: printedTotalInput.value,
            notes: document.getElementById('notes').value,
            invoice_format: chosenFormat,
            items: rows.filter(tr => tr.querySelector('.pi-product').value).map(tr => {
                const p = productById.get(tr.querySelector('.pi-product').value);
                return {
                    product_id: tr.querySelector('.pi-product').value,
                    entered_qty: tr.querySelector('.pi-qty').value,
                    entered_uom: tr.querySelector('.pi-uom').value,
                    pack_volume: p && !p.pack_size ? tr.querySelector('.pi-packsize').value : null,
                    gross_amount: tr.querySelector('.pi-gross').value,
                    discount_amount: discountMode() === 'TOTAL' ? 0 : tr.querySelector('.pi-disc').value,
                    gst_pct: tr.querySelector('.pi-gst').value,
                    mrp: tr._mrp,
                    notes: tr._notes
                };
            })
        };
    }

    function validateClient(data) {
        const errs = [];
        if (!data.invoice_number.trim()) errs.push('Enter the invoice number.');
        if (!data.invoice_date) errs.push('Enter the invoice date.');
        if (!data.supplier_id) errs.push('Select the supplier.');
        if (!data.items.length) errs.push('Add at least one product.');
        data.items.forEach((it, i) => {
            const p = productById.get(String(it.product_id));
            const name = p ? p.product_name : `Line ${i + 1}`;
            if (!(parseFloat(it.entered_qty) > 0)) errs.push(`${name}: enter the quantity.`);
            if (it.gross_amount === '' || parseFloat(it.gross_amount) < 0) errs.push(`${name}: enter the amount (0 for free stock).`);
        });
        if (lastResult) errs.push(...lastResult.errors);
        return errs;
    }

    async function save() {
        const data = collect();
        const errs = validateClient(data);
        if (errs.length) { showErrors(errs); return null; }
        showErrors([]);
        const res = await fetch('/lubes-invoice/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await res.json().catch(() => ({ success: false, message: 'Unexpected server response.' }));
        if (!result.success) { showErrors(result.errors || [result.message || 'Failed to save invoice.']); return null; }
        return result;
    }

    function setBusy(busy) {
        [saveBtn, closeBtn].forEach(b => { if (b) b.disabled = busy || (b === closeBtn && !(lastResult && lastResult.totals.matches)); });
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            setBusy(true);
            try {
                const result = await save();
                if (result) window.location.href = `/lubes-invoice?id=${result.lubes_hdr_id}`;
            } catch (e) {
                showErrors(['Could not save — check your connection and try again.']);
            } finally { setBusy(false); }
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', async () => {
            if (!confirm('Close this invoice? Stock and accounts will use it, and it cannot be changed afterwards.')) return;
            setBusy(true);
            try {
                const saved = await save();
                if (!saved) return;
                const res = await fetch(`/lubes-invoice/close?id=${saved.lubes_hdr_id}`, { headers: { Accept: 'application/json' } });
                const result = await res.json().catch(() => ({ success: false }));
                if (result.success) window.location.href = '/lubes-invoice-home';
                else {
                    showErrors([result.message || 'Failed to close invoice.']);
                    // Saved as draft even though close failed — reload so the screen shows the saved state
                    setTimeout(() => { window.location.href = `/lubes-invoice?id=${saved.lubes_hdr_id}`; }, 2500);
                }
            } catch (e) {
                showErrors(['Could not close — check your connection and try again.']);
            } finally { setBusy(false); }
        });
    }

    // ── Attachments ─────────────────────────────────────────────────────────
    const attList = document.getElementById('pi-att-list');
    let attachments = (D.attachments || []).slice();

    function renderAttachments() {
        if (!attList) return;
        if (!attachments.length) {
            attList.innerHTML = D.isNew ? '' : '<div class="small text-muted">No copy attached yet.</div>';
        } else {
            attList.innerHTML = attachments.map(a => `
                <div class="pi-att">
                    ${a.mime_type.indexOf('image/') === 0
                        ? `<a href="${a.url}" target="_blank" rel="noopener"><img src="${a.url}" alt=""></a>`
                        : `<a href="${a.url}" target="_blank" rel="noopener" class="h3 mb-0 text-danger"><i class="bi bi-file-earmark-pdf"></i></a>`}
                    <a href="${a.url}" target="_blank" rel="noopener" class="small flex-grow-1">${esc(a.file_name)}</a>
                    ${closed ? '' : `<button type="button" class="btn btn-sm btn-outline-danger pi-att-remove" data-id="${a.doc_id}" title="Remove"><i class="bi bi-trash"></i></button>`}
                </div>`).join('');
        }
        const actions = document.getElementById('pi-att-actions');
        if (actions) actions.style.display = attachments.length >= D.maxAttachments ? 'none' : '';
    }

    // Phone photos are shrunk and re-encoded in the browser before upload
    // (also strips anything hidden in the original file)
    function compressImage(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => {
                const max = 1800;
                const scale = Math.min(1, max / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                URL.revokeObjectURL(url);
                canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not read the photo')), 'image/jpeg', 0.75);
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This file is not a readable image.')); };
            img.src = url;
        });
    }

    async function uploadAttachment(file, source) {
        const status = document.getElementById('pi-att-status');
        const hdrId = document.getElementById('lubes_hdr_id').value;
        try {
            let blob = file, name = file.name || 'invoice';
            if (file.type === 'application/pdf') {
                if (file.size > D.maxUploadMb * 1024 * 1024) throw new Error(`PDF is larger than ${D.maxUploadMb} MB. Take a photo of the invoice instead — photos are shrunk automatically.`);
            } else if (/^image\//.test(file.type)) {
                status.textContent = 'Preparing photo…';
                blob = await compressImage(file);
                name = name.replace(/\.[^.]*$/, '') + '.jpg';
            } else {
                throw new Error('Only JPG, PNG or PDF files can be attached.');
            }
            status.className = 'small mt-1 text-muted';
            status.textContent = 'Uploading…';
            const fd = new FormData();
            fd.append('capture_source', source);
            fd.append('file', blob, name);
            const res = await fetch(`/lubes-invoice/${hdrId}/attachments`, { method: 'POST', body: fd });
            const result = await res.json().catch(() => ({ success: false, message: 'Upload failed.' }));
            if (!result.success) throw new Error(result.message || 'Upload failed.');
            attachments.unshift(result.attachment);
            renderAttachments();
            status.className = 'small mt-1 text-success';
            status.textContent = 'Attached.';
        } catch (e) {
            status.className = 'small mt-1 text-danger';
            status.textContent = e.message;
        }
    }

    if (document.getElementById('pi-att-upload-btn')) {
        const fileInput = document.getElementById('pi-att-file');
        const camInput = document.getElementById('pi-att-camera');
        document.getElementById('pi-att-upload-btn').addEventListener('click', () => fileInput.click());
        document.getElementById('pi-att-camera-btn').addEventListener('click', () => camInput.click());
        fileInput.addEventListener('change', () => { if (fileInput.files[0]) uploadAttachment(fileInput.files[0], 'UPLOAD'); fileInput.value = ''; });
        camInput.addEventListener('change', () => { if (camInput.files[0]) uploadAttachment(camInput.files[0], 'CAMERA'); camInput.value = ''; });
    }
    if (attList) {
        attList.addEventListener('click', async (ev) => {
            const btn = ev.target.closest('.pi-att-remove');
            if (!btn || !confirm('Remove this attachment?')) return;
            const hdrId = document.getElementById('lubes_hdr_id').value;
            const res = await fetch(`/lubes-invoice/${hdrId}/attachments/${btn.dataset.id}/remove`, { method: 'POST' });
            const result = await res.json().catch(() => ({ success: false }));
            if (result.success) { attachments = attachments.filter(a => String(a.doc_id) !== btn.dataset.id); renderAttachments(); }
            else alert(result.message || 'Could not remove the attachment.');
        });
    }

    // ── Init ────────────────────────────────────────────────────────────────
    (D.lines && D.lines.length ? D.lines : [{}]).forEach(addRow);
    renderHelp();
    renderAttachments();

    if (closed) {
        renderClosed();
    } else {
        document.getElementById('add-row-btn').addEventListener('click', () => { addRow({}); recalc(); });
        [cashDiscountInput, printedTotalInput, totalLineDiscInput].forEach(el => el && el.addEventListener('input', recalc));
        form.querySelectorAll('input[name="tax_type"], input[name="discount_mode"]').forEach(el => el.addEventListener('change', recalc));
        recalc();
    }
});
