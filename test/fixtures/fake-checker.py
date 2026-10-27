#!/usr/bin/env python3
import json
import os
import pathlib
import sys

sherlock = os.path.basename(sys.argv[0]) == "sherlock"
a = sys.argv[1:]
out = pathlib.Path(a[a.index("-fo") + 1])
full = "--site" not in a if sherlock else "-a" in a
gone = "Not Found!" if sherlock else "Not found!"
for u in a[a.index("--") + 1:]:
    print(f"[*] Checking username {u} on:")
    sites = (["Real", "SaysYes", "Erratic"] + (["Flaky"] if full else [])) if u == "eve" else ["SaysYes"]
    if "--site" in a:
        asked = [a[i + 1] for i, x in enumerate(a) if x == "--site"]
        sites = [s for s in sites if s in asked]
        for s in asked:
            if s not in sites and s != "Erratic":
                print(f"[-] {s}: {gone}")
    for s in sites:
        print(f"[+] {s}: https://{s.lower()}.example/{u}")
    report = {s: {"url_user": f"https://{s.lower()}.example/{u}", "status": {"status": "Claimed"}} for s in sites}
    (out / f"report_{u}_simple.json").write_text(json.dumps(report))
