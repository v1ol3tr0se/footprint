#!/usr/bin/env python3
import csv
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
HOSTS = {"Dead": "https://dead.invalid/", "Wobbly": "http://localhost/", "Silent": "http://localhost/"}
if not sherlock:
    db = out / "db.json"
    db.write_text(json.dumps({"sites": {s: {"urlMain": h} for s, h in HOSTS.items()}}))
    print(f"[+] Using sites database: {db} ({len(HOSTS)} sites)")
asked = [a[i + 1] for i, x in enumerate(a) if x == "--site"]
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
    if sherlock and "sticky" in a and u != "sticky" and "Sticky" in asked:
        for x in asked:
            if x == "Sticky":
                time.sleep(30)
            print(f"[-] {x}: {gone}")
        continue
    if sherlock and u == "sticky":
        for x in asked or ["Real", "Sticky"]:
            print(f"[+] {x}: https://{x.lower()}.example/{u}")
        continue
    if sherlock and u == "drip":
        if full:
            for x in ("A", "B", "C"):
                print(f"[-] {x}: Timeout Error ")
        elif "A" in asked:
            time.sleep(30)
        for x in asked:
            print(f"[-] {x}: {gone}")
        continue
    sites = (["Real", "SaysYes", "Erratic"] + (["Flaky"] if full else [])) if u == "eve" else ["SaysYes"]
    down = ["Down", "Slow"] if sherlock and u == "eve" else []
    if down and not full and float(a[a.index("--timeout") + 1]) >= 60:
        sites, down = sites + ["Slow"], ["Down"]
    if sherlock and full:
        print(f"[-] Nope: {gone}")
    states = {}
    if not sherlock and u == "eve":
        if full:
            print("[?] Wobbly: Request timeout error")
            print("[?] Dead: Connecting failure error")
            print("[?] Walled: Captcha error: Cloudflare")
            states = {
                "Nope": "Available",
                "Wobbly": "Request timeout error: read, 20s",
                "Dead": "Connecting failure error: Cannot connect",
                "Walled": "Captcha error: Cloudflare",
                "Silent": "Request failed error",
                "Skippy": "Skipped error: no tor gateway configured",
                "Busy": "Server error: 503 status code",
            }
        elif float(a[a.index("--timeout") + 1]) >= 60 and "Wobbly" in a:
            sites.append("Wobbly")
        if not full and "--print-not-found" not in a:
            states = {"Silent": "Request failed error", "Busy": "Available", "Pixwox": "Bot protection error: mirror"}
            states.update({s: "Connecting failure error: Cannot connect" for s in asked if s == "Dead"})
    if "--site" in a:
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
    if "-C" in a:
        rows = [["username", "name", "url_main", "url_user", "exists", "http_status", "error_reason"]]
        rows += [[u, s, "", "", "Claimed", 200, ""] for s in sites]
        rows += [[u, s, "", "", "Available" if st == "Available" else "Unknown", 0, st] for s, st in states.items()]
        with (out / f"report_{u}.csv").open("w", newline="") as f:
            csv.writer(f).writerows(rows)
