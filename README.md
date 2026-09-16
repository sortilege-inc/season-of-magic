# Season of Magic

A static campaign wiki + **playable D&D 2024 (5.5e) character sheets** for
**Season of Magic**, a run of Forgotten Realms organized play on the 2024 rules. Illuminated-manuscript
aesthetic: gold is the ground, bright green and blue are the ink.

No build step in the repo — plain HTML, one stylesheet, and the play engine.
The pages are **generated**; don't hand-edit them (see *Generated from source*).

## Structure

Section labels are evocative, and each directory slug matches its label.

| Path | Label | What |
|------|-------|------|
| `index.html` | — | Landing page — gold cartouche hero, section cards |
| `season.css` | — | The theme (every page shares it, play pages included) |
| `annals/` | **Annals** | Session-by-session play log + index |
| `company/` | **The Company** | Player-character pages + index. Each links to a play sheet. |
| `personae/` | **Personae** | NPCs + index |
| `banners/` | **Banners** | Factions, courts and orders + index |
| `realms/` | **Realms** | Gazetteer + index |
| `hoard/` | **The Hoard** | Relics and treasure + index |
| `arcana/` | **Arcana** | Rules references, organizer handouts and table rulings |
| `legendry/` | **Legendry** | Cosmology, history, myth |
| `table/` | **At the Table** | Safety tools, session structure, character creation |
| `threads/` | **Loose Threads** | The site owner's own player notes — theories and open questions |
| `play/` | — | The playable 5e/5.5e sheet engine (see below) |

To rename a section, edit `CATS` in the generator and `git mv` the directory.

### Cross-references

Author `[[Wikilinks]]` in the Markdown. Resolved links render as `.ref`; an
unresolved one renders as a dotted `.ref-open` span ("not yet chronicled") — an
honest gap rather than a dead link. The build prints every unresolved target.

## The play sheets (`play/`)

The engine is the D&D 5e sheet engine from the sibling `a-gibbous-moon` site,
re-skinned to this theme and used for the **2024 rules**. `season.css` carries a
documented *play-engine bridge* block that re-points the engine's variable names
(`--gold`, `--teal`, `--rust`, `--olive-deep`, …) at this palette — keep it in
sync if the engine is ever re-synced from upstream.

| File | Role |
|------|------|
| `sheet.js` | Renders `window.SHEET` into `#sheet`, wires clickable rolls, persists play-state |
| `sheet.css` | Sheet layout |
| `dice.js` | Game-agnostic animated roller |
| `dice.css` | Dice theming |

**At the table:** tap any ability modifier, save, skill, attack or spell attack
to roll it in the tray; set **Adv/Dis** first. Click spell-slot and feature-use
pips to spend/restore them; the HP `−/+` take damage/heal (**Shift** = 5, temp
HP absorbs first). **Long Rest** restores HP, slots, uses and half the hit dice.
Play-state persists per-browser in `localStorage`, so it survives reloads but is
local to each device.

**Authoring a sheet:** drop `<slug>.sheet.json` next to the character's Markdown
in `content/company/` (or in `build/sheets/`), and the build emits
`play/<slug>.html` and puts an **Open play sheet** button on the bio page. The
full `window.SHEET` schema is documented in `a-gibbous-moon/README.md`.

## Generated from source

Everything under the section directories is generated. Source and generator live
in the sibling support folder, `../season-of-magic-support/`:

| Path | What |
|------|------|
| `site.config.json` | Every path and every piece of site copy the build uses. Edit values **here**, not in the script |
| `content/<section>/*.md` | The hand-authored pages, with YAML-ish front matter |
| `content/<section>/*.sheet.json` | A page's play sheet, named for its Markdown file |
| `build/portraits/` | Portraits copied to `<section>/img/` for pages with `portrait:` |
| `build/sheets/` | Play-sheet JSON kept outside `content/` |
| `build/play-assets/` | The sheet engine, copied into `play/` |
| `scripts/build_site.py` | The builder |

```bash
python3 "../season-of-magic-support/scripts/build_site.py"
```

Re-running **wipes and rebuilds** the section directories, `play/` and
`index.html`. `season.css`, `favicon.svg`, `CNAME`, `LICENSE`, `README.md` and
`.git` are preserved.

### Front matter

```yaml
---
title: Princess Hobnip
eyebrow: Player Character      # defaults to the section's singular kicker
summary: One line for index cards and the meta description
pronouns: she/her
portrait: princess-hobnip.png  # file in build/portraits/
group: The Company             # optional; groups entries on grouped indexes
date: 12 September 2026        # sessions
order: 1                       # sort key; sessions use it as the session number
source: Where this page's text came from
---
```
