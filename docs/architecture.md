# Architecture

The extension has one job: while a supported streaming page plays, switch to a creator's clip from the viewer's own device at exact times, and hand back to the stream at the right point. Everything else supports that.

## Pieces and where they run

| Piece | Runs in | Files |
| --- | --- | --- |
| Controller | Content script on the streaming tab | `src/main.mjs`, `src/passive-service-adapter.mjs`, `src/standard-*-adapter.mjs`, `src/transition-engine.mjs`, `src/manifest-action-scheduler.mjs` |
| Identity bridge | The page's own JavaScript world, injected on request for one document | `src/prime-identity-reader.mjs`, `src/prime-identity-endpoint.mjs`, `src/read-only-identity-bridge.mjs` |
| Private renderer | An extension-origin iframe placed over the player | `local-playback-frame.*`, `src/local-overlay.mjs` |
| Relay and services | Service worker | `background.mjs`, `src/local-playback-protocol.mjs`, `src/local-message-schema.mjs`, `src/viewer-service.mjs`, `src/device-link-service.mjs`, `src/viewer-web-bridge.mjs` |
| Viewer UI | Popup and settings pages | `viewer-popup.html`, `viewer-settings.html`, `viewer.mjs` |

Local clip bytes, object URLs and file handles never leave the renderer iframe. The page only ever sees opaque `asset:<sha256>` references, and every message on the relay is schema-checked (`src/local-message-schema.mjs`). The renderer iframe is bound to its controller with a one-time challenge, so another frame cannot impersonate it.

## Identity: is this the right video?

An edit names its source: service, content ID, season/episode, runtime and tier. The controller reads the playing title from the page (`prime-identity-reader.mjs`) and compares it (`src/source-identity.mjs`). A mismatch, a navigation or a new player element clears the armed edit. Prime ad breaks stop the edit, because ads shift the element clock away from programme time.

## A replacement, step by step

1. **Preload.** Within 10 s of a scene's trigger, the renderer loads and decodes the clip.
2. **Stage.** About 1.5 s before the trigger, the cover host is mounted hidden over the player, the renderer is moved into it, audio is set, and the clip's first frame is shown.
3. **Cut.** At the trigger the controller snapshots native state, pauses and mutes the native video, and reveals the cover. There is no renderer round trip on this path. For an INSERT, the resume point is where native actually paused.
4. **Play and seek.** The local clip plays while native seeks, muted and covered, to the join.
5. **Chain.** If the next scene starts at this scene's join, a second decoder has already loaded it, and it plays inside the same cover.
6. **Restore.** Native resumes at the join. The cover is removed once native presents a frame, and audio is restored.

A failure before the cut returns native to where it paused. A failure after the cut resumes at the join, so removed footage is never replayed. A viewer's seek into a replaced interval starts that scene part-way in.

## The return, in the timing report

With Exit reveal set to "precise", native is not started on the join. It is first seeked a little before the join (the *park*) and started at the usual lead, so that its clock, which starts some tens of milliseconds after `play()`, reaches the join as the clip ends. Native's audio fades in over the last few tens of milliseconds before the join, under the end of the clip's audio, so there is no quiet stretch between the two.

That fade-in follows native's own clock. When the clock is behind where it was expected, the fade-in would come after the clip's audio has gone, so on a parked exit, while native's clock is advancing, native's level is never below a wall-clock fade over the same window as the clip's fade-out (60 to 30 ms before the clip's end). A clock that has not started, has stalled, or is paused or seeking holds the level, and exits that are not parked do not use the wall clock. Native has no audio before its clock starts, so a clock that starts after the clip's fade-out has begun still leaves a short dip until it does.

On a parked exit the cover is not lifted in the callback of the first native frame at the join: that callback runs when the frame is handed to the compositor, and lifting then could show the frame before it, a picture of the removed scene, for one display refresh. The cover goes once the frame is confirmed on screen: at native's next frame callback, or at the first animation frame at least one display refresh (1/60 s) after the frame's expected display time, whichever comes first, and never later than 60 ms after the callback. The clip's last frame is held for that time, typically one native frame or less, and the first picture seen can be the frame after the join frame. Exits that are not parked lift the cover in the callback, since the frame before is then the paused join frame itself.

A timing report (Settings → Advanced) records this per scene under `audioFade.exit`. All values are milliseconds; "vs join" values are media time relative to the join, negative before it.

| Field | Meaning |
| --- | --- |
| `parkMs` | How far before the join native was parked. Absent when the exit was not parked. |
| `fadeBaseMediaMs` | Where native's audio ramp started, relative to the join. |
| `native.clockMovingMs` | Parked exits: when native's clock was first seen advancing during the ramp, relative to the clip's end (read on a 4 ms timer). Absent when it never was. |
| `native.wallFloor` | `true` when the wall-clock fade raised native's level above what its own clock gave. Absent otherwise. |
| `overlap.minCombinedTraceGain` | The lowest combined level of the two volume traces. It does not include audio output latency or the clip's dropped last 25 ms, so it is not a measurement of what was heard. |
| `uncover.frameMs` | The native frame length used for the `…Frames` values (measured, else 1/30 s). |
| `uncover.frameVsJoinMs`, `uncover.frameVsJoinFrames` | How far past the join the native frame that qualified for the reveal is. 0 is the join frame; under one frame is the frame that holds the join. On a parked exit the cover goes `uncover.confirmMs` after this frame's callback. |
| `uncover.confirmVia`, `uncover.confirmMs` | Parked exits: how that frame was confirmed on screen before the cover went (`frame`: native's next frame callback; `raf`: an animation frame; `timeout`: neither came within 60 ms), and the time from the frame's callback to the cover going. Absent when the exit was not parked or the fallback lifted the cover. |
| `uncover.clockVsJoinMs`, `uncover.clockVsJoinFrames` | Native's clock at the reveal, relative to the join. |
| `uncover.clipRemainingMs`, `uncover.clipFramesRemaining` | How much of the clip was left at the reveal. Negative: the clip had ended and its last frame was held that long. |
| `uncover.clockAtClipEndVsJoinMs` | Native's clock at the clip's end. 0 is on the join; positive is ahead of it (frames skipped). |
| `uncover.clockDelayMs` | How long after `play()` native's clock effectively started. The next exits' park is the lead minus the median of the last three of these, each counted as at most 150 ms. |

## Edit packets

Local packets are unsigned and for personal use. Website edits are signed catalog packets, and protected website edits are encrypted with a renewable licence. See [packet-format.md](packet-format.md).

## Watch this edit

An edit page on the Seamless Scene website can ask the extension, through `chrome.runtime` external messaging, whether it is set up and to queue that edit's download. The manifest's `externally_connectable` allows only the website's origins, and `src/viewer-web-bridge.mjs` re-checks the sender (`src/website-origins.mjs`). The page sends only the edit's release ID; the extension never opens a URL the page supplies.
