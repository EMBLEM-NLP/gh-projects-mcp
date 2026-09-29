# Vertical layout v4: full-bleed border, overlay-aware (1080 x 1920)

Problem: Instagram Stories cover the top of the frame (profile chip, progress bar) and the bottom (reply bar, floating hearts). v1 put the brand header and footer under them; v3 fixed that by shrinking the design into a card, which left large blank margins.

Measured on a real screenshot (1920-tall space): top overlay to y≈145, hearts start y≈1663, reply bar y≈1810+.

Fix: keep the full-bleed border and fill the reserved zones with dense, non-informational graphics.

| Zone | y range | Content |
|---|---|---|
| Top band | 33 – 235 | Solid black; 46-tick beat ruler, one tick per song beat, lights cobalt and pops on its beat |
| Header | 252 – 314 | GRANDPA2-BUDDY brand row (clear of the profile chip) |
| Hero | 352 – 602 | Big numeral + headline |
| Blue band | 644 – 714 | Scene label |
| Content | 738 – ~1550 | Diagrams / rows (all readable text) |
| Footer | 1578 | CODE / METHOD / RESULT, page x / 5 |
| Bottom band | 1650 – 1887 | Solid black; mirrored beat ruler + 5 scene-progress segments |

Only decorative elements enter the top and bottom bands, so app overlays covering them cost nothing.
`safe-zone-check.jpg` shades y<145 and y>1663 red on one frame from each scene.
