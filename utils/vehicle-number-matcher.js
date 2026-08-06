// Fuzzy matching for Indian vehicle registration numbers.
// Goal: catch the same plate re-entered with different spacing/formatting
// (e.g. missing RTO code or series letter), without flagging genuinely
// different vehicles that only differ by their series letter.

function normalize(vehicleNumber) {
    return (vehicleNumber || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Splits a normalized plate into state code / RTO+series letters / digits.
// e.g. "TN87B1783" -> { state: 'TN', letters: 'B', digits: '871783' }
function parse(vehicleNumber) {
    const full = normalize(vehicleNumber);
    const stateMatch = full.match(/^[A-Z]{1,3}/);
    const state = stateMatch ? stateMatch[0] : '';
    const rest = full.slice(state.length);
    const digits = rest.replace(/[^0-9]/g, '');
    const letters = rest.replace(/[^A-Z]/g, '');
    return { full, state, letters, digits };
}

// Restricted edit distance (substitution, insertion, deletion, and
// adjacent-character transposition) - catches "1783" -> "1738" (swapped
// digits) and "1783" -> "17983" (extra digit), not just single-position typos.
function editDistance(a, b) {
    const al = a.length, bl = b.length;
    const d = Array.from({ length: al + 1 }, () => new Array(bl + 1).fill(0));
    for (let i = 0; i <= al; i++) d[i][0] = i;
    for (let j = 0; j <= bl; j++) d[0][j] = j;
    for (let i = 1; i <= al; i++) {
        for (let j = 1; j <= bl; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(
                d[i - 1][j] + 1,
                d[i][j - 1] + 1,
                d[i - 1][j - 1] + cost
            );
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
            }
        }
    }
    return d[al][bl];
}

// How many edits are tolerated before two digit strings stop looking like
// the same number - loose enough to catch real typos, tight enough that two
// different short numbers don't collide.
function editThreshold(len) {
    return len >= 6 ? 2 : 1;
}

// Returns true if `a` and `b` plausibly refer to the same vehicle - either
// an exact match (ignoring spacing/punctuation), a formatting difference
// (missing RTO code or series letter), or a transcription mistake in the
// digits (swapped, dropped, extra, or mistyped digit).
// Returns false for genuinely different vehicles.
function isLikelySameVehicle(a, b) {
    const pa = parse(a);
    const pb = parse(b);

    if (!pa.state || !pb.state || pa.state !== pb.state) return false;
    if (!pa.digits || !pb.digits) return false;

    // Both entries specify a series letter and they disagree -> different
    // vehicles (e.g. TN87B1783 vs TN87C1783), not a formatting mistake.
    if (pa.letters && pb.letters && pa.letters !== pb.letters) return false;

    if (pa.digits === pb.digits) return true;

    // One side omitted the leading RTO-code digits (e.g. "TN 1783" for
    // "TN 87 B 1783") - treat a shared numeric suffix of 4+ digits as a match.
    const shorter = pa.digits.length <= pb.digits.length ? pa.digits : pb.digits;
    const longer = pa.digits.length <= pb.digits.length ? pb.digits : pa.digits;
    if (shorter.length >= 4 && longer.endsWith(shorter)) return true;

    // Otherwise, a small number of edits (typo'd/swapped/dropped digit)
    // between the two digit strings - likely a transcription mistake.
    const maxLen = Math.max(pa.digits.length, pb.digits.length);
    if (editDistance(pa.digits, pb.digits) <= editThreshold(maxLen)) return true;

    return false;
}

module.exports = { normalize, parse, isLikelySameVehicle, editDistance };
