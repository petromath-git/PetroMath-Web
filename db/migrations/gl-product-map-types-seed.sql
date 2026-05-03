-- ============================================================
-- Product GL Map Types — m_lookup seed
-- Generated: 2026-05-02
--
-- Moves PRODUCT_MAP_TYPES out of code into m_lookup so new
-- map types can be added without a code deploy.
--
-- lookup_type : 'ProductMapType'
-- tag         : code key used in gl_product_ledger_map.map_type
-- description : display label shown in the UI modal
-- attribute1  : ledger group category key (used by the route
--               to decide which ledger dropdown to show)
-- ============================================================

-- Idempotent: remove existing rows then re-insert
DELETE FROM m_lookup WHERE lookup_type = 'ProductMapType';

INSERT INTO m_lookup (lookup_type, description, tag, attribute1, created_by) VALUES
    ('ProductMapType', 'Sales',       'SALES',       'sales',    'SYSTEM'),
    ('ProductMapType', 'Purchase',    'PURCHASE',    'purchase', 'SYSTEM'),
    ('ProductMapType', 'Output CGST', 'OUTPUT_CGST', 'tax',      'SYSTEM'),
    ('ProductMapType', 'Output SGST', 'OUTPUT_SGST', 'tax',      'SYSTEM'),
    ('ProductMapType', 'Input CGST',  'INPUT_CGST',  'tax',      'SYSTEM'),
    ('ProductMapType', 'Input SGST',  'INPUT_SGST',  'tax',      'SYSTEM');

-- ── VERIFY ────────────────────────────────────────────────────────────────────
SELECT lookup_id, description, tag, attribute1
FROM m_lookup
WHERE lookup_type = 'ProductMapType'
ORDER BY lookup_id;
