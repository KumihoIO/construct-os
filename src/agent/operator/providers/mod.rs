//! Provider detection and tool-layer dispatch.
//!
//! Determines which LLM provider is running the operator from the model
//! name string and returns the appropriate tool-calling prompt layer.

pub mod claude;
pub mod gemini;
pub mod ollama;
pub mod openai;

/// Known LLM provider families.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    /// Anthropic Claude models (Opus, Sonnet, Haiku).
    Claude,
    /// OpenAI models (GPT, Codex, o-series).
    OpenAi,
    /// Local/open-source models via Ollama or similar (Llama, Mistral, Qwen).
    Local,
    /// Google Gemini models.
    Gemini,
}

impl Provider {
    /// Detect the provider from a model name string.
    ///
    /// Handles prefixed names like `"openrouter/claude-opus-4-6"` by stripping
    /// everything before the last `/`.
    ///
    /// Defaults to [`Provider::OpenAi`] for unrecognised models — the OpenAI
    /// JSON format is the most universal fallback.
    pub fn detect(model_name: &str) -> Self {
        let lower = model_name.to_lowercase();

        // Strip provider/router prefix (e.g. "openrouter/", "together/")
        let model = match lower.rfind('/') {
            Some(pos) => &lower[pos + 1..],
            None => &lower,
        };

        if model.starts_with("claude") {
            Provider::Claude
        } else if model.starts_with("gpt-")
            || model.starts_with("gpt4")
            || model.starts_with("o1")
            || model.starts_with("o3")
            || model.starts_with("o4")
            || model.starts_with("codex")
            || model.starts_with("chatgpt")
        {
            Provider::OpenAi
        } else if model.starts_with("gemini") {
            Provider::Gemini
        } else if model.starts_with("llama")
            || model.starts_with("mistral")
            || model.starts_with("qwen")
            || model.starts_with("phi")
            || model.starts_with("deepseek")
            || model.starts_with("command")
            || model.contains(':')
        // Ollama-style "model:tag"
        {
            Provider::Local
        } else {
            // Default: OpenAI JSON format is the safest universal fallback.
            Provider::OpenAi
        }
    }

    /// Return the provider-specific tool-layer prompt.
    pub fn tool_layer(&self) -> &'static str {
        match self {
            Provider::Claude => claude::TOOL_LAYER,
            Provider::OpenAi => openai::TOOL_LAYER,
            Provider::Local => ollama::TOOL_LAYER,
            Provider::Gemini => gemini::TOOL_LAYER,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_claude_models() {
        assert_eq!(Provider::detect("claude-opus-4-6"), Provider::Claude);
        assert_eq!(Provider::detect("claude-sonnet-4-6"), Provider::Claude);
        assert_eq!(
            Provider::detect("claude-haiku-4-5-20251001"),
            Provider::Claude
        );
        assert_eq!(Provider::detect("Claude-Opus-4-6"), Provider::Claude);
    }

    #[test]
    fn detect_openai_models() {
        assert_eq!(Provider::detect("gpt-5.4"), Provider::OpenAi);
        assert_eq!(Provider::detect("gpt-4-turbo"), Provider::OpenAi);
        assert_eq!(Provider::detect("gpt4o"), Provider::OpenAi);
        assert_eq!(Provider::detect("o1-preview"), Provider::OpenAi);
        assert_eq!(Provider::detect("o3-mini"), Provider::OpenAi);
        assert_eq!(Provider::detect("codex-mini"), Provider::OpenAi);
    }

    #[test]
    fn detect_gemini_models() {
        assert_eq!(Provider::detect("gemini-pro"), Provider::Gemini);
        assert_eq!(Provider::detect("gemini-2.0-flash"), Provider::Gemini);
    }

    #[test]
    fn detect_local_models() {
        assert_eq!(Provider::detect("llama3:70b"), Provider::Local);
        assert_eq!(Provider::detect("mistral-7b"), Provider::Local);
        assert_eq!(Provider::detect("qwen2:14b"), Provider::Local);
        assert_eq!(Provider::detect("deepseek-coder-v2"), Provider::Local);
        assert_eq!(Provider::detect("phi-3-mini"), Provider::Local);
    }

    #[test]
    fn detect_with_router_prefix() {
        assert_eq!(
            Provider::detect("openrouter/claude-opus-4-6"),
            Provider::Claude
        );
        assert_eq!(Provider::detect("openrouter/gpt-5.4"), Provider::OpenAi);
        assert_eq!(Provider::detect("together/llama3-70b"), Provider::Local);
    }

    #[test]
    fn unknown_defaults_to_openai() {
        assert_eq!(Provider::detect("some-unknown-model"), Provider::OpenAi);
    }

    #[test]
    fn tool_layer_not_empty() {
        for provider in [
            Provider::Claude,
            Provider::OpenAi,
            Provider::Local,
            Provider::Gemini,
        ] {
            let layer = provider.tool_layer();
            assert!(!layer.is_empty(), "{provider:?} has empty tool layer");
            assert!(
                layer.contains("create_agent"),
                "{provider:?} tool layer missing create_agent"
            );
        }
    }
}
