# Privacy

- **Clips stay on your device.** Clips are read inside the extension's own renderer frame. They are never uploaded, and never passed to the streaming page.
- **The streaming page.** On Prime Video, the extension reads the playing title, runtime and playback time so it can tell whether an edit matches. It does not read your account, cookies, payment details or the video stream itself, and it cannot capture DRM-protected frames.
- **What goes to the Seamless Scene website.** All requests go to the Seamless Scene website only, without cookies:
  - Linking a device sends hashes of one-time link values and the extension version; the link's session checks send the extension version and whether the extension can read the playing title.
  - Finding edits sends the current title's identity (service, title ID, season, episode, runtime) with the device token. Checking kept edits for updates sends their release IDs.
  - Downloading an edit sends its release ID and, for protected edits, licence requests tied to the linked device.
  - While a website edit plays, the extension checks every 30 seconds whether that edit has been withdrawn (a request naming the edit, without the device token).
  - The website stores the device link and which edits you opened. See the website's privacy notice.
- **The website's pages.** Edit pages on the Seamless Scene website can ask the extension whether it is installed and linked, its version, whether Prime Video access is allowed, and how a download is going, and can ask it to download an edit. No other site can.
- **Diagnostics.** Diagnostics and timing reports are made only when you ask for them (Settings → Advanced), and you choose where they go. They carry the build, times, positions, error codes and the IDs of the title and edit involved, not your files or account.
- **Permissions.** `storage`, `scripting` and `activeTab`, plus the Seamless Scene website (for device links and edits). Prime Video (`www.amazon.com`, `www.primevideo.com`) is an optional permission, requested only when you allow the extension there.
- **No analytics.** The extension has no analytics, advertising or third-party services.
