# Changelog

## 0.66.2 — a cleaner return to the episode, and one-press connecting

- **A cleaner return to the episode.** At the end of a scene the episode is brought to the join point a moment early and held there, so the frame shown when the clip ends is the join frame itself, with no gap in the sound.
- **A replayed scene is prepared again**, and a scene that could not be prepared in time holds the episode just before its start instead of letting it run on.
- If a scene is cancelled while the episode is held before the join, playback carries on from the join, never from before it.
- A short scene whose return seek is slow still comes back on the join frame, and on computers where the episode is slow to restart the return now adapts instead of holding the clip's last frame.
- **Connect your account in one press.** The toolbar menu, Welcome page and Settings now ask for a code and open the website's confirmation page for you, and the wording changes from "link" to "connect" throughout ("Connected as …", "Disconnect").
- When Prime Video moves on to the next episode, the extension shows that episode's normal state instead of a Problem.
- The Library no longer keeps a "Checking clips…" or "Opening the title…" line after the edit is ready or you have come back from watching, and opening a local edit no longer says it is waiting for a download.
- Fixed an error that could appear in Chrome's extension error list when an episode changed during a scene.
- Fixed a rare single flash of the removed scene's last picture just before the episode came back.
- Includes the 0.66.1 changes below, which were not published separately.

## 0.66.1 — fixes from the first store test (shipped as part of 0.66.2)

- **The download limit says so.** Downloading the same edit a fourth time within 24 hours now says "You’ve downloaded this edit 3 times in the last 24 hours. You can download it again in about 23 hours." instead of "cannot open this edit on this device".
- **Longer approval codes.** Account linking accepts approval codes that last up to 30 minutes, and the link page says how long the code has left.
- **The toolbar menu shows the linked account** ("Linked as …").
- **Download speed after downloading an edit again** is measured from the new download, not from the first one.
- **Removing an edit from the Library** also clears its status, so the website no longer says it is ready.
- The Downloads card no longer shows a stray " · ", and a scene's clip ending on time is no longer reported as an interrupted playback in timing reports.
- New store description.
- Clearer settings wording: the default-folder check runs when you open the Local tab; "Continue with the next episode" also turns on the only matching edit; "Reset all settings" says it resets every setting.

## 0.66.0 — first public release

- The first version in the Chrome Web Store, for Prime Video in desktop Chrome.
- Plays a Seamless Scene edit over the episode you are streaming: each scene's clip from your own device at its exact time, then the episode carries on from the right point.
- Edits come from the Seamless Scene website (signed, and for some edits encrypted with a renewable licence tied to your linked device), or from a `.ss` file you add yourself.

Earlier versions were private test builds.
