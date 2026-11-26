-- =====================================================================
-- Sample queries for demonstration / viva  (run: sqlite3 luggage.db < queries.sql)
-- =====================================================================
.headers on
.mode column

-- 1. JOIN: all open cases with passenger and flight details
SELECT reference_no, passenger_name, airline_name, flight_number, origin, destination, status
  FROM v_report_summary
 WHERE status IN ('open','searching','located')
 ORDER BY reported_at;

-- 2. GROUP BY / HAVING: airlines with more than one report
SELECT al.name, COUNT(*) AS reports
  FROM baggage_reports r
  JOIN flights f  ON f.flight_id = r.flight_id
  JOIN airlines al ON al.airline_id = f.airline_id
 GROUP BY al.airline_id
HAVING COUNT(*) >= 1
 ORDER BY reports DESC;

-- 3. Subquery: passengers who have filed a claim above the average claim
SELECT DISTINCT u.full_name, c.claimed_amount
  FROM claims c JOIN users u ON u.user_id = c.user_id
 WHERE c.claimed_amount > (SELECT AVG(claimed_amount) FROM claims);

-- 4. LEFT JOIN: reports that have NO claim yet
SELECT r.reference_no, r.status
  FROM baggage_reports r LEFT JOIN claims c ON c.report_id = r.report_id
 WHERE c.claim_id IS NULL;

-- 5. Matching: found items with the same tag as an open report
SELECT r.reference_no, f.found_id, f.storage_location
  FROM baggage_reports r
  JOIN found_items f ON f.tag_number = r.tag_number
 WHERE r.status IN ('open','searching') AND f.status = 'in_storage';

-- 6. Aggregate: total claimed vs approved vs paid by claim type
SELECT claim_type,
       COUNT(*)                    AS claims,
       SUM(claimed_amount)         AS claimed,
       SUM(approved_amount)        AS approved,
       SUM(CASE WHEN status='paid' THEN approved_amount END) AS paid
  FROM claims GROUP BY claim_type;

-- 7. Window function: rank each staff member by claims reviewed
SELECT u.full_name, COUNT(*) AS reviewed,
       RANK() OVER (ORDER BY COUNT(*) DESC) AS rnk
  FROM claims c JOIN users u ON u.user_id = c.reviewed_by
 GROUP BY u.user_id;

-- 8. Date arithmetic: average days from report to resolution (view)
SELECT * FROM v_airline_performance WHERE total_reports > 0;

-- 9. Audit trail for one report
SELECT h.changed_at, h.old_status, h.new_status, u.full_name AS by_user, h.note
  FROM status_history h LEFT JOIN users u ON u.user_id = h.changed_by
 WHERE h.entity_type = 'report' AND h.entity_id = 1
 ORDER BY h.history_id;

-- 10. Transaction + trigger demo (rolled back so data is untouched)
BEGIN;
  INSERT INTO report_matches(report_id, found_id, match_score, matched_by) VALUES (4, 3, 80, 1);
  SELECT reference_no, status FROM baggage_reports WHERE report_id = 4;   -- now 'located'
  SELECT found_id, status FROM found_items WHERE found_id = 3;            -- now 'matched'
ROLLBACK;
