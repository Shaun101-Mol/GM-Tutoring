// Diagnostic for the signup 404 issue.
const fs = require('fs');
const base = 'http://localhost:4000';
const out = [];
(async () => {
  try {
    const health = await fetch(base + '/api/health');
    out.push('HEALTH status: ' + health.status);
    out.push('HEALTH body: ' + await health.text());
  } catch (e) {
    out.push('SERVER NOT REACHABLE: ' + e.message);
  }

  try {
    const reg = await fetch(base + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test User', email: 'final-verify-' + Date.now() + '@example.com', password: 'password123' })
    });
    out.push('REGISTER status: ' + reg.status);
    out.push('REGISTER body: ' + await reg.text());
  } catch (e) {
    out.push('REGISTER ERROR: ' + e.message);
  }
  fs.writeFileSync(__dirname + '/diagnose-output.txt', out.join('\n'));
})();
