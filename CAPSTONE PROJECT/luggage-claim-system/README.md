# Baggage Desk - Lost Luggage & Claim Resolution System

A full-stack DBMS capstone project: passengers report lost, delayed or damaged bags, track the search,
and claim compensation; airline staff match found bags, decide claims and record payouts.

| Layer | Technology |
|---|---|
| Front-end | HTML, CSS, vanilla JavaScript single-page app (no build step) |
| Back-end | Python 3.9+ with Flask (REST API, session auth, password hashing) |
| Database | SQLite 3 (12 tables, 6 triggers, 3 views, indexes, constraints) |

## Run it (3 commands)

```bash
cd backend
pip install -r requirements.txt
python init_db.py          # creates database/luggage.db with demo data
python app.py              # open http://127.0.0.1:5000
```

Demo logins - password for all: `password123`

| Role | Email |
|---|---|
| Passenger | aarav@example.com, priya@example.com, rohan@example.com |
| Staff | staff@airport.test |
| Admin | admin@airport.test |

Public tracking demo: reference `LL-2026-00002` with email `priya@example.com` on the home page.

## Project layout

```
luggage-claim-system/
├── database/
│   ├── schema.sql      tables, constraints, indexes, triggers, views
│   ├── seed.sql        airlines, airports, demo users, reports, claims
│   └── queries.sql     10 demo queries (joins, subqueries, window fn, transaction)
├── backend/
│   ├── app.py          Flask REST API
│   ├── init_db.py      builds the database  (--empty for no demo data)
│   └── requirements.txt
├── frontend/           index.html, css/styles.css, js/app.js
└── docs/ER_DIAGRAM.md  ER diagram (Mermaid), normalisation, integrity notes
```

## Features

**Passenger** - register/sign in, file a lost/delayed/damaged report (reference number is generated), track status
timeline, message the desk, file an itemised compensation claim, follow claim decisions. Anyone can track a
report publicly with reference + email.

**Staff / admin** - dashboard (open cases, pending claims, recovery rate, payouts, airline performance), search and
filter all reports, update status with notes, log found bags, see ranked match suggestions and confirm a match,
approve / partly approve / reject / request info on claims, record payments.

## Workflows

* Report: `open -> searching -> located -> delivered -> closed` (or `unresolved`)
* Claim: `submitted -> under_review -> (info_requested) -> approved | partially_approved | rejected -> paid`

## Where the DBMS concepts live

| Concept | Where |
|---|---|
| ER design, 3NF | `docs/ER_DIAGRAM.md`, `database/schema.sql` |
| Constraints (PK, FK, UNIQUE, CHECK, partial unique index) | `schema.sql` |
| Triggers | `schema.sql` - T1 to T6 (reference numbers, timestamps, amount cap, approval rule, match, payment) |
| Views | `v_report_summary`, `v_claim_summary`, `v_airline_performance` |
| Transactions | `app.py` - report+flight, claim+items, decisions commit atomically |
| Joins, aggregates, subqueries, window functions | `database/queries.sql` |
| Similarity matching | `score_match()` in `app.py` (tag 60, colour 15, brand 15, type 10) |

## REST API summary

```
POST /api/auth/register | login | logout        GET /api/auth/me
GET  /api/lookups                               GET /api/track?ref=&email=
GET/POST /api/reports   GET /api/reports/:id    PATCH /api/reports/:id/status   POST /api/reports/:id/messages
GET  /api/reports/:id/suggestions               POST /api/reports/:id/match
GET/POST /api/found
GET/POST /api/claims    GET /api/claims/:id     PATCH /api/claims/:id/decision  POST /api/claims/:id/pay
GET  /api/stats
```

## Notes

* Set `SECRET_KEY` (environment variable) before any real deployment; the default is for local demos only.
* Currency is shown in INR. Change `money()` in `frontend/js/app.js` to use another currency.
* To reset the data at any time, run `python init_db.py` again.
* Google Fonts load from the internet; the UI falls back to system fonts when offline.
