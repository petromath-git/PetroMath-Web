-- Face ID / fingerprint login (WebAuthn passkeys).
-- One row per phone a person has enabled it on. The phone keeps the private
-- key; this table holds only the public key, so a leaked row can't log anyone in.
-- password_sig: SHA-256 of the person's password hash when the phone was enabled.
-- If the password changes by any route, the signature no longer matches and the
-- passkey stops working until the person logs in with the new password.

CREATE TABLE IF NOT EXISTS m_person_passkeys (
    passkey_id     INT           NOT NULL AUTO_INCREMENT,
    person_id      INT           NOT NULL,
    credential_id  VARCHAR(512)  NOT NULL COMMENT 'base64url, from the phone',
    public_key     BLOB          NOT NULL,
    sign_count     BIGINT        NOT NULL DEFAULT 0,
    transports     VARCHAR(255)  DEFAULT NULL,
    device_label   VARCHAR(100)  DEFAULT NULL COMMENT 'e.g. iPhone, Android phone',
    password_sig   CHAR(64)      NOT NULL,
    created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at   TIMESTAMP     NULL DEFAULT NULL,
    PRIMARY KEY (passkey_id),
    UNIQUE KEY uk_person_passkeys_credential (credential_id),
    KEY idx_person_passkeys_person (person_id),
    CONSTRAINT fk_person_passkeys_person FOREIGN KEY (person_id) REFERENCES m_persons (Person_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
