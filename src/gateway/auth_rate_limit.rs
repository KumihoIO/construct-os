//! Sliding-window rate limiter for authentication attempts.
//!
//! Protects pairing and bearer-token validation endpoints against
//! brute-force attacks.  Tracks per-IP attempt timestamps and enforces
//! a lockout period after too many failures within the sliding window.

use parking_lot::Mutex;
use std::collections::HashMap;
use std::time::{Duration, Instant};

/// Maximum auth attempts allowed within the sliding window.
pub const MAX_ATTEMPTS: u32 = 10;
/// Sliding window duration in seconds.
pub const WINDOW_SECS: u64 = 60;
/// Lockout duration in seconds after exceeding [`MAX_ATTEMPTS`].
pub const LOCKOUT_SECS: u64 = 300;
/// How often stale entries are swept from the map.
const SWEEP_INTERVAL_SECS: u64 = 300;

/// Error returned when a client exceeds the auth rate limit.
#[derive(Debug, Clone)]
pub struct RateLimitError {
    /// Seconds until the client may retry.
    pub retry_after_secs: u64,
}

/// Per-IP auth attempt tracker with sliding window and lockout.
#[derive(Debug)]
pub struct AuthRateLimiter {
    inner: Mutex<Inner>,
}

#[derive(Debug)]
struct Inner {
    /// Key = IP string, value = timestamps of recent attempts.
    attempts: HashMap<String, Vec<Instant>>,
    /// Key = IP string, value = instant when lockout was triggered.
    lockouts: HashMap<String, Instant>,
    last_sweep: Instant,
}

impl AuthRateLimiter {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                attempts: HashMap::new(),
                lockouts: HashMap::new(),
                last_sweep: Instant::now(),
            }),
        }
    }

    /// Check whether the client identified by `key` is allowed to attempt auth.
    ///
    /// `peer_is_loopback` must reflect the *socket* peer (never a value
    /// derived from client-supplied headers). When `true`, rate limiting is
    /// skipped — local administrators may retry freely. Trusting a
    /// header-derived loopback value would let an attacker spoof
    /// `X-Forwarded-For: 127.0.0.1` to bypass the lockout.
    ///
    /// Does **not** record a new attempt — call [`record_attempt`] after
    /// verifying the attempt actually happened (regardless of success/failure).
    pub fn check_rate_limit(
        &self,
        key: &str,
        peer_is_loopback: bool,
    ) -> Result<(), RateLimitError> {
        if peer_is_loopback {
            return Ok(());
        }

        let now = Instant::now();
        let mut inner = self.inner.lock();
        Self::maybe_sweep(&mut inner, now);

        // Check active lockout first.
        if let Some(&locked_at) = inner.lockouts.get(key) {
            let elapsed = now.duration_since(locked_at).as_secs();
            if elapsed < LOCKOUT_SECS {
                return Err(RateLimitError {
                    retry_after_secs: LOCKOUT_SECS - elapsed,
                });
            }
            // Lockout expired — remove it and let the attempt through.
            inner.lockouts.remove(key);
            inner.attempts.remove(key);
        }

        // Prune old timestamps for this key.
        let window = Duration::from_secs(WINDOW_SECS);
        if let Some(timestamps) = inner.attempts.get_mut(key) {
            timestamps.retain(|t| now.duration_since(*t) < window);
            if timestamps.len() >= MAX_ATTEMPTS as usize {
                // Trigger lockout.
                inner.lockouts.insert(key.to_owned(), now);
                return Err(RateLimitError {
                    retry_after_secs: LOCKOUT_SECS,
                });
            }
        }

        Ok(())
    }

    /// Record a new authentication attempt for `key`.
    ///
    /// See [`check_rate_limit`](Self::check_rate_limit) for `peer_is_loopback`
    /// semantics. Only the socket peer may be trusted as loopback.
    pub fn record_attempt(&self, key: &str, peer_is_loopback: bool) {
        if peer_is_loopback {
            return;
        }

        let now = Instant::now();
        let mut inner = self.inner.lock();
        inner.attempts.entry(key.to_owned()).or_default().push(now);
    }

    /// Check whether `key` is currently locked out, without recording anything.
    ///
    /// See [`check_rate_limit`](Self::check_rate_limit) for `peer_is_loopback`
    /// semantics. Only the socket peer may be trusted as loopback.
    pub fn is_locked_out(&self, key: &str, peer_is_loopback: bool) -> bool {
        if peer_is_loopback {
            return false;
        }

        let now = Instant::now();
        let inner = self.inner.lock();
        if let Some(&locked_at) = inner.lockouts.get(key) {
            return now.duration_since(locked_at).as_secs() < LOCKOUT_SECS;
        }
        false
    }

    /// Periodically purge entries older than [`LOCKOUT_SECS`] to bound memory.
    fn maybe_sweep(inner: &mut Inner, now: Instant) {
        if inner.last_sweep.elapsed() < Duration::from_secs(SWEEP_INTERVAL_SECS) {
            return;
        }
        inner.last_sweep = now;

        let lockout_dur = Duration::from_secs(LOCKOUT_SECS);
        let window_dur = Duration::from_secs(WINDOW_SECS);

        inner
            .lockouts
            .retain(|_, locked_at| now.duration_since(*locked_at) < lockout_dur);

        inner.attempts.retain(|_, timestamps| {
            timestamps.retain(|t| now.duration_since(*t) < window_dur);
            !timestamps.is_empty()
        });
    }
}

impl Default for AuthRateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_peer_is_exempt() {
        let limiter = AuthRateLimiter::new();
        for _ in 0..20 {
            assert!(limiter.check_rate_limit("whatever", true).is_ok());
            limiter.record_attempt("whatever", true);
        }
        assert!(!limiter.is_locked_out("whatever", true));
    }

    #[test]
    fn spoofed_loopback_key_is_not_exempt() {
        // An attacker sending `X-Forwarded-For: 127.0.0.1` produces a key
        // that looks like loopback, but the socket peer is not loopback.
        // The limiter must NOT exempt such requests.
        let limiter = AuthRateLimiter::new();
        let key = "127.0.0.1";
        for _ in 0..MAX_ATTEMPTS {
            assert!(limiter.check_rate_limit(key, false).is_ok());
            limiter.record_attempt(key, false);
        }
        assert!(limiter.check_rate_limit(key, false).is_err());
        assert!(limiter.is_locked_out(key, false));
    }

    #[test]
    fn lockout_after_max_attempts() {
        let limiter = AuthRateLimiter::new();
        let key = "192.168.1.100";

        for _ in 0..MAX_ATTEMPTS {
            assert!(limiter.check_rate_limit(key, false).is_ok());
            limiter.record_attempt(key, false);
        }

        // Next check should fail — lockout triggered.
        let err = limiter.check_rate_limit(key, false).unwrap_err();
        assert!(err.retry_after_secs > 0);
        assert!(limiter.is_locked_out(key, false));
    }

    #[test]
    fn under_limit_is_ok() {
        let limiter = AuthRateLimiter::new();
        let key = "10.0.0.1";

        for _ in 0..(MAX_ATTEMPTS - 1) {
            assert!(limiter.check_rate_limit(key, false).is_ok());
            limiter.record_attempt(key, false);
        }
        // Still under the limit.
        assert!(limiter.check_rate_limit(key, false).is_ok());
    }
}
