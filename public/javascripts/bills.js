let billsVehicleData  = {};

document.addEventListener('DOMContentLoaded', function() {
    const billForm = document.getElementById('billForm');
    const billItemsTable = document.getElementById('billItemsTable');
    const addRowDesktopBtn = document.getElementById('addRowDesktop');
    const totalAmountDisplay = document.getElementById('totalAmount');
    let rowIndex = 0;

    initializeVehicleHandling();
    initializeVehicleSelect2();

    // Handle product selection for desktop
    function attachProductSelectListener(row) {
        const productSelect = row.querySelector('.product-select');
        const priceInput = row.querySelector('.price-input');
        const qtyInput = row.querySelector('.qty-input');
        const discountInput = row.querySelector('.discount-input');
        const amountInput = row.querySelector('.amount-input');
        const removeBtn = row.querySelector('.remove-row');

       productSelect.addEventListener('change', function() {
            const selectedOption = this.options[this.selectedIndex];
            const price = selectedOption.getAttribute('data-price') || '0';
            
            priceInput.value = parseFloat(price).toFixed(2); // Changed from toFixed(3) to toFixed(2)
            
            // Don't call recalculateBillItem here - let the global handler manage it
        });


        
        
       

        // Remove row functionality
        removeBtn.addEventListener('click', function() {
            // Prevent removing the last row
            const rows = billItemsTable.querySelectorAll('.item-row');
            if (rows.length > 1) {
                row.remove();
                calculateGrandTotal();
            }
        });
    }


// Improved remove row functionality
function attachRemoveRowListener(row) {
    const removeBtn = row.querySelector('.remove-row');
    if (removeBtn) {
        // Remove any existing listeners to prevent duplicates
        removeBtn.replaceWith(removeBtn.cloneNode(true));
        const newRemoveBtn = row.querySelector('.remove-row');
        
        newRemoveBtn.addEventListener('click', function() {
            const rows = billItemsTable.querySelectorAll('.item-row');
            if (rows.length > 1) {
                row.remove();
                calculateGrandTotal();
                updateRemoveButtonStates(); // Update all button states
            } else {
                alert('Cannot delete the last row. At least one item is required.');
            }
        });
    }
}


// New function to update remove button states dynamically
function updateRemoveButtonStates() {
    const rows = billItemsTable.querySelectorAll('.item-row');
    rows.forEach(row => {
        const removeBtn = row.querySelector('.remove-row');
        if (removeBtn) {
            // Enable all remove buttons when there's more than 1 row
            removeBtn.disabled = rows.length <= 1;
        }
    });
}





document.addEventListener('change', function(e) {
    if (e.target.name === 'bill_type' || e.target.name === 'bill_type_mobile') {
        handleBillTypeChange(e.target.value);
        
        // Sync the other form if values differ
        if (e.target.name === 'bill_type') {
            // Desktop changed, sync mobile
            const mobileCash = document.getElementById('cashBillMobile');
            const mobileCredit = document.getElementById('creditBillMobile');
            if (e.target.value === 'CASH' && mobileCash) mobileCash.checked = true;
            if (e.target.value === 'CREDIT' && mobileCredit) mobileCredit.checked = true;
        } else {
            // Mobile changed, sync desktop
            const desktopCash = document.getElementById('cashBill');
            const desktopCredit = document.getElementById('creditBill');
            if (e.target.value === 'CASH' && desktopCash) desktopCash.checked = true;
            if (e.target.value === 'CREDIT' && desktopCredit) desktopCredit.checked = true;
        }
    }
});


document.addEventListener('change', function(e) {
    if (e.target.classList.contains('product-select')) {
        const row = e.target.closest('.item-row');
        const selectedOption = e.target.options[e.target.selectedIndex];
        
        // Auto-fill price
        const price = selectedOption.dataset.price;
        const priceInput = row.querySelector('.price-input');
        if (price && priceInput) {
            priceInput.value = parseFloat(price).toFixed(2);
        }
        
        // Clear existing values when switching products
        const qtyInput = row.querySelector('.qty-input');
        const discountInput = row.querySelector('.discount-input');
        const amountInput = row.querySelector('.amount-input');
        
        qtyInput.value = '';
        discountInput.value = '0';
        amountInput.value = '';
        
        // Set quantity step for unit-based products
        const unit = selectedOption.dataset.unit || '';
        const unitBasedProducts = ['NOS', 'PCS', 'UNITS', 'BOTTLES', 'CANS'];
        
        if (unitBasedProducts.includes(unit.toUpperCase())) {
            qtyInput.step = '1';
            qtyInput.setAttribute('title', 'This product can only be sold in whole units');
        } else {
            qtyInput.step = '0.001';
            qtyInput.setAttribute('title', 'Quantity can have decimals');
        }
        
        // Clear tax displays
        const subtotalDisplay = row.querySelector('.subtotal-display');
        const cgstDisplay = row.querySelector('.cgst-display');
        const sgstDisplay = row.querySelector('.sgst-display');
        
        if (subtotalDisplay) subtotalDisplay.textContent = '0.00';
        if (cgstDisplay) cgstDisplay.textContent = '0.00';
        if (sgstDisplay) sgstDisplay.textContent = '0.00';
        
        // Set amount field state (readonly for units, editable for volume)
        setAmountFieldState(row);
        
        // No calculations here - let input handlers trigger them naturally
        // when user enters quantity or amount
    }
});


    document.addEventListener('input', function(e) {
    if (e.target.classList.contains('qty-input') || 
        e.target.classList.contains('price-input') || 
        e.target.classList.contains('discount-input')) {
        
        // Prevent negative values
        if (parseFloat(e.target.value) < 0) {
            e.target.value = 0;
        }
        
        const row = e.target.closest('.item-row');
        validateRow(row);
        calculateRowTax(row);
    }

     if (e.target.classList.contains('amount-input')) {
        // Prevent negative values
        if (parseFloat(e.target.value) < 0) {
            e.target.value = 0;
        }
        
        const row = e.target.closest('.item-row');
        validateRow(row);
        reverseCalculateTax(row);
    }
});








        // Add new row for desktop
        addRowDesktopBtn.addEventListener('click', function() {
            rowIndex++;
            const newRow = billItemsTable.querySelector('tbody tr.item-row').cloneNode(true);
        
       
                // Reset form values
        newRow.querySelectorAll('select, input').forEach(el => {
            if (el.type === 'select-one') {
                el.selectedIndex = 0;
            } else if (el.classList.contains('discount-input')) {
                el.value = '0';
            } else {
                el.value = '';
            }
        });

        // Reset display text content
        newRow.querySelectorAll('.subtotal-display, .cgst-display, .sgst-display').forEach(display => {
            display.textContent = '0.00';
        });

        // Reset amount input specifically
        const amountInput = newRow.querySelector('.amount-input');
        if (amountInput) amountInput.value = '';



        // Update input names with new index
        newRow.querySelector('.product-select').name = `items[${rowIndex}][product_id]`;
        newRow.querySelector('.price-input').name = `items[${rowIndex}][price]`;
        newRow.querySelector('.qty-input').name = `items[${rowIndex}][qty]`;
        newRow.querySelector('.discount-input').name = `items[${rowIndex}][price_discount]`;
        newRow.querySelector('.amount-input').name = `items[${rowIndex}][amount]`;
        newRow.querySelector('.notes-input').name = `items[${rowIndex}][notes]`;
        newRow.querySelector('.subtotal-hidden').name = `items[${rowIndex}][base_amount]`;
        newRow.querySelector('.cgst-hidden').name = `items[${rowIndex}][cgst_amount]`;
        newRow.querySelector('.sgst-hidden').name = `items[${rowIndex}][sgst_amount]`;
       const cgstPercentInput = newRow.querySelector('input[name*="[cgst_percent]"]');
       const sgstPercentInput = newRow.querySelector('input[name*="[sgst_percent]"]');

        if (cgstPercentInput) cgstPercentInput.name = `items[${rowIndex}][cgst_percent]`;
        if (sgstPercentInput) sgstPercentInput.name = `items[${rowIndex}][sgst_percent]`;

        // Enable remove button
        const removeBtn = newRow.querySelector('.remove-row');
        removeBtn.disabled = false;        
        

        // Append new row
        billItemsTable.querySelector('tbody').appendChild(newRow);

        // Attach event listeners
        attachProductSelectListener(newRow);
        attachRemoveRowListener(newRow);

        // Update all remove button states
        updateRemoveButtonStates();
    });

    // Mobile: Add item handler
    const addRowMobileBtn = document.getElementById('addRowMobile');
    if (addRowMobileBtn) {
        addRowMobileBtn.addEventListener('click', function() {
            const mobileProduct = document.getElementById('mobileProduct');
            const selectedProduct = mobileProduct.options[mobileProduct.selectedIndex];
            const mobileQty = document.getElementById('mobileQty');
            const mobileDiscount = document.getElementById('mobileDiscount');
            const mobileItemsList = document.getElementById('mobileItemsList');

            const product = selectedProduct.value;
            const qty = mobileQty.value;
            const discount = mobileDiscount.value || 0;
            
            if (!product || !qty) {
                alert('Please fill all required fields');
                return;
            }

            const price = selectedProduct.dataset.price;
            const discountedPrice = parseFloat(price) - parseFloat(discount);
            const amount = discountedPrice * parseFloat(qty);

            // Create mobile item HTML
            const itemDiv = document.createElement('div');
            itemDiv.classList.add('list-group-item');
            itemDiv.innerHTML = `
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <h6 class="mb-1">${selectedProduct.text}</h6>
                        <small>Qty: ${qty} × ₹${price}</small>
                        ${discount > 0 ? `<br><small>Discount: ₹${discount}</small>` : ''}
                    </div>
                    <div class="text-right">
                        <h6 class="mb-1">₹${amount.toFixed(2)}</h6>
                        <button class="btn btn-danger btn-sm delete-mobile-item" type="button">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
                <input type="hidden" name="items[${mobileItemsList.children.length}][product_id]" value="${product}">
                <input type="hidden" name="items[${mobileItemsList.children.length}][price]" value="${price}">
                <input type="hidden" name="items[${mobileItemsList.children.length}][qty]" value="${qty}">
                <input type="hidden" name="items[${mobileItemsList.children.length}][price_discount]" value="${discount}">
                <input type="hidden" name="items[${mobileItemsList.children.length}][amount]" value="${amount}">
            `;

            // Append to mobile items list
            mobileItemsList.appendChild(itemDiv);

            // Clear mobile inputs
            mobileProduct.selectedIndex = 0;
            mobileQty.value = '';
            mobileDiscount.value = '';

            calculateGrandTotal();
        });
    }

    // Mobile: Delete item
    document.addEventListener('click', function(e) {
        if (e.target.closest('.delete-mobile-item')) {
            e.target.closest('.list-group-item').remove();
            calculateGrandTotal();
        }
    });


   
const existingRows = billItemsTable.querySelectorAll('tbody tr.item-row');
existingRows.forEach((row) => {
    attachProductSelectListener(row);
    attachRemoveRowListener(row);
});

// Update remove button states based on current row count
updateRemoveButtonStates();

    syncFormValues();    

    // Form validation
  // Form validation - FIXED VERSION
    billForm.addEventListener('submit', function(e) {
        // Get values from either desktop or mobile (whichever is visible)
        const shiftDesktop = document.getElementById('shift')?.value;
        const shiftMobile = document.getElementById('shiftMobile')?.value;
        const shift = shiftDesktop || shiftMobile;

        // Get bill type from checked radio buttons
        const billTypeDesktop = document.querySelector('input[name="bill_type"]:checked')?.value;
        const billTypeMobile = document.querySelector('input[name="bill_type_mobile"]:checked')?.value;
        const billType = billTypeDesktop || billTypeMobile;

        // Get customer for credit bills
        const creditCustomerDesktop = document.getElementById('creditCustomer')?.value;
        const creditCustomerMobile = document.getElementById('creditCustomerMobile')?.value;
        const creditCustomer = creditCustomerDesktop || creditCustomerMobile;

        if (!shift) {
            alert('Please select a shift');
            e.preventDefault();
            return false;
        }

        if (billType === 'CREDIT' && !creditCustomer) {
            alert('Please select a customer for credit bill');
            e.preventDefault();
            return false;
        }

        // Check if there are any items
        const desktopItems = document.querySelectorAll('.item-row');
        const mobileItems = document.querySelectorAll('#mobileItemsList .list-group-item');
        const hasDesktopItems = desktopItems.length > 0 && desktopItems[0].querySelector('.product-select')?.value;
        const hasMobileItems = mobileItems.length > 0;

        if (!hasDesktopItems && !hasMobileItems) {
            alert('Please add at least one item');
            e.preventDefault();
            return false;
        }

        // Validate desktop items if present
        if (hasDesktopItems) {
            let hasValidItems = false;
            
            for (let row of desktopItems) {
                const productSelect = row.querySelector('.product-select');
                
                if (!productSelect.value) {
                    continue;
                }
                
                const validation = validateRow(row);
                if (!validation.valid) {
                    alert(validation.message);
                    e.preventDefault();
                    return false;
                } else {
                    hasValidItems = true;
                }
            }
            
            if (!hasValidItems) {
                alert('Please add at least one valid item to the bill');
                e.preventDefault();
                return false;
            }
        }

        return true;
    });



// Delete Bill Button Handler - Add this inside the DOMContentLoaded event
const deleteBillBtn = document.getElementById('deleteBillBtn');
if (deleteBillBtn) {
    deleteBillBtn.addEventListener('click', function() {
        const billId = this.dataset.billId;
        
        if (confirm('Are you sure you want to delete this bill? This action cannot be undone.')) {
            fetch(`/bills/delete/${billId}`, {
                method: 'POST'
            }).then(response => {
                if (response.redirected) {
                    window.location.href = response.url;
                } else {
                    return response.text();
                }
            }).then(data => {
                if (data) {
                    console.log('Delete response:', data);
                }
            }).catch(error => {
                console.error('Delete error:', error);
                alert('An error occurred while deleting the bill.');
            });
        }
    });
}
     // Enable print button after successful save
     if (window.location.search.includes('success=true')) {
        $('#printBtn').prop('disabled', false);
    }

    // Print button click handler
    $('.print-bill, #printBtn').click(function() {
            const billId = $(this).data('bill-id');
            
            // Create a simple menu for print options
            const printMenu = `
                <div class="dropdown-menu show" style="position: absolute; z-index: 1000;">
                    <h6 class="dropdown-header">Print Options</h6>
                    <a class="dropdown-item" href="/bills/${billId}/print" target="_blank">
                        <i class="bi bi-eye"></i> Preview (HTML)
                    </a>
                    <a class="dropdown-item" href="/bills/${billId}/print/pdf" target="_blank">
                        <i class="bi bi-file-pdf"></i> Download PDF
                    </a>
                    <div class="dropdown-divider"></div>
                    <a class="dropdown-item" href="#" onclick="printDirectly(${billId})">
                        <i class="bi bi-printer"></i> Print Directly
                    </a>
                </div>
            `;
            
            // For now, let's just open the PDF directly (simpler approach)
            window.open(`/bills/${billId}/print/pdf`, '_blank');
        });

// Enhanced initialization for existing data (edit page)
setTimeout(function() {
    const itemRows = document.querySelectorAll('#billItems .item-row');
    itemRows.forEach(function(row) {
        const productSelect = row.querySelector('.product-select');
        if (productSelect && productSelect.value) {
            console.log('Initializing row with product:', productSelect.value);
            
            // Set amount field state
            setAmountFieldState(row);
            
            // Trigger tax calculation
            calculateRowTax(row);
        }
    });
}, 200); // Increased timeout slightly

    });





// Auto-calculate tax with RSP-inclusive logic
function calculateRowTax(row) {
    const productSelect = row.querySelector('.product-select');
    const qtyInput = row.querySelector('.qty-input');
    const priceInput = row.querySelector('.price-input');
    const discountInput = row.querySelector('.discount-input');
    

     // Add validation to prevent NaN
    if (!productSelect || !productSelect.value) {
        console.log('No product selected, skipping tax calculation');
        return;
    }
    
    const selectedOption = productSelect.options[productSelect.selectedIndex];
    if (!selectedOption) {
        console.log('No valid product option found');
        return;
    }

            // Add validation for numeric inputs to prevent NaN
        const rspPrice = parseFloat(priceInput.value || 0);
        const qty = parseFloat(qtyInput.value || 0);
        const discount = parseFloat(discountInput.value || 0);

        // Validate all numeric inputs to prevent NaN
        if (isNaN(rspPrice) || isNaN(qty) || isNaN(discount)) {
            console.log('Invalid numeric values detected:', {
                price: priceInput.value,
                qty: qtyInput.value,
                discount: discountInput.value
            });
            return;
        }

        if (rspPrice <= 0 || qty <= 0) {
            console.log('Price or quantity is zero/negative, skipping calculation');
            return;
        }
            


    console.log('=== TAX CALCULATION DEBUG ===');
    console.log('Product:', selectedOption.text);
    console.log('Raw CGST:', selectedOption.dataset.cgstPercent);
    console.log('Raw SGST:', selectedOption.dataset.sgstPercent);

    const cgstPercent = parseFloat(selectedOption.dataset.cgstPercent || 0);
    const sgstPercent = parseFloat(selectedOption.dataset.sgstPercent || 0);

     console.log('Parsed CGST:', cgstPercent);
    console.log('Parsed SGST:', sgstPercent);
    console.log('Total Tax %:', cgstPercent + sgstPercent);
    
 
    // Calculate line total after discount (RSP inclusive)
    const lineTotalRSP = (rspPrice * qty) - discount;
    
    // Calculate tax amounts using RSP-inclusive logic
    const totalTaxPercent = cgstPercent + sgstPercent;
    let baseAmount = 0;
    let cgstAmount = 0;
    let sgstAmount = 0;
    
    if (totalTaxPercent > 0) {
        baseAmount = lineTotalRSP / (1 + (totalTaxPercent / 100));
        cgstAmount = baseAmount * (cgstPercent / 100);
        sgstAmount = baseAmount * (sgstPercent / 100);
    } else {
         // No tax case - explicitly set to proper values
        baseAmount = lineTotalRSP;
        cgstAmount = 0;  // Explicitly set to 0, not empty
        sgstAmount = 0;  // Explicitly set to 0, not empty
    }
    
    const finalAmount = baseAmount + cgstAmount + sgstAmount;
    
    // Update displays
    const subtotalDisplay = row.querySelector('.subtotal-display');
    const cgstDisplay = row.querySelector('.cgst-display');
    const sgstDisplay = row.querySelector('.sgst-display');
    const amountInput = row.querySelector('.amount-input');
    
    if (subtotalDisplay) subtotalDisplay.textContent = baseAmount.toFixed(2);
    if (cgstDisplay) cgstDisplay.textContent = cgstAmount.toFixed(2);
    if (sgstDisplay) sgstDisplay.textContent = sgstAmount.toFixed(2);
    if (amountInput) amountInput.value = finalAmount.toFixed(2);

     console.log('Calculated values:');
    console.log('Base Amount:', baseAmount.toFixed(2));
    console.log('CGST Amount:', cgstAmount.toFixed(2));
    console.log('SGST Amount:', sgstAmount.toFixed(2)); 
    
    // Update hidden fields
    const subtotalHidden = row.querySelector('.subtotal-hidden');
    const cgstHidden = row.querySelector('.cgst-hidden');
    const sgstHidden = row.querySelector('.sgst-hidden');
    const cgstPercentInput = row.querySelector('input[name*="[cgst_percent]"]');
    const sgstPercentInput = row.querySelector('input[name*="[sgst_percent]"]');
    const baseAmountInput = row.querySelector('input[name*="[base_amount]"]');
    const cgstAmountInput = row.querySelector('input[name*="[cgst_amount]"]');
    const sgstAmountInput = row.querySelector('input[name*="[sgst_amount]"]');
    
    if (subtotalHidden) subtotalHidden.value = baseAmount.toFixed(2);
    if (cgstHidden) cgstHidden.value = cgstAmount.toFixed(2);
    if (sgstHidden) sgstHidden.value = sgstAmount.toFixed(2);
    if (cgstPercentInput) cgstPercentInput.value = cgstPercent.toFixed(2);
    if (sgstPercentInput) sgstPercentInput.value = sgstPercent.toFixed(2);
    if (baseAmountInput) baseAmountInput.value = baseAmount.toFixed(2);
    if (cgstAmountInput) cgstAmountInput.value = cgstAmount.toFixed(2);
    if (sgstAmountInput) sgstAmountInput.value = sgstAmount.toFixed(2);
    
    calculateGrandTotal();


    console.log('Hidden field values set:');
    if (cgstAmountInput) console.log('cgst_amount field:', cgstAmountInput.value);
    if (sgstAmountInput) console.log('sgst_amount field:', sgstAmountInput.value);
    console.log('=== END TAX CALCULATION ===');
}

// Calculate grand total and tax summary
function calculateGrandTotal() {
    let grandTotal = 0;
    const itemRows = document.querySelectorAll('#billItems .item-row');
    itemRows.forEach(function(row) {
        const amountInput = row.querySelector('.amount-input');
        const amount = parseFloat(amountInput?.value || 0);
        grandTotal += amount;
    });
    
    const grandTotalElement = document.getElementById('totalAmount');
    if (grandTotalElement) {
        grandTotalElement.textContent = '₹ ' + grandTotal.toFixed(2);
    }
}

function validateRow(row) {
    const productSelect = row.querySelector('.product-select');
    const qtyInput = row.querySelector('.qty-input');
    const priceInput = row.querySelector('.price-input');
    const discountInput = row.querySelector('.discount-input');
    const amountInput = row.querySelector('.amount-input');
    
    const selectedOption = productSelect.options[productSelect.selectedIndex];
    const unit = selectedOption.dataset.unit || '';
    
    let isValid = true;
    let errorMessage = '';
    
    if (!productSelect.value) {
        return { valid: true }; // Empty row is okay
    }
    
    // Validate quantity
    const qty = parseFloat(qtyInput.value || 0);
    if (qty <= 0) {
        isValid = false;
        errorMessage = 'Quantity must be greater than 0';
        qtyInput.style.borderColor = 'red';
    } else {
        // Check unit-based products
        const unitBasedProducts = ['NOS', 'PCS', 'UNITS', 'BOTTLES', 'CANS'];
        if (unitBasedProducts.includes(unit.toUpperCase()) && qty % 1 !== 0) {
            isValid = false;
            errorMessage = `${selectedOption.text} must be sold in whole units only`;
            qtyInput.style.borderColor = 'red';
        } else {
            qtyInput.style.borderColor = '';
        }
    }
    
    // Validate price
    const price = parseFloat(priceInput.value || 0);
    if (price <= 0) {
        isValid = false;
        errorMessage = 'Price must be greater than 0';
        priceInput.style.borderColor = 'red';
    } else {
        priceInput.style.borderColor = '';
    }
    
    // Validate discount
    const discount = parseFloat(discountInput.value || 0);
    const lineTotal = price * qty;
    if (discount < 0) {
        isValid = false;
        errorMessage = 'Discount cannot be negative';
        discountInput.style.borderColor = 'red';
    } else if (discount >= lineTotal) {
        isValid = false;
        errorMessage = 'Discount cannot be equal to or greater than line total';
        discountInput.style.borderColor = 'red';
    } else {
        discountInput.style.borderColor = '';
    }
    
    // Validate final amount
    const amount = parseFloat(amountInput.value || 0);
    if (amount <= 0) {
        isValid = false;
        errorMessage = 'Final amount must be greater than 0';
        amountInput.style.borderColor = 'red';
    } else {
        amountInput.style.borderColor = '';
    }
    
    return { valid: isValid, message: errorMessage };
}

function validateBillForm() {
    let hasValidItems = false;
    let allRowsValid = true;
    const rows = document.querySelectorAll('.item-row');
    
    for (let row of rows) {
        const productSelect = row.querySelector('.product-select');
        
        if (!productSelect.value) {
            continue;
        }
        
        const validation = validateRow(row);
        if (!validation.valid) {
            allRowsValid = false;
            alert(validation.message);
            break;
        } else {
            hasValidItems = true;
        }
    }
    
    if (!hasValidItems) {
        alert('Please add at least one valid item to the bill');
        return false;
    }
    
    return allRowsValid;
}


function reverseCalculateTax(row) {
    const productSelect = row.querySelector('.product-select');
    const qtyInput = row.querySelector('.qty-input');
    const priceInput = row.querySelector('.price-input');
    const discountInput = row.querySelector('.discount-input');
    const amountInput = row.querySelector('.amount-input');
    
    const selectedOption = productSelect.options[productSelect.selectedIndex];
    const unit = selectedOption.dataset.unit || '';
    const unitBasedProducts = ['NOS', 'PCS', 'UNITS', 'BOTTLES', 'CANS']; // TODO: Make this configurable
    
    // Only allow manual amount entry for non-unit-based products (fuels, oils by volume)
    if (unitBasedProducts.includes(unit.toUpperCase())) {
        // For unit-based products, recalculate normally (qty -> amount)
        calculateRowTax(row);
        return;
    }
    
    const cgstPercent = parseFloat(selectedOption.dataset.cgstPercent || 0);
    const sgstPercent = parseFloat(selectedOption.dataset.sgstPercent || 0);
    
    const manualAmount = parseFloat(amountInput.value || 0);
    const unitPrice = parseFloat(priceInput.value || 0);
    const discount = parseFloat(discountInput.value || 0);
    
    if (manualAmount <= 0 || unitPrice <= 0) {
        return;
    }
    
    // Calculate tax breakdown from manual amount (reverse of RSP-inclusive)
    const totalTaxPercent = cgstPercent + sgstPercent;
    let baseAmount = 0;
    let cgstAmount = 0;
    let sgstAmount = 0;
    
    if (totalTaxPercent > 0) {
        // Base amount = Manual Amount / (1 + total tax rate)
        baseAmount = manualAmount / (1 + (totalTaxPercent / 100));
        cgstAmount = baseAmount * (cgstPercent / 100);
        sgstAmount = baseAmount * (sgstPercent / 100);
    } else {
        baseAmount = manualAmount;
    }
    
    // Calculate quantity from amount and price
    // Amount after discount = (unitPrice × qty) - discount
    // So: qty = (baseAmount + discount) / unitPrice
    const calculatedQty = (manualAmount + discount) / unitPrice;
    
    // Update quantity field
    qtyInput.value = calculatedQty.toFixed(3);
    
    // Update tax displays
    const subtotalDisplay = row.querySelector('.subtotal-display');
    const cgstDisplay = row.querySelector('.cgst-display');
    const sgstDisplay = row.querySelector('.sgst-display');
    
    if (subtotalDisplay) subtotalDisplay.textContent = baseAmount.toFixed(2);
    if (cgstDisplay) cgstDisplay.textContent = cgstAmount.toFixed(2);
    if (sgstDisplay) sgstDisplay.textContent = sgstAmount.toFixed(2);
    
    // Update hidden fields
    const subtotalHidden = row.querySelector('.subtotal-hidden');
    const cgstHidden = row.querySelector('.cgst-hidden');
    const sgstHidden = row.querySelector('.sgst-hidden');
    const cgstPercentInput = row.querySelector('input[name*="[cgst_percent]"]');
    const sgstPercentInput = row.querySelector('input[name*="[sgst_percent]"]');
    const baseAmountInput = row.querySelector('input[name*="[base_amount]"]');
    const cgstAmountInput = row.querySelector('input[name*="[cgst_amount]"]');
    const sgstAmountInput = row.querySelector('input[name*="[sgst_amount]"]');
    
    if (subtotalHidden) subtotalHidden.value = baseAmount.toFixed(2);
    if (cgstHidden) cgstHidden.value = cgstAmount.toFixed(2);
    if (sgstHidden) sgstHidden.value = sgstAmount.toFixed(2);
    if (cgstPercentInput) cgstPercentInput.value = cgstPercent.toFixed(2);
    if (sgstPercentInput) sgstPercentInput.value = sgstPercent.toFixed(2);
    if (baseAmountInput) baseAmountInput.value = baseAmount.toFixed(2);
    if (cgstAmountInput) cgstAmountInput.value = cgstAmount.toFixed(2);
    if (sgstAmountInput) sgstAmountInput.value = sgstAmount.toFixed(2);
    
    calculateGrandTotal();
}


// Add this function to handle readonly state for amount field
function setAmountFieldState(row) {
    const productSelect = row.querySelector('.product-select');
    const amountInput = row.querySelector('.amount-input');
    const selectedOption = productSelect.options[productSelect.selectedIndex];
    const unit = selectedOption.dataset.unit || '';
    const unitBasedProducts = ['NOS', 'PCS', 'UNITS', 'BOTTLES', 'CANS'];
    
    if (unitBasedProducts.includes(unit.toUpperCase())) {
        // Unit-based products: Amount is calculated, not manually entered
        amountInput.readOnly = true;
        amountInput.style.backgroundColor = '#f8f9fa';
        amountInput.title = "Amount is calculated automatically for this product (Qty × Price)";
    } else {
        // Volume-based products: Allow manual amount entry
        amountInput.readOnly = false;
        amountInput.style.backgroundColor = '#ffffff';
        amountInput.title = "You can enter amount directly or it will be calculated from quantity";
    }
}

function printDirectly(billId) {
    const printWindow = window.open(`/bills/${billId}/print/pdf`, '_blank');
    printWindow.addEventListener('load', function() {
        printWindow.print();
    });
}



function initializeVehicleHandling() {
    document.addEventListener('change', function(e) {        
        if (e.target.id === 'creditCustomer' || e.target.id === 'creditCustomerMobile') {
            loadVehiclesForCustomer(e.target.value);
        }
    });
}



function initializeVehicleSelect2() {
    $('#vehicleSelect').select2({
        placeholder: 'Select Vehicle',
        allowClear: true,
        width: '100%'
    });
}

function loadVehiclesForCustomer(creditListId) {
    $('#vehicleSelect').empty().append('<option value="">Select Vehicle</option>');
    
    if (creditListId && billsVehicleData [creditListId]) {
        billsVehicleData [creditListId].forEach(vehicle => {
            const option = new Option(
                `${vehicle.vehicleNumber} (${vehicle.vehicleType})`, 
                vehicle.vehicleId
            );
            $('#vehicleSelect').append(option);
        });
    }
    $('#vehicleSelect').trigger('change');
}

function getVehicleDataForSubmission() {
    const billTypeDesktop = document.querySelector('input[name="bill_type"]:checked')?.value;
    const billTypeMobile = document.querySelector('input[name="bill_type_mobile"]:checked')?.value;
    const billType = billTypeDesktop || billTypeMobile;
    
    if (billType === 'CASH') {
        const cashVehicleDesktop = document.getElementById('cashVehicleNumber')?.value;
        const cashVehicleMobile = document.getElementById('cashVehicleMobile')?.value;
        const odometerDesktop = document.getElementById('odometerReading')?.value;
        const odometerMobile = document.getElementById('odometerMobile')?.value;
        
        return {
            vehicle_number: cashVehicleDesktop || cashVehicleMobile,
            odometer_reading: odometerDesktop || odometerMobile,
            vehicle_id: null
        };
    } else if (billType === 'CREDIT') {
        const creditVehicleDesktop = document.getElementById('creditVehicle')?.value;
        const creditVehicleMobile = document.getElementById('creditVehicleMobile')?.value;
        const odometerDesktop = document.getElementById('odometerReading')?.value;
        const odometerMobile = document.getElementById('odometerMobile')?.value;
        
        return {
            vehicle_number: null,
            odometer_reading: odometerDesktop || odometerMobile,
            vehicle_id: creditVehicleDesktop || creditVehicleMobile
        };
    }
    
    return { vehicle_number: null, odometer_reading: null, vehicle_id: null };
}


// Sync mobile and desktop form values
function syncFormValues() {
    console.log('Setting up form sync...');
    
    // 1. Sync shift selection
    const shiftDesktop = document.getElementById('shift');
    const shiftMobile = document.getElementById('shiftMobile');
    
    if (shiftDesktop && shiftMobile) {
        shiftDesktop.addEventListener('change', function() {
            shiftMobile.value = this.value;
            console.log('Synced shift to mobile:', this.value);
        });
        
        shiftMobile.addEventListener('change', function() {
            shiftDesktop.value = this.value;
            console.log('Synced shift to desktop:', this.value);
        });
    }
    
    // 2. Sync bill type
    const cashDesktop = document.getElementById('cashBill');
    const creditDesktop = document.getElementById('creditBill');
    const cashMobile = document.getElementById('cashBillMobile');
    const creditMobile = document.getElementById('creditBillMobile');
    
    if (cashDesktop && cashMobile) {
        cashDesktop.addEventListener('change', function() {
            if (this.checked) {
                cashMobile.checked = true;
                creditMobile.checked = false;
            }
        });
        
        cashMobile.addEventListener('change', function() {
            if (this.checked) {
                cashDesktop.checked = true;
                creditDesktop.checked = false;
            }
        });
    }
    
    if (creditDesktop && creditMobile) {
        creditDesktop.addEventListener('change', function() {
            if (this.checked) {
                creditMobile.checked = true;
                cashMobile.checked = false;
            }
        });
        
        creditMobile.addEventListener('change', function() {
            if (this.checked) {
                creditDesktop.checked = true;
                cashDesktop.checked = false;
            }
        });
    }
    
    // 3. Sync customer fields
    const cashCustomerDesktop = document.getElementById('cashCustomerName');
    const cashCustomerMobile = document.getElementById('cashCustomerMobile');
    const creditCustomerDesktop = document.getElementById('creditCustomer');
    const creditCustomerMobile = document.getElementById('creditCustomerMobile');
    
    if (cashCustomerDesktop && cashCustomerMobile) {
        cashCustomerDesktop.addEventListener('input', function() {
            cashCustomerMobile.value = this.value;
        });
        
        cashCustomerMobile.addEventListener('input', function() {
            cashCustomerDesktop.value = this.value;
        });
    }
    
    if (creditCustomerDesktop && creditCustomerMobile) {
        creditCustomerDesktop.addEventListener('change', function() {
            creditCustomerMobile.value = this.value;
        });
        
        creditCustomerMobile.addEventListener('change', function() {
            creditCustomerDesktop.value = this.value;
        });
    }
    
    // 4. Sync vehicle fields
    const cashVehicleDesktop = document.getElementById('cashVehicleNumber');
    const cashVehicleMobile = document.getElementById('cashVehicleMobile');
    const creditVehicleDesktop = document.getElementById('creditVehicle');
    const creditVehicleMobile = document.getElementById('creditVehicleMobile');
    
    if (cashVehicleDesktop && cashVehicleMobile) {
        cashVehicleDesktop.addEventListener('input', function() {
            cashVehicleMobile.value = this.value;
        });
        
        cashVehicleMobile.addEventListener('input', function() {
            cashVehicleDesktop.value = this.value;
        });
    }
    
    if (creditVehicleDesktop && creditVehicleMobile) {
        creditVehicleDesktop.addEventListener('change', function() {
            creditVehicleMobile.value = this.value;
        });
        
        creditVehicleMobile.addEventListener('change', function() {
            creditVehicleDesktop.value = this.value;
        });
    }
    
    // 5. Sync odometer
    const odometerDesktop = document.getElementById('odometerReading');
    const odometerMobile = document.getElementById('odometerMobile');
    
    if (odometerDesktop && odometerMobile) {
        odometerDesktop.addEventListener('input', function() {
            odometerMobile.value = this.value;
        });
        
        odometerMobile.addEventListener('input', function() {
            odometerDesktop.value = this.value;
        });
    }
}

function handleBillTypeChange(billType) {
    // Desktop Elements
    const cashCustomerDiv = document.getElementById('cashCustomerDiv');
    const creditCustomerDiv = document.getElementById('creditCustomerDiv');
    const cashVehicleDiv = document.getElementById('cashVehicleDiv');
    const creditVehicleDiv = document.getElementById('creditVehicleDiv');
    
    // Mobile Elements  
    const cashCustomerMobileDiv = document.getElementById('cashCustomerMobileDiv');
    const creditCustomerMobileDiv = document.getElementById('creditCustomerMobileDiv');
    const cashVehicleMobileDiv = document.getElementById('cashVehicleMobileDiv');
    const creditVehicleMobileDiv = document.getElementById('creditVehicleMobileDiv');
    
    if (billType === 'CREDIT') {
        // Show Credit fields, Hide Cash fields
        if (cashCustomerDiv) cashCustomerDiv.classList.add('d-none');
        if (creditCustomerDiv) creditCustomerDiv.classList.remove('d-none');
        if (cashVehicleDiv) cashVehicleDiv.classList.add('d-none');
        if (creditVehicleDiv) creditVehicleDiv.classList.remove('d-none');
        
        // Mobile
        if (cashCustomerMobileDiv) cashCustomerMobileDiv.classList.add('d-none');
        if (creditCustomerMobileDiv) creditCustomerMobileDiv.classList.remove('d-none');
        if (cashVehicleMobileDiv) cashVehicleMobileDiv.classList.add('d-none');
        if (creditVehicleMobileDiv) creditVehicleMobileDiv.classList.remove('d-none');
        
        // Set required and load vehicles
        const creditCustomerSelect = document.getElementById('creditCustomer');
        const creditCustomerMobileSelect = document.getElementById('creditCustomerMobile');
        if (creditCustomerSelect) creditCustomerSelect.required = true;
        if (creditCustomerMobileSelect) creditCustomerMobileSelect.required = true;
        
    } else {
        // Show Cash fields, Hide Credit fields
        if (cashCustomerDiv) cashCustomerDiv.classList.remove('d-none');
        if (creditCustomerDiv) creditCustomerDiv.classList.add('d-none');
        if (cashVehicleDiv) cashVehicleDiv.classList.remove('d-none');
        if (creditVehicleDiv) creditVehicleDiv.classList.add('d-none');
        
        // Mobile
        if (cashCustomerMobileDiv) cashCustomerMobileDiv.classList.remove('d-none');
        if (creditCustomerMobileDiv) creditCustomerMobileDiv.classList.add('d-none');
        if (cashVehicleMobileDiv) cashVehicleMobileDiv.classList.remove('d-none');
        if (creditVehicleMobileDiv) creditVehicleMobileDiv.classList.add('d-none');
        
        // Clear and remove required
        const creditCustomerSelect = document.getElementById('creditCustomer');
        const creditCustomerMobileSelect = document.getElementById('creditCustomerMobile');
        if (creditCustomerSelect) {
            creditCustomerSelect.required = false;
            creditCustomerSelect.value = '';
        }
        if (creditCustomerMobileSelect) {
            creditCustomerMobileSelect.required = false;
            creditCustomerMobileSelect.value = '';
        }
    }
}