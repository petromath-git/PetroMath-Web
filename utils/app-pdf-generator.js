const fs = require('fs');
const puppeteer = require('puppeteer');
const path = require('path');
const reportsController = require("../controllers/reports-controller");
const cashflowReportsController = require("../controllers/reports-cashflow-controller");
const dsrReportsController = require("../controllers/reports-dsr-controller");
const gstReportsController = require("../controllers/reports-gst-summary-controller");
const digitalReconreportsController = require("../controllers/reports-digital-recon-controller");
const tallyDaybookReportsController = require("../controllers/reports-tally-daybook-controller");
const stockReportsController = require("../controllers/stock-reports-controller");
var locationdao = require("../dao/report-dao");
require('dotenv').config();
const { getBrowser } = require('./browserHelper');
const performance = require('perf_hooks').performance;

const msToSeconds = ms => (ms / 1000).toFixed(2);

module.exports = {   

    getPDF : async (req,res,next) => {
        const startTime = performance.now();
      try {
        
        let htmlContent = '';
        // for reports with multilocation select first check the locationcode.
        // if empty then select the default location
        let location = req.body.locationCode||req.user.location_code;
        console.log('Location '+location);
        
        const locationDetails = await locationdao.getLocationDetails(location);

        const contentStart = performance.now();

        if(req.body.reportType == 'CreditSummary')
        {
        htmlContent = await reportsController.getCreditSummaryReport(req, res, next);
        } else if (req.body.reportType == 'CreditDetails')
        {
           htmlContent = await reportsController.getCreditReport(req, res, next);
        }else if (req.body.reportType == 'DSR')
        {             
            htmlContent = await dsrReportsController.getdsrReport(req, res, next);
        }else if (req.body.reportType == 'CashFlow')
        {
            htmlContent = await cashflowReportsController.getCashFlowReport(req, res, next);
        }else if (req.body.reportType == 'Creditledger')
        {
             htmlContent = await reportsController.getCreditReport(req, res, next);
        }else if (req.body.reportType == 'GstSummary')
        {
            htmlContent = await gstReportsController.getgstsummaryReport(req, res, next);
        }
        else if (req.body.reportType == 'DigitalRecon')
        {
            htmlContent = await digitalReconreportsController.getDigitalReconReport(req, res, next);
        }
        else if (req.body.reportType == 'SalesSummary')
        {
            htmlContent = await reportsController.getSalesSummaryReport(req, res, next);
        }
        else if (req.body.reportType == 'TallyDaybook') {    
            htmlContent = await tallyDaybookReportsController.getTallyDaybookReport(req, res, next);
       }
       else if (req.body.reportType == 'StockSummary') {
            htmlContent = await stockReportsController.getStockSummaryReport(req, res, next);
        }
        else if (req.body.reportType == 'StockLedger') {
            htmlContent = await stockReportsController.getStockLedgerReport(req, res, next);
        }

        const contentEnd = performance.now();
        console.log(`HTML content generation took: ${contentEnd - contentStart}ms`);


                                   // Apply page break styles to the HTML content
                const pageBreakStyles = `
                                           <style>
                                        body {
                                            font-family: "Segoe UI", "Arial", "Times New Roman", serif;
                                            font-size: 16px;
                                            margin: 0;
                                            padding: 0;
                                        }

                                        /* Card styling */
                                        .card {
                                            page-break-inside: avoid;
                                            margin-bottom: 10px;
                                            border: 1px solid rgba(0,0,0,.125);
                                        }

                                        .card-header {
                                            padding: 0.75rem 1.25rem;
                                            background-color: rgba(0,0,0,.03);
                                            border-bottom: 1px solid rgba(0,0,0,.125);
                                        }

                                        .card-body {
                                            padding: 1.25rem;
                                        }

                                        /* Table styling */
                                        table {
                                            width: 100%;
                                            border-collapse: collapse;
                                            border: 2px solid #000;
                                            margin-bottom: 0; /* Remove bottom margin from table */
                                        }

                                        th, td {
                                            border: 2px solid #000;
                                            padding: 8px;
                                            text-align: left;
                                        }

                                        thead {
                                            display: table-header-group;
                                        }

                                        tbody {
                                            display: table-row-group;
                                        }
                                       
                                       
                                    </style>
                                  `;
                                  
                htmlContent = pageBreakStyles + htmlContent; // Add the styles before the content

               

             
                const pdfStart = performance.now();
                const browser = await getBrowser(); // Get the already launched browser

        //const browser = await puppeteer.launch();
//        const browser = await puppeteer.launch({executablePath: process.env.CHROMIUM_PATH,ignoreDefaultArgs: ['--disable-extensions']});
        
        
        
        const browserend = performance.now();
        console.log(`Browser handle generation took: ${browserend - pdfStart}ms`);
        const page = await browser.newPage();
        const pageend = performance.now();
        console.log(`Browser New page  generation took: ${pageend - browserend}ms`);
      //  await page.setContent(htmlContent);
     //   await page.waitForSelector('body'); // Wait for the body tag to ensure the page is loaded
        
             // Set content with optimized options
             await page.setContent(htmlContent, {
                waitUntil: 'domcontentloaded',
                timeout: 5000
            });

        const pdfEnd = performance.now();
        console.log(`Content Load took: ${pdfEnd - pageend}ms`);
        console.log(`PDF generation took: ${pdfEnd - pdfStart}ms`);
       

        // await page.evaluate(() => {
        //     // Hide all buttons
        //     const buttons = document.querySelectorAll('button');
        //     buttons.forEach(button => button.remove());

        //     // Select the form
        //     const form = document.querySelector('form');

        //     // Hide all elements inside the form
        //     if (form) {
        //         const children = form.querySelectorAll('*'); // Select all child elements
	    //             children.forEach(child => child.style.display = 'none');
        //     }
          
        //     // Hide all text boxes
        //     const textBoxes = document.querySelectorAll('input[type="text"], input[type="date"]');
        //     textBoxes.forEach(textBox => textBox.remove());

        //     const tds = document.querySelectorAll('td');
            
        //     tds.forEach(td => {
        //         if (td.textContent.trim() === 'Date:') {  
        //         td.remove();
        //         }
        //      });

             
        //      const alerts = document.querySelectorAll('.alert:not(.period-summary)'); 
        //      alerts.forEach(alert => alert.remove()); // Remove each alert element 

        //      const element = document.getElementById('petromath-heading'); // Select the element by ID
        //      if (element) {
        //         element.remove();
        //      }

        //      const footer = document.querySelector('.pageNumber');
        //      if (footer) {
        //         footer.textContent = 'Page ' + window.pageNumber + ' of ' + window.totalPages;
        //      }


        //   });

          

        await page.evaluate(() => {
            // Hide the new vertical sidebar
            const sidebar = document.querySelector('.sidebar');
            if (sidebar) {
                sidebar.style.display = 'none';
            }

            // Hide the top bar
            const topBar = document.querySelector('.top-bar');
            if (topBar) {
                topBar.style.display = 'none';
            }

            // Adjust main content to remove left margin for PDF
            const mainContent = document.querySelector('.main-content');
            if (mainContent) {
                mainContent.style.marginLeft = '0';
                mainContent.style.width = '100%';
            }

            // Remove content wrapper padding for better PDF layout
            const contentWrapper = document.querySelector('.content-wrapper');
            if (contentWrapper) {
                contentWrapper.style.padding = '0';
            }

            // Hide all buttons
            const buttons = document.querySelectorAll('button');
            buttons.forEach(button => button.remove());

            // Select the form
            const form = document.querySelector('form');

            // Hide all elements inside the form
            if (form) {
                const children = form.querySelectorAll('*'); // Select all child elements
                children.forEach(child => child.style.display = 'none');
            }
        
            // Hide all text boxes
            const textBoxes = document.querySelectorAll('input[type="text"], input[type="date"]');
            textBoxes.forEach(textBox => textBox.remove());

            const tds = document.querySelectorAll('td');
            
            tds.forEach(td => {
                if (td.textContent.trim() === 'Date:') {  
                td.remove();
                }
            });

     
     const alerts = document.querySelectorAll('.alert:not(.period-summary)'); 
     alerts.forEach(alert => alert.remove()); // Remove each alert element 

     const element = document.getElementById('petromath-heading'); // Select the element by ID
     if (element) {
        element.remove();
     }

     const footer = document.querySelector('.pageNumber');
     if (footer) {
        footer.textContent = 'Page ' + window.pageNumber + ' of ' + window.totalPages;
     }
});


        
        const currentYear = new Date().getFullYear();
        const currentDateTime = new Date().toLocaleString();
//        const imageBase64 = convertImageToBase64('MME_Header.jpg');
        
  

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            displayHeaderFooter: true,
            headerTemplate:`<div style="font-size: 16px; text-align: center; width: 100%; margin-bottom: 20px;">
                                <strong>${locationDetails.location_name}</strong><br>
                                <span style="font-size: 14px;">${locationDetails.address}</span>
                                <div style="border-bottom: 2px solid #ccc; margin: 10px auto 5px auto; width: 90%;"></div>
                            </div>`,
            footerTemplate: `<div style="font-size: 14px; text-align: center; width: 100%;">
                <div style="border-top: 1px solid #ccc; margin: 0 auto 5px auto; width: 90%;"></div>
                <span>This is a computer-generated document and requires no signature. Generated on: ${currentDateTime}</span>                              
                <br>
                <span style="font-size: 12px;">© ${currentYear} petromath.co.in</span>
                <br>
                <span style="font-size: 12px;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
            </div>`,
            margin: {
                top: '120px',    // Increased from 80px to give more space for header
                bottom: '90px',  // Increased from 60px to give more space for footer
                left: '20px',
                right: '20px'
            }
        });

      
        //await browser.close();
        await page.close(); // Close the tab, but NOT the browser

        console.log('PDF buffer size:', pdfBuffer.length); // Log the buffer size
        
        console.log(process.cwd());
         
         fs.writeFileSync('output1.pdf', pdfBuffer);
         
         const pdfPath = path.join(process.cwd(), 'output1.pdf');

         
        //  Set headers for PDF response
        // res.setHeader('Content-Type', 'application/pdf');
        // res.setHeader('Content-Disposition', 'attachment; filename="output.pdf"');
    
       
       // res.send(pdfBuffer); // Send the PDF buffer to the client

       // Send the PDF file back to the client
       res.download(pdfPath, 'output1.pdf', (err) => {
        if (err) {
            console.error('Error sending file:', err);
            res.status(500).send('Error downloading the file');
        } else {
            // Optionally delete the file after sending it
            fs.unlink(pdfPath, (unlinkErr) => {
                if (unlinkErr) console.error('Error deleting file:', unlinkErr);
            });
        }
        });


      } catch (error) {
        console.error('Error generating PDF: Routing', error);
        res.status(500).send('Error generating PDF');
      }

}

};

function convertImageToBase64(imagePath){
    const image = fs.readFileSync(imagePath);
    return `data:image/jpeg;base64,${image.toString('base64')}`;  // Assuming the image is JPEG
  }

 

