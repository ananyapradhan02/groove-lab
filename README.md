# groove lab

a step sequencer, a metronome and a tempo ladder for drummers, in one page. every sound is synthesised in the browser with the web audio api. no samples, no account, no backend.

**for:** drummers who want a daily practice partner, and drum teachers who want to send a student a groove as a link.

**hypothesis:** a drummer practises ten minutes with it and comes back tomorrow.

## open it

- live: https://ananyapradhan02.github.io/groove-lab/
- local: open `index.html` from the folder (`file://` works; the copy button falls back to a text box there)

## what it does (v0.1)

- six drums (kick, snare, hi-hat, ride, two toms) by sixteen steps, with swing from 0 to 60%. fifty is a triplet feel.
- four starting grooves: basic rock, a half-time shuffle feel, bossa-ish, and teentaal on kit. the teentaal one maps the sixteen matras of the theka onto the kit (dha on kick, dhin on low tom, tin and ta on high tom, ride on sam, hi-hat on khali). it is a feel, not a tabla part.
- metronome in 3/4, 4/4, 5/4 and 7/8 (7/8 counts eighths, grouped 2 + 2 + 3), quarter, eighth, triplet or sixteenth clicks, accent on beat one.
- tempo ladder: start, add n bpm every n bars, stop at a ceiling. works in both modes.
- share: the url hash holds the pattern (four hex digits per drum), tempo and swing, e.g. `#g=80a00808aaaa000000000000&t=100&s=0`.
- space plays and stops. in the grid, arrows move and enter toggles a step. nothing plays until you press play.
- the last groove and settings stay in this browser's localStorage. nothing leaves the device.

timing uses a lookahead scheduler (a 25 ms settimeout loop booking notes 100 ms ahead on the audio clock), so the click stays steady when the tab is busy.

## test script (ten minutes with a real drummer)

1. "load basic rock, turn the ladder on from 80 to 120, and play along on a practice pad for five minutes. where did it feel wrong?"
2. "make a groove you are working on this week and send yourself the link. did it open the same?"
3. "would you open this tomorrow before practice? what would make you?"

## what ananya should decide after testing

whether the pull is the tempo ladder (build the practice log and streak next) or the shareable groove (build practice-room mode for teachers next).

## status

v0.1 · 30.09.26 · keep. mit licence.
