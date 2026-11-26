# ER Diagram & Design Notes

Paste the Mermaid block below into https://mermaid.live or any Markdown viewer that supports Mermaid to render it.

```mermaid
erDiagram
    USERS ||--o{ BAGGAGE_REPORTS : files
    USERS ||--o{ CLAIMS : submits
    USERS ||--o{ FOUND_ITEMS : logs
    USERS ||--o{ MESSAGES : writes
    AIRLINES ||--o{ FLIGHTS : operates
    AIRPORTS ||--o{ FLIGHTS : "origin / destination"
    AIRPORTS ||--o{ FOUND_ITEMS : "found at"
    FLIGHTS ||--o{ BAGGAGE_REPORTS : "travelled on"
    BAGGAGE_REPORTS ||--o{ MESSAGES : has
    BAGGAGE_REPORTS ||--o{ CLAIMS : "basis for"
    BAGGAGE_REPORTS ||--o{ REPORT_MATCHES : "matched in"
    FOUND_ITEMS ||--o{ REPORT_MATCHES : "matched in"
    CLAIMS ||--|{ CLAIM_ITEMS : itemises
    CLAIMS ||--o| PAYMENTS : "settled by"

    USERS { int user_id PK  text email UK  text role }
    AIRLINES { int airline_id PK  text code UK }
    AIRPORTS { int airport_id PK  text iata_code UK }
    FLIGHTS { int flight_id PK  int airline_id FK  text flight_number  text flight_date }
    BAGGAGE_REPORTS { int report_id PK  text reference_no UK  int user_id FK  int flight_id FK  text status }
    FOUND_ITEMS { int found_id PK  text tag_number  text status }
    REPORT_MATCHES { int match_id PK  int report_id FK  int found_id FK  int match_score }
    CLAIMS { int claim_id PK  text claim_no UK  int report_id FK  real claimed_amount  real approved_amount  text status }
    CLAIM_ITEMS { int item_id PK  int claim_id FK  int quantity  real unit_value }
    PAYMENTS { int payment_id PK  int claim_id FK_UK  real amount }
    MESSAGES { int message_id PK  int report_id FK  int user_id FK }
    STATUS_HISTORY { int history_id PK  text entity_type  int entity_id }
```

## Normalisation
* **1NF** - every column is atomic; claim line items live in `claim_items`, not in a text blob.
* **2NF** - no partial dependencies; airline and airport facts live in their own tables, referenced by key.
* **3NF** - no transitive dependencies; a flight's airline/route is stored once in `flights`, not repeated on each report.
* `report_matches` resolves the many-to-many relationship between lost-bag reports and found items.
* `status_history` is a deliberate audit table (polymorphic via `entity_type`/`entity_id`).

## Integrity rules
| Mechanism | Examples |
|---|---|
| PRIMARY / FOREIGN KEYS | all relations, `PRAGMA foreign_keys = ON` |
| UNIQUE | `users.email`, `reference_no`, `claim_no`, `(airline, flight_number, date)`, one payment per claim |
| CHECK | status/role enums, `weight_kg > 0`, `claimed_amount >= 0`, origin <> destination |
| Partial unique index | only one non-rejected claim per report per claim type |
| Triggers | T1 reference numbers, T2 timestamps, T3 approved <= claimed, T4 approval needs amount, T5 match updates statuses, T6 payment marks claim paid |
| Views | `v_report_summary`, `v_claim_summary`, `v_airline_performance` |
| Transactions | report + flight creation, claim + items, decisions are committed atomically |

## Claim workflow
`submitted` -> `under_review` -> (`info_requested` ->) `approved` / `partially_approved` / `rejected` -> `paid`

## Report workflow
`open` -> `searching` -> `located` -> `delivered` -> `closed`  (or `unresolved` if the bag is never found)
