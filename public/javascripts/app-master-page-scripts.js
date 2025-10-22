
// Receipts - scripts - start



// master table receipt row edit
function editReceipt(id) {
    document.getElementById("creditreceiptno_" + id).readOnly = false;
    document.getElementById("cr_receiptType_" + id).disabled = false;
    document.getElementById("cr_type-" + id).disabled = false;
    document.getElementById("cr_crcompanyname_" + id).disabled = false;
    document.getElementById("cramount_" + id).readOnly = false;
    document.getElementById("crnotes_" + id).readOnly = false;
    document.getElementById('creditReceipts-add-new').disabled = true;
    document.getElementById("receipt-edit-" + id).className = hideClassName;
    document.getElementById("receipt-save-" + id).className = "btn btn-info " + showClassName;
}

function postReceiptEdit(id) {
    document.getElementById("creditreceiptno_" + id).readOnly = true;
    document.getElementById("cr_receiptType_" + id).disabled = true;
    document.getElementById("cr_type-" + id).disabled = true;
    document.getElementById("cr_crcompanyname_" + id).disabled = true;
    document.getElementById("cramount_" + id).readOnly = true;
    document.getElementById("crnotes_" + id).readOnly = true;
    document.getElementById('creditReceipts-add-new').disabled = false;
    document.getElementById("receipt-edit-" + id).className = "btn btn-info";
    document.getElementById("receipt-save-" + id).className = "btn-info" + hideClassName;
}

// Receipts - scripts - end

// Users - scripts - start

function showMasterEntryRow(obj, prefix) {
    obj.disabled = true;
    document.getElementById(prefix + '-save').disabled = false;
    showAddedRow(prefix);
}

let rowCounter = 0;

        function showMultipleMasterRow(btn, prefix) {
            const template = document.getElementById('banktransaction-template-row');
            const clone = template.cloneNode(true);
            clone.classList.remove('d-none');

            const newRowId = `${prefix}-table-row-${rowCounter}`;
            clone.id = newRowId;

            // Update all input/select/textarea IDs and names inside the row
            clone.querySelectorAll('[id]').forEach(el => {
                el.id = el.id.replace('template', rowCounter);
            });

            clone.querySelectorAll('[name]').forEach(el => {
                el.name = el.name.replace('template', rowCounter);
            });

            clone.querySelectorAll('input, select, textarea').forEach(el => {
                el.disabled = false;
            });

            clone.querySelectorAll('[onchange]').forEach(el => {
                const oldAttr = el.getAttribute('onchange');
                if (oldAttr && oldAttr.includes('updateLedgerFields(')) {
                    el.setAttribute('onchange', `updateLedgerFields(${rowCounter})`);
                }
            });

            clone.querySelectorAll('[onclick]').forEach(el => {
                const oldAttr = el.getAttribute('onclick');
                if (oldAttr && oldAttr.includes('removeBankTxnRow')) {
                    el.setAttribute('onclick', `removeBankTxnRow('banktransaction-table-row-${rowCounter}')`);
                }
            });

            clone.querySelectorAll('[oninput]').forEach(el => {
                const oldAttr = el.getAttribute('oninput');
            
                if (oldAttr && oldAttr.includes('disableCreditInput(')) {
                    el.setAttribute('oninput', `disableCreditInput(${rowCounter})`);
                }
            
                if (oldAttr && oldAttr.includes('disableDebitInput(')) {
                    el.setAttribute('oninput', `disableDebitInput(${rowCounter})`);
                }
            });

            document.getElementById('banktransaction-rows').appendChild(clone);
            document.getElementById(`${prefix}-save`).disabled = false;
            rowCounter++;
        }

function removeBankTxnRow(rowId) {
    const row = document.getElementById(rowId);
    if (row) {
        row.remove();
    }
}

function hideMasterEntryRow(prefix, rowId) {
    document.getElementById(prefix + '-add-new').disabled = false;
    document.getElementById(prefix + '-save').disabled = true;
    reloadPage(rowId);
    hideRow(rowId);

    // Add only this line for product master
    if (rowId.includes('product-master')) {
        hideRow(rowId.replace('product-master-table-row', 'details') + '-row');
    }
}

// Suppliers - scripts - start

function showSupplierMasterEntryRow(button) {
    const rowId = 'suppliers-table-row-0';
    const row = document.getElementById(rowId);
    const saveButton = document.getElementById('suppliers-save');
    if (row && saveButton) {
        row.classList.remove('d-md-none');
        button.disabled = true;
        saveButton.disabled = false;
    }
}

function hideMasterEntryRow(prefix, rowId) {
    const row = document.getElementById(rowId);
    const addButton = document.getElementById(prefix + '-add-new');
    const saveButton = document.getElementById(prefix + '-save');
    if (row && addButton && saveButton) {
        row.classList.add('d-md-none');
        addButton.disabled = false;
        saveButton.disabled = true;
        // Clear input fields
        const inputs = row.getElementsByTagName('input');
        for (let input of inputs) {
            input.value = '';
        }
    }
}

function disableSupplier(index, supplierId) {
    if (confirm('Are you sure you want to disable this supplier?')) {
        fetch('/suppliers/disable/' + supplierId, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const row = document.getElementById('supplier-' + index);
                if (row) {
                    row.remove();
                }
                alert('Supplier disabled successfully');
            } else {
                alert('Error disabling supplier');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('Error disabling supplier');
        });
    }
}

function enableSupplier(index, supplierId) {
    if (confirm('Are you sure you want to enable this supplier?')) {
        fetch('/suppliers/enable/' + supplierId, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const row = document.getElementById('supplier-' + index);
                if (row) {
                    row.remove();
                }
                alert('Supplier enabled successfully');
            } else {
                alert('Error enabling supplier');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('Error enabling supplier');
        });
    }
}

// Suppliers - scripts - End

// New function specific to product master
function showProductMasterRow(obj, prefix) {
    // Call the original function to maintain existing behavior
    showMasterEntryRow(obj, prefix);
    
    // Additional handling for expandable details
    let rowId = prefix + '-table-row-0';
    let detailsRowId = 'details-0-row';
    
    // Show the details row
    document.getElementById(detailsRowId).style.display = '';
    
    // Expand the details section
    document.getElementById('details-0').classList.add('show');
    
    // Update chevron icon
    let chevronButton = document.querySelector(`#${rowId} .oi-chevron-right`);
    if (chevronButton) {
        chevronButton.classList.remove('oi-chevron-right');
        chevronButton.classList.add('oi-chevron-bottom');
    }
}


// Users - scripts - end

// Cash flow - scripts - start
function saveCashFlowTxnsAndDenoms() {
    document.getElementById('cashflow-close').disabled = false;
    return new Promise((resolve, reject) => {
        const divId = 'cashflow-txn-data';
        validateDivTabPromise(divId)
            .then((data) => {
                if (data) {
                    Promise.all([saveCashFlowTxns('cashflow-debit-', 'cashflow-credit-'), saveCashFlowDenoms()]).then((values) => {
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

function saveCashFlowTxns(debitPrefix, creditPrefix) {
    return new Promise((resolve, reject) => {
        const debitData = iterateDebitOrCreditTxns(debitPrefix);
        const creditData = iterateDebitOrCreditTxns(creditPrefix);
        const newTxns = [].concat(debitData.newTxns, creditData.newTxns);
        const updateTxns = [].concat(debitData.updateTxns, creditData.updateTxns);
        const newHiddenFieldsArr = [].concat(debitData.newHiddenFieldsArr, creditData.newHiddenFieldsArr);
        console.log("Consolidated - New cash flow txn data " + JSON.stringify(newTxns));
        console.log("Consolidated - Update cash flow txn data " + JSON.stringify(updateTxns));
        if (newTxns.length > 0 || updateTxns.length > 0) {
            postAjaxNew('save-cashflow-txns', newTxns, updateTxns, undefined, undefined, newHiddenFieldsArr, 'transaction_id')
                .then((data) => {
                    undoInvokedValidation(divId);
                });
        }
    });
}

function iterateDebitOrCreditTxns(debitOrCreditPrefix) {
    const txnRow = debitOrCreditPrefix + 'table-row-';
    const txnsObj = document.getElementById('cashflow-txn-data').querySelectorAll('[id^=' + txnRow + ']:not([type="hidden"])');
    let newTxns = [], updateTxns = [], newHiddenFieldsArr = [];
    const user = JSON.parse(document.getElementById("user").value);
    txnsObj.forEach((txnObj) => {
        if (!txnObj.className.includes('-none')) {
            const rowNum = txnObj.id.replace(txnRow, '');
            const amtField = document.getElementById(debitOrCreditPrefix + 'amt-' + rowNum);
            if (amtField.readOnly) {
                ; // Do nothing for system generated txns
            } else {
                const hiddenField = document.getElementById(debitOrCreditPrefix + rowNum + '_hiddenId');
                if (parseFloat(amtField.value) > 0 || (hiddenField.value && parseInt(hiddenField.value) > 0)) {
                    if (hiddenField.value && parseInt(hiddenField.value) > 0) {
                        // Scenario: Where user clears the value to '0', so just update the data in DB
                        updateTxns.push(formCashFlowTxn(hiddenField.value, debitOrCreditPrefix, rowNum, user));
                    } else {
                        newHiddenFieldsArr.push(debitOrCreditPrefix + rowNum);
                        newTxns.push(formCashFlowTxn(undefined, debitOrCreditPrefix, rowNum, user));
                    }
                }
            }
        }
    });
    console.log("New cash flow txn(" + debitOrCreditPrefix + ") data " + JSON.stringify(newTxns));
    console.log("Update cash flow txn(" + debitOrCreditPrefix + ") data " + JSON.stringify(updateTxns));
    return { "newTxns": newTxns, "updateTxns": updateTxns, "newHiddenFieldsArr": newHiddenFieldsArr };
}

function formCashFlowTxn(txnId, prefix, rowNum, user) {
    const typeObj = document.getElementById(prefix + 'transaction-' + rowNum);
    return {
        'transaction_id': txnId,
        'cashflowId': document.getElementById('cashflowId_hiddenId').value,
        'description': document.getElementById(prefix + 'remarks-' + rowNum).value,
        'type': typeObj.options[typeObj.selectedIndex].text,
        'amount': document.getElementById(prefix + 'amt-' + rowNum).value,
        'calcFlag': 'N',
        'created_by': user.User_Name,
        'updated_by': user.User_Name
    };
}

function calculateCashflowDebitTotal() {
    return calculateTotal("cashflow-debit-");
}

function calculateCashflowCreditTotal() {
    return calculateTotal("cashflow-credit-");
}

function saveCashFlowDenoms() {
    return new Promise((resolve, reject) => {
        const denomTag = 'denom-';
        const currentTabId = denomTag + 'table';
        let denomObj = document.getElementById(currentTabId).querySelectorAll('[id^=' + denomTag + ']:not([type="hidden"])');
        let newDenoms = [], updateDenoms = [], newHiddenFieldsArr = [];
        const user = JSON.parse(document.getElementById("user").value);
        denomObj.forEach((denom) => {
            const denomKey = denom.id.replace(denomTag, '').replace('-cnt', '');
            const hiddenField = document.getElementById(denomTag + denomKey + '_hiddenId');
            if ((denom.value && parseFloat(denom.value) > 0) || (hiddenField.value && parseInt(hiddenField.value) > 0)) {
                if (hiddenField.value && parseInt(hiddenField.value) > 0) {
                    // Scenario: Where user clears the value to '0', so just update the data in DB
                    updateDenoms.push(formCashFlowDenoms(hiddenField.value, denomKey, denom, user));
                } else {
                    newHiddenFieldsArr.push(denomTag + denomKey);
                    newDenoms.push(formCashFlowDenoms(undefined, denomKey, denom, user));
                }
            }
        });
        console.log("New denoms data " + JSON.stringify(newDenoms));
        console.log("Update denoms data " + JSON.stringify(updateDenoms));
        postAjaxNew('save-cashflow-denoms', newDenoms, updateDenoms, undefined, undefined, newHiddenFieldsArr, 'cashdenom_id')
            .then((data) => {
                resolve(data);
            });
        if (newDenoms.length == 0 && updateDenoms.length == 0) {
            resolve(true);      // tab click handled in trackMenu()
        }
    });
}

function formCashFlowDenoms(denomId, denomKey, denom, user) {
    return {
        'cashdenom_id': denomId,
        'cashflow_id': document.getElementById('cashflowId_hiddenId').value,
        'denomination': denomKey,
        'denomcount': denom.value,
        'created_by': user.User_Name,
        'updated_by': user.User_Name
    };
}

function deleteCashflow(cashflowId) {
    const r = confirm("Please confirm if you want to delete the record?");
    if (r == true) {
        if (deleteAjax('cashflow', cashflowId, 'cashflow-record-' + cashflowId, 'd-md-none')) {

        }
    }
}
// Cash flow related scripts - end
