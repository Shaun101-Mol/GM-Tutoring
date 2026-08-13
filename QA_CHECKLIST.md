# GM Tutoring v5 QA checklist

## Startup
- [x] `node server.js` starts successfully
- [x] `/api/health` responds
- [x] Frontend is served from the same Node process
- [x] Browser cache is disabled for local development assets

## Authentication
- [x] Demo admin login
- [x] Demo tutor login
- [x] Demo learner login
- [x] Actual learner registration with email/password
- [x] Actual registered learner login
- [x] Existing-account duplicate registration blocked
- [x] Role restored correctly after browser refresh
- [x] Logout
- [x] Forgot-password request endpoint

## Modals
- [x] Close X button
- [x] Cancel buttons
- [x] Backdrop close
- [x] Escape key close
- [x] Modal buttons use `type=button`
- [x] Dynamic modal actions use event delegation

## Live classroom
- [x] Open live room
- [x] Session start API
- [x] Microphone toggle
- [x] Camera toggle
- [x] Screen sharing
- [x] Live chat
- [x] Participants panel
- [x] Recording start/stop
- [x] MediaRecorder upload to backend
- [x] Recording metadata stored
- [x] Session end API for tutor/admin
- [x] Learner leave flow does not end the class
- [x] Camera/mic cleanup when room closes

## Files
- [x] Learning material upload
- [x] Learning material download
- [x] Assignment upload
- [x] Recording download route

## Validation performed
- [x] `node --check server.js`
- [x] `node --check app.js`
- [x] API health smoke test
- [x] Demo login smoke test
- [x] Registration smoke test
- [x] Registered-user login smoke test
- [x] Session start/end smoke test
- [x] Multipart recording upload smoke test
