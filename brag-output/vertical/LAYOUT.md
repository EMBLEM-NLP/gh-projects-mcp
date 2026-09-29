# Vertical layout v5: full-bleed ivory, no bands (1080 x 1920)

History: v3 shrank everything into a card (blank margins). v4 filled the reserved zones with black bands (rejected). v5 returns to the full-bleed ivory of v2 and re-composes it around the real overlay positions.

Measured on a real story screenshot (1920-tall space): profile chip / progress bar end at y≈145; floating hearts start y≈1663; reply bar y≈1810+. Devices differ, so the header keeps ~27 px clearance below the chip.

| Element | y range | Notes |
|---|---|---|
| Top reserved | 0 – 145 | Left empty; the app's own chip fills it visually |
| Header (brand) | 172 – 236 | Now clear of the profile chip |
| Hero (numeral + headline) | 274 – 524 | |
| Blue band | 552 – 628 | Scene label |
| Content | 664 – ~1560 | Diagrams and rows, ~900 px tall (was ~700 in v3/v4) |
| Footer rule + takeaway line | 1596 – ~1640 | One README fact per scene (replaces the repeated 0N / 05 counter and tab strip); above the hearts |
| Bottom reserved | 1663 – 1920 | Left empty; the reply bar and hearts fill it in the app |

`safe-zone-check.jpg`: red shading marks y<145 and y>1663 on one frame per scene.
