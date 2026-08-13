# GM Tutoring — Backend v5 / Fully Interactive Frontend

This build connects the GM Tutoring frontend to the local Node.js backend and fixes the interactive workflows that were incomplete in v4.

## Run
1. Install Node.js (Node 18+ recommended; Node 26 works).
2. Open PowerShell in this folder.
3. Run `node server.js`.
4. Open http://localhost:4000 — do not open index.html directly, and do not use VS Code Live Preview (it occupies ports 3000/3001 and will cause API 404s).
NOTE: The backend listens on port 4000. Port 3000 is reserved for VS Code Live Preview, which does not serve the API. If you see `Request failed (404)` on signup or login, the node backend is not running — start it with `node server.js`.

## Demo accounts
All demo accounts use password `Welcome123!`.
- Administrator: owner@gmtutoring.co.za
- Tutor: thandi@gmtutoring.co.za
- Learner: lerato@student.co.za

## Your own email
Use **New learner? Create an account** on the login screen. Your account is created by the backend and you are signed in immediately. This development build does not send external email verification yet.

## Live classroom
The live classroom now supports browser camera/microphone permissions, mute/unmute, camera on/off, screen sharing, chat, participants, actual browser recording through MediaRecorder, backend recording upload, live session start/end, and recording storage. Camera/microphone/screen APIs require a browser that supports them; localhost is treated as a secure context by modern browsers.

## Data
PostgreSQL is intentionally not included yet. The temporary JSON store is `data/store.json`. Delete it while the server is stopped to reset the demo data. Uploaded files and recordings are stored under `uploads/`.

## Important
This is still a local development build. Authentication and authorization are now server-side for the implemented API, but production deployment will require HTTPS, PostgreSQL, secure secrets, persistent sessions, email service, cloud file storage, WebRTC infrastructure, backups and monitoring.
