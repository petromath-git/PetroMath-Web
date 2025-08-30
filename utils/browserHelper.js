const puppeteer = require('puppeteer');
const os = require('os');

let browser; // Shared browser instance
let isLaunching = false; // Prevent multiple simultaneous launches

// Detect if we're running on Windows
const isWindows = os.platform() === 'win32';
const isLinux = os.platform() === 'linux';
const isDevelopment = process.env.NODE_ENV !== 'production';

// Get Chrome launch arguments based on environment
function getChromeArgs() {
    const baseArgs = [
        // Universal optimizations
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-component-extensions-with-background-pages',
        '--disable-sync',
        '--disable-translate',
        '--disable-client-side-phishing-detection',
        '--disable-hang-monitor',
        '--disable-prompt-on-repost',
        '--disable-domain-reliability',
        '--disable-infobars',
        '--force-color-profile=srgb',
        '--no-first-run',
        '--no-default-browser-check'
    ];

    if (isLinux) {
        // Linux-specific args (production server)
        return [
            ...baseArgs,
            // Essential for Linux servers
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            
            // Linux server memory optimizations
            '--memory-pressure-off',
            '--max_old_space_size=4096',
            '--disable-background-networking',
            
            // Linux server security (internal use)
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--run-all-compositor-stages-before-draw',
            '--disable-checker-imaging',
            '--disable-gpu-early-init',
            '--disable-gpu-sandbox',
            '--disable-font-subpixel-positioning',
            
            // Headless mode for server
            '--headless=new',
            '--hide-scrollbars',
            '--mute-audio'
        ];
    } else if (isWindows) {
        // Windows-specific args (development)
        return [
            ...baseArgs,
            // Windows development - more lenient settings
            '--disable-dev-shm-usage', // Still useful on Windows
            
            // Windows-specific optimizations
            '--disable-background-networking',
            '--disable-features=VizDisplayCompositor',
            
            // Windows development - keep some debugging capabilities
            ...(isDevelopment ? [
                // Development mode - visible browser for debugging
                '--headless=new', // Still headless, but can be changed
                '--disable-gpu', // Avoid GPU issues on dev machines
            ] : [
                // Production mode on Windows
                '--headless=new',
                '--hide-scrollbars',
                '--mute-audio'
            ])
        ];
    } else {
        // macOS or other platforms
        return [
            ...baseArgs,
            '--headless=new',
            '--disable-dev-shm-usage'
        ];
    }
}

// Get launch options based on environment
function getLaunchOptions() {
    const options = {
        headless: 'new',
        args: getChromeArgs(),
        ignoreDefaultArgs: false,
        timeout: isWindows ? 15000 : 10000, // Windows can be slower
    };

    // Use custom executable path if provided (mainly for Linux servers)
    if (process.env.CHROMIUM_PATH) {
        options.executablePath = process.env.CHROMIUM_PATH;
    }

    // Windows development specific options
    if (isWindows && isDevelopment) {
        options.devtools = false; // Keep devtools closed for performance
        options.slowMo = 0; // No slow motion in development
    }

    return options;
}

// Function to launch the browser if not already running
async function getBrowser() {
    // If browser exists and is connected, return it
    if (browser && browser.isConnected()) {
        return browser;
    }
    
    // If browser is in the process of launching, wait for it
    if (isLaunching) {
        while (isLaunching) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return browser;
    }
    
    isLaunching = true;
    
    try {
        const launchOptions = getLaunchOptions();
        
        console.log(`Launching Puppeteer browser on ${os.platform()} with optimized settings...`);
        if (isDevelopment) {
            console.log('Development mode detected - using dev-friendly settings');
        }
        
        const startTime = Date.now();
        
        browser = await puppeteer.launch(launchOptions);
        
        const launchTime = Date.now() - startTime;
        console.log(`✅ Puppeteer browser launched successfully in ${launchTime}ms`);
        
        // Add error handlers
        browser.on('disconnected', () => {
            console.log('🔌 Browser disconnected, will relaunch on next request');
            browser = null;
        });
        
        // Different monitoring based on platform
        if (isLinux) {
            // Aggressive cleanup for Linux servers
            setInterval(async () => {
                if (browser && browser.isConnected()) {
                    try {
                        const pages = await browser.pages();
                        if (pages.length > 5) {
                            console.log(`⚠️  Warning: ${pages.length} pages open in browser`);
                            
                            // Close pages older than 30 seconds (except the first one)
                            for (let i = 1; i < pages.length; i++) {
                                try {
                                    await pages[i].close();
                                } catch (e) {
                                    // Ignore close errors
                                }
                            }
                        }
                    } catch (e) {
                        // Ignore monitoring errors
                    }
                }
            }, 5 * 60 * 1000); // Every 5 minutes
        } else {
            // Gentler cleanup for development machines
            setInterval(async () => {
                if (browser && browser.isConnected()) {
                    try {
                        const pages = await browser.pages();
                        if (pages.length > 10) { // Higher threshold for dev
                            console.log(`⚠️  Dev: ${pages.length} pages open in browser`);
                        }
                    } catch (e) {
                        // Ignore monitoring errors
                    }
                }
            }, 10 * 60 * 1000); // Every 10 minutes
        }
        
    } catch (error) {
        console.error('❌ Failed to launch browser:', error.message);
        
        // Platform-specific error guidance
        if (isWindows && error.message.includes('spawn')) {
            console.error('💡 Windows: Try installing Chrome or set CHROME_PATH environment variable');
        } else if (isLinux && error.message.includes('sandbox')) {
            console.error('💡 Linux: Sandbox issues - check server configuration');
        }
        
        browser = null;
        throw error;
    } finally {
        isLaunching = false;
    }
    
    return browser;
}

// Function to close the browser gracefully
async function closeBrowser() {
    if (browser) {
        try {
            await browser.close();
            console.log('✅ Puppeteer browser closed gracefully');
        } catch (error) {
            console.error('⚠️  Error closing browser:', error.message);
        }
        browser = null;
    }
}

// Function to get browser info for debugging
async function getBrowserInfo() {
    if (browser && browser.isConnected()) {
        const version = await browser.version();
        const pages = await browser.pages();
        return {
            platform: os.platform(),
            version,
            connected: browser.isConnected(),
            pageCount: pages.length,
            wsEndpoint: browser.wsEndpoint(),
            isDevelopment,
            args: getChromeArgs()
        };
    }
    return { 
        platform: os.platform(),
        connected: false, 
        pageCount: 0,
        isDevelopment 
    };
}

// Graceful shutdown handler (works on both Windows and Linux)
const shutdown = async () => {
    console.log('🛑 Shutting down, closing browser...');
    await closeBrowser();
    process.exit(0);
};

// Windows uses different signals
if (isWindows) {
    process.on('SIGINT', shutdown);
    process.on('SIGBREAK', shutdown);
} else {
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

module.exports = { 
    getBrowser, 
    closeBrowser, 
    getBrowserInfo,
    isWindows,
    isLinux,
    isDevelopment
};