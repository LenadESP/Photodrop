-- Auth hardening (1.2.0).
--
-- token_version — bumped on logout (and, once a password-change flow exists, on
-- password change) to revoke every outstanding session at once. Access and
-- refresh JWTs carry the value they were minted with; a mismatch against the
-- row's current value fails the session guard and the refresh endpoint. DEFAULT
-- 0 so tokens issued before this migration (which carry no version claim and are
-- read as 0) keep working — the live session survives the upgrade.
ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;

-- totp_last_step — the last TOTP time-step accepted for this user. A code whose
-- matched step is <= this value is rejected, so a captured code cannot be
-- replayed within its ±1-step validity window. NULL = nothing accepted yet.
ALTER TABLE users ADD COLUMN totp_last_step INTEGER;
