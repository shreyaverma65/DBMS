-- =====================================================================
-- Lost Luggage & Claim Resolution System  |  Database schema (SQLite)
-- Normalised to 3NF. Run with: sqlite3 luggage.db < schema.sql
-- =====================================================================
PRAGMA foreign_keys = ON;

DROP VIEW    IF EXISTS v_report_summary;
DROP VIEW    IF EXISTS v_claim_summary;
DROP VIEW    IF EXISTS v_airline_performance;
DROP TABLE   IF EXISTS payments;
DROP TABLE   IF EXISTS claim_items;
DROP TABLE   IF EXISTS claims;
DROP TABLE   IF EXISTS messages;
DROP TABLE   IF EXISTS status_history;
DROP TABLE   IF EXISTS report_matches;
DROP TABLE   IF EXISTS found_items;
DROP TABLE   IF EXISTS baggage_reports;
DROP TABLE   IF EXISTS flights;
DROP TABLE   IF EXISTS airports;
DROP TABLE   IF EXISTS airlines;
DROP TABLE   IF EXISTS users;

-- ---------------------------------------------------------------- USERS
CREATE TABLE users (
    user_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name      TEXT    NOT NULL,
    email          TEXT    NOT NULL UNIQUE,
    phone          TEXT,
    password_hash  TEXT    NOT NULL,
    role           TEXT    NOT NULL DEFAULT 'passenger'
                   CHECK (role IN ('passenger','staff','admin')),
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------- AIRLINES
CREATE TABLE airlines (
    airline_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT NOT NULL UNIQUE,          -- IATA 2-letter code
    name        TEXT NOT NULL
);

-- ------------------------------------------------------------- AIRPORTS
CREATE TABLE airports (
    airport_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    iata_code   TEXT NOT NULL UNIQUE,          -- 3-letter code
    name        TEXT NOT NULL,
    city        TEXT NOT NULL,
    country     TEXT NOT NULL
);

-- -------------------------------------------------------------- FLIGHTS
CREATE TABLE flights (
    flight_id           INTEGER PRIMARY KEY AUTOINCREMENT,
    airline_id          INTEGER NOT NULL REFERENCES airlines(airline_id),
    flight_number       TEXT    NOT NULL,
    origin_airport_id   INTEGER NOT NULL REFERENCES airports(airport_id),
    dest_airport_id     INTEGER NOT NULL REFERENCES airports(airport_id),
    flight_date         TEXT    NOT NULL,      -- YYYY-MM-DD
    CHECK (origin_airport_id <> dest_airport_id),
    UNIQUE (airline_id, flight_number, flight_date)
);

-- ------------------------------------------------ BAGGAGE REPORTS (PIR)
CREATE TABLE baggage_reports (
    report_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    reference_no      TEXT    NOT NULL UNIQUE,   -- LL-2026-00001 (set by trigger)
    user_id           INTEGER NOT NULL REFERENCES users(user_id),
    flight_id         INTEGER NOT NULL REFERENCES flights(flight_id),
    report_type       TEXT    NOT NULL CHECK (report_type IN ('lost','delayed','damaged')),
    tag_number        TEXT,                      -- IATA bag tag
    bag_type          TEXT    NOT NULL DEFAULT 'suitcase'
                      CHECK (bag_type IN ('suitcase','backpack','duffel','box','other')),
    color             TEXT,
    brand             TEXT,
    weight_kg         REAL    CHECK (weight_kg IS NULL OR weight_kg > 0),
    description       TEXT    NOT NULL,
    contents_summary  TEXT,
    delivery_address  TEXT,
    status            TEXT    NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','searching','located','delivered','closed','unresolved')),
    assigned_staff_id INTEGER REFERENCES users(user_id),
    reported_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    last_updated      TEXT    NOT NULL DEFAULT (datetime('now')),
    closed_at         TEXT
);
CREATE INDEX idx_reports_user   ON baggage_reports(user_id);
CREATE INDEX idx_reports_status ON baggage_reports(status);
CREATE INDEX idx_reports_tag    ON baggage_reports(tag_number);

-- ----------------------------------------------- FOUND (UNCLAIMED) ITEMS
CREATE TABLE found_items (
    found_id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_number        TEXT,
    bag_type          TEXT NOT NULL DEFAULT 'suitcase'
                      CHECK (bag_type IN ('suitcase','backpack','duffel','box','other')),
    color             TEXT,
    brand             TEXT,
    description       TEXT NOT NULL,
    found_airport_id  INTEGER NOT NULL REFERENCES airports(airport_id),
    found_date        TEXT NOT NULL DEFAULT (date('now')),
    storage_location  TEXT,
    status            TEXT NOT NULL DEFAULT 'in_storage'
                      CHECK (status IN ('in_storage','matched','returned','disposed')),
    logged_by         INTEGER NOT NULL REFERENCES users(user_id)
);
CREATE INDEX idx_found_tag    ON found_items(tag_number);
CREATE INDEX idx_found_status ON found_items(status);

-- ------------------------------------- REPORT <-> FOUND ITEM (M:N link)
CREATE TABLE report_matches (
    match_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id    INTEGER NOT NULL REFERENCES baggage_reports(report_id) ON DELETE CASCADE,
    found_id     INTEGER NOT NULL REFERENCES found_items(found_id),
    match_score  INTEGER NOT NULL CHECK (match_score BETWEEN 0 AND 100),
    matched_by   INTEGER NOT NULL REFERENCES users(user_id),
    matched_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (report_id, found_id)
);

-- ---------------------------------------------------------------- CLAIMS
CREATE TABLE claims (
    claim_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_no         TEXT    NOT NULL UNIQUE,    -- CL-2026-00001 (set by trigger)
    report_id        INTEGER NOT NULL REFERENCES baggage_reports(report_id),
    user_id          INTEGER NOT NULL REFERENCES users(user_id),
    claim_type       TEXT    NOT NULL
                     CHECK (claim_type IN ('lost_bag','damaged_bag','missing_contents','delay_expenses')),
    description      TEXT    NOT NULL,
    claimed_amount   REAL    NOT NULL CHECK (claimed_amount >= 0),
    approved_amount  REAL    CHECK (approved_amount IS NULL OR approved_amount >= 0),
    status           TEXT    NOT NULL DEFAULT 'submitted'
                     CHECK (status IN ('submitted','under_review','info_requested',
                                       'approved','partially_approved','rejected','paid')),
    resolution_note  TEXT,
    reviewed_by      INTEGER REFERENCES users(user_id),
    submitted_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    resolved_at      TEXT
);
CREATE INDEX idx_claims_report ON claims(report_id);
CREATE INDEX idx_claims_status ON claims(status);
-- one live claim per report per claim type (rejected claims may be re-filed)
CREATE UNIQUE INDEX uq_active_claim ON claims(report_id, claim_type) WHERE status <> 'rejected';

-- ---------------------------------------------------- CLAIM LINE ITEMS
CREATE TABLE claim_items (
    item_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id    INTEGER NOT NULL REFERENCES claims(claim_id) ON DELETE CASCADE,
    item_name   TEXT    NOT NULL,
    quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_value  REAL    NOT NULL CHECK (unit_value >= 0)
);

-- -------------------------------------------------------------- PAYMENTS
CREATE TABLE payments (
    payment_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id      INTEGER NOT NULL UNIQUE REFERENCES claims(claim_id),
    amount        REAL    NOT NULL CHECK (amount > 0),
    method        TEXT    NOT NULL CHECK (method IN ('bank_transfer','upi','voucher','cheque')),
    txn_reference TEXT,
    paid_by       INTEGER NOT NULL REFERENCES users(user_id),
    paid_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------- MESSAGES (case thread)
CREATE TABLE messages (
    message_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id   INTEGER NOT NULL REFERENCES baggage_reports(report_id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(user_id),
    body        TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------- STATUS HISTORY (audit log)
CREATE TABLE status_history (
    history_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type  TEXT    NOT NULL CHECK (entity_type IN ('report','claim')),
    entity_id    INTEGER NOT NULL,
    old_status   TEXT,
    new_status   TEXT    NOT NULL,
    changed_by   INTEGER REFERENCES users(user_id),
    note         TEXT,
    changed_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_history_entity ON status_history(entity_type, entity_id);

-- =====================================================================
-- TRIGGERS
-- =====================================================================

-- T1: generate human-friendly reference numbers
CREATE TRIGGER trg_report_reference AFTER INSERT ON baggage_reports
BEGIN
    UPDATE baggage_reports
       SET reference_no = 'LL-' || strftime('%Y','now') || '-' || printf('%05d', NEW.report_id)
     WHERE report_id = NEW.report_id;
END;

CREATE TRIGGER trg_claim_number AFTER INSERT ON claims
BEGIN
    UPDATE claims
       SET claim_no = 'CL-' || strftime('%Y','now') || '-' || printf('%05d', NEW.claim_id)
     WHERE claim_id = NEW.claim_id;
END;

-- T2: keep last_updated fresh and stamp closed_at
CREATE TRIGGER trg_report_touch AFTER UPDATE OF status, assigned_staff_id ON baggage_reports
BEGIN
    UPDATE baggage_reports
       SET last_updated = datetime('now'),
           closed_at = CASE WHEN NEW.status IN ('closed','delivered','unresolved')
                            THEN COALESCE(closed_at, datetime('now')) ELSE NULL END
     WHERE report_id = NEW.report_id;
END;

-- T3: business rule - approved amount may never exceed claimed amount
CREATE TRIGGER trg_claim_cap BEFORE UPDATE OF approved_amount ON claims
WHEN NEW.approved_amount IS NOT NULL AND NEW.approved_amount > NEW.claimed_amount
BEGIN
    SELECT RAISE(ABORT, 'Approved amount cannot exceed claimed amount');
END;

-- T4: a claim cannot be approved without an approved amount; stamp resolved_at
CREATE TRIGGER trg_claim_decision BEFORE UPDATE OF status ON claims
WHEN NEW.status IN ('approved','partially_approved')
     AND (NEW.approved_amount IS NULL OR NEW.approved_amount <= 0)
BEGIN
    SELECT RAISE(ABORT, 'An approved amount is required to approve a claim');
END;

CREATE TRIGGER trg_claim_resolved AFTER UPDATE OF status ON claims
WHEN NEW.status IN ('approved','partially_approved','rejected','paid')
BEGIN
    UPDATE claims SET resolved_at = COALESCE(resolved_at, datetime('now'))
     WHERE claim_id = NEW.claim_id;
END;

-- T5: matching a found bag to a report flips both statuses and logs it
CREATE TRIGGER trg_match_created AFTER INSERT ON report_matches
BEGIN
    UPDATE found_items SET status = 'matched' WHERE found_id = NEW.found_id;
    INSERT INTO status_history(entity_type, entity_id, old_status, new_status, changed_by, note)
        SELECT 'report', r.report_id, r.status, 'located', NEW.matched_by,
               'Bag matched with found item #' || NEW.found_id || ' (score ' || NEW.match_score || ')'
          FROM baggage_reports r WHERE r.report_id = NEW.report_id;
    UPDATE baggage_reports SET status = 'located' WHERE report_id = NEW.report_id;
END;

-- T6: paying a claim marks it paid and logs it
CREATE TRIGGER trg_payment_made AFTER INSERT ON payments
BEGIN
    INSERT INTO status_history(entity_type, entity_id, old_status, new_status, changed_by, note)
        SELECT 'claim', c.claim_id, c.status, 'paid', NEW.paid_by,
               'Payment of ' || NEW.amount || ' via ' || NEW.method
          FROM claims c WHERE c.claim_id = NEW.claim_id;
    UPDATE claims SET status = 'paid' WHERE claim_id = NEW.claim_id;
END;

-- =====================================================================
-- VIEWS
-- =====================================================================
CREATE VIEW v_report_summary AS
SELECT r.report_id, r.reference_no, r.report_type, r.status, r.tag_number,
       r.bag_type, r.color, r.brand, r.description, r.reported_at, r.last_updated,
       u.user_id, u.full_name AS passenger_name, u.email AS passenger_email,
       al.code AS airline_code, al.name AS airline_name,
       f.flight_number, f.flight_date,
       o.iata_code AS origin, d.iata_code AS destination,
       s.full_name AS assigned_staff
  FROM baggage_reports r
  JOIN users    u  ON u.user_id = r.user_id
  JOIN flights  f  ON f.flight_id = r.flight_id
  JOIN airlines al ON al.airline_id = f.airline_id
  JOIN airports o  ON o.airport_id = f.origin_airport_id
  JOIN airports d  ON d.airport_id = f.dest_airport_id
  LEFT JOIN users s ON s.user_id = r.assigned_staff_id;

CREATE VIEW v_claim_summary AS
SELECT c.claim_id, c.claim_no, c.claim_type, c.status, c.claimed_amount, c.approved_amount,
       c.submitted_at, c.resolved_at, c.description, c.resolution_note,
       r.report_id, r.reference_no, u.user_id, u.full_name AS claimant,
       u.email AS claimant_email, p.amount AS paid_amount, p.paid_at
  FROM claims c
  JOIN baggage_reports r ON r.report_id = c.report_id
  JOIN users u           ON u.user_id   = c.user_id
  LEFT JOIN payments p   ON p.claim_id  = c.claim_id;

CREATE VIEW v_airline_performance AS
SELECT al.code, al.name,
       COUNT(r.report_id)                          AS total_reports,
       COALESCE(SUM(r.status IN ('delivered','closed')), 0) AS resolved,
       COALESCE(SUM(r.status = 'unresolved'), 0)   AS unresolved,
       ROUND(AVG(CASE WHEN r.closed_at IS NOT NULL
             THEN julianday(r.closed_at) - julianday(r.reported_at) END), 1) AS avg_days_to_resolve
  FROM airlines al
  LEFT JOIN flights f ON f.airline_id = al.airline_id
  LEFT JOIN baggage_reports r ON r.flight_id = f.flight_id
 GROUP BY al.airline_id;
