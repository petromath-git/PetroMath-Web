// closing-autosave.js
// Autosave for the shift closing screens (new closing + edit draft).
//
// Each tab already has a save function that runs when the user leaves the tab
// (trackMenu in draft-edit-scripts.js). This file runs those same functions in the
// background a few seconds after the user stops typing, and when the page is hidden
// (phone locked, app switched, tab closed), so entered data is not lost.
//
// - Quiet mode: while window.closingAutosaveQuiet is set, the save functions skip
//   popups, toasts, field highlighting, the loading overlay and tab locking
//   (see saveAlert / postAjaxNew in app-scripts.js, validateDivTab in
//   app-validator.js, disableOtherTabs in draft-edit-scripts.js). An incomplete row
//   just means "not saved yet" - the reason is shown on the status line.
// - One save at a time: every tab save function is wrapped so saves run one after
//   another, whoever starts them (autosave, Next, tab click, Save button). A save
//   that starts while another is still waiting for its new rows' ids would insert
//   those rows a second time.
// - The Closing tab is only autosaved once the closing exists - creating it still
//   needs the Next click.
(function () {
    'use strict';

    if (!document.getElementById('new_closing') ||
        !document.getElementById('closing_hiddenId') ||
        document.getElementById('freezedRecord_hiddenValue')) {
        return;
    }

    const IDLE_MS = 4000;       // save this long after the last edit
    const RETRY_MS = 20000;     // retry an unsuccessful autosave (e.g. network down)

    const TAB_SAVES = [
        'saveClosing', 'saveAttendance', 'saveReadings', 'save2TProducts', 'saveCashSales',
        'saveCreditSales', 'saveDigitalSales', 'saveCreditReceipts', 'saveEmployeeAdvance',
        'saveExpensesTab', 'saveDenomsTab', 'saveIntercompany'
    ];
    // Row deletes read the row's saved id when clicked. Queued behind any running save, so a
    // row deleted while its insert is still on the way is deleted from the DB once it has an id
    // (otherwise it vanishes from the screen but the insert lands and the row comes back).
    const ROW_DELETES = ['hideRow', 'hideAndDeleteReadingPump', 'hideAndDeleteTestingRow'];

    const originals = {};       // save function name -> unwrapped function
    const editSeq = {};         // save function name -> sequence number of its latest edit
    const savedSeq = {};        // save function name -> latest edit sequence a save has covered
    let seq = 0;
    let chain = Promise.resolve();
    let timer = null;
    let flushing = 0;
    let statusEl = null;

    // ── One save at a time ────────────────────────────────────────

    function runExclusive(task) {
        const run = chain.then(task, task);
        chain = run.then(() => {}, () => {});
        return run;
    }

    function markSaved(fn, coveredSeq) {
        savedSeq[fn] = Math.max(savedSeq[fn] || 0, coveredSeq);
    }

    function wrapSaveFunctions() {
        TAB_SAVES.forEach((fn) => {
            const original = window[fn];
            if (typeof original !== 'function' || original.closingAutosaveWrapped) return;
            originals[fn] = original;
            const wrapped = function () {
                const self = this, args = arguments;
                return runExclusive(() => {
                    const startSeq = seq;
                    return Promise.resolve(original.apply(self, args)).then((ok) => {
                        if (ok) {
                            markSaved(fn, startSeq);
                            refreshStatus();
                        }
                        return ok;
                    });
                });
            };
            wrapped.closingAutosaveWrapped = true;
            window[fn] = wrapped;
        });

        ROW_DELETES.forEach((fn) => {
            const original = window[fn];
            if (typeof original !== 'function' || original.closingAutosaveWrapped) return;
            const wrapped = function () {
                const self = this, args = arguments;
                return runExclusive(() => original.apply(self, args));
            };
            wrapped.closingAutosaveWrapped = true;
            window[fn] = wrapped;
        });

        // CLOSE (freeze): finish any pending or running save first, and don't freeze over
        // entries that could not be saved
        const finish = window.finishClosing;
        if (typeof finish === 'function' && !finish.closingAutosaveWrapped) {
            const wrapped = function () {
                const self = this, args = arguments;
                clearTimeout(timer);
                return flush()
                    .then(() => runExclusive(() => true))
                    .then(() => {
                        if (dirtyFunctions().length) {
                            alert('Some entries are not saved yet' +
                                (lastBlockedIssue ? ': ' + lastBlockedIssue : '.') +
                                '\n\nPlease correct them before closing the shift.');
                            return;
                        }
                        return finish.apply(self, args);
                    });
            };
            wrapped.closingAutosaveWrapped = true;
            window.finishClosing = wrapped;
        }
    }

    // A calculated field (e.g. lube sale amount = qty x price) is only recalculated when the
    // cursor leaves the field the user is typing in. Run that field's change handler before
    // saving so qty and amount are saved together. The synthetic event is untrusted, so it is
    // not counted as a new edit, and the browser still fires the real change on leaving.
    function commitFocusedField(fn) {
        const el = document.activeElement;
        if (!el || !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.type === 'hidden') return;
        if (saveFunctionFor(el) !== fn) return;
        // The browser's own change event still comes when the cursor leaves - with this value it
        // is not a new edit (it would otherwise trigger an extra save, e.g. after CLOSE)
        el.closingAutosaveCommitted = el.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // ── Tracking edits ────────────────────────────────────────────

    function hasClosingId() {
        return parseInt(document.getElementById('closing_hiddenId').value) > 0;
    }

    function saveFunctionFor(el) {
        // Fields of a row being edited in a modal are moved out of their tab, so fall back to the open tab
        const pane = el.closest('.tab-pane') || document.querySelector('.tab-content .tab-pane.active');
        if (!pane || !pane.id) return null;
        const link = document.querySelector('.nav-tabs a.nav-link[href="#' + pane.id + '"]');
        if (!link || typeof getSaveFunction !== 'function') return null;
        const fn = getSaveFunction(link.id);
        return TAB_SAVES.indexOf(fn) >= 0 ? fn : null;
    }

    function onUserEdit(el) {
        if (!el || !el.closest || el.closest('.select2-search, #summary')) return;
        const fn = saveFunctionFor(el);
        if (!fn || !hasClosingId()) return;     // a new closing is created by the Closing tab's Next
        seq++;
        editSeq[fn] = seq;
        setStatus('dirty');
        schedule(IDLE_MS);
    }

    function isDirty(fn) {
        return (editSeq[fn] || 0) > (savedSeq[fn] || 0);
    }

    function dirtyFunctions() {
        return TAB_SAVES.filter(isDirty);
    }

    // ── Saving ────────────────────────────────────────────────────

    function schedule(ms) {
        clearTimeout(timer);
        timer = setTimeout(flush, ms);
    }

    function autosaveOne(fn) {
        return runExclusive(() => {
            // A Next / tab click may have saved it while this was queued
            if (!isDirty(fn) || !originals[fn]) return true;
            commitFocusedField(fn);
            const startSeq = seq;
            window.closingAutosaveQuiet = true;
            window.closingAutosaveIssue = null;
            return Promise.resolve()
                .then(() => originals[fn]())
                .catch((err) => {
                    console.error('Autosave failed', fn, err);
                    window.closingAutosaveIssue = window.closingAutosaveIssue || 'Could not save. Please try again.';
                    return false;
                })
                .then((ok) => {
                    window.closingAutosaveQuiet = false;
                    if (ok) markSaved(fn, startSeq);
                    return !!ok;
                });
        });
    }

    function flush() {
        clearTimeout(timer);
        timer = null;
        const pending = dirtyFunctions();
        if (!pending.length) {
            refreshStatus();
            return Promise.resolve(true);
        }
        // Don't save a row while it is open in a modal (credit sale entry, quick add vehicle)
        if (document.querySelector('.modal.show')) {
            schedule(IDLE_MS);
            return Promise.resolve(false);
        }
        flushing++;
        setStatus('saving');
        let issue = null;
        return pending.reduce((prev, fn) => prev.then((allOk) =>
            autosaveOne(fn).then((ok) => {
                if (!ok && !issue) issue = window.closingAutosaveIssue;
                return allOk && ok;
            })
        ), Promise.resolve(true)).then((allOk) => {
            flushing--;
            if (dirtyFunctions().length) {
                if (!allOk) {
                    setStatus('blocked', issue);
                    schedule(RETRY_MS);
                } else {
                    schedule(IDLE_MS);    // edited again while saving
                }
            }
            refreshStatus();
            return allOk;
        });
    }

    // ── Status line ───────────────────────────────────────────────

    let lastBlockedIssue = null;

    function createStatus() {
        const tabs = document.querySelector('.nav-tabs');
        if (!tabs) return;
        statusEl = document.createElement('div');
        statusEl.id = 'closing-autosave-status';
        statusEl.setAttribute('aria-live', 'polite');
        statusEl.style.cssText = 'font-size:0.8rem;text-align:right;min-height:1.2em;padding:2px 4px;';
        tabs.parentNode.insertBefore(statusEl, tabs.nextSibling);
    }

    function setStatus(state, issue) {
        if (!statusEl) return;
        statusEl.dataset.state = state;
        if (state === 'saving') {
            statusEl.style.color = '#6c757d';
            statusEl.textContent = 'Saving…';
        } else if (state === 'dirty') {
            statusEl.style.color = '#6c757d';
            statusEl.textContent = lastBlockedIssue ? 'Not saved yet: ' + lastBlockedIssue : 'Unsaved changes';
        } else if (state === 'blocked') {
            lastBlockedIssue = issue || 'please complete the entries on this tab.';
            statusEl.style.color = '#c0392b';
            statusEl.textContent = 'Not saved yet: ' + lastBlockedIssue;
        } else if (state === 'saved') {
            lastBlockedIssue = null;
            const now = new Date();
            const hh = String(now.getHours()).padStart(2, '0');
            const mm = String(now.getMinutes()).padStart(2, '0');
            statusEl.style.color = '#2e7d32';
            statusEl.textContent = '✓ All changes saved ' + hh + ':' + mm;
        }
    }

    function refreshStatus() {
        if (!statusEl || flushing) return;
        if (!dirtyFunctions().length) {
            // Only claim "saved" once something has actually been edited
            if (statusEl.dataset.state) setStatus('saved');
        } else if (statusEl.dataset.state !== 'blocked') {
            setStatus('dirty');
        }
    }

    // ── Wiring ────────────────────────────────────────────────────

    function onNativeEdit(e) {
        // Only real user input - code that fills fields or fires change itself is not an edit
        if (e.isTrusted === false) return;
        const el = e.target;
        if (el && el.closingAutosaveCommitted !== undefined) {
            const unchanged = e.type === 'change' && el.closingAutosaveCommitted === el.value;
            delete el.closingAutosaveCommitted;
            if (unchanged) return;
        }
        onUserEdit(el);
    }

    function init() {
        wrapSaveFunctions();
        createStatus();

        document.addEventListener('input', onNativeEdit, true);
        document.addEventListener('change', onNativeEdit, true);
        // Select2 dropdowns report a choice through jQuery events, not native change
        if (window.jQuery) {
            window.jQuery(document).on('select2:select select2:unselect select2:clear', (e) => onUserEdit(e.target));
        }

        // Phone locked, app switched, tab closed: save straight away
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden' && dirtyFunctions().length) flush();
        });
        window.addEventListener('beforeunload', (e) => {
            if (dirtyFunctions().length || flushing) {
                flush();
                e.preventDefault();
                e.returnValue = '';
            }
        });

        // For checking from the browser console / automated tests
        window.closingAutosave = {
            flush: flush,
            pending: dirtyFunctions,
            idle: () => runExclusive(() => true),
            // For edits that are not typing, e.g. removing a row that is only saved as a whole set
            markEdited: (el) => onUserEdit(el)
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
