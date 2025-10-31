
// Edit closing flow: Enable pump reading entries based on selected pumps in first tab.
// Also update price under the sub-header element
function doubleCheckReadingPumps(obj) {
    if(obj) {
        trackMenu(obj);
    }
    calculateReadingsAndSale();
    updatePriceOnReadingTab(true);
}


function calculateReadingsAndSale() {
    const readingsContainer = document.getElementById('new_readings').querySelectorAll('[id$=_sub_header]');
    readingsContainer.forEach(container => {
       const uniquePump = container.id.replace('_sub_header', '');
       if(!container.className.includes('-none')) {
           calculatePumpSale(uniquePump);
       }
    });
}

function calculateAll2TProducts(obj) {
    if(obj) {
        trackMenu(obj);
    }
    const products = document.getElementById('sales_2t').querySelectorAll('[id$=_sale]');
    products.forEach(product => {
        const productTag = product.id.replace('_sale', '');
        calculate2TSale(productTag);
    });
}

function calculateTestings(obj) {
    if(obj) {
        trackMenu(obj);
    }
    const products = document.getElementById('new_testing').querySelectorAll('[id^=testing-lts]');
    products.forEach(product => {
        const productTag = product.id.replace('testing-lts-', '');
        calculateTestingAmount(productTag);
    });
}

function calculateCashSaleTotal() {
    calculateTotal('cash-sale-');
}

function calculateCreditTotal() {
    calculateTotal('credit-');
}
function calculateDigitalSalesTotal() {
    calculateTotal('digital-sales-');
}

function calculateExpenseTotal() {
    calculateTotal('exp-');
}

function calculateExpensesAndDenoms(obj) {
    if(obj) {
        trackMenu(obj);
    }
    calculateExpenseTotal();
    calculateDenominations()
}

function calculateDigitalSalesAndTrackMenu(obj) {
    // if(obj) {
    //     trackMenu(obj);
    // }
    // calculateDigitalSalesTotal();
     setTimeout(() => {
        trackMenu(obj);
        calculateDigitalSalesTotal();
    }, 100);
}

// Validate closing tab prices before moving to next tab
function validateClosingTabPrices() {
    const priceInputs = document.querySelectorAll('#gasoline-prices input[type="number"]:not([type="hidden"])');
    let isValid = true;
    let emptyFields = [];
    
    priceInputs.forEach(input => {
        const value = parseFloat(input.value);
        if (!input.value || isNaN(value) || value <= 0) {
            isValid = false;
            input.classList.add('is-invalid');
            // Get the product name from the label
            const label = input.closest('.col').querySelector('label');
            if (label) {
                emptyFields.push(label.textContent.replace(' Rate', ''));
            }
        } else {
            input.classList.remove('is-invalid');
        }
    });
    
    if (!isValid) {
        showSnackbar(`Please enter valid prices for: ${emptyFields.join(', ')}`, 'warning', 4000);
    }
    
    return isValid;
}


function trackMenuWithName(tabName) {
    // If moving away from closing tab, validate prices first
    const activeTab = document.querySelector('.nav-link.active');
    if (activeTab && activeTab.id === 'closing_tab') {
        if (!validateClosingTabPrices()) {
            return; // Don't allow navigation if validation fails
        }
    }
    
    trackMenu(document.getElementById(tabName));
}

function trackMenu(obj) {
    const previousSaveFun = document.getElementById('currentTabForSave').value;   

    if(minimumRequirementForTabbing() || previousSaveFun === 'saveClosing' || previousSaveFun ==='saveDecantHeader') {        
        const callSaveFunctionForMenu = getSaveFunction(obj.id);        
        if (previousSaveFun === callSaveFunctionForMenu) {
            setSaveFunction(obj.id);

            // Initialize reading tab price when navigating to it via Next button
            if (obj.id === 'reading_tab') {
                setTimeout(() => updatePriceOnReadingTab(false), 100);
            }
            

            return;
        }
        if (previousSaveFun === 'NoSaveClick') {
            document.getElementById('currentTabForSave').value = callSaveFunctionForMenu;

             // Initialize reading tab price when navigating to it via Next button
            if (obj.id === 'reading_tab') {
                setTimeout(() => updatePriceOnReadingTab(false), 100);
            }

        } else {            
            ajaxLoading('d-md-block');
            window[previousSaveFun]().then((data) => {
                if (data) {
                    setSaveFunction(obj.id);
                    activateTabDirectly(obj);
                    //obj.click();
                    // Initialize reading tab price when navigating to it via Next button
                    if (obj.id === 'reading_tab') {
                        setTimeout(() => updatePriceOnReadingTab(false), 100);
                    }


                }
                ajaxLoading('d-md-none');
            });
        }
    }
}


// Add this helper function
function activateTabDirectly(tabElement) {
    // Remove active from all tab panes and nav links
    document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.remove('active', 'show');
    });
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
    });
    
    // Activate target tab pane
    const targetId = tabElement.getAttribute('href');
    const targetPane = document.querySelector(targetId);
    if (targetPane) {
        targetPane.classList.add('active', 'show');
    }
    
    // Activate nav link
    tabElement.classList.add('active');
}

function setSaveFunction(clickedTab) {
    if(clickedTab) {
        document.getElementById('currentTabForSave').value = getSaveFunction(clickedTab);
    }
}

function getSaveFunction(clickedTab) {
    let saveFunctionName = undefined;
    const isFreezedRecordObj = document.getElementById('freezedRecord_hiddenValue');
    if(isFreezedRecordObj) {
        saveFunctionName = 'NoSaveClick';
        switch (clickedTab) {
            case 'cash_sales_tab':
            case 'credit_sales_tab':
            case 'digital_sales_tab':
            case 'closing_tab':
            case 'reading_tab':
            case 'sales_2t_tab':
            case 'expenses_tab':
            case 'summary_tab':
            case 'decantheader_tab':
            case 'decantlines_tab':
            case 'attendance_tab':
                saveFunctionName = 'NoSaveClick';   // dummy value
                break;
        }
    } else {
        switch (clickedTab) {
            case 'closing_tab':
                saveFunctionName = 'saveClosing';
                break;
            case 'reading_tab':
                saveFunctionName = 'saveReadings';
                break;
            case 'sales_2t_tab':
                saveFunctionName = 'save2TProducts';
                break;
            case 'cash_sales_tab':
                saveFunctionName = 'saveCashSales';
                break;
            case 'credit_sales_tab':
                saveFunctionName = 'saveCreditSales';
                break;
            case 'digital_sales_tab':
                saveFunctionName = 'saveDigitalSales';
                break;    
            case 'expenses_tab':
                saveFunctionName = 'saveExpensesAndDenoms';
                break;
            case 'summary_tab':
                saveFunctionName = 'NoSaveClick';   // dummy value
                break;
            case 'decantheader_tab':
                saveFunctionName = 'saveDecantHeader';
                break;
            case 'decantlines_tab':
                saveFunctionName = 'saveDecantLines';
                break;
            case 'attendance_tab':
                saveFunctionName = 'saveAttendance';   // dummy value
                break;
        }
    }

    return saveFunctionName;
}

function calculateAllInOnePlace() {
    return new Promise((resolve, reject) => {
        if(doubleCheckReadingPumps() ||
        calculateAll2TProducts() ||
        calculateCashSaleTotal() ||
        calculateCreditTotal() ||
        calculateExpensesAndDenoms()) {
            resolve(true);
        } else {
            resolve(false);
        }
    });
}

function populateSummaryFn(isFreezedRecord) {
    if(isFreezedRecord) {
        return populateSummary();
    } else {
        calculateCashflowDebitTotal();
        calculateCashflowCreditTotal();
        calculateDenominations();
    }
}

function disableOtherTabs(tabName) {
    switch(tabName) {
        case 'closing_tab':
            disableLink(document.getElementById('reading_tab'));
            disableLink(document.getElementById('sales_2t_tab'));
            disableLink(document.getElementById('cash_sales_tab'));
            disableLink(document.getElementById('credit_sales_tab'));
            disableLink(document.getElementById('digital_sales_tab'));
            disableLink(document.getElementById('expenses_tab'));
            disableLink(document.getElementById('summary_tab'));
            disableLink(document.getElementById('attendance_tab'));
            break;
        case 'expenses_tab':
            disableLink(document.getElementById('closing_tab'));
            disableLink(document.getElementById('reading_tab'));
            disableLink(document.getElementById('sales_2t_tab'));
            disableLink(document.getElementById('cash_sales_tab'));
            disableLink(document.getElementById('credit_sales_tab'));
            disableLink(document.getElementById('digital_sales_tab'));
            disableLink(document.getElementById('summary_tab'));
            disableLink(document.getElementById('attendance_tab'));
            break;
        case 'decantheader_tab':
            disableLink(document.getElementById('decantlines_tab'));
            disableLink(document.getElementById('summary_tab'));
            break;
    }
}

function enableOtherTabs(tabName) {
    switch(tabName) {
        case 'closing_tab':
            enableLink(document.getElementById('reading_tab'));
            enableLink(document.getElementById('sales_2t_tab'));
            enableLink(document.getElementById('cash_sales_tab'));
            enableLink(document.getElementById('credit_sales_tab'));
            enableLink(document.getElementById('digital_sales_tab'));
            enableLink(document.getElementById('expenses_tab'));
            enableLink(document.getElementById('summary_tab'));
            enableLink(document.getElementById('attendance_tab'));
            break;
        case 'expenses_tab':
            enableLink(document.getElementById('closing_tab'));
            enableLink(document.getElementById('reading_tab'));
            enableLink(document.getElementById('sales_2t_tab'));
            enableLink(document.getElementById('cash_sales_tab'));
            enableLink(document.getElementById('credit_sales_tab'));
            enableLink(document.getElementById('digital_sales_tab'));
            enableLink(document.getElementById('summary_tab'));
            enableLink(document.getElementById('attendance_tab'));
            break;
        case 'decantheader_tab':
            enableLink(document.getElementById('decantlines_tab'));
            enableLink(document.getElementById('summary_tab'));
            break;

    }
}

function changeEBflag(prefix,rownum){
    if(document.getElementById(prefix+'eb_' + rownum).checked){
        document.getElementById(prefix+'eb_' + rownum).value="Y"
    }
    else{
        document.getElementById(prefix+'eb_' + rownum).value="N"
    }

}

function changeHaltflag(){
    if(document.getElementById('halt_chk').checked){
        document.getElementById('halt_chk').value="Y"
    }
    else{
        document.getElementById('halt_chk').value="N"
    }

}

function disableCreditInput(rowNum){
    const debitVal = parseFloat(document.getElementById('debitamount_' + rowNum).value || 0);
    const creditField = document.getElementById('creditamount_' + rowNum);
    creditField.disabled = debitVal > 0;
}

function disableDebitInput(rowNum){
    const creditVal = parseFloat(document.getElementById('creditamount_' + rowNum).value || 0);
    const debitField = document.getElementById('debitamount_' + rowNum);
    debitField.disabled = creditVal > 0;
}

function validCreditDebit() {
   

    for (let i = 0; i < rowCounter; i++) {
        const creditField = document.getElementById(`creditamount_${i}`);
        const debitField = document.getElementById(`debitamount_${i}`);
        const row = document.getElementById(`banktransaction-table-row-${i}`);

        // Skip rows that don't exist (e.g., deleted ones)
        if (!creditField || !debitField) continue;

        const cr = parseFloat(creditField.value || 0);
        const dr = parseFloat(debitField.value || 0);

        if (cr === 0 && dr === 0) {
            alert(`Row ${i + 1} is incomplete. Enter credit or debit, or remove the row.`);
            if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return false;
        }
    }

    return true;
    }


function changeCheckValue(prefix,rownum){

    if(document.getElementById(prefix + rownum).checked){
        document.getElementById(prefix+ rownum).value="Y"
    }
    else{
        document.getElementById(prefix+ rownum).value="N"
    }

}

function changeClosedValue(prefix,rownum){
    if(document.getElementById(prefix + rownum).checked){
        document.getElementById(prefix+ rownum).value="Y"
    }
    else{
        document.getElementById(prefix+ rownum).value="N"
    }
}
