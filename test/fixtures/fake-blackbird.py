import datetime
import json
import pathlib
import sys

a = sys.argv[1:]
users = a[a.index("-u") + 1:] if "-u" in a else []
stamp = datetime.datetime.now().strftime("%m_%d_%Y")
slow = "--timeout" in a
for u in users:
    if u == "patchy":
        log = pathlib.Path("logs")
        log.mkdir(exist_ok=True)
        with (log / "blackbird.log").open("a") as f:
            f.write("2026-01-01 00:00:00,000 - root - ERROR - Error in Async HTTP Request [GET] https://down.example/patchy | TimeoutError()\n")
            if not slow:
                f.write("2026-01-01 00:00:00,000 - root - ERROR - Coudn't check GitHub (User) https://api.github.com/users/patchy | TimeoutError()\n")
        if not slow:
            print("🏁 Check completed in 1 seconds (1 sites)")
            continue
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
