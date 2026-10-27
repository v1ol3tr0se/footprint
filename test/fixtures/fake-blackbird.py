import datetime
import json
import pathlib
import sys

a = sys.argv[1:]
users = a[a.index("-u") + 1:] if "-u" in a else []
stamp = datetime.datetime.now().strftime("%m_%d_%Y")
for u in users:
    if u in ("empty", "fail"):
        print("🏁 Check completed in 1 seconds (1 sites)")
        continue
    print(f"  ✔️  [GitHub (User)] https://api.github.com/users/{u}")
    print("🏁 Check completed in 1 seconds (1 sites)")
    d = pathlib.Path("results") / f"{u}_{stamp}_blackbird"
    d.mkdir(parents=True, exist_ok=True)
    found = [{"name": "GitHub (User)", "url": "https://api.github.com/users/" + u, "category": "coding", "status": "FOUND", "metadata": None}]
    (d / f"{d.name}.json").write_text(json.dumps(found))
sys.exit(int("fail" in users))
