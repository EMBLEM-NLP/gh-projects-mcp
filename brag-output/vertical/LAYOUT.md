# Vertical layouts (1080 x 1920)

Two themes share the same content, beat grid, song section and timings.

| File | Theme | Source |
|---|---|---|
| `brag-vertical-swiss.mp4` | Swiss Signal (ivory, cobalt, red) | `vertical/themes/swiss-index.html.txt` (rename to index.html to render) |
| `brag-vertical-ma2.mp4` | grandMA2 onPC (black, amber, blue) | `vertical/index.html` |

## grandMA2 onPC palette (sampled from screenshots in doc/2024-09-30_grandMA2_User_Manual_v3-9.pdf)
| Role | Value | Where sampled |
|---|---|---|
| Screen background | `#000000` | 76–91% of pixels in every UI screenshot checked |
| Amber (text, borders, selected) | `#FEC000`, `#FFB804`; dim `#936B00` / `#AD7F00` | window borders and labels |
| Yellow highlight | `#FFDE01` | node-page text |
| Window title bar blue | `#00008C` (bright `#0000FE`) | window title bars |
| MA logo red | `#DA251C` | logo on MA node page |
| Button gray / light gray | `#5F5E5C` / `#99958B` | button borders and labels |
Sampled by quantizing four manual screenshots (pages 207, 1467, 1743, 1754); values are exact pixel colours, not eyeballed.

## Layout logic (both themes)
Measured on a real story screenshot: top overlay to y≈145, hearts from y≈1663, reply bar y≈1810+.

| Element | y range | Notes |
|---|---|---|
| Top | 0 – 145 | Left empty; the app's own chip fills it |
| Title bar / header | 172 – 240 | Clear of the profile chip |
| Hero (numeral + headline) | 274 – 524 | |
| Band | 552 – 628 | Scene label (blue title-bar style in the MA theme) |
| Content | 664 – ~1530 | Diagrams and rows |
| Command line (MA theme) | 1566 – 1658 | Persistent, like the grandMA2 bottom command line; shows the real command the agent sends in each scene |
| Risk-tier key caps (MA theme) | 1686 – 1798 | SAFE_READ / SAFE_WRITE / DESTRUCTIVE, styled like console buttons; the one matching the command on the command line lights up (Go = SAFE_WRITE, ChangeDest = SAFE_READ, Store and delete_object = DESTRUCTIVE). Fills the footer with meaning; fine if the reply bar covers its lower edge |
| Bottom margin | 1798 – 1920 | Under the app's reply bar |

Command-line script (all real strings): S1 `go+ sequence 1` (typed) · S2 `cd /` · S3 the six builder outputs, one per beat · S4 `blocked · nothing sent` (red; the README says rights are checked before any Telnet command is sent) · S5 `uv run python -m src.server` (README Quick Start).
