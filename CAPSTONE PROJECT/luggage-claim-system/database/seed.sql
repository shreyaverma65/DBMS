-- Seed data. {{PW_HASH}} is replaced with a hash of "password123" by init_db.py
PRAGMA foreign_keys = ON;

INSERT INTO airlines(code, name) VALUES
 ('6E','IndiGo'),('AI','Air India'),('QP','Akasa Air'),('SG','SpiceJet'),
 ('EK','Emirates'),('SQ','Singapore Airlines'),('BA','British Airways');

INSERT INTO airports(iata_code, name, city, country) VALUES
 ('DEL','Indira Gandhi International','Delhi','India'),
 ('BOM','Chhatrapati Shivaji Maharaj International','Mumbai','India'),
 ('BLR','Kempegowda International','Bengaluru','India'),
 ('HYD','Rajiv Gandhi International','Hyderabad','India'),
 ('MAA','Chennai International','Chennai','India'),
 ('CCU','Netaji Subhas Chandra Bose International','Kolkata','India'),
 ('DXB','Dubai International','Dubai','UAE'),
 ('SIN','Changi Airport','Singapore','Singapore'),
 ('LHR','Heathrow Airport','London','United Kingdom'),
 ('JFK','John F. Kennedy International','New York','USA');

-- Users (all demo passwords: password123)
INSERT INTO users(user_id, full_name, email, phone, password_hash, role) VALUES
 (1,'Ananya Rao',   'staff@airport.test',  '+91 98100 00001','{{PW_HASH}}','staff'),
 (2,'Vikram Singh', 'admin@airport.test',  '+91 98100 00002','{{PW_HASH}}','admin'),
 (3,'Aarav Sharma', 'aarav@example.com',   '+91 98100 10003','{{PW_HASH}}','passenger'),
 (4,'Priya Nair',   'priya@example.com',   '+91 98100 10004','{{PW_HASH}}','passenger'),
 (5,'Rohan Mehta',  'rohan@example.com',   '+91 98100 10005','{{PW_HASH}}','passenger');

INSERT INTO flights(flight_id, airline_id, flight_number, origin_airport_id, dest_airport_id, flight_date) VALUES
 (1,1,'6E2041',1,2,date('now','-6 day')),
 (2,2,'AI101', 1,9,date('now','-10 day')),
 (3,3,'QP1405',3,1,date('now','-3 day')),
 (4,5,'EK511', 7,1,date('now','-14 day')),
 (5,4,'SG8152',1,4,date('now','-2 day'));

INSERT INTO baggage_reports
 (report_id, reference_no, user_id, flight_id, report_type, tag_number, bag_type, color, brand,
  weight_kg, description, contents_summary, delivery_address, status, assigned_staff_id, reported_at, closed_at)
VALUES
 (1,'TMP1',3,2,'lost','0098123456','suitcase','black','Samsonite',23,
  'Large black hard-shell suitcase with a red ribbon on the handle.',
  'Clothes, laptop charger, two gift boxes','12 Lodhi Road, New Delhi','searching',1,
  datetime('now','-9 day'),NULL),
 (2,'TMP2',4,1,'delayed','0161234567','backpack','blue','Wildcraft',9,
  'Navy blue backpack with a luggage tag in my name.',
  'Camera, documents, toiletries','Flat 4B, Bandra West, Mumbai','searching',1,
  datetime('now','-5 day'),NULL),
 (3,'TMP3',3,4,'damaged','0176543210','suitcase','red','American Tourister',20,
  'Red suitcase, wheel broken and a large crack on the side panel.',
  'Clothes and souvenirs','12 Lodhi Road, New Delhi','closed',1,
  datetime('now','-13 day'),datetime('now','-4 day')),
 (4,'TMP4',5,3,'lost',NULL,'duffel','green','Decathlon',14,
  'Green sports duffel bag with a white stripe.',
  'Cricket kit and shoes','Sector 62, Noida','open',NULL,
  datetime('now','-2 day'),NULL),
 (5,'TMP5',4,5,'delayed','0451122334','suitcase','grey','Skybags',18,
  'Grey cabin-size trolley bag.',
  'Work clothes','Gachibowli, Hyderabad','delivered',1,
  datetime('now','-2 day'),datetime('now','-1 day'));

INSERT INTO found_items(found_id, tag_number, bag_type, color, brand, description,
                        found_airport_id, found_date, storage_location, status, logged_by) VALUES
 (1,'0161234567','backpack','blue','Wildcraft','Blue backpack found near carousel 4',2,date('now','-3 day'),'Lost Property Shelf B-12','in_storage',1),
 (2,NULL,'suitcase','black','Samsonite','Black hard-shell suitcase, no tag, red ribbon on handle',9,date('now','-4 day'),'Heathrow T3 Store A-03','in_storage',1),
 (3,NULL,'duffel','green','Decathlon','Green duffel with white stripe left at security',1,date('now','-1 day'),'Lost Property Shelf C-02','in_storage',1),
 (4,'0999888777','box','brown',NULL,'Cardboard box taped shut',3,date('now','-7 day'),'Shelf D-07','in_storage',1);

-- Case history for seeded reports
INSERT INTO status_history(entity_type, entity_id, old_status, new_status, changed_by, note, changed_at) VALUES
 ('report',1,NULL,'open',3,'Report filed',datetime('now','-9 day')),
 ('report',1,'open','searching',1,'Tracing request sent to LHR and DEL baggage services',datetime('now','-8 day')),
 ('report',2,NULL,'open',4,'Report filed',datetime('now','-5 day')),
 ('report',2,'open','searching',1,'Searching at BOM arrival hall',datetime('now','-4 day')),
 ('report',3,NULL,'open',3,'Report filed',datetime('now','-13 day')),
 ('report',3,'open','searching',1,'Damage inspection booked',datetime('now','-12 day')),
 ('report',3,'searching','closed',1,'Damage assessed, claim settled',datetime('now','-4 day')),
 ('report',4,NULL,'open',5,'Report filed',datetime('now','-2 day')),
 ('report',5,NULL,'open',4,'Report filed',datetime('now','-2 day')),
 ('report',5,'open','delivered',1,'Bag delivered to passenger address',datetime('now','-1 day'));

INSERT INTO messages(report_id, user_id, body, created_at) VALUES
 (1,3,'Any update on my suitcase? I have an important meeting next week.',datetime('now','-6 day')),
 (1,1,'We have sent a tracing request to Heathrow. A black Samsonite was logged there - we are verifying it.',datetime('now','-5 day')),
 (2,1,'Your backpack may have been found. Please check the case timeline shortly.',datetime('now','-3 day'));

-- Match for report 2 (trigger flips report 2 to "located" and found item 1 to "matched")
INSERT INTO report_matches(report_id, found_id, match_score, matched_by) VALUES (2,1,100,1);

-- Claim on the damaged bag (report 3): filed, approved partly, then paid
INSERT INTO claims(claim_id, claim_no, report_id, user_id, claim_type, description, claimed_amount, submitted_at)
VALUES (1,'TMP',3,3,'damaged_bag','Suitcase cracked and wheel broken during the EK511 flight.',8500,datetime('now','-11 day'));
INSERT INTO claim_items(claim_id, item_name, quantity, unit_value) VALUES
 (1,'American Tourister suitcase (replacement)',1,8500);
UPDATE claims SET approved_amount = 7000, status = 'partially_approved', reviewed_by = 1,
       resolution_note = 'Approved at depreciated value of the suitcase.' WHERE claim_id = 1;
INSERT INTO payments(claim_id, amount, method, txn_reference, paid_by, paid_at)
VALUES (1,7000,'bank_transfer','NEFT-20260001',1,datetime('now','-4 day'));

-- Pending claim on the lost bag (report 1)
INSERT INTO claims(claim_id, claim_no, report_id, user_id, claim_type, description, claimed_amount, status, reviewed_by, submitted_at)
VALUES (2,'TMP',1,3,'lost_bag','Bag not found after 21 days of searching.',46500,'under_review',1,datetime('now','-1 day'));
INSERT INTO claim_items(claim_id, item_name, quantity, unit_value) VALUES
 (2,'Samsonite suitcase',1,12000),
 (2,'Clothing',12,1500),
 (2,'Gift items',2,5250),
 (2,'Charger and accessories',1,6000);
