# LOOP

Replace your microphone with looped audio files in browser conference tools (Teams, Zoom web, Meet, Jitsi, Whereby, ...).

A web page alone cannot create a microphone that other tabs can select. So there are two ways to use this repo.

## A. Extension (recommended): replaces the microphone directly

Folder: `extension/`. Works in Chrome, Edge, Brave and other Chromium browsers (version 111+).

Inside any page, it:
- hides the real microphones and shows one device, **"LOOP virtual microphone"**;
- answers every microphone request (`getUserMedia`) with your looped audio;
- reports microphone permission as granted, so it also works on a computer with no microphone.

Camera, screen sharing and speakers are untouched.

### Install (one time)
1. Open `chrome://extensions` (or `edge://extensions`), enable **Developer mode**.
2. **Load unpacked**, select the `extension` folder.
3. Pin the extension icon.

### Use
1. Click the icon, add one or more audio files (MP3, WAV, OGG, M4A).
2. Pick a mode (loop playlist, loop selected, shuffle), a gap, a volume.
3. Press the big button to switch **ON**.
4. **Reload the conference tab**, then join the call. The microphone is the looped audio.
5. Use the app's mute button as usual; it mutes the loop.

Tips:
- Switch OFF when you want your real microphone back, then reload the tab.
- "Hear it locally" plays the loop on your speakers too (off by default, to avoid echo).
- Files are stored in the extension (several MB each is fine). Nothing is uploaded anywhere.
- The extension runs on every site. On a machine used only for the project this is fine; elsewhere keep it OFF.
- Desktop Zoom/Teams apps are not browsers: use approach B for them.

## B. Website + virtual cable: works with any application

`index.html` (host it on GitHub Pages) plays the files to an output device. A virtual audio cable turns that output into a microphone any app can select.

```
LOOP page ──▶ virtual cable output ──▶ virtual cable input ──▶ app "microphone"
```

| OS | Virtual cable |
|---|---|
| Windows | [VB-Cable](https://vb-audio.com/Cable/) |
| macOS | [BlackHole](https://existential.audio/blackhole/) |
| Linux | `pactl load-module module-null-sink sink_name=loop`, pick "Monitor of loop" as mic |

1. Open the page in Chrome or Edge, click **Detect devices**, choose the cable output.
2. Add files, press **Start**.
3. In the app, choose the cable input as microphone. Turn off noise suppression.

### Deploy on GitHub Pages
Push everything to `main`, Settings → Pages → `main` / root, open `https://<user>.github.io/<repo>/`. Or run `python3 -m http.server` and open `http://localhost:8000`.
