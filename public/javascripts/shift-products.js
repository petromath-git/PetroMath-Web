async function loadShiftProducts() {
    console.log('=== SHIFT PRODUCTS DEBUG START ===');
    
    try {
        const closingId = document.getElementById('closing_hiddenId')?.value;
        
        
        if (!closingId) {
            
            renderEmptyShiftProducts();
            return;
        }
        
        const apiUrl = `/api/shift-products/${closingId}`;
        
        
        const response = await fetch(apiUrl);
        
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const products = await response.json();
        
        
        renderShiftProducts(products);
        
    } catch (error) {
        
        renderEmptyShiftProducts();
    }
    
    
}


function renderShiftProducts(products) {
    console.log('Rendering products:', products);
    
    const container = document.getElementById('shift-products-container');
    if (!container) {
        console.error('Container #shift-products-container not found!');
        return;
    }
    
    if (!products || products.length === 0) {
        container.innerHTML = '<div class="col-12"><div class="text-muted">No products recorded for this shift</div></div>';
        return;
    }
    
    // Create table structure like the original
    let tableHtml = `
        <div class="col-12">
            <div class="table-responsive">
                <table class="table table-sm table-secondary">
                    <tbody>
    `;
    
    products.forEach(product => {
        // Convert RGB string to proper CSS format
        const rgbColor = product.rgb_color.includes(',') 
            ? `rgb(${product.rgb_color})` 
            : product.rgb_color;
        
        const formattedAmount = parseFloat(product.total_amount || 0).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 3
        });
        
        tableHtml += `
            <tr style="background-color: ${rgbColor};">
                <td>
                    <span>${product.product_code} Sales</span>
                </td>
                <td class="font-weight-bold">
                    <span>${formattedAmount}</span>
                </td>
            </tr>
        `;
    });
    
    tableHtml += `
                    </tbody>
                </table>
            </div>
        </div>
    `;
    
    container.innerHTML = tableHtml;
    console.log('Products rendered successfully');
}

function renderEmptyShiftProducts() {
    const container = document.getElementById('shift-products-container');
    if (!container) {
        console.error('Container #shift-products-container not found for empty state!');
        return;
    }
    
    container.innerHTML = '<div class="col-12"><div class="text-muted">No products recorded for this shift</div></div>';
}

// Test the function manually
window.testShiftProducts = loadShiftProducts;