// controllers/system-health-controller.js
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const os = require('os');
const execAsync = promisify(exec);


// Import database connection
const db = require("../db/db-connection");

// For direct MySQL queries (some health checks need raw SQL)
let mysql;
let dbConfig;

try {
    mysql = require('mysql2/promise');
    const deploymentConfig = "../config/app-deployment-" + process.env.ENVIRONMENT;
    dbConfig = require(deploymentConfig);
} catch (error) {
    console.warn('mysql2 not available - database health checks will be limited:', error.message);
    mysql = null;
    dbConfig = null;
}


module.exports = {
    // Main dashboard page
    getSystemHealthDashboard: async (req, res, next) => {
        try {
            // Get initial metrics for page load
            const initialMetrics = await gatherAllMetrics();
            
            res.render('system-health', {
                title: 'System Health Monitor',
                user: req.user,
                initialMetrics: JSON.stringify(initialMetrics),
                messages: req.flash()
            });

        } catch (error) {
            console.error('Error in getSystemHealthDashboard:', error);
            req.flash('error', 'Failed to load system health dashboard: ' + error.message);
            res.redirect('/home');
        }
    },

    // API endpoint for real-time metrics
    getSystemMetrics: async (req, res) => {
        try {
            const metrics = await gatherAllMetrics();
            
            res.json({
                success: true,
                data: metrics,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Error in getSystemMetrics:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch system metrics: ' + error.message
            });
        }
    },

    // Server performance specific data
    getServerPerformance: async (req, res) => {
        try {
            const performance = await gatherServerPerformance();
            
            res.json({
                success: true,
                data: performance
            });

        } catch (error) {
            console.error('Error in getServerPerformance:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch server performance: ' + error.message
            });
        }
    },

    // Database health metrics
    getDatabaseHealth: async (req, res) => {
        try {
            const dbHealth = await gatherDatabaseHealth();
            
            res.json({
                success: true,
                data: dbHealth
            });

        } catch (error) {
            console.error('Error in getDatabaseHealth:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch database health: ' + error.message
            });
        }
    },

    // Network performance tests
    getNetworkPerformance: async (req, res) => {
        try {
            const networkPerf = await gatherNetworkPerformance();
            
            res.json({
                success: true,
                data: networkPerf
            });

        } catch (error) {
            console.error('Error in getNetworkPerformance:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch network performance: ' + error.message
            });
        }
    },

    // Storage utilization data
    getStorageUtilization: async (req, res) => {
        try {
            const storage = await gatherStorageUtilization();
            
            res.json({
                success: true,
                data: storage
            });

        } catch (error) {
            console.error('Error in getStorageUtilization:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch storage utilization: ' + error.message
            });
        }
    },

    // System services status
    getServicesStatus: async (req, res) => {
        try {
            const services = await gatherServicesStatus();
            
            res.json({
                success: true,
                data: services
            });

        } catch (error) {
            console.error('Error in getServicesStatus:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch services status: ' + error.message
            });
        }
    },

    // Historical metrics for trending
    getMetricsHistory: async (req, res) => {
        try {
            // This would fetch from a metrics history table in the future
            res.status(501).json({
                success: false,
                message: 'Historical metrics feature is coming soon'
            });

        } catch (error) {
            console.error('Error in getMetricsHistory:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch metrics history: ' + error.message
            });
        }
    }
};

// Helper function to gather all system metrics
async function gatherAllMetrics() {
    try {
        const [
            serverPerf,
            dbHealth,
            networkPerf,
            storage,
            services
        ] = await Promise.all([
            gatherServerPerformance(),
            gatherDatabaseHealth(),
            gatherNetworkPerformance(),
            gatherStorageUtilization(),
            gatherServicesStatus()
        ]);

        return {
            server: serverPerf,
            database: dbHealth,
            network: networkPerf,
            storage: storage,
            services: services,
            systemInfo: getBasicSystemInfo()
        };
    } catch (error) {
        console.error('Error gathering all metrics:', error);
        throw error;
    }
}

// Server performance metrics
async function gatherServerPerformance() {
    try {
        // CPU usage
        const cpuUsage = await getCpuUsage();
        
        // Memory usage
        const memInfo = await getMemoryInfo();
        
        // Load average
        const loadAvg = os.loadavg();
        
        // Uptime
        const uptime = os.uptime();

        return {
            cpu: {
                usage: cpuUsage,
                cores: os.cpus().length
            },
            memory: memInfo,
            loadAverage: {
                oneMin: loadAvg[0],
                fiveMin: loadAvg[1],
                fifteenMin: loadAvg[2]
            },
            uptime: {
                seconds: uptime,
                formatted: formatUptime(uptime)
            }
        };
    } catch (error) {
        console.error('Error gathering server performance:', error);
        throw error;
    }
}

// Database health metrics

async function gatherDatabaseHealth() {
    try {
        // Check if mysql2 is available
        if (!mysql || !dbConfig) {
            return {
                status: 'mysql2_not_available',
                error: 'mysql2 package not installed',
                connections: { active: 0, max: 0, running: 0, maxUsed: 0, totalConnections: 0 },
                performance: { uptime: 0, totalQueries: 0, slowQueries: 0, queriesPerSecond: 0 },
                storage: { databaseSize: 0, bufferPoolSize: 0 },
                tables: { locked: 0, databaseName: 'unknown' },
                health: { connectionUsage: 0, slowQueryRate: 0 }
            };
        }

        // Create a direct MySQL connection for health checks
        const connection = await mysql.createConnection({
            host: dbConfig.HOST,
            port: dbConfig.PORT,
            user: dbConfig.USER,
            password: dbConfig.PASSWORD,
            database: dbConfig.DB
        });

        // Test basic connectivity
        await connection.ping();

        // Get global status variables
        const [statusRows] = await connection.execute(`
            SHOW GLOBAL STATUS WHERE Variable_name IN (
                'Connections', 'Max_used_connections', 'Threads_connected', 
                'Threads_running', 'Slow_queries', 'Questions', 'Uptime'
            )
        `);

        // Get global variables for limits
        const [variableRows] = await connection.execute(`
            SHOW GLOBAL VARIABLES WHERE Variable_name IN (
                'max_connections', 'innodb_buffer_pool_size'
            )
        `);

        // Get database size
        const [sizeRows] = await connection.execute(`
            SELECT 
                ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS size_mb
            FROM information_schema.tables 
            WHERE table_schema = ?
        `, [dbConfig.DB]);

        // Get table lock status
        const [lockRows] = await connection.execute('SHOW OPEN TABLES WHERE In_use > 0');

        // Convert status and variables to key-value objects
        const statusMap = {};
        statusRows.forEach(row => {
            statusMap[row.Variable_name] = row.Value;
        });

        const variableMap = {};
        variableRows.forEach(row => {
            variableMap[row.Variable_name] = row.Value;
        });

        await connection.end();

        return {
            status: 'connected',
            connections: {
                active: parseInt(statusMap.Threads_connected || 0),
                running: parseInt(statusMap.Threads_running || 0),
                max: parseInt(variableMap.max_connections || 151),
                maxUsed: parseInt(statusMap.Max_used_connections || 0),
                totalConnections: parseInt(statusMap.Connections || 0)
            },
            performance: {
                uptime: parseInt(statusMap.Uptime || 0),
                totalQueries: parseInt(statusMap.Questions || 0),
                slowQueries: parseInt(statusMap.Slow_queries || 0),
                queriesPerSecond: Math.round((parseInt(statusMap.Questions || 0)) / Math.max(parseInt(statusMap.Uptime || 1), 1))
            },
            storage: {
                databaseSize: sizeRows[0]?.size_mb || 0,
                bufferPoolSize: Math.round(parseInt(variableMap.innodb_buffer_pool_size || 0) / 1024 / 1024)
            },
            tables: {
                locked: lockRows.length,
                databaseName: dbConfig.DB
            }
        };
    } catch (error) {
        console.error('Error gathering database health:', error);
        return {
            status: 'error',
            error: error.message,
            connections: { active: 0, max: 0, running: 0, maxUsed: 0, totalConnections: 0 },
            performance: { uptime: 0, totalQueries: 0, slowQueries: 0, queriesPerSecond: 0 },
            storage: { databaseSize: 0, bufferPoolSize: 0 },
            tables: { locked: 0, databaseName: dbConfig?.DB || 'unknown' }
        };
    }
}

// Network performance metrics
async function gatherNetworkPerformance() {
    try {
        const networkInterfaces = os.networkInterfaces();
        
        return {
            interfaces: Object.keys(networkInterfaces).length,
            connectivity: 'online',
            latency: '0ms'
        };
    } catch (error) {
        console.error('Error gathering network performance:', error);
        throw error;
    }
}

// Storage utilization metrics
async function gatherStorageUtilization() {
    try {
        // Get disk usage for root filesystem
        const { stdout: dfOutput } = await execAsync('df -h /');
        const dfLines = dfOutput.trim().split('\n');
        const rootData = dfLines[1].split(/\s+/);

        // Get disk usage for all mounted filesystems
        const { stdout: dfAllOutput } = await execAsync('df -h');
        const allLines = dfAllOutput.trim().split('\n').slice(1); // Skip header
        const allFilesystems = allLines.map(line => {
            const parts = line.split(/\s+/);
            return {
                filesystem: parts[0],
                size: parts[1],
                used: parts[2],
                available: parts[3],
                usagePercent: parseInt(parts[4]) || 0,
                mountPoint: parts[5]
            };
        }).filter(fs => !fs.filesystem.startsWith('tmpfs') && !fs.filesystem.startsWith('udev'));

        // Get inode usage
        let inodeInfo = {};
        try {
            const { stdout: inodeOutput } = await execAsync('df -i /');
            const inodeLines = inodeOutput.trim().split('\n');
            const inodeData = inodeLines[1].split(/\s+/);
            inodeInfo = {
                total: inodeData[1],
                used: inodeData[2],
                available: inodeData[3],
                usagePercent: parseInt(inodeData[4]) || 0
            };
        } catch (error) {
            console.log('Could not gather inode information');
        }

        // Get I/O statistics if available
        let ioStats = {};
        try {
            const { stdout: iostatOutput } = await execAsync('iostat -d 1 1 2>/dev/null | tail -n +4');
            // This is optional as iostat might not be available
        } catch (error) {
            console.log('iostat not available');
        }

        return {
            root: {
                filesystem: rootData[0],
                total: rootData[1],
                used: rootData[2],
                available: rootData[3],
                usagePercent: parseInt(rootData[4]) || 0,
                mountPoint: rootData[5]
            },
            allFilesystems: allFilesystems,
            inodes: inodeInfo,
            ioStats: ioStats
        };
    } catch (error) {
        console.error('Error gathering storage utilization:', error);
        return {
            root: {
                filesystem: 'Unknown',
                total: 'Unknown',
                used: 'Unknown',
                available: 'Unknown',
                usagePercent: 0,
                mountPoint: '/'
            },
            allFilesystems: [],
            inodes: {},
            ioStats: {}
        };
    }
}

// System services status
async function gatherServicesStatus() {
    try {
        const platform = os.platform();
        const serviceStatuses = {};
        
        if (platform === 'win32') {
            // Windows services (common service names)
            const windowsServices = ['MySQL80', 'nginx', 'W3SVC']; // IIS as alternative to nginx
            
            for (const service of windowsServices) {
                try {
                    const { stdout } = await execAsync(`sc query "${service}"`);
                    if (stdout.includes('RUNNING')) {
                        serviceStatuses[service] = 'running';
                    } else if (stdout.includes('STOPPED')) {
                        serviceStatuses[service] = 'stopped';
                    } else {
                        serviceStatuses[service] = 'unknown';
                    }
                } catch (error) {
                    // Service might not exist
                    serviceStatuses[service] = 'not_found';
                }
            }
        } else {
            // Linux services (existing code)
            const criticalServices = ['mysql', 'nginx', 'ssh'];
            
            for (const service of criticalServices) {
                try {
                    const { stdout } = await execAsync(`systemctl is-active ${service}`);
                    serviceStatuses[service] = stdout.trim() === 'active' ? 'running' : 'stopped';
                } catch (error) {
                    serviceStatuses[service] = 'unknown';
                }
            }
        }
        
        return {
            ...serviceStatuses,
            platform: platform
        };
    } catch (error) {
        console.error('Error gathering services status:', error);
        return {
            platform: os.platform()
        };
    }
}

// Helper functions
function getBasicSystemInfo() {
    return {
        hostname: os.hostname(),
        platform: os.platform(),
        architecture: os.arch(),
        nodeVersion: process.version,
        totalMemory: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2) + ' GB'
    };
}

async function getCpuUsage() {
    return new Promise((resolve) => {
        const startTime = process.hrtime();
        const startUsage = process.cpuUsage();

        setTimeout(() => {
            const endTime = process.hrtime(startTime);
            const endUsage = process.cpuUsage(startUsage);
            
            const totalTime = endTime[0] * 1000000 + endTime[1] / 1000;
            const userTime = endUsage.user;
            const systemTime = endUsage.system;
            
            const usage = Math.round(((userTime + systemTime) / totalTime) * 100);
            resolve(Math.min(usage, 100));
        }, 100);
    });
}

async function getMemoryInfo() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    
    return {
        total: (total / 1024 / 1024 / 1024).toFixed(2) + ' GB',
        used: (used / 1024 / 1024 / 1024).toFixed(2) + ' GB',
        free: (free / 1024 / 1024 / 1024).toFixed(2) + ' GB',
        usagePercent: Math.round((used / total) * 100)
    };
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) {
        return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else {
        return `${minutes}m`;
    }
}