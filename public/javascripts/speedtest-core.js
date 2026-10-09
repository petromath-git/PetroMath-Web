// speedtest-core.js — network speed test shared by the /speedtest page (manual)
// and diag-auto.js (silent run for users flagged from /speedtest/results).
//
// PMSpeedtest.run(options) resolves to the payload POSTed to /speedtest/result.
// Every response carries Server-Timing (app;dur=ms), so delay can be split into
// server time vs network time.
(function () {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const round = (n, d) => n == null ? null : Number(n.toFixed(d || 0));
    const avg = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
    const KB = 1024, MB = 1024 * 1024;

    const PROFILES = {
        // Manual: user is waiting and watching, so measure properly
        full:  { pings: 10, download: [128 * KB, 512 * KB, 2 * MB, 4 * MB], upload: [128 * KB, 512 * KB, 2 * MB] },
        // Auto: runs in the background, possibly on mobile data — keep it to ~1.5 MB
        light: { pings: 8,  download: [128 * KB, 512 * KB, 1 * MB],         upload: [128 * KB, 256 * KB] }
    };

    // Server-Timing: app;dur=12.3  →  12.3
    function serverMs(res) {
        const h = res.headers.get('server-timing') || '';
        const m = h.match(/app;dur=([\d.]+)/);
        return m ? parseFloat(m[1]) : null;
    }

    async function runPings(count, progress) {
        const rtts = [], servers = [];
        let failed = 0;
        for (let i = 0; i < count; i++) {
            const t0 = performance.now();
            try {
                const ctl = new AbortController();
                const timer = setTimeout(() => ctl.abort(), 5000);
                const res = await fetch('/speedtest/ping?t=' + Date.now() + '_' + i,
                    { cache: 'no-store', credentials: 'same-origin', signal: ctl.signal });
                clearTimeout(timer);
                if (!res.ok) throw new Error('HTTP ' + res.status);
                rtts.push(performance.now() - t0);
                const s = serverMs(res);
                if (s != null) servers.push(s);
            } catch (e) {
                failed++;
            }
            progress('Measuring delay… ' + (i + 1) + '/' + count, 5 + Math.round((i + 1) / count * 35));
            await sleep(100);
        }
        // First request may include connection setup — drop it from the averages when we can
        const steady = rtts.length > 3 ? rtts.slice(1) : rtts;
        let jitter = 0;
        for (let i = 1; i < steady.length; i++) jitter += Math.abs(steady[i] - steady[i - 1]);
        jitter = steady.length > 1 ? jitter / (steady.length - 1) : 0;
        return {
            samples: rtts.map(x => round(x)),
            ping_avg_ms: round(avg(steady)),
            ping_min_ms: steady.length ? round(Math.min.apply(null, steady)) : null,
            jitter_ms: round(jitter),
            server_avg_ms: round(avg(servers), 1),
            failed_pings: failed
        };
    }

    // Grow the payload until a transfer takes long enough to be a fair measurement
    async function runDownload(sizes, progress) {
        const samples = [];
        let best = null;
        for (let i = 0; i < sizes.length; i++) {
            progress('Measuring download…', 45 + i * 8);
            const t0 = performance.now();
            try {
                const res = await fetch('/speedtest/blob?bytes=' + sizes[i] + '&t=' + Date.now(),
                    { cache: 'no-store', credentials: 'same-origin' });
                // Time from first byte to last byte, so server time and the
                // request round trip don't count against the transfer speed
                const tHeaders = performance.now();
                const buf = await res.arrayBuffer();
                const tEnd = performance.now();
                const secs = Math.max(tEnd - tHeaders, 1) / 1000;
                const mbps = (buf.byteLength * 8) / secs / 1e6;
                samples.push({ bytes: buf.byteLength, total_ms: round(tEnd - t0), transfer_ms: round(secs * 1000), mbps: round(mbps, 2) });
                best = mbps;
                if (secs > 2.5) break; // slow link — enough data, don't make the user wait
            } catch (e) {
                samples.push({ bytes: sizes[i], error: String(e.message || e) });
                break;
            }
        }
        return { download_mbps: round(best, 2), samples };
    }

    // baselineMs = an empty round trip (incl. server time), subtracted so only the body transfer counts
    async function runUpload(sizes, baselineMs, progress) {
        const samples = [];
        let best = null;
        for (let i = 0; i < sizes.length; i++) {
            progress('Measuring upload…', 80 + i * 5);
            const data = new Uint8Array(sizes[i]);
            for (let off = 0; off < data.length; off += 65536) {
                crypto.getRandomValues(data.subarray(off, Math.min(off + 65536, data.length)));
            }
            const t0 = performance.now();
            try {
                const res = await fetch('/speedtest/upload?t=' + Date.now(), {
                    method: 'POST', body: data, cache: 'no-store', credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/octet-stream' }
                });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const totalMs = performance.now() - t0;
                const secs = Math.max(totalMs - (baselineMs || 0), totalMs * 0.1) / 1000;
                const mbps = (data.length * 8) / secs / 1e6;
                samples.push({ bytes: data.length, total_ms: round(totalMs), transfer_ms: round(secs * 1000), mbps: round(mbps, 2) });
                best = mbps;
                if (secs > 2.5) break;
            } catch (e) {
                samples.push({ bytes: sizes[i], error: String(e.message || e) });
                break;
            }
        }
        return { upload_mbps: round(best, 2), samples };
    }

    // How long the current page took, and which files on it were slowest
    function pageTimings() {
        const out = { url: location.pathname };
        const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
        if (nav) {
            out.navigation = {
                dns_ms: round(nav.domainLookupEnd - nav.domainLookupStart),
                connect_ms: round(nav.connectEnd - nav.connectStart),
                ttfb_ms: round(nav.responseStart - nav.requestStart),
                download_ms: round(nav.responseEnd - nav.responseStart),
                dom_ready_ms: round(nav.domContentLoadedEventEnd),
                load_ms: round(nav.loadEventEnd),
                transfer_bytes: nav.transferSize,
                server: (nav.serverTiming || []).map(s => s.name + '=' + round(s.duration, 1))
            };
        }
        const resources = (performance.getEntriesByType && performance.getEntriesByType('resource')) || [];
        out.slowest_resources = resources
            .filter(r => r.initiatorType !== 'fetch' && r.initiatorType !== 'xmlhttprequest')
            .sort((a, b) => b.duration - a.duration)
            .slice(0, 10)
            .map(r => ({
                url: r.name.replace(location.origin, '').substring(0, 150),
                ms: round(r.duration),
                bytes: r.transferSize || null,
                cached: r.transferSize === 0 && r.decodedBodySize > 0
            }));
        return out;
    }

    function deviceInfo() {
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
        return {
            connection: conn ? {
                type: conn.type || null,
                effective_type: conn.effectiveType || null,
                rtt_ms: conn.rtt != null ? conn.rtt : null,
                downlink_mbps: conn.downlink != null ? conn.downlink : null,
                save_data: !!conn.saveData
            } : null,
            device_memory_gb: navigator.deviceMemory || null,
            cpu_cores: navigator.hardwareConcurrency || null,
            screen: screen.width + 'x' + screen.height + ' @' + (window.devicePixelRatio || 1) + 'x',
            viewport: window.innerWidth + 'x' + window.innerHeight,
            language: navigator.language,
            timezone: (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || null,
            online: navigator.onLine
        };
    }

    // options: { profile: 'full'|'light', onProgress(text, pct), onMetric(name, value) }
    async function run(options) {
        const opts = options || {};
        const profile = PROFILES[opts.profile] || PROFILES.full;
        const progress = opts.onProgress || function () {};
        const metric = opts.onMetric || function () {};
        const startedAt = new Date().toISOString();
        const dev = deviceInfo();

        const ping = await runPings(profile.pings, progress);
        metric('ping', ping.ping_avg_ms);
        const down = await runDownload(profile.download, progress);
        metric('download', down.download_mbps);
        const up = await runUpload(profile.upload, ping.ping_min_ms, progress);
        metric('upload', up.upload_mbps);

        return {
            ping_avg_ms: ping.ping_avg_ms,
            ping_min_ms: ping.ping_min_ms,
            jitter_ms: ping.jitter_ms,
            server_avg_ms: ping.server_avg_ms,
            failed_pings: ping.failed_pings,
            download_mbps: down.download_mbps,
            upload_mbps: up.upload_mbps,
            connection_type: dev.connection ? dev.connection.effective_type : null,
            details: {
                started_at: startedAt,
                profile: opts.profile || 'full',
                ping_samples: ping.samples,
                download_samples: down.samples,
                upload_samples: up.samples,
                device: dev,
                page: pageTimings()
            }
        };
    }

    async function save(payload) {
        const res = await fetch('/speedtest/result', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Save failed');
        return data;
    }

    window.PMSpeedtest = { run, save, deviceInfo };
})();
