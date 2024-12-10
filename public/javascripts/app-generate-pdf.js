
function generatePDF(currentPage) { 

    

    const requestBody = {};

    requestBody.caller = 'PDF';

    if (currentPage.includes('creditsummary')) {
        requestBody.reportType = 'CreditSummary';
        requestBody.toClosingDate = document.getElementById('toclosingDate').value;
    } else if (currentPage.includes('reports')) {
        requestBody.reportType = 'CreditDetails';
        requestBody.fromClosingDate = document.getElementById('fromclosingDate').value;
        requestBody.toClosingDate = document.getElementById('toclosingDate').value;
        requestBody.company_id = document.getElementById('company_id').value;
    } else {
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
            const a = document.createElement('a');
            a.href = url;
            a.download = `${requestBody.reportType}_${formattedTimestamp}.pdf`;;
            document.body.appendChild(a);
            a.click();
            a.remove();
        })
        .catch((error) => console.error('Error downloading PDF:', error));


} 