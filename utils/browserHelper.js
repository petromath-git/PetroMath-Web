const puppeteer = require('puppeteer');

let browser; // Shared browser instance

// Function to launch the browser if not already running
async function getBrowser() {
    if (!browser) {
        // browser = await puppeteer.launch({
        //     headless: true, // Set to false if debugging
        //     args: ['--no-sandbox', '--disable-setuid-sandbox']
        // });

        browser = await puppeteer.launch({executablePath: process.env.CHROMIUM_PATH,ignoreDefaultArgs: ['--disable-extensions']});
        console.log('Puppeteer browser launched.');
    }
    return browser;
}

// Function to close the browser gracefully
async function closeBrowser() {
    if (browser) {
        await browser.close();
        console.log('Puppeteer browser closed.');
        browser = null;
    }
}

module.exports = { getBrowser, closeBrowser };
