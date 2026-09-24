# a4-reading-dictionaries

Dictionary data files for the A4 Reading Obsidian plugin's word-lookup
feature. The plugin downloads a dictionary from here only when you press
**Download** in its settings (Settings → A4 Reading → Word lookup), checks it
against the checksum in `manifest.json`, and from then on works offline.

| Language | File | Source | Licence |
|---|---|---|---|
| English | `en.tsv.gz` | [Princeton WordNet](https://wordnet.princeton.edu/) 3.1 (via the `wordnet-db` package), with WordNet's irregular-form lists | WordNet licence, see `LICENSE-WordNet.txt` |
| Spanish, French, German | coming | [Wiktionary](https://www.wiktionary.org/), each language's own edition, via [kaikki.org](https://kaikki.org/) | CC BY-SA 4.0 and GFDL |

Built from [Wiktionary](https://www.wiktionary.org/) extracts provided
by [kaikki.org](https://kaikki.org/). Wiktionary content is licensed
under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
and the [GFDL](https://www.gnu.org/licenses/fdl-1.3.html); any reuse
of this data must carry the same attribution and share-alike terms.

WordNet 3.1 Copyright 2006 by Princeton University. All rights reserved.

## Format

Each file is gzip-compressed text, one word per line, sorted by word:

    word<TAB>[["part of speech", "meaning", "example (optional)"], ...]

An inflected or irregular form points at its base word instead:
`went<TAB>[["=","go","verb"]]`.

## Rebuilding

English (runs anywhere with npm):

    npm pack wordnet-db@3.1.14 && tar xzf wordnet-db-3.1.14.tgz
    npm pack wndb-with-exceptions@3.0.2 && mkdir wx && tar xzf wndb-with-exceptions-3.0.2.tgz -C wx
    node scripts/build-wordnet.js package/dict wx/package/data

Spanish, French or German (needs to reach kaikki.org; pass the file or URL of
that language's own Wiktionary edition extract, `.jsonl` or `.jsonl.gz`):

    node scripts/build-wiktionary.js es <file or URL>

Each build writes `<lang>.tsv.gz` and updates `manifest.json`.
