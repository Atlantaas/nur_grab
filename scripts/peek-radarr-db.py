import os
import sqlite3

p = os.path.join(os.environ["TEMP"], "radarr.db")
con = sqlite3.connect(p)
tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print("tables", tables[:50])
try:
    rows = con.execute("SELECT Key, Value FROM Config").fetchall()
    for k, v in rows:
        if any(x in (k or "").lower() for x in ("tmdb", "api", "movie", "metadata")):
            print(k, "=", (v or "")[:120])
except Exception as e:
    print("config err", e)
# sample movie images
try:
    cols = [r[1] for r in con.execute("PRAGMA table_info(Movies)").fetchall()]
    print("Movies cols", cols)
except Exception as e:
    print(e)
