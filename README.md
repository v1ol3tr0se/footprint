# footprint 🔎

a little script that runs the osint tools you already have, then folds everything they find into one html report sorted by how much it actually exposes you

i made it to audit my own handles. if that's you too, it might save you some tab-juggling

### what it does
- runs [maigret](https://github.com/soxoj/maigret), [sherlock](https://github.com/sherlock-project/sherlock), [blackbird](https://github.com/p1ngul1n0/blackbird) and [holehe](https://github.com/megadose/holehe) at the same time, whichever it can find
- merges their hits so the same site doesn't show up three times
- ranks each one: payment pages, nsfw and dating sites, infostealer hits and anything that mentions another handle or email from the same run float to the top, name-taken checks sink to the bottom
- double-checks every maigret and sherlock hit before showing it: it asks the site again for your handle and for two made-up ones, and only keeps it if your handle is found again and the fakes aren't. bot walls, login redirects and dead forums say yes to anyone
- shows everything live in the terminal, and with `--html` it also writes a single themed page, light and dark, that lists what couldn't be checked (a tool that crashed or got rate limited) instead of quietly saying "nothing found"

it only reads what the tools report. no accounts, no scraping of its own, and maigret doesn't go chasing the handles it finds on your profiles (those could be someone else's)

### getting it
you need node 24 or newer, plus whichever of those tools you want it to run
```shell
yarn install
yarn link
```

that builds it and puts `footprint` in `~/.yarn/bin`, so that one has to be on your PATH. or skip the link and run `./src/main.ts` straight from the clone, node runs the typescript as is

### using it
```shell
footprint -u myhandle other_handle -e me@example.com
```

hits show up in the terminal as each tool finds them, and when everything's done you get them ranked per handle and email

want the page too:
```shell
footprint -u myhandle -e me@example.com --html
```
- `-u` usernames, `-e` emails, repeat them as much as you want, you just need one
- `--html` (or `-html`) writes the report into `reports/`, named after the handle that turned up the most stuff (for emails only, the username their hits mention the most). give it a path if you want it somewhere else, and `-n` if you want another title
- `-i` asks you for the handles, emails and the html instead, if you'd rather not remember flags
- `--no-nsfw` leaves nsfw sites out
- `--blackbird-home` is the blackbird clone it runs, point it at yours if it isn't in `~/Tools/OSINT/blackbird`

it takes a while, maigret checks every site it knows about and that's kinda a lot. ctrl-c still keeps whatever got done

if a name or email didn't get checked by every tool that ran, it exits with 1. the report still gets written either way

### a note
point it at your own stuff. it's for seeing what someone could find about you, not for digging into other people

### tests
```shell
yarn test
```

`yarn verify` does the typecheck and the lint first, same as the ci

run it again after cleaning up, watching the pink cards go away is the best part
