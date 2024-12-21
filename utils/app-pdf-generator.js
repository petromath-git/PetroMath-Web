

const fs = require('fs');
const puppeteer = require('puppeteer');
const path = require('path');
const reportsController = require("../controllers/reports-controller");
const fonts = require('puppeteer-extra-plugin-fonts')();

puppeteer.use(fonts());




module.exports = {   

    getPDF : async (req,res,next) => {
      try {
        
        let htmlContent = '';

        if(req.body.reportType == 'CreditSummary')
        {
        htmlContent = await reportsController.getCreditSummaryReport(req, res, next);
        } else if (req.body.reportType == 'CreditDetails')
        {
        htmlContent = await reportsController.getCreditReport(req, res, next);
        }

                                   // Apply page break styles to the HTML content
                const pageBreakStyles = `
                                                  <style>
                                                   /* Include your updated styles here */
                                                    body {
                                                        font-family: "Segoe UI", "Arial", "Times New Roman", serif;
                                                        font-size: 16px;
                                                    }
                                      /* General table styling */
                                      table {
                                          width: 100%;
                                          border-collapse: collapse;
                                          border: 1px solid #ddd;
                                          page-break-inside: avoid; /* Prevent table from breaking across pages */
                                          margin-bottom: 20px; /* Optional: Adds space below tables */
                                      }
                                      th, td {
                                          border: 1px solid #ddd;
                                          padding: 8px;
                                          text-align: left;
                                      }
                                      tr {
                                          page-break-inside: avoid; /* Prevent rows from breaking across pages */
                                      }
                                      thead {
                                          display: table-header-group; /* Ensure headers are on the same page as the content */
                                      }
                                      tfoot {
                                          display: table-footer-group; /* Ensure footers are on the same page as the content */
                                      }

                                      /* Prevent breaking cards (if using cards around tables) */
                                      .card {
                                          page-break-inside: avoid;
                                     }                                     
                                  </style>
                                  `;
                                  
                htmlContent = pageBreakStyles + htmlContent; // Add the styles before the content
              console.log(htmlContent); 

        // const browser = await puppeteer.launch({executablePath: '/usr/bin/chromium-browser',ignoreDefaultArgs: ['--disable-extensions']});
              const browser = await puppeteer.launch({
						    executablePath: '/usr/bin/chromium-browser', // Path to your custom Chromium binary
						    ignoreDefaultArgs: ['--disable-extensions'], // Ignore disabling extensions
						    headless: true, // Run in headless mode
						    args: [
							      '--no-sandbox', // Disable sandbox for certain environments (optional)
							      '--disable-setuid-sandbox', // For environments where sandboxing is not allowed (optional)
							      '--font-render-hinting=none', // Disable font hinting for better font rendering
								'--disable-gpu',  // Optional: Might help in some cases
							      '--fontconfig',  // Ensure fontconfig is used
							      '--enable-font-antialiasing'  // Enable anti-aliasing for fonts
							    ]
				  });



        const page = await browser.newPage();
        await page.setContent(htmlContent);
        await page.waitForSelector('body'); // Wait for the body tag to ensure the page is loaded


const fonts = await page.evaluate(() => {
  const fontList = [];
  const testString = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  
  // Test a font family by creating a temporary element with that font
  const testFont = (fontFamily) => {
    const div = document.createElement('div');
    div.style.fontFamily = fontFamily;
    div.textContent = testString;
    document.body.appendChild(div);
    const computedStyle = window.getComputedStyle(div);
    fontList.push(computedStyle.fontFamily);
    document.body.removeChild(div);
  };

  testFont('Segoe UI');
  testFont('Arial');
  testFont('Times New Roman');
  // Add other font families as needed
  
  return fontList;
});

console.log(fonts); // Check which fonts are available

			await page.addStyleTag({
						      content: `
						      @font-face {
						      font-family: 'Roboto';
						      font-style: normal;
						      font-weight: 400;
						      src: local('Roboto'), local('Roboto-Regular'), url(https://fonts.gstatic.com/s/roboto/v18/KFOmCnqEu92Fr1Mu7GxKOzY.woff2) format('woff2');
						      unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2212, U+2215;
						    }
							  `
						});






       

        await page.evaluate(() => {
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
                if (td.textContent.trim() === 'Date:') {  // Replace 'Specific Text' with the text you're looking for
                td.remove();
                }
             });

             const alerts = document.querySelectorAll('.alert'); // Select all elements with class 'alert'
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
            format: 'A4',              // Set paper format
            printBackground: true,     // Include background styles
            displayHeaderFooter: true,
            headerTemplate: `<div style="text-align: center; width: 100%; padding: 10px 0;">
                           </div>
                            `, // Image header
            footerTemplate: `<div style="font-size: 10px; color: #555; text-align: center; width: 100%;">
                                <div style="border-top: 1px solid #ccc; margin: 0 auto 5px auto; width: 90%;"></div>
                                <span>This is a computer-generated document. Generated on: ${currentDateTime}</span>                              
                                <br>
                                <span style="font-size: 9px;">© ${currentYear} petromath.co.in</span>
                                <br>
                                <span style="font-size: 9px;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
                            </div>`,
            // margin: {                  // Add margins
            //     top: '20mm',
            //     bottom: '20mm',
            //     left: '10mm',
            //     right: '10mm',                
            // }
             margin: {
                top: '150px',
                bottom: '60px', // Space for the footer
                left: '10mm',
                right: '10mm',
              },
        });

      
        await browser.close();

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

 
