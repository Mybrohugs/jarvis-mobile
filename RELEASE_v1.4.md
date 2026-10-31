# v1.4 — ChatGPT and video to TV (DEV)

ChatGPT via the paired PC replaces the Claude SDK and key prompt. Calendar and weather tools retain their browser workflow. Voice uses local PC transcription and the phone voice. Pairing survives reloads and gives clear errors for expired codes or blocked storage. Video sharing fills the URL without automatically sending it; the explicit TV button posts once and waits for its queue result. Duplicate URL schemes are rejected. The service worker excludes all API traffic.

Requires matching Mybrohugs/Jarvis DEV v1.4, a configured PC, private HTTPS/Tailscale and the existing TV integration. No main branch merge, GitHub Pages rollout or PR #2 merge is included. Phone-to-TV playback was confirmed by the owner. Account secrets stay on the PC; no API key is needed on the phone.

## Verification

24 mobile Node tests passed. Matching PC export passed 254 regression tests (14 optional skips), 17 TV tests and 6 ChatGPT tests. User confirmed playback.
