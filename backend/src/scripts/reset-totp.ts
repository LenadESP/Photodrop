// Recovery: clear a user's TOTP enrolment so their next login re-enrols from
// scratch, and lift any active lockout. No schema change — the seed/backup-code
// rework rides the 2.0 auth model. Run inside the container:
//
//   docker exec apps-photodrop node dist/scripts/reset-totp.js <username>
//
// After this, the user logs in with their password and is walked through TOTP
// enrolment again (a new secret + QR), exactly like first login.
import { openDatabase } from '../db/index.js';

const username = process.argv[2];
if (!username) {
  console.error('Usage: node dist/scripts/reset-totp.js <username>');
  process.exit(1);
}

const db = openDatabase();
const info = db
  .prepare(
    `UPDATE users
        SET totp_enabled = 0,
            totp_secret = NULL,
            failed_login_attempts = 0,
            locked_until = NULL
      WHERE username = ?`,
  )
  .run(username);
db.close();

if (info.changes === 0) {
  console.error(`No user named "${username}".`);
  process.exit(1);
}
console.log(`TOTP enrolment cleared for "${username}". Their next login will re-enrol.`);
