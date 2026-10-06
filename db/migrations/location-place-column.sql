-- Short town/place name for a location, shown under the RO name on the
-- Select Location tiles (address is free text and too long to show there).
-- Editable from Location Master; NULL just means no place line on the tile.
ALTER TABLE m_location
    ADD COLUMN place VARCHAR(100) NULL AFTER address;

-- Backfill the ROs live as of 06-Oct-2026. Guarded by code AND name so a
-- code reused for a different RO on another environment (e.g. SFS on dev
-- is a demo station) is left alone.
UPDATE m_location SET place = 'Salem'          WHERE location_code = 'AMT'   AND location_name = 'AMARNATH FUELS';
UPDATE m_location SET place = 'Erode'          WHERE location_code = 'AMR'   AND location_name = 'AMR FUELS';
UPDATE m_location SET place = 'Kombai'         WHERE location_code = 'BAF'   AND location_name = 'BALAA FUELS';
UPDATE m_location SET place = 'Coimbatore'     WHERE location_code = 'AACBE' AND location_name = 'BALASEKHARAN AGENCIES';
UPDATE m_location SET place = 'Kilvelur'       WHERE location_code = 'DIV'   AND location_name = 'DIVIJ KRISHNA AGENCIES';
UPDATE m_location SET place = 'Perundurai'     WHERE location_code = 'GAC2'  AND location_name = 'GOUNDER AGENCIES';
UPDATE m_location SET place = 'Perundurai'     WHERE location_code = 'AKMN'  AND location_name = 'M/S AKM NATARAJAN CHETTY(IOCL DEALER)';
UPDATE m_location SET place = 'Kunnathur'      WHERE location_code = 'MC'    AND location_name = 'MUTHU CORPORATION';
UPDATE m_location SET place = 'Gobi'           WHERE location_code = 'MC2'   AND location_name = 'MUTHU CORPORATION UNIT II';
UPDATE m_location SET place = 'Gobi'           WHERE location_code = 'MUE'   AND location_name = 'MUTHU ENERGIES';
UPDATE m_location SET place = 'Kunnathur'      WHERE location_code = 'MME'   AND location_name = 'MUTHU MANIENTERPRISES';
UPDATE m_location SET place = 'Gobi'           WHERE location_code = 'PAC'   AND location_name = 'PARIYUR CORPORATION';
UPDATE m_location SET place = 'Jangaon'        WHERE location_code = 'SPFP'  AND location_name = 'S P FUEL POINT';
UPDATE m_location SET place = 'Salem'          WHERE location_code = 'SAR'   AND location_name = 'SARADHA AGENCIES';
UPDATE m_location SET place = 'Sattur'         WHERE location_code = 'SEN'   AND location_name = 'SENTHIL ANDAVAR FUELS';
UPDATE m_location SET place = 'Kavalkinaru'    WHERE location_code = 'SHA'   AND location_name = 'SHANKAR AGENCIES';
UPDATE m_location SET place = 'Thirupoondi'    WHERE location_code = 'SMA'   AND location_name = 'SHRIMATHI SARADHAMBAL PETRO PRODUCTS';
UPDATE m_location SET place = 'Kunnathur'      WHERE location_code = 'AND'   AND location_name = 'SRI ANDAVAR AND CO';
UPDATE m_location SET place = 'Coimbatore'     WHERE location_code = 'RAN'   AND location_name = 'SRI RANGANATHAR FUELS';
UPDATE m_location SET place = 'Sriperumbudur'  WHERE location_code = 'SFS'   AND location_name = 'SRINIVASA FILLING STATION';
UPDATE m_location SET place = 'Kittampalayam'  WHERE location_code = 'SSM'   AND location_name = 'SSM AGENCY';
