# Vertical Remix Refactor Plan — real visuals, same Swiss Signal theme

## Executive summary
The current vertical cut looks on-brand but shows almost nothing that is true of the product. Three of its five scenes are rows of "PASS" chips that I copied from your style-guide sample; the repo has no such per-step pass/fail display. The plan below keeps the beat grid, the music excerpt, the palette, the fonts and the numbered-row layout, and replaces every scene's visual with a diagram or artifact taken from the repository's own README and docs: the layer stack, real command-builder output, the six-tier permission ladder, and the co-located network topology.

## Theme (unchanged)
Background ivory `#F0EDE5`, text `#101214`, accent cobalt `#234DFF`, muted `#535A65`, rejection red `#B12D2D`. Barlow Condensed 800/700 (headings), IBM Plex Sans (body), IBM Plex Mono (code). Red is reserved for things that are really rejected or blocked; cobalt for allowed or active; gray for structure.

## What is wrong today (observed in the render)
| # | Scene | Problem | Evidence | Severity |
|---|---|---|---|---|
| 1 | 03 "Goal in. Steps checked." | Six identical PASS rows for classify / plan / validate / execute / verify / trace. The steps are real (README, `run_agent_goal`), but nothing in the repo shows a green "PASS" per step, so the visual implies output the product does not display. | README "Autonomous agent entry points" lists the steps only | High |
| 2 | 05 outro | A giant "PASS" block is decoration, not evidence. | Copied from the style-guide card | High |
| 3 | 04 safety | Layers shown as three PASS rows; the README describes an intersection (`scope ∩ ma2_rights ∩ console_floor = FINAL AUTHORITY`), not three sequential passes. Row chips "scope ✓" mean nothing. | README "Safety System" | High |
| 4 | 02 reveal | Rows "Playback / Programming / User management" are generic category words with no diagram. | README tool list | Medium |
| 5 | 01 hook | Bottom third of the frame is empty. | Render frame at 2.9 s | Low |

## Replacement visuals (ranked by impact; each traceable to the repo)
Timings reuse the existing beat grid `G(n) = 0.397 + 0.4317·n` seconds (139 beats per minute, BPM) and the drop at 4.07 s.

### Scene 01 — Hook, 0–4.07 s (UPDATE)
- Keep the hook words on beats 0, 2, 4, 6.
- ADD in the empty lower third: a console prompt strip in IBM Plex Mono, `[default]>`, typing `go+ sequence 1` on beats 5–8. Source: prompt format in README "Console Navigation"; the string is the documented output of `go_sequence(1)`.

### Scene 02 — The stack, 4.07–8.60 s (REPLACE rows with a diagram)
- Keep the "210" counter on the drop but shrink it to a header number.
- ADD the five-layer architecture stack from the README Mermaid diagram, drawn as ivory boxes with black rules and cobalt fill for the top one: Agent Core → MCP Server → Navigation → Command Builders → Telnet Client. Layers land one per beat, top to bottom, with an arrow down the left edge.
- Use only labels the README prints. Show "254 pure functions" on Command Builders. Do NOT print per-layer tool counts (see risks).

### Scene 03 — Goal to console command, 8.60–13.78 s (REPLACE the PASS rows)
- Six numbered rows, one per beat, each showing a real function call and its exact output, arrow between them, from README "Command Builders":
  1. `go_sequence(1)` → `go+ sequence 1`
  2. `select_fixture(1, 10)` → `selfix fixture 1 thru 10`
  3. `preset("color", 5)` → `preset 4.5`
  4. `store_cue(1, merge=True)` → `store cue 1 /merge`
  5. `changedest("Group", 1)` → `cd Group.1`
  6. `goto_cue(1, 5)` → `goto cue 5 sequence 1`
- Right-hand chip shows the real risk tier: SAFE_WRITE (cobalt) for go / select / goto; SAFE_READ (gray) for cd; DESTRUCTIVE (red) for store, because the README says those tools require `confirm_destructive=True`.
- Caption: "Pure functions in. Console strings out."

### Scene 04 — Permission ladder, 13.78–17.23 s (REPLACE the three PASS rows)
- Draw the six-tier ladder from the README table as ascending horizontal bars (guest → operator → presets_editor → programmer → tech_director → administrator, `tier:0` to `tier:5`), one bar per beat, widening as rights grow.
- Under it, the formula line in mono: `scope ∩ ma2_rights ∩ console_floor = FINAL AUTHORITY`.
- Finish with one red REJECT card on beat 4: a `delete` request at `tier:1` returns `{"blocked": True, "required_ma2_right": ...}` (shape quoted in README Layer 2), with a second small line "Error #72 — console floor" (README Layer 3). Keep "Line-break injection" as a footnote line, not a fourth row.

### Scene 05 — Trust and topology, 17.23–20.0 s (REPLACE the giant PASS)
- "3,705 tests" numeral stays (after verification, see below).
- ADD a three-node vertical flow from `doc/network-topology.md`: LLM Client → (stdio) → MCP Server → (`localhost:30000`, Telnet) → grandMA2 onPC, with a firewall bracket labelled "loopback only".
- Keep the URL bar and "Let the lights listen."

## Change list
| Action | Item | Reason | Expected impact | How to verify |
|---|---|---|---|---|
| REMOVE | All decorative PASS chips (scenes 03, 05) | Not product output | Removes the misleading claim | Search final HTML for "PASS": only allowed if tied to a real allowed/blocked result |
| REMOVE | "scope ✓ / rights ✓ / floor ✓" chips | Meaningless | Cleaner rows | Visual check |
| UPDATE | Scene 04 from three rows to ladder + formula + blocked response | Matches README semantics (intersection, not sequence) | Accurate and more distinctive | Each label appears verbatim in README |
| UPDATE | Scene 01 lower third | Fills empty space with real prompt/command | Stronger hook | Snapshot at 3.6 s |
| ADD | Architecture stack (scene 02) | The one true diagram of the product | Viewer learns the shape in 4 s | Layer names match README Mermaid |
| ADD | Function-to-command rows with risk-tier chips (scene 03) | Shows the product doing its job | Centerpiece "product in use" per the brag guidance | Outputs match README tables character for character |
| ADD | Topology strip (scene 05) | Explains why it is safe to run | Credible outro | Matches `doc/network-topology.md` |

## Verification tasks before building (facts I could not confirm)
1. **Tool count arithmetic.** README says 210 tools, but also "164 tools" (server) plus "34 tools" (agent core) = 198. I will show only "210" until the gap is explained. Check by counting tool registrations in `src/`.
2. **Test count.** "3,705 tests" comes from a README badge. Run `pytest --collect-only -q` on a fresh clone to confirm, or soften to "thousands of tests".
3. **Version.** Not used in the video, but the README shows 3.39.2 in front matter and 3.35.3 in a badge; avoid printing a version.
4. **Risk tier of each shown command.** Confirm `Go`, `Store`, `Goto`, `ChangeDest` map to the tiers I plan to print (README lists Go = SAFE_WRITE, Store = DESTRUCTIVE, ChangeDest = SAFE_READ; Goto and Select are not listed, so either drop their chips or check `src/vocab.py`).

## Build steps
1. Verify items above (about 10 minutes).
2. Author diagrams as inline SVG in the composition, one `<g>` per beat, fixed-height boxes (avoids the text-overlap failures `hyperframes check` reported last time).
3. Re-time reveals to the existing grid; keep the audio untouched.
4. Run `npx hyperframes check` (must pass), snapshot a contact sheet at every scene boundary and one mid-reveal, then render to `brag-vertical.mp4`.
5. Fresh-eyes review: every visible string traced to a README/doc line in a small source map file.

## Acceptance criteria
- Zero decorative PASS/REJECT chips; every chip corresponds to a documented state.
- Every number on screen is verified or removed.
- Text readable: short labels held at least 0.8 s, mono code lines held at least 1.2 s.
- Same palette, fonts, beat grid, and song section as the current cut.

## Risks and open questions
- Mono code rows are dense at 1080 px width; the six-row scene may need 44 px code text, which limits the longest string (`goto_cue(1, 5) → goto cue 5 sequence 1`) to two lines.
- Showing real command strings will read as niche to non-lighting viewers. Decision for you: keep it technical (my recommendation, since the audience is MCP/agent builders) or add a plain-language caption per row.
- Song audio remains in the mp4; check you have the right to post it.
