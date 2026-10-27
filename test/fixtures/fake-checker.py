#!/usr/bin/env python3
import json
import os
import pathlib
import sys
import time

sherlock = os.path.basename(sys.argv[0]) == "sherlock"
a = sys.argv[1:]
out = pathlib.Path(a[a.index("-fo") + 1])
full = "--site" not in a and (sherlock or "-a" in a)
gone = "Not Found!" if sherlock else "Not found!"
for u in a[a.index("--") + 1:]:
    print(f"[*] Checking username {u} on:")
    if sherlock and u == "stuck":
        if full:
            print(f"[-] Before: {gone}", flush=True)
            time.sleep(30)
        for i, x in enumerate(a):
            if x == "--site":
                print(f"[-] {a[i + 1]}: {gone}")
        continue
    sites = (["Real", "SaysYes", "Erratic"] + (["Flaky"] if full else [])) if u == "eve" else ["SaysYes"]
    down = ["Down", "Slow"] if sherlock and u == "eve" else []
    if down and not full and float(a[a.index("--timeout") + 1]) >= 60:
        sites, down = sites + ["Slow"], ["Down"]
    if sherlock and full:
        print(f"[-] Nope: {gone}")
    if not sherlock and u == "eve":
        if full:
            print("[?] Wobbly: Request timeout error")
            print("[?] Dead: Connecting failure error")
            print("[?] Walled: Captcha error: Cloudflare")
        else:
            if float(a[a.index("--timeout") + 1]) >= 60 and "Wobbly" in a:
                sites.append("Wobbly")
            if "Dead" in a:
                print("[?] Dead: Connecting failure error")
    if "--site" in a:
        asked = [a[i + 1] for i, x in enumerate(a) if x == "--site"]
        sites = [s for s in sites if s in asked]
        down = [s for s in down if s in asked]
        for s in asked:
            if s not in sites + down and s not in ("Erratic", "Dead"):
                print(f"[-] {s}: {gone}")
    for s in down:
        print(f"[-] {s}: Timeout Error ")
    for s in sites:
        print(f"[+] {s}: https://{s.lower()}.example/{u}")
    report = {s: {"url_user": f"https://{s.lower()}.example/{u}", "status": {"status": "Claimed"}} for s in sites}
    (out / f"report_{u}_simple.json").write_text(json.dumps(report))
