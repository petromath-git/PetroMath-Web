function updateDateRange() {
    const dateRange = document.getElementById('dateRange').value;
    const fromDateInput = document.getElementById('fromclosingDate');
    const toDateInput = document.getElementById('toclosingDate');
    const fromDateLabel = document.getElementById('fromDateLabel');
    const toDateLabel = document.getElementById('toDateLabel');

    const currentDate = new Date();
    let fromDate, toDate;

    if (dateRange === 'this_month') {
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