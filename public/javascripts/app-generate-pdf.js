
function generatePDF(currentPage,isPrint = 'N') { 

    const loadingOverlay = document.getElementById('loadingOverlay');
    if(loadingOverlay)
    {
    loadingOverlay.style.display = 'flex'; // Show overlay
    }

    const requestBody = {};

    requestBody.caller = 'PDF';

    if (currentPage.includes('creditsummary')) {
        requestBody.reportType = 'CreditSummary';
        requestBody.toClosingDate = document.getElementById('toclosingDate').value;
    }else if (currentPage.includes('reports-cashflow-detailed')) {
    requestBody.reportType = 'CashflowDetailed';
    requestBody.fromClosingDate = document.getElementById('fromclosingDate').value;
    requestBody.toClosingDate = document.getElementById('toclosingDate').value;
    } else if (currentPage.includes('reports-cashflow')){
        requestBody.reportType = 'CashFlow';
        requestBody.cfclosingDate = document.getElementById('cfclosingDate').value;       
    } else if (currentPage.includes('reports-dsr')){
        requestBody.reportType = 'DSR';
        requestBody.fromClosingDate = document.getElementById('fromClosingDate').value; 
        const locationCodeElement = document.getElementById('locationCode');
        requestBody.locationCode = locationCodeElement ? locationCodeElement.value:'';  // if no location code obtained
                                                                                        // subsequent code will use req.user.location_code
    } else if (currentPage.includes('reports-credit-ledger')) {
        requestBody.reportType = 'Creditledger';
        requestBody.fromClosingDate = document.getElementById('fromclosingDate').value;
        requestBody.toClosingDate = document.getElementById('toclosingDate').value;
        requestBody.company_id = document.getElementById('company_id').value;
    }  else if (currentPage.includes('reports-gst-summary')) {
        requestBody.reportType = 'GstSummary';
        requestBody.fromClosingDate = document.getElementById('fromclosingDate').value;
        requestBody.toClosingDate = document.getElementById('toclosingDate').value; 
        const locationCodeElement = document.getElementById('locationCode');
        requestBody.locationCode = locationCodeElement ? locationCodeElement.value:'';  // if no location code obtained
                                                                                        // subsequent code will use req.user.location_code       
    }else if (currentPage.includes('reports/stock/summary')) {
        requestBody.reportType = 'StockSummary';
        requestBody.fromDate = document.getElementById('fromDate').value;
        requestBody.toDate = document.getElementById('toDate').value;
    }else if (currentPage.includes('reports/stock/ledger')) {
        requestBody.reportType = 'StockLedger';
        requestBody.fromDate = document.getElementById('fromDate').value;
        requestBody.toDate = document.getElementById('toDate').value;
        requestBody.productId = document.getElementById('productId').value;
    }else if (currentPage.includes('reports-digital-recon')) {
        requestBody.reportType = 'DigitalRecon';
        requestBody.fromClosingDate = document.getElementById('fromclosingDate').value;
        requestBody.toClosingDate = document.getElementById('toclosingDate').value;
        requestBody.company_id = document.getElementById('company_id').value;        
    }else if (currentPage.includes('reports-sales-summary')) {
        requestBody.reportType = 'SalesSummary';
        requestBody.fromClosingDate = document.getElementById('fromclosingDate').value;
        requestBody.toClosingDate = document.getElementById('toclosingDate').value;        
    }else if (currentPage.includes('reports-tally-daybook')) {
    requestBody.reportType = 'TallyDaybook';
    requestBody.fromClosingDate = document.getElementById('fromclosingDate').value;
    requestBody.toClosingDate = document.getElementById('toclosingDate').value;
    }else if (currentPage.includes('reports')) {
        requestBody.reportType = 'CreditDetails';
        requestBody.fromClosingDate = document.getElementById('fromclosingDate').value;
        requestBody.toClosingDate = document.getElementById('toclosingDate').value;
        requestBody.company_id = document.getElementById('company_id').value;
    }    
    else {
        requestBody.reportType = 'GeneralReport';
    }


    const timestamp = new Date();
    const formattedTimestamp = `${String(timestamp.getDate())
                               .padStart(2, '0')}${String(timestamp.getMonth() + 1)
                               .padStart(2, '0')}${timestamp.getFullYear()}_${String(timestamp.getHours())
                               .padStart(2, '0')}${String(timestamp.getMinutes())
                               .padStart(2, '0')}${String(timestamp.getSeconds())
                               .padStart(2, '0')}`;                 
    
    fetch('/generate-pdf', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        })
        .then(response => {
            if (response.ok) {                            
                return response.blob();
            } else {
                throw new Error('Failed to generate PDF');
            }
        })
        .then((blob) => {
            const url = window.URL.createObjectURL(blob);
            
            if(isPrint=='N'){
            const a = document.createElement('a');
            a.href = url;
            a.download = `${requestBody.reportType}_${formattedTimestamp}.pdf`;;
            document.body.appendChild(a);
            a.click();
            a.remove();
            }
            else{
            const newTab = window.open(url, '_blank'); // Open PDF in a new tab
            if (newTab) {
            newTab.focus();
            //newTab.onload = () => {newTab.print(); // Automatically triggers print
            //                }
            }
        }

         // Hide the overlay after file is prepared
        document.getElementById('loadingOverlay').style.display = 'none';

        })
        .catch((error) =>{             
            console.error('Error downloading PDF:', error);
            // Hide the overlay if there was an error
            document.getElementById('loadingOverlay').style.display = 'none';
        });

} 