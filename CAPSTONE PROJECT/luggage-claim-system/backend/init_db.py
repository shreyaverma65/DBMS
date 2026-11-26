"""Create (or reset) the SQLite database from database/schema.sql + seed.sql."""
import os
import sqlite3
import sys

from werkzeug.security import generate_password_hash

BASE = os.path.dirname(os.path.abspath(__file__))
DB_DIR = os.path.join(BASE, "..", "database")
DB_PATH = os.environ.get("LUGGAGE_DB", os.path.join(DB_DIR, "luggage.db"))


def main(with_seed=True):
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    con = sqlite3.connect(DB_PATH)
    with open(os.path.join(DB_DIR, "schema.sql"), encoding="utf-8") as f:
        con.executescript(f.read())
    if with_seed:
        with open(os.path.join(DB_DIR, "seed.sql"), encoding="utf-8") as f:
            seed = f.read().replace("{{PW_HASH}}", generate_password_hash("password123"))
        con.executescript(seed)
    con.commit()
    con.close()
    print(f"Database ready at {os.path.abspath(DB_PATH)}" + (" (with demo data)" if with_seed else ""))


if __name__ == "__main__":
    main(with_seed="--empty" not in sys.argv)
