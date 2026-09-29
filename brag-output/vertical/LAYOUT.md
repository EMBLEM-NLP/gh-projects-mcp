# Vertical layout: story-safe composition (1080 x 1920)

Problem: in Instagram Stories the profile chip / progress bar cover the top of the frame, and the reply bar, floating hearts and Activity row cover the bottom. The old layout put the GRANDPA2-BUDDY header at y=70 and the page footer at y=1850, both under those overlays.

Measured on a real screenshot (1920-tall space): top overlay reaches y≈145, floating hearts start y≈1663, reply bar y≈1810+. Devices differ, so the design uses a wider margin.

| Zone | y range | Rule |
|---|---|---|
| Top reserved | 0 – 250 | Ivory only. No text, no logos. |
| Safe card | 250 – 1535 | Everything readable lives here (the bordered card). |
| Bottom reserved | 1535 – 1920 | Ivory only. Room for reply bar and hearts. |
| Side margin | 70 px each side inside the card | Keeps text clear of edge UI. |

Inside the card: header 272–338 · hero (numeral + headline) 376–626 · blue band 656–726 · content 748–1450 · footer rule 1466.

`safe-zone-check.jpg` overlays the reserved zones in red on a frame from every scene; nothing sits in a red band.
