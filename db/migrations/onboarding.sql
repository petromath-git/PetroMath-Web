-- Web-based onboarding form tables

CREATE TABLE IF NOT EXISTS t_onboarding (
    id                   INT AUTO_INCREMENT PRIMARY KEY,
    token                VARCHAR(36)  UNIQUE NOT NULL,
    location_name        VARCHAR(200) NOT NULL,
    status               ENUM('active', 'setup_done') DEFAULT 'active',
    notes                TEXT,
    created_by_person_id INT,
    created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS t_onboarding_ro (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    onboarding_id INT NOT NULL,
    ro_name       VARCHAR(200),
    owner_contact VARCHAR(100),
    ro_brand      VARCHAR(50),
    ro_address    TEXT,
    location_link TEXT,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_ob_ro (onboarding_id),
    CONSTRAINT fk_ob_ro FOREIGN KEY (onboarding_id) REFERENCES t_onboarding(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS t_onboarding_employees (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    onboarding_id INT NOT NULL,
    employee_name VARCHAR(200),
    designation   VARCHAR(100),
    sort_order    INT DEFAULT 0,
    CONSTRAINT fk_ob_emp FOREIGN KEY (onboarding_id) REFERENCES t_onboarding(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS t_onboarding_metered_products (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    onboarding_id INT NOT NULL,
    product_name  VARCHAR(200),
    short_name    VARCHAR(50),
    sort_order    INT DEFAULT 0,
    CONSTRAINT fk_ob_mprod FOREIGN KEY (onboarding_id) REFERENCES t_onboarding(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS t_onboarding_tanks (
    id                 INT AUTO_INCREMENT PRIMARY KEY,
    onboarding_id      INT NOT NULL,
    tank_name          VARCHAR(200),
    tank_capacity      INT,
    tank_short_name    VARCHAR(50),
    product_short_name VARCHAR(100),
    sort_order         INT DEFAULT 0,
    CONSTRAINT fk_ob_tank FOREIGN KEY (onboarding_id) REFERENCES t_onboarding(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS t_onboarding_nozzles (
    id                 INT AUTO_INCREMENT PRIMARY KEY,
    onboarding_id      INT NOT NULL,
    nozzle_name        VARCHAR(200),
    nozzle_product     VARCHAR(100),
    du_make            VARCHAR(100),
    tank_connected     VARCHAR(200),
    next_stamping_date DATE,
    sort_order         INT DEFAULT 0,
    CONSTRAINT fk_ob_nozzle FOREIGN KEY (onboarding_id) REFERENCES t_onboarding(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS t_onboarding_lubes (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    onboarding_id INT NOT NULL,
    product_name  VARCHAR(200),
    unit          VARCHAR(50),
    selling_price DECIMAL(10, 2),
    sort_order    INT DEFAULT 0,
    CONSTRAINT fk_ob_lube FOREIGN KEY (onboarding_id) REFERENCES t_onboarding(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS t_onboarding_banks (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    onboarding_id INT NOT NULL,
    bank_name     VARCHAR(200),
    short_name    VARCHAR(100),
    branch        VARCHAR(200),
    account_name  VARCHAR(200),
    account_last4 VARCHAR(10),
    account_type  VARCHAR(50),
    sort_order    INT DEFAULT 0,
    CONSTRAINT fk_ob_bank FOREIGN KEY (onboarding_id) REFERENCES t_onboarding(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS t_onboarding_digital (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    onboarding_id INT NOT NULL,
    platform_name VARCHAR(200),
    sort_order    INT DEFAULT 0,
    CONSTRAINT fk_ob_digital FOREIGN KEY (onboarding_id) REFERENCES t_onboarding(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS t_onboarding_customers (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    onboarding_id  INT NOT NULL,
    customer_name  VARCHAR(200),
    address        TEXT,
    gstin          VARCHAR(20),
    owner_name     VARCHAR(200),
    owner_mobile   VARCHAR(15),
    manager_name   VARCHAR(200),
    manager_mobile VARCHAR(15),
    customer_type  VARCHAR(20),
    sort_order     INT DEFAULT 0,
    CONSTRAINT fk_ob_cust FOREIGN KEY (onboarding_id) REFERENCES t_onboarding(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS t_onboarding_suppliers (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    onboarding_id INT NOT NULL,
    supplier_name VARCHAR(200),
    short_name    VARCHAR(100),
    sort_order    INT DEFAULT 0,
    CONSTRAINT fk_ob_supp FOREIGN KEY (onboarding_id) REFERENCES t_onboarding(id) ON DELETE CASCADE
);
