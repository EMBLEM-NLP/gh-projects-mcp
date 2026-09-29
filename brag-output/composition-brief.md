# Hyperframes Composition Brief: GrandPA2-Buddy

## Objective
Short launch-style brag video for GrandPA2-Buddy.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape 1920x1080
- Duration: 20s

## Source Material
- Primary files read: README.md (badges, architecture, entry points)
- Product name: GrandPA2-Buddy
- Strongest claim: "210 MCP tools covering every grandMA2 operation"
- UI moment recreated: run_agent_goal loop (classify → plan → validate → execute → verify → trace)
- Verbatim copy: "210 MCP tools", "OAuth scope ∩ MA2 native rights ∩ console floor", "3,705 tests"

## Creative Direction
- Tone: cinematic; quiet stage-blackout trailer, deadpan technical claims
- Avoid: generic SaaS language, abstract filler, redesign

## Visual Identity
- Background #1a1a2e, text #ffffff, accent #e94560, secondary #0f3460 / #533483
- Fonts: system sans bold (display), system monospace (body)

## Scenes
1. Hook 3s; 2. Reveal 4s; 3. Agent run 6s; 4. Safety 4s; 5. Outro 3s

## Audio
- Bed: assets/music/bed.mp3 (vol 0.35, fade 1s/2s); SFX: keyboard ticks on typing, select click per step, click per ring, bong on outro.
- No audio-reactive treatment.

## Hyperframes Instructions
Hand-authored HTML + GSAP composition; validate with `npx hyperframes check`, render with `npx hyperframes render`.
