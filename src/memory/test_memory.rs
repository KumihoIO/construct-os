//! In-memory `Memory` implementation for tests that need real roundtrip storage.
//!
//! The runtime `Memory` binding is always `NoneMemory` (persistence is delegated
//! to Kumiho MCP). Tests that exercise logic built on the `Memory` trait —
//! e.g. SOP audit logging + metrics warm-start — need a backend that actually
//! stores and reads entries back. This module provides a minimal
//! HashMap-backed implementation for that purpose.

use super::traits::{Memory, MemoryCategory, MemoryEntry};
use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::Mutex;
use uuid::Uuid;

/// Simple in-process `Memory` backend for tests. Stores entries in a mutex-guarded
/// `HashMap` keyed by `key`.
#[derive(Default)]
pub struct TestMemory {
    entries: Mutex<HashMap<String, MemoryEntry>>,
}

impl TestMemory {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl Memory for TestMemory {
    fn name(&self) -> &str {
        "test"
    }

    async fn store(
        &self,
        key: &str,
        content: &str,
        category: MemoryCategory,
        session_id: Option<&str>,
    ) -> anyhow::Result<()> {
        let entry = MemoryEntry {
            id: Uuid::new_v4().to_string(),
            key: key.to_string(),
            content: content.to_string(),
            category,
            timestamp: Utc::now().to_rfc3339(),
            session_id: session_id.map(str::to_string),
            score: None,
            namespace: "default".into(),
            importance: None,
            superseded_by: None,
        };
        self.entries.lock().unwrap().insert(key.to_string(), entry);
        Ok(())
    }

    async fn recall(
        &self,
        query: &str,
        limit: usize,
        session_id: Option<&str>,
        _since: Option<&str>,
        _until: Option<&str>,
    ) -> anyhow::Result<Vec<MemoryEntry>> {
        let q = query.to_ascii_lowercase();
        let guard = self.entries.lock().unwrap();
        let mut results: Vec<MemoryEntry> = guard
            .values()
            .filter(|e| session_id.is_none_or(|s| e.session_id.as_deref() == Some(s)))
            .filter(|e| q.is_empty() || e.content.to_ascii_lowercase().contains(&q))
            .cloned()
            .collect();
        results.truncate(limit);
        Ok(results)
    }

    async fn get(&self, key: &str) -> anyhow::Result<Option<MemoryEntry>> {
        Ok(self.entries.lock().unwrap().get(key).cloned())
    }

    async fn list(
        &self,
        category: Option<&MemoryCategory>,
        session_id: Option<&str>,
    ) -> anyhow::Result<Vec<MemoryEntry>> {
        let guard = self.entries.lock().unwrap();
        Ok(guard
            .values()
            .filter(|e| category.is_none_or(|c| &e.category == c))
            .filter(|e| session_id.is_none_or(|s| e.session_id.as_deref() == Some(s)))
            .cloned()
            .collect())
    }

    async fn forget(&self, key: &str) -> anyhow::Result<bool> {
        Ok(self.entries.lock().unwrap().remove(key).is_some())
    }

    async fn count(&self) -> anyhow::Result<usize> {
        Ok(self.entries.lock().unwrap().len())
    }

    async fn health_check(&self) -> bool {
        true
    }

    async fn purge_namespace(&self, namespace: &str) -> anyhow::Result<usize> {
        let mut guard = self.entries.lock().unwrap();
        let before = guard.len();
        guard.retain(|_, e| e.category.to_string() != namespace);
        Ok(before - guard.len())
    }

    async fn purge_session(&self, session_id: &str) -> anyhow::Result<usize> {
        let mut guard = self.entries.lock().unwrap();
        let before = guard.len();
        guard.retain(|_, e| e.session_id.as_deref() != Some(session_id));
        Ok(before - guard.len())
    }
}
