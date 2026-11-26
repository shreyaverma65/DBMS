"""
Lost Luggage & Claim Resolution System - Flask REST API
Run:  python init_db.py   (once)   then   python app.py
"""
import os
import re
import sqlite3
import secrets
from functools import wraps

from flask import Flask, g, jsonify, request, session, send_from_directory
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("LUGGAGE_DB", os.path.join(BASE_DIR, "..", "database", "luggage.db"))
FRONTEND_DIR = os.path.join(BASE_DIR, "..", "frontend")

app = Flask(__name__, static_folder=None)
app.secret_key = os.environ.get("SECRET_KEY", "change-this-secret-in-production")
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax")

STAFF_ROLES = ("staff", "admin")
REPORT_STATUSES = ("open", "searching", "located", "delivered", "closed", "unresolved")
CLAIM_DECISIONS = ("under_review", "info_requested", "approved", "partially_approved", "rejected")
CLAIM_TYPES = ("lost_bag", "damaged_bag", "missing_contents", "delay_expenses")
BAG_TYPES = ("suitcase", "backpack", "duffel", "box", "other")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# ------------------------------------------------------------------ DB helpers
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def rows(sql, args=()):
    return [dict(r) for r in get_db().execute(sql, args).fetchall()]


def one(sql, args=()):
    r = get_db().execute(sql, args).fetchone()
    return dict(r) if r else None


class ApiError(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status


@app.errorhandler(ApiError)
def handle_api_error(e):
    return jsonify(error=e.message), e.status


@app.errorhandler(sqlite3.IntegrityError)
def handle_integrity(e):
    msg = str(e)
    if "uq_active_claim" in msg or "claims.report_id" in msg:
        msg = "A claim of this type is already open for this report."
    elif "users.email" in msg:
        msg = "An account with this email already exists."
    return jsonify(error=msg), 409


@app.errorhandler(sqlite3.DatabaseError)
def handle_db_error(e):
    # Raised by trigger RAISE(ABORT, ...) business rules
    return jsonify(error=str(e)), 400


# ------------------------------------------------------------------ auth utils
def current_user():
    uid = session.get("user_id")
    if not uid:
        return None
    return one("SELECT user_id, full_name, email, phone, role FROM users WHERE user_id = ?", (uid,))


def login_required(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        user = current_user()
        if not user:
            raise ApiError("Please sign in to continue.", 401)
        g.user = user
        return fn(*a, **kw)
    return wrapper


def staff_required(fn):
    @wraps(fn)
    @login_required
    def wrapper(*a, **kw):
        if g.user["role"] not in STAFF_ROLES:
            raise ApiError("Staff access required.", 403)
        return fn(*a, **kw)
    return wrapper


def body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError("Request body must be JSON.")
    return data


def need(data, *fields):
    missing = [f for f in fields if data.get(f) in (None, "")]
    if missing:
        raise ApiError("Missing required field(s): " + ", ".join(missing))


def log_status(entity, entity_id, old, new, user_id, note=None):
    get_db().execute(
        "INSERT INTO status_history(entity_type, entity_id, old_status, new_status, changed_by, note) "
        "VALUES (?,?,?,?,?,?)", (entity, entity_id, old, new, user_id, note))


def get_report_or_404(report_id):
    r = one("SELECT * FROM v_report_summary WHERE report_id = ?", (report_id,))
    if not r:
        raise ApiError("Report not found.", 404)
    if g.user["role"] not in STAFF_ROLES and r["user_id"] != g.user["user_id"]:
        raise ApiError("You do not have access to this report.", 403)
    return r


# ------------------------------------------------------------------ auth routes
@app.post("/api/auth/register")
def register():
    d = body()
    need(d, "full_name", "email", "password")
    if not EMAIL_RE.match(d["email"]):
        raise ApiError("Enter a valid email address.")
    if len(d["password"]) < 8:
        raise ApiError("Password must be at least 8 characters.")
    db = get_db()
    cur = db.execute(
        "INSERT INTO users(full_name, email, phone, password_hash, role) VALUES (?,?,?,?, 'passenger')",
        (d["full_name"].strip(), d["email"].strip().lower(), d.get("phone"),
         generate_password_hash(d["password"])))
    db.commit()
    session["user_id"] = cur.lastrowid
    return jsonify(user=current_user()), 201


@app.post("/api/auth/login")
def login():
    d = body()
    need(d, "email", "password")
    u = one("SELECT * FROM users WHERE email = ?", (d["email"].strip().lower(),))
    if not u or not check_password_hash(u["password_hash"], d["password"]):
        raise ApiError("Email or password is incorrect.", 401)
    session["user_id"] = u["user_id"]
    return jsonify(user=current_user())


@app.post("/api/auth/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.get("/api/auth/me")
def me():
    return jsonify(user=current_user())


# ------------------------------------------------------------------ lookups
@app.get("/api/lookups")
def lookups():
    return jsonify(
        airlines=rows("SELECT airline_id, code, name FROM airlines ORDER BY name"),
        airports=rows("SELECT airport_id, iata_code, city, name FROM airports ORDER BY city"),
        bag_types=BAG_TYPES, claim_types=CLAIM_TYPES, report_statuses=REPORT_STATUSES)


# ------------------------------------------------------------------ public tracking
@app.get("/api/track")
def track():
    ref = (request.args.get("ref") or "").strip().upper()
    email = (request.args.get("email") or "").strip().lower()
    if not ref or not email:
        raise ApiError("Enter both the reference number and the email used on the report.")
    r = one("SELECT report_id, reference_no, report_type, status, airline_name, flight_number, "
            "flight_date, origin, destination, reported_at, last_updated "
            "FROM v_report_summary WHERE reference_no = ? AND lower(passenger_email) = ?", (ref, email))
    if not r:
        raise ApiError("No report matches that reference and email.", 404)
    r["history"] = rows("SELECT new_status, note, changed_at FROM status_history "
                        "WHERE entity_type='report' AND entity_id=? ORDER BY history_id", (r.pop("report_id"),))
    return jsonify(report=r)


# ------------------------------------------------------------------ reports
@app.post("/api/reports")
@login_required
def create_report():
    d = body()
    need(d, "airline_id", "flight_number", "flight_date", "origin_airport_id",
         "dest_airport_id", "report_type", "description")
    if d["report_type"] not in ("lost", "delayed", "damaged"):
        raise ApiError("Invalid report type.")
    if d.get("bag_type", "suitcase") not in BAG_TYPES:
        raise ApiError("Invalid bag type.")
    if int(d["origin_airport_id"]) == int(d["dest_airport_id"]):
        raise ApiError("Origin and destination must be different airports.")
    weight = d.get("weight_kg") or None
    if weight is not None and float(weight) <= 0:
        raise ApiError("Weight must be greater than zero.")

    db = get_db()
    fn = d["flight_number"].replace(" ", "").upper()
    # find-or-create the flight (a transaction keeps flight + report consistent)
    f = one("SELECT flight_id FROM flights WHERE airline_id=? AND flight_number=? AND flight_date=?",
            (d["airline_id"], fn, d["flight_date"]))
    flight_id = f["flight_id"] if f else db.execute(
        "INSERT INTO flights(airline_id, flight_number, origin_airport_id, dest_airport_id, flight_date) "
        "VALUES (?,?,?,?,?)", (d["airline_id"], fn, d["origin_airport_id"], d["dest_airport_id"],
                               d["flight_date"])).lastrowid
    cur = db.execute(
        "INSERT INTO baggage_reports(reference_no, user_id, flight_id, report_type, tag_number, bag_type, "
        "color, brand, weight_kg, description, contents_summary, delivery_address) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        ("PENDING-" + secrets.token_hex(4), g.user["user_id"], flight_id, d["report_type"],
         (d.get("tag_number") or "").strip() or None, d.get("bag_type", "suitcase"),
         (d.get("color") or "").strip().lower() or None, (d.get("brand") or "").strip() or None,
         weight, d["description"].strip(), d.get("contents_summary"), d.get("delivery_address")))
    rid = cur.lastrowid
    log_status("report", rid, None, "open", g.user["user_id"], "Report filed")
    db.commit()
    return jsonify(report=one("SELECT * FROM v_report_summary WHERE report_id=?", (rid,))), 201


@app.get("/api/reports")
@login_required
def list_reports():
    sql, args = "SELECT * FROM v_report_summary WHERE 1=1", []
    if g.user["role"] not in STAFF_ROLES:
        sql += " AND user_id = ?"; args.append(g.user["user_id"])
    status = request.args.get("status")
    if status:
        sql += " AND status = ?"; args.append(status)
    q = (request.args.get("q") or "").strip()
    if q:
        like = f"%{q}%"
        sql += " AND (reference_no LIKE ? OR tag_number LIKE ? OR passenger_name LIKE ? OR flight_number LIKE ?)"
        args += [like] * 4
    sql += " ORDER BY last_updated DESC"
    return jsonify(reports=rows(sql, args))


@app.get("/api/reports/<int:rid>")
@login_required
def report_detail(rid):
    r = get_report_or_404(rid)
    full = one("SELECT weight_kg, contents_summary, delivery_address FROM baggage_reports WHERE report_id=?", (rid,))
    r.update(full)
    r["history"] = rows(
        "SELECT h.new_status, h.note, h.changed_at, u.full_name AS changed_by FROM status_history h "
        "LEFT JOIN users u ON u.user_id = h.changed_by "
        "WHERE h.entity_type='report' AND h.entity_id=? ORDER BY h.history_id", (rid,))
    r["messages"] = rows(
        "SELECT m.body, m.created_at, u.full_name, u.role FROM messages m "
        "JOIN users u ON u.user_id = m.user_id WHERE m.report_id=? ORDER BY m.message_id", (rid,))
    r["claims"] = rows("SELECT * FROM v_claim_summary WHERE report_id=? ORDER BY claim_id", (rid,))
    r["matches"] = rows(
        "SELECT m.match_id, m.match_score, m.matched_at, f.found_id, f.description, f.storage_location, "
        "f.status, a.iata_code AS found_at FROM report_matches m "
        "JOIN found_items f ON f.found_id = m.found_id JOIN airports a ON a.airport_id = f.found_airport_id "
        "WHERE m.report_id=?", (rid,))
    return jsonify(report=r)


@app.patch("/api/reports/<int:rid>/status")
@staff_required
def update_report_status(rid):
    d = body()
    need(d, "status")
    if d["status"] not in REPORT_STATUSES:
        raise ApiError("Invalid status.")
    r = get_report_or_404(rid)
    db = get_db()
    if d["status"] == "delivered":
        db.execute("UPDATE found_items SET status='returned' WHERE found_id IN "
                   "(SELECT found_id FROM report_matches WHERE report_id=?)", (rid,))
    db.execute("UPDATE baggage_reports SET status=?, assigned_staff_id=COALESCE(assigned_staff_id, ?) "
               "WHERE report_id=?", (d["status"], g.user["user_id"], rid))
    if r["status"] != d["status"]:
        log_status("report", rid, r["status"], d["status"], g.user["user_id"], d.get("note"))
    db.commit()
    return jsonify(report=one("SELECT * FROM v_report_summary WHERE report_id=?", (rid,)))


@app.post("/api/reports/<int:rid>/messages")
@login_required
def post_message(rid):
    get_report_or_404(rid)
    d = body()
    need(d, "body")
    db = get_db()
    db.execute("INSERT INTO messages(report_id, user_id, body) VALUES (?,?,?)",
               (rid, g.user["user_id"], d["body"].strip()))
    db.execute("UPDATE baggage_reports SET last_updated = datetime('now') WHERE report_id=?", (rid,))
    db.commit()
    return jsonify(ok=True), 201


# ------------------------------------------------------------------ found items + matching
@app.get("/api/found")
@staff_required
def list_found():
    status = request.args.get("status")
    sql = ("SELECT f.*, a.iata_code AS airport FROM found_items f "
           "JOIN airports a ON a.airport_id = f.found_airport_id")
    args = []
    if status:
        sql += " WHERE f.status = ?"; args.append(status)
    return jsonify(items=rows(sql + " ORDER BY f.found_date DESC, f.found_id DESC", args))


@app.post("/api/found")
@staff_required
def create_found():
    d = body()
    need(d, "description", "found_airport_id")
    if d.get("bag_type", "suitcase") not in BAG_TYPES:
        raise ApiError("Invalid bag type.")
    db = get_db()
    cur = db.execute(
        "INSERT INTO found_items(tag_number, bag_type, color, brand, description, found_airport_id, "
        "storage_location, logged_by) VALUES (?,?,?,?,?,?,?,?)",
        ((d.get("tag_number") or "").strip() or None, d.get("bag_type", "suitcase"),
         (d.get("color") or "").strip().lower() or None, (d.get("brand") or "").strip() or None,
         d["description"].strip(), d["found_airport_id"], d.get("storage_location"), g.user["user_id"]))
    db.commit()
    return jsonify(found_id=cur.lastrowid), 201


def score_match(report, item):
    """Heuristic 0-100 similarity between a lost-bag report and a found item."""
    score = 0
    if report["tag_number"] and item["tag_number"] and report["tag_number"] == item["tag_number"]:
        score += 60
    if report["bag_type"] == item["bag_type"]:
        score += 10
    for field, pts in (("color", 15), ("brand", 15)):
        a, b = (report[field] or "").lower(), (item[field] or "").lower()
        if a and b and a == b:
            score += pts
    return min(score, 100)


@app.get("/api/reports/<int:rid>/suggestions")
@staff_required
def suggestions(rid):
    r = one("SELECT * FROM baggage_reports WHERE report_id=?", (rid,))
    if not r:
        raise ApiError("Report not found.", 404)
    items = rows("SELECT f.*, a.iata_code AS airport FROM found_items f "
                 "JOIN airports a ON a.airport_id=f.found_airport_id WHERE f.status='in_storage'")
    out = []
    for it in items:
        s = score_match(r, it)
        if s >= 25:
            it["match_score"] = s
            out.append(it)
    out.sort(key=lambda x: -x["match_score"])
    return jsonify(suggestions=out)


@app.post("/api/reports/<int:rid>/match")
@staff_required
def confirm_match(rid):
    d = body()
    need(d, "found_id")
    r = one("SELECT * FROM baggage_reports WHERE report_id=?", (rid,))
    it = one("SELECT * FROM found_items WHERE found_id=?", (d["found_id"],))
    if not r or not it:
        raise ApiError("Report or found item not found.", 404)
    if it["status"] != "in_storage":
        raise ApiError("That found item is no longer available for matching.", 409)
    db = get_db()
    db.execute("INSERT INTO report_matches(report_id, found_id, match_score, matched_by) VALUES (?,?,?,?)",
               (rid, it["found_id"], score_match(r, it), g.user["user_id"]))  # trigger T5 updates statuses
    db.commit()
    return jsonify(ok=True), 201


# ------------------------------------------------------------------ claims
@app.post("/api/claims")
@login_required
def create_claim():
    d = body()
    need(d, "report_id", "claim_type", "description")
    if d["claim_type"] not in CLAIM_TYPES:
        raise ApiError("Invalid claim type.")
    r = get_report_or_404(int(d["report_id"]))
    if r["user_id"] != g.user["user_id"]:
        raise ApiError("Only the passenger who filed the report can submit a claim.", 403)
    items = d.get("items") or []
    if not items:
        raise ApiError("Add at least one item to the claim.")
    total = 0.0
    for it in items:
        if not str(it.get("item_name", "")).strip():
            raise ApiError("Each claim item needs a name.")
        qty, val = int(it.get("quantity", 1)), float(it.get("unit_value", 0))
        if qty < 1 or val < 0:
            raise ApiError("Item quantity must be at least 1 and value cannot be negative.")
        total += qty * val
    db = get_db()
    cur = db.execute(
        "INSERT INTO claims(claim_no, report_id, user_id, claim_type, description, claimed_amount) "
        "VALUES (?,?,?,?,?,?)", ("PENDING-" + secrets.token_hex(4), r["report_id"], g.user["user_id"],
                                 d["claim_type"], d["description"].strip(), total))
    cid = cur.lastrowid
    db.executemany("INSERT INTO claim_items(claim_id, item_name, quantity, unit_value) VALUES (?,?,?,?)",
                   [(cid, i["item_name"].strip(), int(i.get("quantity", 1)), float(i["unit_value"])) for i in items])
    log_status("claim", cid, None, "submitted", g.user["user_id"], "Claim submitted")
    db.commit()
    return jsonify(claim=one("SELECT * FROM v_claim_summary WHERE claim_id=?", (cid,))), 201


@app.get("/api/claims")
@login_required
def list_claims():
    sql, args = "SELECT * FROM v_claim_summary WHERE 1=1", []
    if g.user["role"] not in STAFF_ROLES:
        sql += " AND user_id = ?"; args.append(g.user["user_id"])
    if request.args.get("status"):
        sql += " AND status = ?"; args.append(request.args["status"])
    return jsonify(claims=rows(sql + " ORDER BY submitted_at DESC", args))


@app.get("/api/claims/<int:cid>")
@login_required
def claim_detail(cid):
    c = one("SELECT * FROM v_claim_summary WHERE claim_id=?", (cid,))
    if not c:
        raise ApiError("Claim not found.", 404)
    if g.user["role"] not in STAFF_ROLES and c["user_id"] != g.user["user_id"]:
        raise ApiError("You do not have access to this claim.", 403)
    c["items"] = rows("SELECT item_name, quantity, unit_value, quantity*unit_value AS line_total "
                      "FROM claim_items WHERE claim_id=?", (cid,))
    c["history"] = rows("SELECT h.new_status, h.note, h.changed_at, u.full_name AS changed_by "
                        "FROM status_history h LEFT JOIN users u ON u.user_id=h.changed_by "
                        "WHERE h.entity_type='claim' AND h.entity_id=? ORDER BY h.history_id", (cid,))
    return jsonify(claim=c)


@app.patch("/api/claims/<int:cid>/decision")
@staff_required
def decide_claim(cid):
    d = body()
    need(d, "status")
    if d["status"] not in CLAIM_DECISIONS:
        raise ApiError("Invalid decision.")
    c = one("SELECT * FROM claims WHERE claim_id=?", (cid,))
    if not c:
        raise ApiError("Claim not found.", 404)
    if c["status"] == "paid":
        raise ApiError("A paid claim can no longer be changed.", 409)
    if d["status"] in ("rejected", "info_requested") and not (d.get("note") or "").strip():
        raise ApiError("Add a note explaining the decision to the passenger.")
    amount = d.get("approved_amount")
    if d["status"] == "approved":
        amount = c["claimed_amount"]
    elif d["status"] == "partially_approved":
        if amount in (None, ""):
            raise ApiError("Enter the approved amount.")
        amount = float(amount)
        if not 0 < amount < c["claimed_amount"]:
            raise ApiError("A partial approval must be above zero and below the claimed amount.")
    else:
        amount = None
    db = get_db()
    db.execute("UPDATE claims SET approved_amount=?, resolution_note=?, reviewed_by=? WHERE claim_id=?",
               (amount, d.get("note"), g.user["user_id"], cid))
    db.execute("UPDATE claims SET status=? WHERE claim_id=?", (d["status"], cid))  # triggers T3/T4
    log_status("claim", cid, c["status"], d["status"], g.user["user_id"], d.get("note"))
    db.commit()
    return jsonify(claim=one("SELECT * FROM v_claim_summary WHERE claim_id=?", (cid,)))


@app.post("/api/claims/<int:cid>/pay")
@staff_required
def pay_claim(cid):
    d = body()
    need(d, "method")
    c = one("SELECT * FROM claims WHERE claim_id=?", (cid,))
    if not c:
        raise ApiError("Claim not found.", 404)
    if c["status"] not in ("approved", "partially_approved"):
        raise ApiError("Only approved claims can be paid.", 409)
    db = get_db()
    db.execute("INSERT INTO payments(claim_id, amount, method, txn_reference, paid_by) VALUES (?,?,?,?,?)",
               (cid, c["approved_amount"], d["method"], d.get("txn_reference"), g.user["user_id"]))  # trigger T6
    db.commit()
    return jsonify(claim=one("SELECT * FROM v_claim_summary WHERE claim_id=?", (cid,)))


# ------------------------------------------------------------------ analytics
@app.get("/api/stats")
@staff_required
def stats():
    by_status = {r["status"]: r["n"] for r in rows("SELECT status, COUNT(*) n FROM baggage_reports GROUP BY status")}
    claims_by_status = {r["status"]: r["n"] for r in rows("SELECT status, COUNT(*) n FROM claims GROUP BY status")}
    money = one("SELECT COALESCE(SUM(claimed_amount),0) AS claimed, "
                "COALESCE(SUM(CASE WHEN status='paid' THEN approved_amount END),0) AS paid FROM claims")
    return jsonify(
        reports_by_status=by_status,
        claims_by_status=claims_by_status,
        total_reports=sum(by_status.values()),
        open_reports=sum(by_status.get(s, 0) for s in ("open", "searching", "located")),
        pending_claims=sum(claims_by_status.get(s, 0) for s in ("submitted", "under_review", "info_requested")),
        found_in_storage=one("SELECT COUNT(*) n FROM found_items WHERE status='in_storage'")["n"],
        money=money,
        airlines=rows("SELECT * FROM v_airline_performance WHERE total_reports > 0 ORDER BY total_reports DESC"),
        recovery_rate=one("SELECT ROUND(100.0 * SUM(status IN ('delivered','closed')) / COUNT(*), 0) AS pct "
                          "FROM baggage_reports")["pct"])


# ------------------------------------------------------------------ frontend
@app.get("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.get("/<path:path>")
def static_files(path):
    if path.startswith("api/"):
        raise ApiError("Not found.", 404)
    return send_from_directory(FRONTEND_DIR, path)


if __name__ == "__main__":
    if not os.path.exists(DB_PATH):
        raise SystemExit("Database not found. Run `python init_db.py` first.")
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5000)), debug=True)
