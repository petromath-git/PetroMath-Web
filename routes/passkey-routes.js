// Face ID / fingerprint login (WebAuthn passkeys).
// The phone checks the face or finger itself and signs a one-time challenge
// with a key that never leaves the phone; we only store the public key.
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const {
    generateRegistrationOptions, verifyRegistrationResponse,
    generateAuthenticationOptions, verifyAuthenticationResponse
} = require('@simplewebauthn/server');
const db = require('../db/db-connection');
const PasskeyDao = require('../dao/passkey-dao');
const { buildLoginUser, completeLogin, logFailedLogin } = require('../utils/login-flow');

const Person = db.person;

// Passkeys belong to the exact site name (beta.petromath.co.in, petromath.co.in).
// nginx passes the browser's Host header through on both servers.
function relyingParty(req) {
    const rpID = req.hostname;
    const scheme = rpID === 'localhost' ? 'http://' : 'https://';
    return { rpID, origin: scheme + req.get('host') };
}

// Ties a passkey to the password in force when it was enabled: a password
// change by any route (self, admin reset, direct SQL) makes it stop working.
function passwordSig(person) {
    return crypto.createHash('sha256').update(String(person.Password || '')).digest('hex');
}

function deviceLabel(ua) {
    ua = ua || '';
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Android phone';
    if (/Macintosh/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows PC';
    return 'Device';
}

// Login endpoints are public; a station's phones often share one IP, so this
// is looser than the password form's 5 per 5 minutes.
const passkeyLoginLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 30,
    handler: (req, res) => res.status(429).json({ message: 'Too many attempts. Please wait 5 minutes and try again.' })
});

// ---- Turning it on (logged in) ----

router.post('/register/options', isLoginEnsured, async (req, res) => {
    try {
        if (req.user.Role === 'Customer') {
            return res.status(403).json({ message: 'Not available for customer logins.' });
        }
        const { rpID } = relyingParty(req);
        const existing = await PasskeyDao.listByPerson(req.user.Person_id);
        const options = await generateRegistrationOptions({
            rpName: 'PetroMath',
            rpID,
            userID: Buffer.from(String(req.user.Person_id)),
            userName: req.user.User_Name,
            userDisplayName: req.user.Person_Name || req.user.User_Name,
            attestationType: 'none',
            // Already on for this phone → the phone says so instead of adding another
            excludeCredentials: existing.map(c => ({
                id: c.credential_id,
                transports: c.transports ? c.transports.split(',') : undefined
            })),
            authenticatorSelection: {
                authenticatorAttachment: 'platform', // this phone's own face/finger, not a USB key
                residentKey: 'required',             // log in without typing the username
                userVerification: 'required'         // face, finger or the phone's PIN
            }
        });
        req.session.passkeyRegChallenge = options.challenge;
        res.json(options);
    } catch (err) {
        console.error('Passkey register options error:', err);
        res.status(500).json({ message: 'Could not start. Please try again.' });
    }
});

router.post('/register/verify', isLoginEnsured, async (req, res) => {
    const expectedChallenge = req.session.passkeyRegChallenge;
    delete req.session.passkeyRegChallenge;
    try {
        if (!expectedChallenge) {
            return res.status(400).json({ message: 'This took too long. Please try again.' });
        }
        const { rpID, origin } = relyingParty(req);
        const { verified, registrationInfo } = await verifyRegistrationResponse({
            response: req.body,
            expectedChallenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
            requireUserVerification: true
        });
        if (!verified) {
            return res.status(400).json({ message: 'Could not turn it on. Please try again.' });
        }
        const person = await Person.findOne({ where: { Person_id: req.user.Person_id } });
        const cred = registrationInfo.credential;
        await PasskeyDao.create({
            personId: req.user.Person_id,
            credentialId: cred.id,
            publicKey: Buffer.from(cred.publicKey),
            signCount: cred.counter || 0,
            transports: cred.transports && cred.transports.length ? cred.transports.join(',') : null,
            deviceLabel: deviceLabel(req.headers['user-agent']),
            passwordSig: passwordSig(person)
        });
        res.json({ ok: true });
    } catch (err) {
        console.error('Passkey register verify error:', err);
        res.status(400).json({ message: 'Could not turn it on. Please try again.' });
    }
});

// Turns it off on every phone for this person
router.post('/disable', isLoginEnsured, async (req, res) => {
    try {
        await PasskeyDao.deleteByPerson(req.user.Person_id);
        res.json({ ok: true });
    } catch (err) {
        console.error('Passkey disable error:', err);
        res.status(500).json({ message: 'Could not turn it off. Please try again.' });
    }
});

// ---- Logging in (public) ----

router.post('/login/options', passkeyLoginLimiter, async (req, res) => {
    try {
        const { rpID } = relyingParty(req);
        // No allowCredentials: the phone offers whichever PetroMath login it holds
        const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
        req.session.passkeyLoginChallenge = options.challenge;
        res.json(options);
    } catch (err) {
        console.error('Passkey login options error:', err);
        res.status(500).json({ message: 'Could not start. Please log in with your password.' });
    }
});

router.post('/login/verify', passkeyLoginLimiter, async (req, res) => {
    const expectedChallenge = req.session.passkeyLoginChallenge;
    delete req.session.passkeyLoginChallenge;
    // forget: the phone's saved login is no longer valid, so stop offering the button
    const fail = (message, forget) => res.status(400).json({ message, forget: !!forget });
    try {
        if (!expectedChallenge || !req.body || !req.body.id) {
            return fail('This took too long. Please try again.');
        }
        const saved = await PasskeyDao.findByCredentialId(req.body.id);
        if (!saved) {
            return fail('Face ID / fingerprint login is not set up for this phone any more. Please log in with your password.', true);
        }
        const person = await Person.findOne({ where: { Person_id: saved.person_id } });
        if (!person) {
            return fail('Please log in with your password.', true);
        }
        if (saved.password_sig !== passwordSig(person)) {
            await PasskeyDao.deleteById(saved.passkey_id);
            await logFailedLogin(req, person.User_Name, {
                message: 'Passkey rejected: password changed since it was enabled',
                Person_id: person.Person_id, location_code: person.location_code
            });
            return fail('Your password was changed. Log in with the new password, then turn on Face ID / fingerprint again.', true);
        }

        const { rpID, origin } = relyingParty(req);
        const { verified, authenticationInfo } = await verifyAuthenticationResponse({
            response: req.body,
            expectedChallenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
            credential: {
                id: saved.credential_id,
                publicKey: new Uint8Array(saved.public_key),
                counter: Number(saved.sign_count),
                transports: saved.transports ? saved.transports.split(',') : undefined
            },
            requireUserVerification: true
        });
        if (!verified) {
            return fail('Face ID / fingerprint was not accepted. Please try again or use your password.');
        }
        await PasskeyDao.markUsed(saved.passkey_id, authenticationInfo.newCounter);

        // Same checks as a password login: disabled account, inactive location
        const result = await buildLoginUser(person);
        if (!result.user) {
            await logFailedLogin(req, person.User_Name, result.failure);
            return fail(result.failure.message);
        }
        req.logIn(result.user, async (err) => {
            if (err) {
                console.error('Passkey logIn error:', err);
                return fail('Login failed. Please use your password.');
            }
            await completeLogin(req, result.user, person.User_Name, url => res.json({ ok: true, redirect: url }));
        });
    } catch (err) {
        console.error('Passkey login verify error:', err);
        fail('Face ID / fingerprint was not accepted. Please try again or use your password.');
    }
});

module.exports = router;
