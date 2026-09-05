-- Config gate for quick-add-vehicle on the DSM credit-entry screen.
-- Deliberately a NEW key, not a reuse of ALLOW_QUICK_ADD_VEHICLE (the shift-closing
-- credit-tab / bowser-closing gate) -- this lets the DSM screen be piloted
-- independently. Also deliberately NOT tied to the QUICK_ADD_VEHICLE permission
-- used by POST /vehicles/api/quick-add: on DSM this is controlled by location
-- config alone (gated server-side in dsm-entry-controller.js quickAddVehicle),
-- reusing only the existing DSM_CREDIT_ENTRY permission that already gates the
-- whole screen.
-- Default is disabled (matches ALLOW_QUICK_ADD_VEHICLE convention -- no
-- global '*' row, code falls back to 'N' when no row exists). Enable
-- per-location by inserting a 'Y' row.

INSERT INTO m_location_config_catalog (setting_name, short_description, detailed_description, created_by, updated_by)
VALUES
('ALLOW_DSM_QUICK_ADD_VEHICLE', 'Enable quick-add vehicle on DSM entry screen',
 'Y/N. When Y, the DSM credit-entry screen (/dsm-entry) shows a "+" button next to the vehicle search box (customer-first mode only) that opens a modal to add a new vehicle inline via POST /dsm-entry/quick-add-vehicle, without leaving the entry screen. Gated by location config only -- no separate permission (uses the existing DSM_CREDIT_ENTRY permission). Default N (disabled). Checked in dsm-entry-controller.js.',
 'system', 'system')
ON DUPLICATE KEY UPDATE
    short_description    = VALUES(short_description),
    detailed_description = VALUES(detailed_description),
    updated_by            = 'system';
