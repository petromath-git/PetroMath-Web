function updateDateRange() {
    const dateRange = document.getElementById('dateRange').value;
    const fromDateInput = document.getElementById('fromclosingDate');
    const toDateInput = document.getElementById('toclosingDate');
    const fromDateLabel = document.getElementById('fromDateLabel');
    const toDateLabel = document.getElementById('toDateLabel');

    const currentDate = new Date();
    let fromDate, toDate;

    if (dateRange === 'today') {
        // "Today": Current date only
        fromDate = new Date();
        toDate = new Date();
    } else if (dateRange === 'yesterday') {
        // "Yesterday": Previous day
        fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - 1);
        toDate = new Date();
        toDate.setDate(toDate.getDate() - 1);
    } else if (dateRange === 'this_week') {
        // "This Week": From Sunday (start of week) to today
        fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - fromDate.getDay()); // Go back to Sunday
        toDate = new Date(); // Today
    } else if (dateRange === 'this_month') {
        // "This Month": From 1st day of current month to today
        fromDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1); // 1st day of the current month
        toDate = new Date(); // Current date
    } else if (dateRange === 'last_month') {
        // "Last Month": From 1st to last day of the previous month
        fromDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
        toDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 0);
    } else if (dateRange === 'this_financial_year') {
        // "This Financial Year": From 1st April to 31st March
        const currentYear = currentDate.getFullYear();
        const currentMonth = currentDate.getMonth();
        if (currentMonth < 3) {
            // Jan, Feb, or Mar => Financial year started last year
            fromDate = new Date(currentYear - 1, 3, 1); // 1st April of last year
            toDate = currentDate; // Today instead of March 31
            //toDate = new Date(currentYear, 2, 31); // 31st March of this year
        } else {
            // Apr to Dec => Financial year started this year
            fromDate = new Date(currentYear, 3, 1); // 1st April of this year
            toDate = currentDate; // Today instead of March 31
            //toDate = new Date(currentYear + 1, 2, 31); // 31st March of next year
        }
    } else if (dateRange === 'last_financial_year') {
        // "Last Financial Year": From 1st April of last year to 31st March of the current year
        const currentYear = currentDate.getFullYear();
        const currentMonth = currentDate.getMonth();
        if (currentMonth < 3) {
            // Jan, Feb, or Mar => Previous Financial year was the year before
            fromDate = new Date(currentYear - 2, 3, 1); // 1st April of the year before last
            toDate = new Date(currentYear - 1, 2, 31); // 31st March of last year
        } else {
            // Apr to Dec => Previous Financial year is the one that ended recently
            fromDate = new Date(currentYear - 1, 3, 1); // 1st April of last year
            toDate = new Date(currentYear, 2, 31); // 31st March of this year
        }
    } else {
        // "Custom Date": Leave blank for manual input
        fromDate = '';
        toDate = '';
    }

    // Convert to ISO format, ensuring we handle UTC correctly
    function formatDateToISOString(date) {
        // Force the date into UTC (remove time zone effect)
        const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        return utcDate.toISOString().split('T')[0];  // Returns only the date part (YYYY-MM-DD)
    }

    // Update the input fields
    fromDateInput.value = fromDate ? formatDateToISOString(fromDate) : '';
    toDateInput.value = toDate ? formatDateToISOString(toDate) : '';

    if (dateRange === 'custom') {
        // Show the From Date and To Date inputs when 'Custom Date' is selected
        fromDateInput.closest('td').style.display = 'table-cell';
        toDateInput.closest('td').style.display = 'table-cell';
        fromDateLabel.closest('td').style.display = 'table-cell';
        toDateLabel.closest('td').style.display = 'table-cell';
    } else {
        // Hide the From Date and To Date inputs when something other than 'Custom Date' is selected
        fromDateInput.closest('td').style.display = 'none';
        toDateInput.closest('td').style.display = 'none';
        fromDateLabel.closest('td').style.display = 'none';
        toDateLabel.closest('td').style.display = 'none';
    }


}


function updateInvoiceDateRange() {
    const dateRange = document.getElementById('dateRange').value;
    const fromDateInput = document.getElementById('invoice_fromDate');
    const toDateInput = document.getElementById('invoice_toDate');
    const fromDateLabel = document.getElementById('fromDateLabel');
    const toDateLabel = document.getElementById('toDateLabel');
    const fromDateHidden = document.getElementById('invoice_fromDate_hiddenValue');
    const toDateHidden = document.getElementById('invoice_toDate_hiddenValue');

    const currentDate = new Date();
    let fromDate, toDate;

    if (dateRange === 'this_month') {
        // "This Month": From 1st day of current month to today
        fromDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        toDate = new Date();
    } else if (dateRange === 'last_month') {
        // "Last Month": From 1st to last day of the previous month
        fromDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
        toDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 0);
    } else if (dateRange === 'this_financial_year') {
        // "This Financial Year": From 1st April to 31st March
        const currentYear = currentDate.getFullYear();
        const currentMonth = currentDate.getMonth();
        if (currentMonth < 3) {
            // Jan, Feb, or Mar => Financial year started last year
            fromDate = new Date(currentYear - 1, 3, 1);
            toDate = new Date(currentYear, 2, 31);
        } else {
            // Apr to Dec => Financial year started this year
            fromDate = new Date(currentYear, 3, 1);
            toDate = new Date(currentYear + 1, 2, 31);
        }
    } else if (dateRange === 'last_financial_year') {
        // "Last Financial Year"
        const currentYear = currentDate.getFullYear();
        const currentMonth = currentDate.getMonth();
        if (currentMonth < 3) {
            // Jan, Feb, or Mar => Previous Financial year was the year before
            fromDate = new Date(currentYear - 2, 3, 1);
            toDate = new Date(currentYear - 1, 2, 31);
        } else {
            // Apr to Dec => Previous Financial year is the one that ended recently
            fromDate = new Date(currentYear - 1, 3, 1);
            toDate = new Date(currentYear, 2, 31);
        }
    } else {
        // "Custom Date": Leave blank for manual input
        fromDate = '';
        toDate = '';
    }

    // Convert to ISO format
    function formatDateToISOString(date) {
        const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        return utcDate.toISOString().split('T')[0];
    }

    // Update the input fields
    fromDateInput.value = fromDate ? formatDateToISOString(fromDate) : '';
    toDateInput.value = toDate ? formatDateToISOString(toDate) : '';
    
    // Update hidden fields
    if (fromDateHidden) fromDateHidden.value = fromDateInput.value;
    if (toDateHidden) toDateHidden.value = toDateInput.value;

    if (dateRange === 'custom') {
        // Show date inputs when 'Custom Date' is selected
        fromDateInput.closest('td').style.display = 'table-cell';
        toDateInput.closest('td').style.display = 'table-cell';
        fromDateLabel.closest('td').style.display = 'table-cell';
        toDateLabel.closest('td').style.display = 'table-cell';
    } else {
        // Hide date inputs for other selections
        fromDateInput.closest('td').style.display = 'none';
        toDateInput.closest('td').style.display = 'none';
        fromDateLabel.closest('td').style.display = 'none';
        toDateLabel.closest('td').style.display = 'none';
    }
}

// ── GL date range helpers ────────────────────────────────────────────────────
// Used by GL report pages — pre-fills from/to date inputs without hiding them.

// glSetPeriod(sel) — called via onchange="glSetPeriod(this)"
// The select must have data-from and data-to attributes with the target input IDs.
// For the "Month/Year" option, it also needs data-monthyear (wrapper element id to
// show/hide) and data-month/data-year (the two picker select ids) — see glSetMonthYear.
function glSetPeriod(sel) {
    const period   = sel.value;
    const fromId   = sel.dataset.from;
    const toId     = sel.dataset.to;
    const myWrapId = sel.dataset.monthyear;
    const monthId  = sel.dataset.month;
    const yearId   = sel.dataset.year;
    const today    = new Date();
    const yr = today.getFullYear();
    const mo = today.getMonth();

    function iso(d) {
        return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().split('T')[0];
    }

    if (myWrapId) {
        const wrap = document.getElementById(myWrapId);
        if (wrap) wrap.style.display = (period === 'month_year') ? '' : 'none';
    }

    let from, to;
    if (period === 'this_month') {
        from = new Date(yr, mo, 1);
        to   = today;
    } else if (period === 'last_month') {
        from = new Date(yr, mo - 1, 1);
        to   = new Date(yr, mo, 0);
    } else if (period === 'this_fy') {
        from = mo < 3 ? new Date(yr - 1, 3, 1) : new Date(yr, 3, 1);
        to   = today;
    } else if (period === 'last_fy') {
        if (mo < 3) {
            from = new Date(yr - 2, 3, 1);
            to   = new Date(yr - 1, 2, 31);
        } else {
            from = new Date(yr - 1, 3, 1);
            to   = new Date(yr, 2, 31);
        }
    } else if (period === 'month_year') {
        if (monthId && yearId) {
            const monthSel = document.getElementById(monthId);
            const yearSel  = document.getElementById(yearId);
            if (monthSel && monthSel.value === '') monthSel.value = String(mo);
            if (yearSel  && yearSel.value  === '') yearSel.value  = String(yr);
            glSetMonthYear(fromId, toId, monthId, yearId);
        }
        return;
    } else {
        return;
    }

    if (fromId) document.getElementById(fromId).value = iso(from);
    if (toId)   document.getElementById(toId).value   = iso(to);
}

// glSetMonthYear(fromId, toId, monthId, yearId) — called via onchange on the
// Month and Year pickers shown when Period is set to "Month/Year". Sets From/To
// to the first and last day of the selected month.
function glSetMonthYear(fromId, toId, monthId, yearId) {
    const month = parseInt(document.getElementById(monthId).value, 10);
    const year  = parseInt(document.getElementById(yearId).value, 10);
    if (isNaN(month) || isNaN(year)) return;

    function iso(d) {
        return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().split('T')[0];
    }

    const from = new Date(year, month, 1);
    const to   = new Date(year, month + 1, 0);
    document.getElementById(fromId).value = iso(from);
    document.getElementById(toId).value   = iso(to);
}

// glSetAsOf(sel) — for single-date views (Trial Balance, Balance Sheet)
// The select must have a data-target attribute with the target input ID.
function glSetAsOf(sel) {
    const period = sel.value;
    const asOfId = sel.dataset.target;
    const today  = new Date();
    const yr = today.getFullYear();
    const mo = today.getMonth();

    function iso(d) {
        return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().split('T')[0];
    }

    let dt;
    if (period === 'today') {
        dt = today;
    } else if (period === 'end_last_month') {
        dt = new Date(yr, mo, 0);
    } else if (period === 'end_this_fy') {
        dt = mo < 3 ? new Date(yr, 2, 31) : new Date(yr + 1, 2, 31);
    } else if (period === 'end_last_fy') {
        dt = mo < 3 ? new Date(yr - 1, 2, 31) : new Date(yr, 2, 31);
    } else {
        return;
    }

    if (asOfId) document.getElementById(asOfId).value = iso(dt);
}