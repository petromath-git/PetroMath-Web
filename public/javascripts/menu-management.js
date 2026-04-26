$(document).ready(function () {

    let menuItems  = [];
    let menuGroups = [];
    let allRoles   = [];
    let isSuperUser = false;
    let editingMenuItem  = null;
    let editingMenuGroup = null;

    // ── tab events ─────────────────────────────────────────────────────────
    $('a[data-toggle="tab"]').on('shown.bs.tab', function (e) {
        const target = $(e.target).attr('href');
        if (target === '#pane-menu-items')    loadMenuItems();
        if (target === '#pane-menu-groups')   loadMenuGroups();
        if (target === '#pane-global-access') loadGlobalAccess();
        if (target === '#pane-overrides')     loadOverrides();
        if (target === '#pane-cache')         loadCacheStats();
    });

    // ── init ───────────────────────────────────────────────────────────────
    isSuperUser = (typeof pageIsSuperUser !== 'undefined') && pageIsSuperUser;
    if (isSuperUser) {
        loadMenuItems();
        loadMenuGroups();
    } else {
        loadOverrides();
    }

    // ══════════════════════════════════════════════════════════════════════
    // MENU ITEMS
    // ══════════════════════════════════════════════════════════════════════

    function loadMenuItems() {
        $.get('/menu-management/api/menu-items').done(function (r) {
            if (!r.success) { tableError('#tbody-menu-items', 5, r.error); return; }
            menuItems = r.data;
            filterMenuItems();
        }).fail(function (xhr) { tableError('#tbody-menu-items', 5, xhr.status + ' ' + xhr.responseText.substring(0, 100)); });
    }

    function filterMenuItems() {
        const q = ($('#search-menu-items').val() || '').toLowerCase().trim();
        const filtered = q ? menuItems.filter(i =>
            (i.menu_code  || '').toLowerCase().includes(q) ||
            (i.menu_name  || '').toLowerCase().includes(q) ||
            (i.url_path   || '').toLowerCase().includes(q) ||
            (i.group_code || '').toLowerCase().includes(q)
        ) : menuItems;
        renderMenuItemsTable(filtered);
    }

    $('#search-menu-items').on('input', filterMenuItems);

    function renderMenuItemsTable(items) {
        const tbody = $('#tbody-menu-items').empty();
        if (!items.length) { tbody.html('<tr><td colspan="5" class="text-center text-muted">No menu items</td></tr>'); return; }

        const groups = {};
        items.forEach(item => {
            const key = item.group_code || '__NONE__';
            if (!groups[key]) groups[key] = { label: item.group_code || 'Ungrouped', items: [] };
            groups[key].items.push(item);
        });

        Object.values(groups).forEach(g => {
            tbody.append(`<tr class="table-secondary"><td colspan="5" class="font-weight-bold small text-uppercase py-1"><i class="bi bi-collection mr-1"></i>${escHtml(g.label)}</td></tr>`);
            g.items.forEach(item => {
                const indent = item.parent_code ? '<span class="text-muted mr-1">↳</span>' : '';
                tbody.append(`
                    <tr>
                      <td><code>${escHtml(item.menu_code)}</code></td>
                      <td>${indent}${escHtml(item.menu_name)}</td>
                      <td><small class="text-muted">${escHtml(item.url_path || '—')}</small></td>
                      <td class="text-center">${item.sequence}</td>
                      <td class="text-center text-nowrap">
                        <button class="btn btn-outline-primary btn-xs mr-1" onclick="editMenuItem(${item.menu_id})" title="Edit"><i class="bi bi-pencil"></i></button>
                        <button class="btn btn-outline-secondary btn-xs" onclick="deleteMenuItem(${item.menu_id},'${escAttr(item.menu_name)}')" title="Disable"><i class="bi bi-slash-circle mr-1"></i>Disable</button>
                      </td>
                    </tr>`);
            });
        });
    }

    $('#btn-add-menu-item').click(() => openMenuItemModal(null));
    $('#btn-save-menu-item').click(saveMenuItem);
    $('#form-menu-item').submit(e => { e.preventDefault(); saveMenuItem(); });

    function openMenuItemModal(item) {
        editingMenuItem = item;
        document.getElementById('form-menu-item').reset();

        const groupSel = $('#fi-group-code').empty().append('<option value="">Select group</option>');
        menuGroups.forEach(g => groupSel.append(`<option value="${escAttr(g.group_code)}">${escHtml(g.group_name)}</option>`));

        const parentSel = $('#fi-parent-code').empty().append('<option value="">None (top level)</option>');
        menuItems.forEach(m => parentSel.append(`<option value="${escAttr(m.menu_code)}">${escHtml(m.menu_name)}</option>`));

        if (item) {
            $('#modal-menu-item-title').text('Edit Menu Item');
            $('#fi-menu-code').val(item.menu_code).prop('readonly', true);
            $('#fi-menu-name').val(item.menu_name);
            $('#fi-url-path').val(item.url_path || '');
            $('#fi-group-code').val(item.group_code || '');
            $('#fi-parent-code').val(item.parent_code || '');
            $('#fi-sequence').val(item.sequence);
        } else {
            $('#modal-menu-item-title').text('Add Menu Item');
            $('#fi-menu-code').prop('readonly', false);
        }
        $('#modal-menu-item').modal('show');
    }

    function saveMenuItem() {
        const form = document.getElementById('form-menu-item');
        if (!form.checkValidity()) { form.reportValidity(); return; }

        const groupCode = $('#fi-group-code').val();
        const sequence  = parseInt($('#fi-sequence').val());
        const menuCode  = $('#fi-menu-code').val();

        const dup = menuItems.find(i => i.group_code === groupCode && parseInt(i.sequence) === sequence && i.menu_code !== menuCode);
        if (dup) { showError(`Sequence ${sequence} already used by "${dup.menu_name}" in this group.`); return; }

        const data = {
            menu_code:   menuCode,
            menu_name:   $('#fi-menu-name').val(),
            url_path:    $('#fi-url-path').val() || null,
            group_code:  groupCode || null,
            parent_code: $('#fi-parent-code').val() || null,
            sequence:    sequence || 1
        };

        const url    = editingMenuItem ? `/menu-management/api/menu-items/${editingMenuItem.menu_id}` : '/menu-management/api/menu-items';
        const method = editingMenuItem ? 'PUT' : 'POST';

        $.ajax({ url, method, data: JSON.stringify(data), contentType: 'application/json' })
            .done(r => { if (r.success) { $('#modal-menu-item').modal('hide'); showSuccess(r.message); loadMenuItems(); } else showError(r.error); })
            .fail(xhr => showError('Save failed: ' + xhr.responseText));
    }

    window.editMenuItem = id => { const item = menuItems.find(i => i.menu_id === id); if (item) openMenuItemModal(item); };

    window.deleteMenuItem = (id, name) => {
        if (!confirm(`Disable menu item "${name}"?\nIt will be hidden but can be re-enabled via SQL.`)) return;
        $.ajax({ url: `/menu-management/api/menu-items/${id}`, method: 'DELETE' })
            .done(r => { if (r.success) { showSuccess(r.message); loadMenuItems(); } else showError(r.error); })
            .fail(xhr => showError('Disable failed: ' + xhr.responseText));
    };

    // ══════════════════════════════════════════════════════════════════════
    // MENU GROUPS
    // ══════════════════════════════════════════════════════════════════════

    function loadMenuGroups() {
        $.get('/menu-management/api/menu-groups').done(function (r) {
            if (!r.success) { tableError('#tbody-menu-groups', 5, r.error); return; }
            menuGroups = r.data;
            renderMenuGroupsTable(menuGroups);
        }).fail(xhr => tableError('#tbody-menu-groups', 5, xhr.status));
    }

    function renderMenuGroupsTable(groups) {
        const tbody = $('#tbody-menu-groups').empty();
        if (!groups.length) { tbody.html('<tr><td colspan="5" class="text-center text-muted">No groups</td></tr>'); return; }
        groups.forEach(g => {
            tbody.append(`
                <tr>
                  <td><code>${escHtml(g.group_code)}</code></td>
                  <td>${escHtml(g.group_name)}</td>
                  <td class="text-center">${g.group_sequence}</td>
                  <td>${g.group_icon ? `<i class="bi ${escAttr(g.group_icon)}"></i> <small class="text-muted">${escHtml(g.group_icon)}</small>` : '—'}</td>
                  <td class="text-center text-nowrap">
                    <button class="btn btn-outline-primary btn-xs mr-1" onclick="editMenuGroup(${g.group_id})" title="Edit"><i class="bi bi-pencil"></i></button>
                    <button class="btn btn-outline-secondary btn-xs" onclick="deleteMenuGroup(${g.group_id},'${escAttr(g.group_name)}')" title="Disable"><i class="bi bi-slash-circle mr-1"></i>Disable</button>
                  </td>
                </tr>`);
        });
    }

    $('#btn-add-menu-group').click(() => openMenuGroupModal(null));
    $('#btn-save-menu-group').click(saveMenuGroup);
    $('#form-menu-group').submit(e => { e.preventDefault(); saveMenuGroup(); });

    function openMenuGroupModal(group) {
        editingMenuGroup = group;
        document.getElementById('form-menu-group').reset();
        if (group) {
            $('#modal-menu-group-title').text('Edit Menu Group');
            $('#fg-code').val(group.group_code).prop('readonly', true);
            $('#fg-name').val(group.group_name);
            $('#fg-sequence').val(group.group_sequence);
            $('#fg-icon').val(group.group_icon || '');
        } else {
            $('#modal-menu-group-title').text('Add Menu Group');
            $('#fg-code').prop('readonly', false);
        }
        $('#modal-menu-group').modal('show');
    }

    function saveMenuGroup() {
        const form = document.getElementById('form-menu-group');
        if (!form.checkValidity()) { form.reportValidity(); return; }
        const data = { group_code: $('#fg-code').val(), group_name: $('#fg-name').val(), group_sequence: parseInt($('#fg-sequence').val()) || 1, group_icon: $('#fg-icon').val() || null };
        const url    = editingMenuGroup ? `/menu-management/api/menu-groups/${editingMenuGroup.group_id}` : '/menu-management/api/menu-groups';
        const method = editingMenuGroup ? 'PUT' : 'POST';
        $.ajax({ url, method, data: JSON.stringify(data), contentType: 'application/json' })
            .done(r => { if (r.success) { $('#modal-menu-group').modal('hide'); showSuccess(r.message); loadMenuGroups(); } else showError(r.error); })
            .fail(xhr => showError('Save failed: ' + xhr.responseText));
    }

    window.editMenuGroup = id => { const g = menuGroups.find(g => g.group_id === id); if (g) openMenuGroupModal(g); };
    window.deleteMenuGroup = (id, name) => {
        if (!confirm(`Disable group "${name}"? (Soft delete — reversible via SQL)`)) return;
        $.ajax({ url: `/menu-management/api/menu-groups/${id}`, method: 'DELETE' })
            .done(r => { if (r.success) { showSuccess(r.message); loadMenuGroups(); } else showError(r.error); })
            .fail(xhr => showError('Disable failed: ' + xhr.responseText));
    };

    // ══════════════════════════════════════════════════════════════════════
    // GLOBAL ACCESS
    // ══════════════════════════════════════════════════════════════════════

    let allGlobalAccessRows = [];

    function loadGlobalAccess() {
        tableLoading('#tbody-global-access', 4);
        $.get('/menu-management/api/global-access').done(function (r) {
            if (!r.success) { tableError('#tbody-global-access', 4, r.error); return; }
            allRoles = r.roles;
            allGlobalAccessRows = r.access;
            filterGlobalAccess();
        }).fail(xhr => tableError('#tbody-global-access', 4, xhr.status));
    }

    function filterGlobalAccess() {
        const q = ($('#search-global-access').val() || '').toLowerCase().trim();
        const filtered = q ? allGlobalAccessRows.filter(row =>
            (row.role      || '').toLowerCase().includes(q) ||
            (row.menu_name || '').toLowerCase().includes(q) ||
            (row.menu_code || '').toLowerCase().includes(q)
        ) : allGlobalAccessRows;
        renderGlobalAccessTable(filtered);
    }

    $('#search-global-access').on('input', filterGlobalAccess);

    function renderGlobalAccessTable(rows) {
        const tbody = $('#tbody-global-access').empty();
        if (!rows.length) { tbody.html('<tr><td colspan="4" class="text-center text-muted">No global rules defined</td></tr>'); return; }
        rows.forEach(row => {
            const badge = row.allowed ? '<span class="badge badge-success">Allow</span>' : '<span class="badge badge-danger">Deny</span>';
            tbody.append(`
                <tr>
                  <td>${escHtml(row.role)}</td>
                  <td>${escHtml(row.menu_name)} <small class="text-muted">(${escHtml(row.menu_code)})</small></td>
                  <td class="text-center">${badge}</td>
                  <td class="text-center">
                    <button class="btn btn-outline-secondary btn-xs" onclick="deleteGlobalAccess(${row.access_id})" title="Disable"><i class="bi bi-slash-circle mr-1"></i>Disable</button>
                  </td>
                </tr>`);
        });
    }

    $('#btn-add-global').click(() => openAccessModal('global'));
    $('#btn-save-global').click(() => saveAccessRule('global'));
    $('#form-global-access').submit(e => { e.preventDefault(); saveAccessRule('global'); });
    $('#ga-select-all').click(e => { e.preventDefault(); $('#ga-roles-checkboxes input[type=checkbox]').prop('checked', true); });
    $('#ga-deselect-all').click(e => { e.preventDefault(); $('#ga-roles-checkboxes input[type=checkbox]').prop('checked', false); });

    window.deleteGlobalAccess = id => {
        if (!confirm('Disable this global access rule? (Soft delete — reversible via SQL)')) return;
        $.ajax({ url: `/menu-management/api/global-access/${id}`, method: 'DELETE' })
            .done(r => { if (r.success) { showSuccess(r.message); loadGlobalAccess(); } else showError(r.error); })
            .fail(xhr => showError('Delete failed: ' + xhr.responseText));
    };

    // ══════════════════════════════════════════════════════════════════════
    // LOCATION OVERRIDES
    // ══════════════════════════════════════════════════════════════════════

    let allOverrideRows = [];

    function loadOverrides() {
        tableLoading('#tbody-overrides', 5);
        $.get('/menu-management/api/overrides').done(function (r) {
            if (!r.success) { tableError('#tbody-overrides', 5, r.error); return; }
            allRoles = r.roles;
            isSuperUser = r.isSuperUser;
            allOverrideRows = r.access;
            if (r.isSuperUser) {
                $('#override-location-label').text('All Locations');
                $('#th-override-location').removeClass('d-none');
                buildLocationFilter(r.access);
                $('#override-filter-row').removeClass('d-none');
            } else {
                $('#override-location-label').text(r.location || userLocationCode);
                $('#th-override-location').addClass('d-none');
                $('#override-filter-row').addClass('d-none');
            }
            filterOverrides();
        }).fail(xhr => tableError('#tbody-overrides', 5, xhr.status));
    }

    function filterOverrides() {
        const q   = ($('#search-overrides').val() || '').toLowerCase().trim();
        const loc = $('#override-location-filter').val();
        let filtered = allOverrideRows;
        if (loc) filtered = filtered.filter(r => r.location_code === loc);
        if (q)   filtered = filtered.filter(r =>
            (r.role          || '').toLowerCase().includes(q) ||
            (r.menu_name     || '').toLowerCase().includes(q) ||
            (r.menu_code     || '').toLowerCase().includes(q) ||
            (r.location_code || '').toLowerCase().includes(q)
        );
        renderOverridesTable(filtered, isSuperUser);
    }

    $('#search-overrides').on('input', filterOverrides);

    function buildLocationFilter(rows) {
        const locs = [...new Set(rows.map(r => r.location_code))].sort();
        const sel = $('#override-location-filter').empty().append('<option value="">All Locations</option>');
        locs.forEach(l => sel.append(`<option value="${escAttr(l)}">${escHtml(l)}</option>`));
    }

    $('#override-location-filter').change(filterOverrides);

    $('#btn-add-override').click(() => openAccessModal('override'));
    $('#btn-save-override').click(() => saveAccessRule('override'));
    $('#form-override').submit(e => { e.preventDefault(); saveAccessRule('override'); });
    $('#ov-select-all').click(e => { e.preventDefault(); $('#ov-roles-checkboxes input[type=checkbox]').prop('checked', true); });
    $('#ov-deselect-all').click(e => { e.preventDefault(); $('#ov-roles-checkboxes input[type=checkbox]').prop('checked', false); });

    window.deleteOverride = id => {
        if (!confirm('Disable this override? (Soft delete — reversible via SQL)')) return;
        $.ajax({ url: `/menu-management/api/overrides/${id}`, method: 'DELETE' })
            .done(r => { if (r.success) { showSuccess(r.message); loadOverrides(); } else showError(r.error); })
            .fail(xhr => showError('Delete failed: ' + xhr.responseText));
    };

    function renderOverridesTable(rows, showLocation) {
        const cols = showLocation ? 5 : 4;
        const tbody = $('#tbody-overrides').empty();
        if (!rows.length) { tbody.html(`<tr><td colspan="${cols}" class="text-center text-muted">No overrides defined</td></tr>`); return; }
        rows.forEach(row => {
            const badge = row.allowed ? '<span class="badge badge-success">Allow</span>' : '<span class="badge badge-danger">Deny</span>';
            const locCell = showLocation ? `<td><code>${escHtml(row.location_code)}</code></td>` : '';
            tbody.append(`
                <tr>
                  ${locCell}
                  <td>${escHtml(row.role)}</td>
                  <td>${escHtml(row.menu_name)} <small class="text-muted">(${escHtml(row.menu_code)})</small></td>
                  <td class="text-center">${badge}</td>
                  <td class="text-center">
                    <button class="btn btn-outline-secondary btn-xs" onclick="deleteOverride(${row.access_id})" title="Disable"><i class="bi bi-slash-circle mr-1"></i>Disable</button>
                  </td>
                </tr>`);
        });
    }

    // ══════════════════════════════════════════════════════════════════════
    // SHARED ACCESS MODAL (Global + Override) — multi-select roles
    // ══════════════════════════════════════════════════════════════════════

    function openAccessModal(type) {
        const prefix  = type === 'global' ? 'ga' : 'ov';
        const menuSel = $(`#${prefix}-menu`).empty().append('<option value="">Select menu item</option>');

        menuItems.forEach(m => menuSel.append(`<option value="${escAttr(m.menu_code)}">${escHtml(m.menu_name)} (${escHtml(m.menu_code)})</option>`));

        // Build role checkboxes
        const box = $(`#${prefix}-roles-checkboxes`).empty();
        allRoles.forEach(r => {
            box.append(`
                <div class="custom-control custom-checkbox">
                  <input class="custom-control-input" type="checkbox" id="${prefix}-role-${escAttr(r.role_name)}" value="${escAttr(r.role_name)}">
                  <label class="custom-control-label" for="${prefix}-role-${escAttr(r.role_name)}">${escHtml(r.role_display_name || r.role_name)}</label>
                </div>`);
        });

        $(`input[name="${prefix}-allowed"][value="1"]`).prop('checked', true);

        if (type === 'override') {
            $('#ov-location').val('');
            isSuperUser ? $('#ov-location-group').removeClass('d-none') : $('#ov-location-group').addClass('d-none');
        }

        $(`#modal-${type === 'global' ? 'global-access' : 'override'}`).modal('show');
    }

    function saveAccessRule(type) {
        const prefix   = type === 'global' ? 'ga' : 'ov';
        const menuCode = $(`#${prefix}-menu`).val();
        const allowed  = $(`input[name="${prefix}-allowed"]:checked`).val() === '1';
        const checkedRoles = $(`#${prefix}-roles-checkboxes input[type=checkbox]:checked`).map((_, el) => el.value).get();

        if (!checkedRoles.length || !menuCode) { showError('Please select at least one role and a menu item.'); return; }

        const url = type === 'global' ? '/menu-management/api/global-access' : '/menu-management/api/overrides';

        const calls = checkedRoles.map(role => {
            const payload = { role, menu_code: menuCode, allowed };
            if (type === 'override' && isSuperUser) {
                const loc = $('#ov-location').val().trim();
                if (loc) payload.location_code = loc;
            }
            return $.ajax({ url, method: 'POST', data: JSON.stringify(payload), contentType: 'application/json' });
        });

        $.when(...calls).then(function () {
            $(`#modal-${type === 'global' ? 'global-access' : 'override'}`).modal('hide');
            showSuccess(`Saved ${checkedRoles.length} rule(s) for ${escHtml(menuCode)}`);
            if (type === 'global') loadGlobalAccess(); else loadOverrides();
        }).fail(xhr => showError('Save failed: ' + (xhr.responseJSON && xhr.responseJSON.error ? xhr.responseJSON.error : xhr.responseText)));
    }

    // ══════════════════════════════════════════════════════════════════════
    // CACHE
    // ══════════════════════════════════════════════════════════════════════

    function loadCacheStats() {
        $('#cache-stats-body').html('<p class="text-muted small mb-0">Loading...</p>');
        $.get('/menu-management/api/cache-stats').done(function (r) {
            if (!r.success || !r.stats) { $('#cache-stats-body').html('<p class="text-muted small mb-0">No refresh history.</p>'); return; }
            const s = r.stats;
            $('#cache-stats-body').html(`
                <table class="table table-sm table-borderless mb-0">
                  <tr><th class="pl-0">Last Refresh</th><td>${escHtml(String(s.refresh_time))}</td></tr>
                  <tr><th class="pl-0">Records Cached</th><td>${s.records_refreshed}</td></tr>
                  <tr><th class="pl-0">Duration</th><td>${s.duration_ms} ms</td></tr>
                </table>`);
        }).fail(() => $('#cache-stats-body').html('<p class="text-danger small mb-0">Could not load stats.</p>'));
    }

    $('#btn-refresh-cache').click(function () {
        const $btn = $(this).prop('disabled', true).html('<span class="spinner-border spinner-border-sm mr-1"></span>Refreshing...');
        $.post('/menu-management/api/refresh-cache')
            .done(r => { if (r.success) { showSuccess('Cache refreshed'); loadCacheStats(); } else showError(r.error); })
            .fail(xhr => showError('Refresh failed: ' + xhr.responseText))
            .always(() => $btn.prop('disabled', false).html('<i class="bi bi-arrow-clockwise mr-1"></i>Refresh Cache Now'));
    });

    // ══════════════════════════════════════════════════════════════════════
    // UTILITIES
    // ══════════════════════════════════════════════════════════════════════

    function tableLoading(sel, cols) { $(sel).html(`<tr><td colspan="${cols}" class="text-center text-muted">Loading...</td></tr>`); }
    function tableError(sel, cols, msg) { $(sel).html(`<tr><td colspan="${cols}" class="text-center text-danger"><i class="bi bi-exclamation-triangle mr-1"></i>${escHtml(String(msg))}</td></tr>`); }

    function escHtml(str) {
        if (str == null) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function escAttr(str) { return str == null ? '' : String(str).replace(/'/g, "\\'"); }

    function showSuccess(msg) { showToast(msg, 'bg-success'); }
    function showError(msg)   { showToast(msg, 'bg-danger'); }

    function showToast(msg, cls) {
        const t = $(`
            <div class="toast text-white ${cls} border-0"
                 style="position:fixed;top:20px;right:20px;z-index:9999;min-width:300px"
                 data-delay="5000" data-autohide="true">
              <div class="d-flex align-items-center p-2">
                <div class="toast-body flex-grow-1">${msg}</div>
                <button type="button" class="close text-white ml-2" data-dismiss="toast"><span>&times;</span></button>
              </div>
            </div>`);
        $('body').append(t);
        t.toast('show');
        t.on('hidden.bs.toast', () => t.remove());
    }
});
