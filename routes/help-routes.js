// User guide with how-to videos (ticket #471): /help, for everyone who signs in.
// The videos are recorded by tools/videos (made-up DEMO station on beta) into public/videos.
const fs = require('fs');
const path = require('path');
const express = require('express');
const login = require('connect-ensure-login');

const router = express.Router();
const isLoginEnsured = login.ensureLoggedIn({});

// Version tag per video file, so browsers and Cloudflare fetch a re-recorded video at once
// (public/ is served with a 7-day cache).
const VIDEO_DIR = path.join(__dirname, '..', 'public', 'videos');
const videoV = {};
if (fs.existsSync(VIDEO_DIR)) {
    for (const f of fs.readdirSync(VIDEO_DIR)) {
        videoV[f] = Math.round(fs.statSync(path.join(VIDEO_DIR, f)).mtimeMs).toString(36);
    }
}

router.get('/', isLoginEnsured, (req, res) => {
    res.render('help', {
        title: 'Help',
        user: req.user,
        origin: `${req.protocol}://${req.get('host')}`,
        videoV,
    });
});

module.exports = router;
