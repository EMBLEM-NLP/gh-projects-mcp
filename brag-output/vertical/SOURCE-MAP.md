# Source map — every on-screen claim and where it comes from
Repo: thisis-romar/ma2-onPC-MCP (README.md unless noted)

| Scene | On screen | Source |
|---|---|---|
| 01 | `[default]>` prompt, `go+ sequence 1` | README "Console Navigation" (prompt format); "Command Builders" → `go_sequence(1)` |
| 02 | "210 tools" | README badge/intro (not independently counted; README's own layer labels 164 + 34 = 198, so no per-layer counts shown) |
| 02 | Five layers, "254 pure functions", "orchestrator · memory · skills", "async · auth · injection prevention" | README "Architecture" Mermaid diagram |
| 02 | "All network I/O lives in one file." | README: "All network I/O is isolated in telnet_client.py" |
| 03 | Six function → command rows | README "Command Builders" tables (character for character) |
| 03 | Tier chips | `src/vocab.py` safe_read / safe_write sets (Go, Goto, SelFix, ChangeDest; object keywords SAFE_WRITE); Store = DESTRUCTIVE per README "Risk Tiers" |
| 04 | tier:0–5 and console users | README "Layer 1 — OAuth Scope" table |
| 04 | `scope ∩ ma2_rights ∩ console_floor = FINAL AUTHORITY` | README "Safety System" |
| 04 | `delete_object` needs `program`; `{"blocked": True, "required_ma2_right": ...}` | `doc/ma2-rights-matrix.json` (id 18) and README "Layer 2" |
| 05 | "3,700+ tests" | README badge 3,705; 3,697 `def test_` found by grep (lower bound) |
| 05 | LLM client → MCP server → localhost:30000 → onPC, loopback firewall | `doc/network-topology.md` |
