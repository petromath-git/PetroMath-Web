//const { config } = require("chai");

var showClassName = 'd-md-block';
var hideClassName = 'd-md-none';
var toFixedValue = 2

// Add new flow: GET page for new closing
// Workaround: auto submit to GET/POST of new-closing !
// TODO: later after more investigation
function getNewClosingPage() {
    document.getElementById('get-new-closing').submit();
}




// Add new flow: Enable pump reading entries based on selected pumps in first tab.
function enableReadingPumps(currentObject) {
    const pumpCode = currentObject.value;
    const subHeader = document.getElementById("f_" + pumpCode + "_sub_header");
    if (currentObject.checked) {
        subHeader.className = 'sub-header d-md-block col-3';
    } else {
        subHeader.className = 'sub-header d-md-none col-3';
    }
}

// Add new flow: Enable/disable row(pump reading for 'before 6 AM') based on multi-price selection in first tab.
function updateReadingPumps(obj) {
    if (obj.checked) {
        document.getElementById('MS-pump-reading').className = 'sub-header d-md-block';
        document.getElementById('HSD-pump-reading').className = 'sub-header d-md-block';
        document.getElementById('XMS-pump-reading').className = 'sub-header d-md-block';
    } else {
        document.getElementById('MS-pump-reading').className = 'sub-header d-md-none';
        document.getElementById('HSD-pump-reading').className = 'sub-header d-md-none';
        document.getElementById('XMS-pump-reading').className = 'sub-header d-md-none';
    }
}

// Add new flow: Update price(from first tab) to each pump instance reading.
function updateProductPrices(obj) {
    trackMenu(obj);
    //updatePriceOnReadingTab();
    updatePriceOnReadingTabv1();
}

// Add new/edit flow: Update default expense amount on select.
function populateDefaultExpenseAmt(obj) {
    const requiredExpenses = ['Others', 'Suspense', 'Self'];
    const expenseData = JSON.parse(obj.value);
    const rowNum = obj.id.replace('exp-expense-', '');
    const expenseAmt = document.getElementById('exp-amt-' + rowNum);
    const texpenseId = document.getElementById('exp-' + rowNum + '_hiddenId');
    if (!texpenseId.value || !parseInt(texpenseId.value) > 0) {
        expenseAmt.value = expenseData.defaultAmt;
    }
    if (requiredExpenses.includes(expenseData.expenseName)) {
        document.getElementById('exp-notes-' + rowNum).setAttribute('required', 'true');
    } else {
        document.getElementById('exp-notes-' + rowNum).removeAttribute('required');
    }
    calculateExpenseTotal();
}

// Add new flow: Calculate sale to each pump instance reading.
function calculatePumpSale(uniquePumpId) {
    const pumpClosing = document.getElementById(uniquePumpId + 'pump_closing');
    const pumpOpening = document.getElementById(uniquePumpId + 'pump_opening');
    const pumpTesting = document.getElementById(uniquePumpId + 'pump_testing');
    if (parseFloat(pumpClosing.value) > parseFloat(pumpOpening.value)) {
        const pricePerLitre = parseFloat(document.getElementById(uniquePumpId + '_price').value);
        const sale = pumpClosing.value - pumpOpening.value - pumpTesting.value;
        if (sale >= 0) {
            document.getElementById(uniquePumpId + 'pump_sale').value = formatCurrencies(sale, toFixedValue);
            document.getElementById(uniquePumpId + 'pump_amount').value = formatCurrencies(sale * pricePerLitre, toFixedValue);
        } else {
            document.getElementById(uniquePumpId + 'pump_sale').value = 0;
            document.getElementById(uniquePumpId + 'pump_amount').value = 0;
        }
    } else {
        document.getElementById(uniquePumpId + 'pump_sale').value = 0;
        document.getElementById(uniquePumpId + 'pump_amount').value = 0;
    }
}

// Add new flow: Hide pump reading and delete from backend
function hideAndDeleteReadingPump(elementId) {
    const deleteObj = document.getElementById(elementId.replace('_sub_header', '_hiddenId'));
    deleteAjax('remove-reading', deleteObj.value, elementId, 'col-3 d-md-none');
}

function updatePriceOnReadingTab(isOnLoad) {
    // Get the select element and its current value
    const pumpSelect = document.getElementById("reading-pump-name");
    const pumpName = pumpSelect.value;

    if (pumpName.startsWith("HSD")) {
        document.getElementById("reading-price").value = document.getElementById("rate_hsdrate").value;
    } else if (pumpName.startsWith("XMS")) {
        document.getElementById("reading-price").value = document.getElementById("rate_xmsrate").value;
    } else if (pumpName.startsWith("MS")) {
        document.getElementById("reading-price").value = document.getElementById("rate_msrate").value;
    } else {
        document.getElementById("reading-price").value = "";
    }

    // Reset the selection to the first option if onLoad is true
    if (isOnLoad) {
        pumpSelect.selectedIndex = 0;
    }
}



//Price change based on selection version 1..
function updatePriceOnReadingTabv1(isOnLoad) {
    
    
    const selectElement = document.getElementById("reading-pump-name");
    const pumpSelectedOption = selectElement.selectedOptions[0];
    const pumpSelectedOptionId = pumpSelectedOption.id;
    const elementId = pumpSelectedOptionId.replace("pump-", "rate_");; // Construct the full ID
    document.getElementById("reading-price").value = document.getElementById(elementId).value;
    console.log(elementId);
    console.log('elementId'+ document.getElementById(elementId).value);
    console.log('rate_HSD' +document.getElementById('rate_HSD').value);
    if (isOnLoad) {
        pumpName.selectedIndex = "0";
    }
}

// Add new flow: Re-add pump reading to UI
function showReadingPump() {
    const pumpName = document.getElementById("reading-pump-name").value;
    const currency = document.getElementById('currency_hiddenValue').value;
    if (!document.getElementById("reading-price").value || document.getElementById("reading-price").value<=0)
    {
     alert(`Product Price cannot be less than 0 for ${pumpName}`);   
    }
    else if (document.getElementById("f_" + pumpName + "_sub_header").className == 'col-3 d-md-none') {
        document.getElementById("f_" + pumpName + "_sub_header").className = 'col-3 d-md-block';
        document.getElementById("f_" + pumpName + "_sub_header_price").innerHTML = currency + document.getElementById("reading-price").value;
        document.getElementById("f_" + pumpName + "_price").value = document.getElementById("reading-price").value;
    } else if (document.getElementById("s_" + pumpName + "_sub_header").className == 'col-3 d-md-none') {
        document.getElementById("s_" + pumpName + "_sub_header").className = 'col-3 d-md-block';
        document.getElementById("s_" + pumpName + "_sub_header_price").innerHTML = currency + document.getElementById("reading-price").value;
        document.getElementById("s_" + pumpName + "_price").value = document.getElementById("reading-price").value;
    } else {
        alert("Same pump cannot be added more than 2 times");
    }
}


// Add new flow: Calculate sale to 2T products.
function calculate2TSale(product2TName) {
    const given2T = document.getElementById(product2TName + '_given');
    const remain2T = document.getElementById(product2TName + '_remain');
    if (parseFloat(given2T.value) > parseFloat(remain2T.value)) {
        const product2TPrice = parseFloat(document.getElementById(product2TName + '-rate').value);
        if (product2TPrice > 0) {
            const sale = (given2T.value - remain2T.value);
            document.getElementById(product2TName + '_sale').value = formatCurrencies(sale, toFixedValue);
            document.getElementById(product2TName + '_amount').value = formatCurrencies((sale * product2TPrice), toFixedValue);
        }
    } else {
        document.getElementById(product2TName + '_sale').value = 0;
        document.getElementById(product2TName + '_amount').value = 0;
    }
}

// Add new page: Cash sale - Dom elements to show product price(s) based on product code
function cashSaleOrCreditUpdateProductTypePrices(obj, prefix) {
    trackMenu(obj);
    const rowsCnt = document.getElementById(prefix + 'table').rows.length;
    for (let i = 0; i < rowsCnt; i++) {
        if (document.getElementById(prefix + 'price-' + i)) {
            calculateCashOrCreditQuantity(prefix, i);
        }
    }
}

// Add new page: Internally called for both cash and credit sale to update all product price(s)
// Also internally calls 'showOrHideProductPrices..' to specific product selected in cash/credit sales page
function updateAllProductPricesForCashOrCreditSales(rowNo, cashOrCreditRowPrefix, selectedValue) {
    const priceElements = document.getElementById("rate_msrate").value;
    document.getElementById(cashOrCreditRowPrefix + rowNo).value = priceElements
}

// Add new page: In cash/credit sale - if user changes product name, show/hide specific price
function creditOrSaleUpdateProductTypePrices(obj, rowNo, cashOrCreditRowPrefix) {
    const productId = obj.options[obj.selectedIndex].value;
    const productName = obj.options[obj.selectedIndex].text;
    showOrHideProductPricesForCashOrCreditSales(rowNo, cashOrCreditRowPrefix, productId, productName);
}

function toggleCreditTypes(obj, rowNo, creditRowPrefix, creditTypes) {
    creditTypes.forEach((type) => {
        let creditTypeSelect = document.getElementById(creditRowPrefix + type + '-' + rowNo);
        if (creditTypeSelect) {
            if (type === obj.value) {
                creditTypeSelect.className = "form-control " + showClassName;
                updateHiddenCreditId(creditTypeSelect, creditRowPrefix, rowNo);
            } else {
                creditTypeSelect.className = hideClassName;
            }
        }
    });
}

function updateHiddenCreditId(obj, creditRowPrefix, rowNo) {
    let hiddenObj = document.getElementById(creditRowPrefix + 'companyName_' + rowNo);
    if (hiddenObj) {
        hiddenObj.value = obj.options[obj.selectedIndex].text;
    }
    hiddenObj = document.getElementById(creditRowPrefix + 'companyId_' + rowNo);
    if (hiddenObj) {
        hiddenObj.value = obj.value;
    }
}

// Add new page: Internally & externally for both cash and credit sale to show/hide of specific product price(s)
// Calls calculation of sale amount too
function showOrHideProductPricesForCashOrCreditSales(rowNo, cashOrCreditRowPrefix, productId, productName) {
    let productPrice = document.getElementById("rate_" + productId).value;
    if (productName === 'MS' || productName === 'HSD' || productName === 'XMS') {
        productPrice = document.getElementById("rate_" + productName.toLowerCase() + 'rate').value;
        let pumpNames = document.getElementById('reading-pump-name');
        for (let i = 0; i < pumpNames.length; i++) {
            let currentOption = pumpNames.options[i].value;
            if (currentOption.startsWith(productName)) {
                let readingData = document.getElementById('f_' + currentOption + '_price');
                if (readingData) {
                    if (readingData.parentNode.className.indexOf('d-md-block') > -1) {
                        productPrice = readingData.value;
                        break;
                    }
                } else {
                    readingData = document.getElementById('s_' + currentOption + '_price');
                    if (readingData.parentNode.className.indexOf('d-md-block') > -1) {
                        productPrice = readingData.value;
                        break;
                    }
                }

            }
        }
        document.getElementById(cashOrCreditRowPrefix + "price-" + rowNo).readOnly = false;
    } else {
        document.getElementById(cashOrCreditRowPrefix + "price-" + rowNo).readOnly = true;
    }
    document.getElementById(cashOrCreditRowPrefix + "price-" + rowNo).value = productPrice
    calculateCashOrCreditSale(cashOrCreditRowPrefix, rowNo)
}

// Add new page: Calculate cash/credit Quantity
function calculateCashOrCreditQuantity(prefix, rowNo) {
    const amt = parseFloat(document.getElementById(prefix + 'amt-' + rowNo).value);
    if (parseFloat(amt) > 0) {
        const price = parseFloat(document.getElementById(prefix + 'price-' + rowNo).value);
        const priceDiscount = parseFloat(document.getElementById(prefix + 'discount-' + rowNo).value);
        const qty = (amt / (price - priceDiscount)).toFixed(3);
        ;
        document.getElementById(prefix + 'qty-' + rowNo).value = qty;
    } else {
        document.getElementById(prefix + 'qty-' + rowNo).value = 0;
    }
    calculateTotal(prefix);
}

// Add new page: Calculate cash/credit sale
function calculateCashOrCreditSale(prefix, rowNo) {
    const qty = parseFloat(document.getElementById(prefix + 'qty-' + rowNo).value);
    if (parseFloat(qty) > 0) {
        const price = parseFloat(document.getElementById(prefix + 'price-' + rowNo).value);
        const priceDiscount = parseFloat(document.getElementById(prefix + 'discount-' + rowNo).value);
        const sale = ((price - priceDiscount) * qty).toFixed(3);
        document.getElementById(prefix + 'amt-' + rowNo).value = sale;
    } else {
        document.getElementById(prefix + 'amt-' + rowNo).value = 0;
    }
    calculateTotal(prefix);
}

// Add new/edit page: Calculate total cash/credit/testing sale
function calculateTotal(tableNamePrefix) {
    if (document.getElementById(tableNamePrefix + 'table')) {
        const rowsCnt = document.getElementById(tableNamePrefix + 'table').rows.length;
        let totalSales = 0;
        for (let i = 0; i < rowsCnt; i++) {
            const tableRowObj = document.getElementById(tableNamePrefix + 'table-row-' + i);
            if (tableRowObj && !(tableRowObj.className === 'd-md-none')) {
                const amtObject = document.getElementById(tableNamePrefix + 'amt-' + i);
                if (amtObject && amtObject.value) {
                    totalSales += currenciesAsFloat(amtObject.value);
                }
            }
        }
        document.getElementById(tableNamePrefix + 'total').value = formatCurrencies(totalSales, toFixedValue);
    }
}

//- Add new page: Dom elements to delete row dynamically on remove click
function hideRow(trId, uri, funToRecalculateTotal) {
    console.log(trId);
    let deleteObj = document.getElementById(trId.replace('table-row-', '') + '_hiddenId');
    console.log(deleteObj);
    if (deleteObj) {
        deleteAjax(uri, deleteObj.value, trId, hideClassName).then(data => {
            if (data) {
                if (funToRecalculateTotal) {
                    funToRecalculateTotal();
                }
            }
        });
    } else {
        postDeleteAction(trId, hideClassName);
    }
}

function reloadPage(trId) {
    let row = document.getElementById(trId);
    if (row) {
        row.style.display = 'none';
        console.log('Row hidden successfully:', trId);
        // Reload the page after hiding the row
        window.location.reload();
    } else {
        console.warn('Row not found:', trId);
    }
}

//- Add new page: Dom elements to add users dynamically on button click
function showAddedRow(prefix, funToRecalculateTotal) {
    const userRowsCnt = document.getElementById(prefix + '-table').rows.length;
    let isEnabled = false;
    for (let i = 0; i < userRowsCnt; i++) {
        const tableRowToEnable = document.getElementById(prefix + '-table-row-' + i);
        if (tableRowToEnable && tableRowToEnable.className === 'd-md-none') {
            tableRowToEnable.className = '';
            if (prefix === 'credit' || prefix === 'cash-sale') {
                let obj = document.getElementById(prefix + '-product-' + i);
                creditOrSaleUpdateProductTypePrices(obj, i, prefix + '-')
            }
            isEnabled = true;
            break;
        }
    }
    if (funToRecalculateTotal) {
        funToRecalculateTotal();
    }
    if (!isEnabled) {
        window.alert("Max allowed is reached, configure the max value in future.")
    }
}

function showExpenseAddedRow(prefix, funToRecalculate) {
    const defaultAmt = document.getElementById('firstExpenseDefaultAmt_hiddenValue').value;
    const userRowsCnt = document.getElementById(prefix + '-table').rows.length;
    let isDefaultAdded = false;
    for (let i = 0; i < userRowsCnt; i++) {
        const tableRow = document.getElementById(prefix + '-table-row-' + i);
        if (tableRow && tableRow.className === 'd-md-none' && !isDefaultAdded) {
            document.getElementById(prefix + '-amt-' + i).value = defaultAmt;
            isDefaultAdded = true;
        }
    }
    showAddedRow(prefix, funToRecalculate);
}

// Add new flow: Calculate denominations total using denominationValues(JSON data - array of {id: <rs.value / cash / coins>, value: <label>}
function calculateDenominations() {
    let total = 0;
    let jsonElement = document.getElementById('denominationValuesJson_hiddenValue');
    if (jsonElement) {
        const denominationValues = JSON.parse(jsonElement.value);
        denominationValues.forEach((denomination) => {
            const element = document.getElementById('denom-' + denomination.id + '-cnt');
            let denominationCnt = 0;
            if (element && element.value) {
                denominationCnt = parseFloat(element.value);
            }
            if (denomination.id == 0) {
                total += denominationCnt;
            } else {
                total += denominationCnt * denomination.id;
            }
        });
        document.getElementById('denominations_total').value = formatCurrencies(total, toFixedValue);
    }
}

//- Summary page: Iterate summary labels having 'v-' prefix for div tabs
//- then iterate for elements with 'val-' prefix to populate value
//- some of the elements require text values instead of value of the element e.g. cashier (requires name instead of id)
//- iterate through elements having 'vis-' prefix to check for visibility in summary page
function populateSummary(obj) {
    calculateAllInOnePlace().then((data) => {
        let hsd_total = 0, ms_total = 0, xms_total = 0;
        if (obj) {
            trackMenu(obj);
        }
        getExcessShortage(document.getElementById("closing_hiddenId").value);
        const elements = document.getElementById("summary-div").querySelectorAll('[id^=v-]');
        for (let i = 0; i < elements.length; i++) {

            const labels = elements[i].querySelectorAll('[id^=val-]');
            for (let j = 0; j < labels.length; j++) {
                const getValueFromLabelId = labels[j].id.replace("val-", "");
                labels[j].textContent = document.getElementById(getValueFromLabelId) ? document.getElementById(getValueFromLabelId).value : "";

                if (getValueFromLabelId.endsWith("pump_amount")) {
                    let value = document.getElementById(getValueFromLabelId) ? document.getElementById(getValueFromLabelId).value : 0;
                    if (getValueFromLabelId.indexOf("_MS") >= 0) {
                        ms_total += currenciesAsFloat(value);
                    } else if (getValueFromLabelId.indexOf("_HSD") >= 0) {
                        hsd_total += currenciesAsFloat(value);
                    } else if (getValueFromLabelId.indexOf("_XMS") >= 0) {
                        xms_total += currenciesAsFloat(value);
                    }
                }
            }

            const dateValues = elements[i].querySelectorAll('[id^=valDate-]');
            for (let j = 0; j < dateValues.length; j++) {
                const getValueFromLabelId = dateValues[j].id.replace("valDate-", "h_")
                dateValues[j].textContent = document.getElementById(getValueFromLabelId).value;
            }

            const texts = elements[i].querySelectorAll('[id^=valText-]');
            for (let j = 0; j < texts.length; j++) {
                const getTextValueFromLabelId = texts[j].id.replace("valText-", "");
                const getElement = document.getElementById(getTextValueFromLabelId);
                if (getElement) {
                    if (getElement.tagName === 'SELECT') {
                        if (getElement.selectedIndex > -1) {
                            texts[j].textContent = getElement.options[getElement.selectedIndex].text;
                        }
                    } else {
                        texts[j].textContent = document.getElementById(getTextValueFromLabelId).textContent;
                    }
                }
            }

            const divsToHideOrShow = elements[i].querySelectorAll('[id^=vis-]');
            for (let j = 0; j < divsToHideOrShow.length; j++) {
                const getDivFromLabelId = divsToHideOrShow[j].id.replace("vis-", "");
                if (document.getElementById(getDivFromLabelId)) {
                    if (getDivFromLabelId.endsWith("_sub_header")) {
                        divsToHideOrShow[j].className = document.getElementById(getDivFromLabelId).className + " col-3";
                    } else {
                        divsToHideOrShow[j].className = document.getElementById(getDivFromLabelId).className;
                    }
                }
            }
        }
        document.getElementById("MS_pump_amount").textContent = formatCurrencies(ms_total, toFixedValue);
        document.getElementById("HSD_pump_amount").textContent = formatCurrencies(hsd_total, toFixedValue);
        document.getElementById("XMS_pump_amount").textContent = formatCurrencies(xms_total, toFixedValue);
    });
}

//- Add new page: Clear values on remove button
function defaultInputValues(inputDiv) {
    // query all input elements
    let elements = document.getElementById(inputDiv).getElementsByTagName("input:not([type='hidden'])");
    for (let i = 0; i < elements.length; i++) {
        if (elements[i].value && isIncludedToDefaultValue(elements[i].id)) {
            elements[i].value = elements[i].defaultValue;
            console.log(elements[i] + "value" + elements[i].defaultValue);
        } else {
            elements[i].value = '';
        }
    }

    // query all hidden elements
    elements = document.getElementById(inputDiv).querySelectorAll('[type="hidden"]');
    for (let i = 0; i < elements.length; i++) {
        if (elements[i].value && !elements[i].id.endsWith("_pumpId")) {
            elements[i].value = '';
        }
    }

    // query all select elements
    elements = document.getElementById(inputDiv).getElementsByTagName("select");
    for (let i = 0; i < elements.length; i++) {
        elements[i].selectedIndex = 0;
    }

    // query all textarea elements
    elements = document.getElementById(inputDiv).getElementsByTagName('textarea');
    for (let i = 0; i < elements.length; i++) {
        if (elements[i].value) {
            elements[i].value = '';
        }
    }

    elements = document.getElementById(inputDiv).querySelectorAll('[type="checkbox"]')
    for (let i = 0; i < elements.length; i++) {
        if (elements[i].value) {
            elements[i].value = 'N';
        }
    }

    // query all datetime-local elements
    elements = document.getElementById(inputDiv).querySelectorAll('[type="datetime-local"]');
    for (let i = 0; i < elements.length; i++) {
        if (elements[i].value) {
            elements[i].value = '';
        }
    }

    // query all required elements
    elements = document.getElementById(inputDiv).querySelectorAll('[required]');
    for (let i = 0; i < elements.length; i++) {
        if (elements[i].id.includes("tankReceipts-amt") || elements[i].id.includes("tankReceipts-opening_dip") || elements[i].id.includes("tankReceipts-closing_dip")) {
            if (elements[i].value) {
                elements[i].value = 0;
            }
        }
    }
    for (let i = 0; i < elements.length; i++) {
        if (elements[i].className) {
            elements[i].className = elements[i].className.replace('is-invalid', '');
        }
    }
}

function isIncludedToDefaultValue(id) {
    let isSetDefaultValue = false;
    const idSubstringsToExclude = ['pump_closing', 'pump_opening', '_pumpId'];
    idSubstringsToExclude.forEach((substring) => {
        if (id.includes(substring)) {
            isSetDefaultValue = true;
        }
    });
    return isSetDefaultValue;
}

// Add new page - add closings to DB via ajax
function saveClosing() {
    return new Promise((resolve, reject) => {
        const currentDiv = 'new_closing';
        const currentTab = 'closing_tab';
        validateDivTabPromise(currentDiv, currentTab)
            .then((data) => {
                if (data) {
                    enableOtherTabs('closing_tab');
                    const tabToActivate = 'attendance_tab';
                    const hiddenTag = 'closing';
                    const user = JSON.parse(document.getElementById("user").value);
                    let newClosingData = [], updateClosingData = [], newHiddenFieldsArr = [];
                    const hiddenIdObj = document.getElementById(hiddenTag + '_hiddenId');
                    if (hiddenIdObj && parseInt(hiddenIdObj.value) > 0) {
                        updateClosingData.push(formClosing(hiddenIdObj.value, user));
                    } else {
                        newClosingData.push(formClosing(undefined, user));
                        newHiddenFieldsArr.push(hiddenTag);
                    }
                    console.log('New closing data ' + JSON.stringify(newClosingData));
                    console.log('Update closing data ' + JSON.stringify(updateClosingData));
                    postAjaxNew('new-closing', newClosingData, updateClosingData, tabToActivate, currentDiv, newHiddenFieldsArr, 'closing_id').then(data => {
                        resolve(data);
                    });
                } else {
                    disableOtherTabs('closing_tab');
                    resolve(false);
                }
            });
    });
}

function formClosing(closingId, user) {
    return {
        'closing_id': closingId,
        'closer_id': user.Person_id,
        'cashier_id': document.getElementById('cashierId').value,
        'location_code': user.location_code,
        'closing_date': document.getElementById('cashierDate').value,
        'cash': document.getElementById('cashGiven').value,
        'notes': document.getElementById('notes').value,
        'created_by': user.User_Name,
        'updated_by': user.User_Name,
    };
}

// Add new page - add readings to DB via ajax
function saveReadings() {
    return new Promise((resolve, reject) => {
        const readingTag = '_readings';
        const currentDiv = 'new_readings';
        const tabToActivate = 'sales_2t_tab';
        const pumps = document.getElementById(currentDiv).querySelectorAll('[id$=' + readingTag + ']:not([type="hidden"])');
        let newReadings = [], updateReadings = [], newHiddenFieldsArr = [];
        const user = JSON.parse(document.getElementById("user").value);
        pumps.forEach((pump) => {
            const pumpId = pump.id.replace(readingTag, '');
            const headerObj = document.getElementById(pumpId + '_sub_header');
            if (headerObj.className.includes('-block')) {
                const saleObj = document.getElementById(pumpId + 'pump_sale');
                const hiddenIdObj = document.getElementById(pumpId + '_hiddenId');
                if (hiddenIdObj.value && parseInt(hiddenIdObj.value) > 0) {
                    // Scenario: Where user clears the value to '0', so just update the data in DB
                    updateReadings.push(formReading(hiddenIdObj.value, pumpId, user));
                } else {
                    // ignore sale as 0, still record the data
                    newReadings.push(formReading(undefined, pumpId, user));
                    newHiddenFieldsArr.push(pumpId);
                }
            }
        });
        console.log('New readingData ' + JSON.stringify(newReadings));
        console.log('Update readingData ' + JSON.stringify(updateReadings));
        postAjaxNew('new-readings', newReadings, updateReadings, tabToActivate, currentDiv, newHiddenFieldsArr, 'reading_id')
            .then((data) => {
                resolve(data);
            });
        if (newReadings.length == 0 && updateReadings.length == 0) {
            resolve(true);      // tab click handled in trackMenu()
        }
    });
}

function formReading(readingId, pumpId, user) {
    return {
        'reading_id': readingId,
        'closing_id': document.getElementById('closing_hiddenId').value,
        'pump_id': document.getElementById(pumpId + '_pumpId').value,
        'opening_reading': document.getElementById(pumpId + 'pump_opening').value,
        'closing_reading': document.getElementById(pumpId + 'pump_closing').value,
        'price': document.getElementById(pumpId + '_price').value,
        'testing': document.getElementById(pumpId + 'pump_testing').value,
        'created_by': user.User_Name,
        'updated_by': user.User_Name
    };
}

function save2TProducts() {
    return new Promise((resolve, reject) => {
        const currentDiv = 'sales_2t';
        const tabToActivate = 'cash_sales_tab';
        const productsSale = document.getElementById(currentDiv).querySelectorAll('[id$=_sale]');
        let new2TProducts = [], update2TProducts = [], newHiddenFieldsArr = [];
        const user = JSON.parse(document.getElementById("user").value);
        productsSale.forEach((sale) => {
            const product2TTag = sale.id.replace('_sale', '');
            const hiddenIdObj = document.getElementById(product2TTag + '_hiddenId');
            if (sale.value && parseFloat(sale.value) > 0 || hiddenIdObj && parseInt(hiddenIdObj.value) > 0) {
                if (hiddenIdObj.value && parseInt(hiddenIdObj.value) > 0) {
                    // Scenario: Where user clears the value to '0', so just update the data in DB
                    update2TProducts.push(formGivenAndRemain(hiddenIdObj.value, product2TTag, user));
                } else {
                    new2TProducts.push(formGivenAndRemain(undefined, product2TTag, user));
                    newHiddenFieldsArr.push(product2TTag);
                }
            }
        });
        console.log('New oilData ' + JSON.stringify(new2TProducts));
        console.log('Update oilData ' + JSON.stringify(update2TProducts));
        postAjaxNew('new-2t-sales', new2TProducts, update2TProducts, tabToActivate, currentDiv, newHiddenFieldsArr, 'oil_id')
            .then((data) => {
                resolve(data);
            });
        if (new2TProducts.length == 0 && update2TProducts.length == 0) {
            resolve(true);      // tab click handled in trackMenu()
        }
    });
}

function formGivenAndRemain(oilId, productAlias, user) {
    return {
        'oil_id': oilId,
        'product_id': document.getElementById(productAlias + '-rate_hiddenId').value,
        'closing_id': document.getElementById('closing_hiddenId').value,
        'price': document.getElementById(productAlias + '-rate').value,
        'given_qty': document.getElementById(productAlias + '_given').value,
        'returned_qty': document.getElementById(productAlias + '_remain').value,
        'created_by': user.User_Name,
        'updated_by': user.User_Name
    };
}

// Add new page - add cash sales to DB via ajax
function saveCashSales() {
    return new Promise((resolve, reject) => {
        const cashSaleTag = 'cash-sale-';
        const cashSaleRow = cashSaleTag + 'table-row-';
        const tabToActivate = 'credit_sales_tab';
        const currentTabId = 'new_cash_sales';
        const salesObj = document.getElementById(currentTabId).querySelectorAll('[id^=' + cashSaleRow + ']:not([type="hidden"])');
        let newSales = [], updateSales = [], newHiddenFieldsArr = [];
        const user = JSON.parse(document.getElementById("user").value);
        salesObj.forEach((saleObj) => {
            if (!saleObj.className.includes('-none')) {
                const saleObjRowNum = saleObj.id.replace(cashSaleRow, '');
                const saleField = document.getElementById(cashSaleTag + 'amt-' + saleObjRowNum);
                const hiddenField = document.getElementById(cashSaleTag + saleObjRowNum + '_hiddenId');
                if (parseFloat(saleField.value) > 0 || (hiddenField.value && parseInt(hiddenField.value) > 0)) {
                    if (hiddenField.value && parseInt(hiddenField.value) > 0) {
                        // Scenario: Where user clears the value to '0', so just update the data in DB
                        updateSales.push(formCashSales(hiddenField.value, cashSaleTag, saleObjRowNum, user));
                    } else {
                        newHiddenFieldsArr.push(cashSaleTag + saleObjRowNum);
                        newSales.push(formCashSales(undefined, cashSaleTag, saleObjRowNum, user));
                    }
                }
            }
        });
        console.log("NEW CASH SALES DATA " + JSON.stringify(newSales));
        console.log("UPDATE CASH SALES DATA " + JSON.stringify(updateSales));
        postAjaxNew('new-cash-sales', newSales, updateSales, tabToActivate, currentTabId, newHiddenFieldsArr, 'cashsales_id')
            .then((data) => {
                resolve(data);
            });
        if (newSales.length === 0 && updateSales.length === 0) {
            resolve(true);      // tab click handled in trackMenu()
        }
    });
}

function formCashSales(salesId, cashSaleTag, saleObjRowNum, user) {
    return {
        'cashsales_id': salesId,
        'closing_id': document.getElementById('closing_hiddenId').value,
        'Bill_no': document.getElementById(cashSaleTag + 'billno-' + saleObjRowNum).value,
        'product_id': document.getElementById(cashSaleTag + 'product-' + saleObjRowNum).value,
        'price': document.getElementById(cashSaleTag + 'price-' + saleObjRowNum).value,
        'price_discount': document.getElementById(cashSaleTag + 'discount-' + saleObjRowNum).value,
        'qty': document.getElementById(cashSaleTag + 'qty-' + saleObjRowNum).value,
        'amount': currenciesAsFloat(document.getElementById(cashSaleTag + 'amt-' + saleObjRowNum).value),
        'notes': document.getElementById(cashSaleTag + 'notes-' + saleObjRowNum).value,
        'created_by': user.User_Name,
        'updated_by': user.User_Name
    };
}

// Add new page - add credit sales to DB via ajax
function saveCreditSales() {
    return new Promise((resolve, reject) => {
        const creditSaleTag = 'credit-';
        const creditSaleRow = creditSaleTag + 'table-row-';
        const tabToActivate = 'expenses_tab';
        const currentTabId = 'new_credit_sales';
        const salesObj = document.getElementById(currentTabId).querySelectorAll('[id^=' + creditSaleRow + ']:not([type="hidden"])');
        let newSales = [], updateSales = [], newHiddenFieldsArr = [];
        const user = JSON.parse(document.getElementById("user").value);
        salesObj.forEach((saleObj) => {
            if (!saleObj.className.includes('-none')) {
                const saleObjRowNum = saleObj.id.replace(creditSaleRow, '');
                const saleField = document.getElementById(creditSaleTag + 'amt-' + saleObjRowNum);
                const hiddenField = document.getElementById(creditSaleTag + saleObjRowNum + '_hiddenId');
                if (parseFloat(saleField.value) > 0 || (hiddenField.value && parseInt(hiddenField.value) > 0)) {
                    if (hiddenField.value && parseInt(hiddenField.value) > 0) {
                        // Scenario: Where user clears the value to '0', so just update the data in DB
                        updateSales.push(formCreditSales(hiddenField.value, creditSaleTag, saleObjRowNum, user));
                    } else {
                        newHiddenFieldsArr.push(creditSaleTag + saleObjRowNum);
                        newSales.push(formCreditSales(undefined, creditSaleTag, saleObjRowNum, user));
                    }
                }
            }
        });
        console.log("New Credit sales data " + JSON.stringify(newSales));
        console.log("Update Credit sales data " + JSON.stringify(updateSales));
        postAjaxNew('new-credit-sales', newSales, updateSales, tabToActivate, currentTabId, newHiddenFieldsArr, 'tcredit_id')
            .then((data) => {
                resolve(data);
            });
        if (newSales.length == 0 && updateSales.length == 0) {
            resolve(true);      // tab click handled in trackMenu()
        }
    });
}

function formCreditSales(salesId, creditSaleTag, creditObjRowNum, user) {
    return {
        'tcredit_id': salesId,
        'closing_id': document.getElementById('closing_hiddenId').value,
        'bill_no': document.getElementById(creditSaleTag + 'billno-' + creditObjRowNum).value,
        'creditlist_id': getCreditType(creditSaleTag, creditObjRowNum),
        'product_id': document.getElementById(creditSaleTag + 'product-' + creditObjRowNum).value,
        'price': document.getElementById(creditSaleTag + 'price-' + creditObjRowNum).value,
        'price_discount': document.getElementById(creditSaleTag + 'discount-' + creditObjRowNum).value,
        'qty': document.getElementById(creditSaleTag + 'qty-' + creditObjRowNum).value,
        'notes': document.getElementById(creditSaleTag + 'notes-' + creditObjRowNum).value,
        'amount': currenciesAsFloat(document.getElementById(creditSaleTag + 'amt-' + creditObjRowNum).value),
        'created_by': user.User_Name,
        'updated_by': user.User_Name
    };
}

function getCreditType(creditSaleTag, creditObjRowNum) {
    const creditTypeObj = document.getElementById(creditSaleTag + 'type-' + creditObjRowNum);
    return document.getElementById(creditSaleTag + creditTypeObj.value + '-' + creditObjRowNum).value;
}

function saveExpensesAndDenoms() {
    return new Promise((resolve, reject) => {
        const currentDiv = 'new_expenses';
        const currentTabId = 'expenses_tab';
        validateDivTabPromise(currentDiv, currentTabId)
            .then((data) => {
                if (data) {
                    enableOtherTabs('expenses_tab');
                    Promise.all([saveExpenses(), saveDenoms()]).then((values) => {
                        if (values[0] && values[1]) {
                            resolve(true);
                        } else {
                            resolve(false);
                        }
                    });
                } else {
                    disableOtherTabs('expenses_tab');
                    resolve(false);
                }
            });
    });
}

// Add new page - add expenses to DB via ajax
function saveExpenses() {
    return new Promise((resolve, reject) => {
        const expenseTag = 'exp-';
        const expenseRowTag = expenseTag + 'table-row-';
        const tabToActivate = 'summary_tab';
        const currentTabId = 'new_expenses';
        const expenseObj = document.getElementById(currentTabId).querySelectorAll('[id^=' + expenseRowTag + ']:not([type="hidden"])');
        let newExpenses = [], updateExpenses = [], newHiddenFieldsArr = [];
        const user = JSON.parse(document.getElementById("user").value);
        expenseObj.forEach((expense) => {
            if (!expense.className.includes('-none')) {
                const rowNum = expense.id.replace(expenseRowTag, '');
                const expenseKey = JSON.parse(document.getElementById(expenseTag + 'expense-' + rowNum).value);
                let expenseNotes = document.getElementById(expenseTag + 'notes-' + rowNum).value;
                const amtObj = document.getElementById(expenseTag + 'amt-' + rowNum);
                const hiddenField = document.getElementById(expenseTag + rowNum + '_hiddenId');
                if ((amtObj.value && parseFloat(amtObj.value) > 0) || (hiddenField.value && parseInt(hiddenField.value) > 0)) {
                    if (hiddenField.value && parseInt(hiddenField.value) > 0) {
                        // Scenario: Where user clears the value to '0', so just update the data in DB
                        updateExpenses.push(formExpenses(hiddenField.value, expenseKey.expenseId, expenseNotes, expenseTag, rowNum, user));
                    } else {
                        newHiddenFieldsArr.push(expenseTag + rowNum);
                        newExpenses.push(formExpenses(undefined, expenseKey.expenseId, expenseNotes, expenseTag, rowNum, user));
                    }
                }
            }
        });
        console.log("NEW EXPENSES DATA " + JSON.stringify(newExpenses));
        console.log("UPDATE EXPENSES DATA " + JSON.stringify(updateExpenses));
        postAjaxNew('new-expenses', newExpenses, updateExpenses, tabToActivate, currentTabId, newHiddenFieldsArr, 'texpense_id')
            .then((data) => {
                resolve(data);
            });
        if (newExpenses.length == 0 && updateExpenses.length == 0) {
            resolve(true);      // tab click handled in trackMenu()
        }

    });
}

function formExpenses(texpenseId, expenseId, expenseNotes, expenseTag, rowNum, user) {
    return {
        'texpense_id': texpenseId,
        'closing_id': document.getElementById('closing_hiddenId').value,
        'expense_id': expenseId,
        'amount': document.getElementById(expenseTag + 'amt-' + rowNum).value,
        'notes': expenseNotes,
        'created_by': user.User_Name,
        'updated_by': user.User_Name
    };
}

// Add new page - add denoms to DB via ajax
function saveDenoms() {
    return new Promise((resolve, reject) => {
        const denomTag = 'denom-';
        const tabToActivate = 'summary_tab';
        const currentTabId = 'new_expenses';
        let denomObj = document.getElementById(currentTabId).querySelectorAll('[id^=' + denomTag + ']:not([type="hidden"])');
        let newDenoms = [], updateDenoms = [], newHiddenFieldsArr = [];
        const user = JSON.parse(document.getElementById("user").value);
        denomObj.forEach((denom) => {
            const denomKey = denom.id.replace(denomTag, '').replace('-cnt', '');
            const hiddenField = document.getElementById(denomTag + denomKey + '_hiddenId');
            if ((denom.value && parseFloat(denom.value) > 0) || (hiddenField.value && parseInt(hiddenField.value) > 0)) {
                if (hiddenField.value && parseInt(hiddenField.value) > 0) {
                    // Scenario: Where user clears the value to '0', so just update the data in DB
                    updateDenoms.push(formDenoms(hiddenField.value, denomKey, denom, user));
                } else {
                    newHiddenFieldsArr.push(denomTag + denomKey);
                    newDenoms.push(formDenoms(undefined, denomKey, denom, user));
                }
            }
        });
        console.log("NEW DENOMS DATA " + JSON.stringify(newDenoms));
        console.log("UPDATE DENOMS DATA " + JSON.stringify(updateDenoms));
        postAjaxNew('new-denoms', newDenoms, updateDenoms, tabToActivate, currentTabId, newHiddenFieldsArr, 'denom_id')
            .then((data) => {
                resolve(data);
            });
        if (newDenoms.length == 0 && updateDenoms.length == 0) {
            resolve(true);      // tab click handled in trackMenu()
        }
    });
}

function formDenoms(denomId, denomKey, denom, user) {
    return {
        'denom_id': denomId,
        'closing_id': document.getElementById('closing_hiddenId').value,
        'denomination': denomKey,
        'denomcount': denom.value,
        'created_by': user.User_Name,
        'updated_by': user.User_Name
    };
}

function postAjaxNew(url, newData, updateData, tabToActivate, currentTabId, hiddenFieldsArr, idModelAttr) {
    return new Promise((resolve, reject) => {
        // remove UI error messages
        undoInvokedValidation(currentTabId);
        undoShowStaticErrorMessage();

        // Prepare AJAX requests & handlers
        const ajaxInsertReq = new XMLHttpRequest();
        const ajaxUpdateReq = new XMLHttpRequest();
        let insertResult = 'No Action', updateResult = 'No Action'; // to store results of requests

        console.log("INSERT DATA LEN : " + newData.length + ", UPDATE LEN : " + updateData.length);
        if (newData && newData.length > 0) {
            ajaxLoading('d-md-block');
            ajaxInsertReq.onreadystatechange = function () {
                if (ajaxInsertReq.readyState == 4) {
                    console.log("Insert response [status : " + ajaxUpdateReq.status + "] - " + ajaxInsertReq.responseText);
                    if (ajaxInsertReq.status == 200 || ajaxInsertReq.status == 500) {
                        insertResult = JSON.parse(ajaxInsertReq.responseText);
                        attemptResult();
                    }
                }
            };
            ajaxInsertReq.open("POST", url, true);
            ajaxInsertReq.setRequestHeader("Content-type", "application/json");
            ajaxInsertReq.send(JSON.stringify(newData));
        }
        if (updateData && updateData.length > 0) {
            ajaxLoading('d-md-block');
            ajaxUpdateReq.onreadystatechange = function () {
                if (ajaxUpdateReq.readyState == 4) {
                    console.log("Update response [status : " + ajaxUpdateReq.status + "] - " + ajaxUpdateReq.responseText);
                    if (ajaxUpdateReq.status == 200 || ajaxUpdateReq.status == 500) {
                        updateResult = JSON.parse(ajaxUpdateReq.responseText);
                        attemptResult();
                    }
                }
            };
            ajaxUpdateReq.open("POST", url, true);
            ajaxUpdateReq.setRequestHeader("Content-type", "application/json");
            ajaxUpdateReq.send(JSON.stringify(updateData));
        }

        function attemptResult() {
            ajaxLoading('d-md-none');
            // display only if both results are set
            if (typeof insertResult !== 'No Action') {
                updateIdsForUpsertSupport(insertResult, hiddenFieldsArr, idModelAttr);
            }
            if (insertResult.error || updateResult.error) {
                showToastMessage(insertResult.error === undefined ? updateResult : insertResult, 7000);
                resolve(false);
            } else {
                setSaveFunction(tabToActivate);
                showToastMessage(insertResult.message === undefined ? updateResult : insertResult);
                resolve(true);
            }
        }
    });
}

function postDeleteAction(elementId, classValue) {
    document.getElementById(elementId).className = classValue;
    defaultInputValues(elementId);
}

function deleteAjax(url, data, elementId, classValue) {
    return new Promise((resolve, reject) => {
        console.log("Delete data " + data + ", rowId " + elementId);
        undoShowStaticErrorMessage();
        if (data && parseInt(data) > 0) {
            ajaxLoading('d-md-block');
            const xhttp = new XMLHttpRequest();
            xhttp.onreadystatechange = function () {
                if (this.readyState == 4) {
                    ajaxLoading('d-md-none');
                    const result = JSON.parse(xhttp.responseText);
                    showToastMessage(result);
                    if (!result.error) {     // Post action on success
                        postDeleteAction(elementId, classValue);
                        resolve(true);
                    } else {
                        resolve(false);
                    }
                }
            };
            xhttp.open("DELETE", url + '?id=' + data, true);
            xhttp.send();
        } else {
            // Scenario: 'X' clicked without data in DB
            postDeleteAction(elementId, classValue);
            resolve(true);
        }
    });
}

// Add new flow : update Ids to hidden field with suffix '_hiddenId'
// some save e.g. t_closing does not need this function.
function updateIdsForUpsertSupport(data, hiddenFieldsArr, idModelAttr) {
    if (hiddenFieldsArr && idModelAttr && data.rowsData) {
        let rowCnt = 0;
        data.rowsData.forEach((row) => {
            document.getElementById(hiddenFieldsArr[rowCnt] + '_hiddenId').value = row[idModelAttr];
            //console.log("Inside Id update"+row[idModelAttr]+idModelAttr);
            rowCnt++;
        });
    }
}

function showToastMessage(response, duration) {
    showStaticErrorMessage(response);
    const x = document.getElementById("snackbar");
    if (!duration) {
        duration = 3000;
    }
    x.innerText = response.error === undefined ? response.message : response.error;
    x.className = "show";
    setTimeout(function () {
        x.className = x.className.replace("show", "");
    }, duration);
}

function showStaticErrorMessage(response) {
    if (response.error) {
        const staticMessage = document.getElementById("static-snackbar");
        staticMessage.innerText = response.error;
        staticMessage.className = 'alert alert-danger d-md-block';
    }

}

// Add new page: Calculate testing amount
function calculateTestingAmount(rowNo) {
    const prefix = 'testing-';
    const price = document.getElementById(prefix + 'price-' + rowNo);
    const lts = document.getElementById(prefix + 'lts-' + rowNo);
    if (price.value && lts.value) {
        const amount = document.getElementById(prefix + 'amt-' + rowNo);
        amount.value = (parseFloat(price.value)
            * parseFloat(lts.value)).toFixed(toFixedValue);
    }
    calculateTotal(prefix);
}

//- Add new page: Dom elements to delete cash sales dynamically on remove click
function hideAndDeleteTestingRow(trId) {
    const deleteObj = document.getElementById(trId.replace('table-row-', '') + '_hiddenId');
    deleteAjax('remove-cash-sale', deleteObj.value, trId, 'd-md-none');
}


function disableUser(index, userId) {
    const r = confirm("Please confirm if you want to disable the user?");
    if (r == true) {
        putAjax('disable-user/' + userId, {}).then(success => {
            if (success) {
                document.getElementById('user-' + index).className = 'd-md-none';
            }
        });
    }
}

function enableUser(index, userId) {
    console.log("Enable user " + userId);
    const r = confirm("Please confirm if you want to enable the user?");
    if (r == true) {
        putAjax('enable-user/' + userId, {}).then(success => {
            if (success) {
                document.getElementById('user-' + index).className = 'd-md-none';
            }
        });
    }
}

function disableCredit(index, creditID) {
    const r = confirm("Please confirm if you want to disable the Credit?");
    if (r == true) {
        putAjax('disable-credit/' + creditID, {}).then(success => {
            if (success) {
                document.getElementById('credit-' + index).className = 'd-md-none';
            }
        });
    }
}

function enableCredit(index, creditID) {
    console.log("Enable Credit" + creditID);
    const r = confirm("Please confirm if you want to enable the user?");
    if (r == true) {
        putAjax('enable-credit/' + creditID, {}).then(success => {
            if (success) {
                document.getElementById('user-' + index).className = 'd-md-none';
            }
        });
    }
}



function editProduct(id, productId) {
    document.getElementById("product-price-" + id).readOnly = false;
    document.getElementById("product-unit-" + id).disabled = false;
    document.getElementById("product-ledger-name-" + id).readOnly = false;
    document.getElementById("product-cgst-" + id).readOnly = false;
    document.getElementById("product-sgst-" + id).readOnly = false;
    document.getElementById("product-edit-" + id).className = hideClassName;
    document.getElementById("product-save-" + id).className = "btn btn-info " + showClassName;
}

function saveProduct(id, productId) {
    const productPrice = document.getElementById("product-price-" + id);
    const productUnit = document.getElementById("product-unit-" + id);
    const ledgerName = document.getElementById("product-ledger-name-" + id);
    const cgst = document.getElementById("product-cgst-" + id);
    const sgst = document.getElementById("product-sgst-" + id);
    if (productPrice.value && parseInt(productPrice.value) > 0) {
        if (putAjax('product/' + productId, {
            m_product_price: productPrice.value,
            m_product_unit: productUnit.value,
            m_product_ledger_name: ledgerName.value,
            m_product_cgst: cgst.value,
            m_product_sgst: sgst.value
        })) {
            postProductEdit(id);
        }
    }
}

function postProductEdit(id) {
    document.getElementById("product-price-" + id).readOnly = true;
    document.getElementById("product-unit-" + id).disabled = true;
    document.getElementById("product-ledger-name-" + id).readOnly = true;
    document.getElementById("product-cgst-" + id).readOnly = true;
    document.getElementById("product-sgst-" + id).readOnly = true;
    document.getElementById("product-edit-" + id).className = "btn btn-info";
    document.getElementById("product-save-" + id).className = "btn-info " + hideClassName;
}

function putAjax(uri, data) {
    return new Promise((resolve, reject) => {
        undoShowStaticErrorMessage();
        console.log("Put data " + JSON.stringify(data) + ", uri " + uri);
        if (data) {
            ajaxLoading('d-md-block');
            const xhttp = new XMLHttpRequest();
            xhttp.onreadystatechange = function () {
                if (this.readyState == 4) {
                    ajaxLoading('d-md-none');
                    const result = JSON.parse(xhttp.responseText);
                    showToastMessage(result);
                    if (!result.error) {     // Post action on success
                        resolve(true);
                    } else {
                        resolve(false);
                    }
                }
            };
            xhttp.open("PUT", uri, true);
            xhttp.setRequestHeader("Content-type", "application/json");
            xhttp.send(JSON.stringify(data));
        } else {
            resolve(true);
        }
    });
}

function finishClosing(hiddenPrefix, uri, redirect) {
    const r = confirm("Please confirm if you want to freeze the closing?");
    if (r == true) {
        const id = document.getElementById(hiddenPrefix + '_hiddenId').value;
        if (id && parseInt(id) > 0) {
            ajaxLoading('d-md-block');
            // Prepare AJAX requests & handlers
            const ajaxUpdateReq = new XMLHttpRequest();
            ajaxUpdateReq.onreadystatechange = function () {
                if (ajaxUpdateReq.readyState == 4) {
                    ajaxLoading('d-md-none');
                    console.log("Close record [status : " + ajaxUpdateReq.status + "] - " + ajaxUpdateReq.responseText);
                    if (ajaxUpdateReq.status == 200 || ajaxUpdateReq.status == 500) {
                        const updateResult = JSON.parse(ajaxUpdateReq.responseText);
                        showToastMessage(updateResult, 7000);
                        if (ajaxUpdateReq.status == 200) {
                            if (redirect.includes("tab")) {
                                Promise.resolve('hello')
                                    .then(promiseTimeout(5000))
                                    .then(document.getElementById(redirect).click());
                            } else {
                                window.location.href = '/' + redirect;
                            }
                        }
                    }
                }
            };
            ajaxUpdateReq.open("POST", uri + '?id=' + id, true);
            ajaxUpdateReq.setRequestHeader("Content-type", "application/json");
            ajaxUpdateReq.send();
        }
    }
}

function deleteClosing(closingId) {
    const r = confirm("Please confirm if you want to delete the closing?");
    if (r == true) {
        if (deleteAjax('delete-closing', closingId, 'closing-record-' + closingId, 'd-md-none')) {
            //console.log(location.href );
            document.getElementById('home_tab').click();
        }
    }
}

function deleteTankReceipt(ttank_Id) {
    const r = confirm("Please confirm if you want to delete the tank receipt?");
    if (r == true) {
        if (deleteAjax('delete-tankReceipt', ttank_Id, 'tank-receipt-' + ttank_Id, 'd-md-none')) {
            document.getElementById('tankReceipt_tab').click();

        }
    }
}

function getExcessShortage(closingId) {
    getAjax('get-excess-shortage', "id=" + closingId, 'excess_storage', updateExcessStorage);
}

function updateExcessStorage(elementId, result) {
    let excessShortage = result.rowsData[0][0].excess_shortage;
    document.getElementById(elementId).innerText = excessShortage;
    if (excessShortage < 0) {
        document.getElementById(elementId + '_color').style = "color:red;";
    } else {
        document.getElementById(elementId + '_color').style = "color:green;";
    }
}

function getAjax(url, params, elementId, calBackMethod) {
    return new Promise((resolve, reject) => {
        console.log("Get data " + params + ", rowId " + elementId);
        undoShowStaticErrorMessage();
        if (params) {
            ajaxLoading('d-md-block');
            const xhttp = new XMLHttpRequest();
            xhttp.onreadystatechange = function () {
                if (this.readyState === 4) {
                    ajaxLoading('d-md-none');
                    const result = JSON.parse(xhttp.responseText);
                    if (result) {
                        calBackMethod(elementId, result);
                        resolve(true);
                    } else {
                        resolve(false);
                    }
                }
            };
            xhttp.open("GET", url + '?' + params, true);
            xhttp.send();
        } else {
            resolve(true);
        }
    });
}

function promiseTimeout(time) {
    return new Promise(function (resolve, reject) {
        setTimeout(function () {
            resolve(time);
        }, time);
    });
};

function formatCurrencies(data, minFixedValue) {
    return data.toLocaleString('en', { minimumFractionDigits: minFixedValue });
}

function currenciesAsFloat(data) {
    return parseFloat(data.replace(/[^0-9-.]/g, ''));
}

function ajaxLoading(className) {
    document.getElementById('ajax-loading').className = className;
}

function copyToHidden(obj) {
    document.getElementById(obj.id + "_hiddenValue").value = obj.value;
}

// Utilities - start
function getDensity() {
    let temperature = document.getElementById("temperature").value;
    let density = document.getElementById("density").value;
    if (temperature && density) {
        getAjax('density', 'temperature=' + temperature + '&density=' + density, 'densityAt15', updateDensity);
    } else {
        showToastMessage({ error: "Mandatory details missing..." });
    }
}

function updateDensity(elementId, result) {
    if (result.rowsData) {
        document.getElementById(elementId).value = result.rowsData.density_at_15;
    } else {
        document.getElementById(elementId).value = "";
        showToastMessage(result);
    }
}

function getDipChart() {
    let chartName = document.getElementById("chart_name").value;
    let dipReading = document.getElementById("dip_reading").value;
    if (dipReading) {
        getAjax('dip-chart', 'chart_name=' + chartName + '&dip_reading=' + dipReading, 'volume', updateDipChart);
    } else {
        showToastMessage({ error: "Mandatory details missing..." });
    }
}

function updateDipChart(elementId, result) {
    if (result.rowsData) {
        document.getElementById(elementId).value = result.rowsData.volume;
    } else {
        document.getElementById(elementId).value = "";
        showToastMessage(result);
    }
}
// Utilities - end
// Add new flow: GET page for new decant
// Workaround: auto submit to GET/POST of new-decant !
// TODO: later after more investigation
function getNewDecantPage() {
    document.getElementById('get-new-decant').submit();
}
function saveDecantHeader() {
    return new Promise((resolve, reject) => {
        const currentDiv = 'new_decantheader';
        const currentTab = 'decantheader_tab';
        validateDivTabPromise(currentDiv, currentTab)
            .then((data) => {
                if (data) {
                    enableOtherTabs('decantheader_tab');
                    const tabToActivate = 'decantlines_tab';
                    const hiddenTag = 'closing';
                    const user = JSON.parse(document.getElementById("user").value);
                    let newDecantData = [], updateDecantData = [], newHiddenFieldsArr = [];
                    const hiddenIdObj = document.getElementById(hiddenTag + '_hiddenId');
                    if (hiddenIdObj && parseInt(hiddenIdObj.value) > 0) {
                        updateDecantData.push(formDecant(hiddenIdObj.value, user));
                    } else {
                        newDecantData.push(formDecant(undefined, user));
                        newHiddenFieldsArr.push(hiddenTag);
                    }
                    console.log('New closing data ' + JSON.stringify(newDecantData));
                    console.log('Update closing data ' + JSON.stringify(updateDecantData));
                    console.log("tabToActivate" + tabToActivate, "currentDiv" + currentDiv, "newHiddenFieldsArr" + newHiddenFieldsArr);
                    postAjaxNew('new-decant', newDecantData, updateDecantData, tabToActivate, currentDiv, newHiddenFieldsArr, 'ttank_id').then(data => {
                        resolve(data);
                    });
                } else {
                    disableOtherTabs('decantheader_tab');
                    resolve(false);
                }
            });
    });
}

function formDecant(ttank_id, user) {
    return {
        'ttank_id': ttank_id,
        'invoice_date': document.getElementById('invoiceDate').value,
        'invoice_number': document.getElementById('invoiceno').value,
        'decant_date': document.getElementById('decantDate').value,
        'decant_incharge': document.getElementById('inchargeid').value,
        'truck_id': document.getElementById('ttnumber').value,
        'location_code': user.location_code,
        'location_id': document.getElementById('location_id').value,
        'driver_id': document.getElementById('driverid').value,
        'helper_id': document.getElementById('helperid').value,
        'odometer_reading': document.getElementById('odometer').value,
        'truck_halt_flag': document.getElementById('halt_chk').value,
        'decant_time': document.getElementById('decanttime').value,
        'created_by': user.User_Name,
        'updated_by': user.User_Name,
    };
}

// Add new page - add credit sales to DB via ajax
function saveDecantLines() {
    return new Promise((resolve, reject) => {
        const decantLineTag = 'tankReceipts-';
        const decantRow = decantLineTag + 'table-row-';
        const tabToActivate = 'summary_tab';
        const currentTabId = 'new_decantlines';
        const linesObj = document.getElementById(currentTabId).querySelectorAll('[id^=' + decantRow + ']:not([type="hidden"])');
        let newLines = [], updateLines = [], newHiddenFieldsArr = [];
        const user = JSON.parse(document.getElementById("user").value);
        linesObj.forEach((linesObj) => {
            if (!linesObj.className.includes('-none')) {
                const linesObjRowNum = linesObj.id.replace(decantRow, '');
                //const hiddenTag = 'closing';
                //const hiddenField = document.getElementById(creditSaleTag + saleObjRowNum + '_hiddenId');
                const hiddenIdObj = document.getElementById(decantLineTag + linesObjRowNum + '_hiddenId');
                console.log(hiddenIdObj);
                console.log(hiddenIdObj.value);
                if (hiddenIdObj && parseInt(hiddenIdObj.value) > 0) {
                    updateLines.push(formDecantLines(hiddenIdObj.value, decantLineTag, linesObjRowNum, user));
                } else {
                    newLines.push(formDecantLines(undefined, decantLineTag, linesObjRowNum, user));
                    newHiddenFieldsArr.push(decantLineTag + linesObjRowNum);
                }

            }

        });
        console.log("New Decant Lines data " + JSON.stringify(newLines));
        console.log("Update Decant Lines data " + JSON.stringify(updateLines));
        postAjaxNew('new-decant-lines', newLines, updateLines, tabToActivate, currentTabId, newHiddenFieldsArr, 'tdtank_id')
            .then((data) => {
                resolve(data);
            });
        if (newLines.length == 0 && updateLines.length == 0) {
            resolve(true);      // tab click handled in trackMenu()
        }
    });
}

function formDecantLines(tdtank_Id, decantLineTag, decantRow, user) {
    return {
        'tdtank_id': tdtank_Id,
        'ttank_id': document.getElementById('closing_hiddenId').value,
        'tank_id': document.getElementById(decantLineTag + 'tank_' + decantRow).value,
        'quantity': parseInt(document.getElementById(decantLineTag + 'tankqty_' + decantRow).value),
        'opening_dip': document.getElementById(decantLineTag + 'opening_dip_' + decantRow).value,
        'closing_dip': document.getElementById(decantLineTag + 'closing_dip_' + decantRow).value,
        'EB_MS_FLAG': document.getElementById(decantLineTag + 'eb_' + decantRow).value,
        'notes': document.getElementById(decantLineTag + 'notes_' + decantRow).value,
        'amount': document.getElementById(decantLineTag + 'amt_' + decantRow).value,
        'created_by': user.User_Name,
        'updated_by': user.User_Name
    };
}

//- Summary page: Iterate summary labels having 'v-' prefix for div tabs
//- then iterate for elements with 'val-' prefix to populate value
//- some of the elements require text values instead of value of the element e.g. cashier (requires name instead of id)
//- iterate through elements having 'vis-' prefix to check for visibility in summary page
function populateReceiptSummary(obj) {
    if (obj) {
        trackMenu(obj);
    }
    const elements = document.getElementById("summary-div").querySelectorAll('[id^=v-]');
    for (let i = 0; i < elements.length; i++) {
        const labels = elements[i].querySelectorAll('[id^=val-]');
        for (let j = 0; j < labels.length; j++) {
            const getValueFromLabelId = labels[j].id.replace("val-", "");
            labels[j].textContent = document.getElementById(getValueFromLabelId) ? document.getElementById(getValueFromLabelId).value : "";
        }
        const dateValues = elements[i].querySelectorAll('[id^=valDate-]');
        for (let j = 0; j < dateValues.length; j++) {
            const getValueFromLabelId = dateValues[j].id.replace("valDate-", "h_");
            dateValues[j].textContent = document.getElementById(getValueFromLabelId).value;
        }

        const texts = elements[i].querySelectorAll('[id^=valText-]');
        for (let j = 0; j < texts.length; j++) {
            const getTextValueFromLabelId = texts[j].id.replace("valText-", "");
            const getElement = document.getElementById(getTextValueFromLabelId);
            if (getElement) {
                if (getElement.tagName === 'SELECT') {
                    if (getElement.selectedIndex > -1) {
                        texts[j].textContent = getElement.options[getElement.selectedIndex].text;
                    }
                } else {
                    texts[j].textContent = document.getElementById(getTextValueFromLabelId).value;
                }
            }
        }

        const divsToHideOrShow = elements[i].querySelectorAll('[id^=vis-]');
        for (let j = 0; j < divsToHideOrShow.length; j++) {
            const getDivFromLabelId = divsToHideOrShow[j].id.replace("vis-", "");
            if (document.getElementById(getDivFromLabelId)) {
                if (getDivFromLabelId.endsWith("_sub_header")) {
                    divsToHideOrShow[j].className = document.getElementById(getDivFromLabelId).className + " col-3";
                } else {
                    divsToHideOrShow[j].className = document.getElementById(getDivFromLabelId).className;
                }
            }
        }
    }

}

function populatesummaryreceiptFn() {
    return populateReceiptSummary();
}

function deleteTruckLoad(rowId, tload_id) {
    deleteAjax('delete-truckload', tload_id, rowId, 'd-md-none');
}

function deleteTruckExpense(rowId, truckexp_id) {
    deleteAjax('delete-truckexpense', truckexp_id, rowId, 'd-md-none');
}

function deleteTransaction(rowId, t_bank_id) {
    deleteAjax('delete-banktransaction', t_bank_id, rowId, 'd-md-none');
}

function populateAccountType(rowNum) {
    let transType = document.getElementById('trans_type_' + rowNum).value;
    // if(AccntTransMap) {
    //     var temp =${ AccntTransMap.get(transType)};
    //     var mySelect = document.getElementById('accnt_type_0');

    //     for(var i, j = 0; i = mySelect.options[j]; j++) {
    //         if(i.value == temp) {
    //             mySelect.selectedIndex = j;
    //             break;
    //         }
    //     }
    // }
    if (transType) {
        getAjax('account-type', 'trans_type=' + transType, 'accnt_type_0', updateAccountingtype);
    }

}

function updateAccountingtype(elementId, result) {
    let val = result.rowsData.attribute1;
    $(document).ready(() => {
        $("#accnt_type_0 option").removeAttr("selected")
        $('#accnt_type_0 option[value="' + val + '"]').attr('selected', "true");
    });

}

function saveAttendance() {
    return new Promise((resolve, reject) => {
        const attendanceTag = 'attendance-';
        const attendanceRow = attendanceTag + 'table-row-';
        const tabToActivate = 'reading_tab';
        const currentTabId = 'new_attendance';
        const linesObj = document.getElementById(currentTabId).querySelectorAll('[id^=' + attendanceRow);
        let newLines = [], updateLines = [], newHiddenFieldsArr = [];
        const user = JSON.parse(document.getElementById("user").value);
        linesObj.forEach((linesObj) => {
            if (!linesObj.className.includes('-none')) {
                const linesObjRowNum = linesObj.id.replace(attendanceRow, '');
                const hiddenIdObj = document.getElementById(attendanceTag + linesObjRowNum + '_hiddenId');

                if (hiddenIdObj && parseInt(hiddenIdObj.value) > 0) {
                    updateLines.push(formAttendanceLines(hiddenIdObj.value, attendanceTag, linesObjRowNum, user));
                } else {
                    newLines.push(formAttendanceLines(undefined, attendanceTag, linesObjRowNum, user));
                    newHiddenFieldsArr.push(attendanceTag + linesObjRowNum);
                }

            }

        });
        console.log("New Attendance data " + JSON.stringify(newLines));
        console.log("Updated Attendance data " + JSON.stringify(updateLines));
        postAjaxNew('new-attendance', newLines, updateLines, tabToActivate, currentTabId, newHiddenFieldsArr, 'tattendance_id')
            .then((data) => {
                resolve(data);
            });
        if (newLines.length == 0 && updateLines.length == 0) {
            resolve(true);      // tab click handled in trackMenu()
        }
    });
}

function formAttendanceLines(tAttendanceId, attendanceTag, rowNo, user) {
    var today = new Date();
    var date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
    var time = today.getHours() + ":" + today.getMinutes();
    var dateTime = date + 'T' + time;
    let inDateTimeArr, outDateTimeArr;
    let in_datetime = document.getElementById(attendanceTag + 'INtime-' + rowNo).value;
    if (in_datetime === '')
        in_datetime = dateTime
    inDateTimeArr = in_datetime.split("T");
    let out_datetime = document.getElementById(attendanceTag + 'OUTtime-' + rowNo).value;
    if (out_datetime === '')
        out_datetime = dateTime
    outDateTimeArr = out_datetime.split("T");
    //console.log("inDateTimeArr"+inDateTimeArr+"outDateTimeArr"+outDateTimeArr);
    return {
        'tattendance_id': tAttendanceId,
        'closing_id': document.getElementById('closing_hiddenId').value,
        'person_id': document.getElementById(attendanceTag + 'personId-' + rowNo).value,
        'shift_type': document.getElementById(attendanceTag + 'shift-' + rowNo).value,
        'in_date': inDateTimeArr[0],
        'in_time': inDateTimeArr[1],
        'out_date': outDateTimeArr[0],
        'out_time': outDateTimeArr[1],
        'notes': document.getElementById(attendanceTag + 'notes-' + rowNo).value,
        'created_by': user.User_Name,
        'updated_by': user.User_Name
    };
}

function editDeadline(id, deadlineId) {
    document.getElementById("deadline-date-" + id).readOnly = false;
    document.getElementById("purpose-" + id).disabled = false;
    document.getElementById("warning-day-" + id).readOnly = false;
    document.getElementById("hard-stop-" + id).disabled = false;
    document.getElementById("closed-" + id).disabled = false;
    document.getElementById("comments-" + id).readOnly = false;
    document.getElementById("deadline-edit-" + id).className = hideClassName;
    document.getElementById("deadline-save-" + id).className = "btn btn-info " + showClassName;
}

function saveDeadline(id, deadlineId) {
    const deadlineDate = document.getElementById("deadline-date-" + id);
    const purpose = document.getElementById("purpose-" + id);
    const warningDay = document.getElementById("warning-day-" + id);
    const hardStop = document.getElementById("hard-stop-" + id);
    const closed = document.getElementById("closed-" + id);
    const comment = document.getElementById("comments-" + id);
    //if (productPrice.value && parseInt(productPrice.value) > 0) {
    if (putAjax('deadline/' + deadlineId, {
        deadlineDate: deadlineDate.value,
        purpose: purpose.value,
        warningDay: warningDay.value,
        hardStop: hardStop.value,
        closed: closed.value,
        comment: comment.value
    })) {
        postDeadlineEdit(id);
    }
    //}
}


function postDeadlineEdit(id) {
    document.getElementById("deadline-date-" + id).readOnly = true;
    document.getElementById("purpose-" + id).disabled = true;
    document.getElementById("warning-day-" + id).readOnly = true;
    document.getElementById("hard-stop-" + id).disabled = true;
    document.getElementById("closed-" + id).disabled = true;
    document.getElementById("comments-" + id).readOnly = true;
    document.getElementById("deadline-edit-" + id).className = "btn btn-info";
    document.getElementById("deadline-save-" + id).className = "btn-info " + hideClassName;
}

function getcurrencyformatter (plainnumber) {
 return new Intl.NumberFormat('en-IN',{ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(plainnumber)
};