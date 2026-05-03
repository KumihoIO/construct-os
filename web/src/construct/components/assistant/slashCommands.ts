/**
 * Slash command registry for the Operator chat composer.
 *
 * Commands are typed as `/<name> [args]` at the start of the textarea.
 * Detection logic (in ChatPane) opens a filter-as-you-type menu while
 * the user is editing the command name; once they hit a space the
 * menu closes and they're typing args. Enter executes the command if
 * the input form `/<known-name> [args]` matches.
 *
 * Phase 1 commands are all client-side: clearing scrollback, opening
 * tabs/file picker, switching theme/language. Phase 2 (workflow / agent
 * / skill invocation) needs Operator MCP changes — deferred.
 *
 * To add a command:
 *   1. Append a `SlashCommand` object below.
 *   2. If your command takes arguments, set `args: 'description'` so
 *      Enter prefills `/<name> ` instead of executing immediately.
 *   3. Aliases are first-class for ergonomics — `/?` aliasing `/help`,
 *      `/cls` aliasing `/clear`, etc. — alias-only matches don't show
 *      separate menu rows; the canonical entry's row matches both.
 */

/** Tab kinds the panel knows how to spawn. Mirrors `TabType` in
 *  AssistantPanel — kept narrow here to avoid a circular import. */
export type SlashTabType = 'chat' | 'terminal' | 'code';

/** Theme names recognized by `useTheme`. */
export type SlashThemeName = 'dark' | 'light' | 'system' | 'oled';

/** Normalized lookup key — lowercase, no leading slash. */
function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/^\//, '');
}

/** Everything a command handler can do, injected by ChatPane at call time.
 *  Keep this surface small and explicit — handlers are easier to reason
 *  about when their dependencies are obvious. */
export interface SlashCommandContext {
  // ── Chat surface actions ──────────────────────────────────────
  /** Wipe the active tab's scrollback (preserves the WS session). */
  clearMessages: () => void;
  /** Inject a system-style message into scrollback. Used by `/help`
   *  to render the command list inline rather than opening a modal. */
  appendSystemMessage: (content: string) => void;
  /** Click the paperclip — opens the OS file picker. */
  openFilePicker: () => void;

  // ── Panel actions ─────────────────────────────────────────────
  /** Spawn a new tab of the given type and switch to it. */
  addTab: (type: SlashTabType) => void;
  /** Open the new-tab dropdown (shows the type chooser). */
  openNewTabMenu: () => void;
  /** Close the active tab; falls back to opening a fresh chat tab if
   *  this was the last one. */
  closeActiveTab: () => void;

  // ── App-wide actions ──────────────────────────────────────────
  /** Switch UI language; persists to config.toml on the runtime. */
  setLang: (code: string) => void | Promise<void>;
  /** Switch theme. */
  setTheme: (theme: SlashThemeName) => void;
}

export interface SlashCommand {
  /** Canonical command name without leading slash. */
  name: string;
  /** Alternative invocation forms — e.g. `?` for `help`. */
  aliases?: string[];
  /** One-line description shown in the menu. */
  description: string;
  /** When set, indicates the command takes arguments. The menu shows
   *  this string as a hint and Enter prefills `/<name> ` instead of
   *  executing immediately. */
  args?: string;
  /** Optional usage example shown in `/help` output. */
  example?: string;
  /** Async or sync handler. Errors are caught by the caller and surfaced
   *  on the chat error banner. */
  handler: (ctx: SlashCommandContext, args: string) => void | Promise<void>;
}

// ── The registry ──────────────────────────────────────────────────

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'help',
    aliases: ['?'],
    description: 'List available slash commands',
    example: '/help',
    handler: (ctx) => {
      const lines: string[] = [];
      lines.push('Available commands:');
      lines.push('');
      for (const cmd of SLASH_COMMANDS) {
        const usage = cmd.args ? `/${cmd.name} ${cmd.args}` : `/${cmd.name}`;
        const aliasNote = cmd.aliases && cmd.aliases.length > 0 ? `  (aka ${cmd.aliases.map((a) => `/${a}`).join(', ')})` : '';
        lines.push(`  ${usage.padEnd(28)} — ${cmd.description}${aliasNote}`);
      }
      lines.push('');
      lines.push('Tip: type / to open the menu and arrow keys to navigate.');
      ctx.appendSystemMessage(lines.join('\n'));
    },
  },
  {
    name: 'clear',
    aliases: ['cls'],
    description: 'Clear chat scrollback (session stays connected)',
    example: '/clear',
    handler: (ctx) => {
      ctx.clearMessages();
    },
  },
  {
    name: 'new',
    description: 'Open the new-tab menu',
    example: '/new',
    handler: (ctx) => {
      ctx.openNewTabMenu();
    },
  },
  {
    name: 'chat',
    description: 'Open a new chat tab',
    example: '/chat',
    handler: (ctx) => {
      ctx.addTab('chat');
    },
  },
  {
    name: 'terminal',
    aliases: ['term'],
    description: 'Open a new terminal tab',
    example: '/terminal',
    handler: (ctx) => {
      ctx.addTab('terminal');
    },
  },
  {
    name: 'code',
    description: 'Open a new code tab',
    example: '/code',
    handler: (ctx) => {
      ctx.addTab('code');
    },
  },
  {
    name: 'attach',
    aliases: ['file'],
    description: 'Pick a file to attach (opens OS file picker)',
    example: '/attach',
    handler: (ctx) => {
      ctx.openFilePicker();
    },
  },
  {
    name: 'theme',
    description: 'Switch UI theme',
    args: '<dark|light|oled|system>',
    example: '/theme dark',
    handler: (ctx, args) => {
      const v = args.trim().toLowerCase();
      if (v === 'dark' || v === 'light' || v === 'system' || v === 'oled') {
        ctx.setTheme(v);
      } else {
        ctx.appendSystemMessage(`Unknown theme: "${args.trim()}". Expected dark, light, oled, or system.`);
      }
    },
  },
  {
    name: 'lang',
    aliases: ['language'],
    description: 'Switch UI language',
    args: '<en|zh|tr|ko>',
    example: '/lang ko',
    handler: (ctx, args) => {
      const v = args.trim().toLowerCase();
      if (!v) {
        ctx.appendSystemMessage('Usage: /lang <en|zh|tr|ko>');
        return;
      }
      void ctx.setLang(v);
    },
  },
  {
    name: 'close',
    description: 'Close the active tab',
    example: '/close',
    handler: (ctx) => {
      ctx.closeActiveTab();
    },
  },
];

// ── Lookup helpers ────────────────────────────────────────────────

/** Return commands whose canonical name starts with the query (after
 *  the leading `/`). Empty query returns the full list. Aliases are
 *  matched too — but the matched entry is still keyed by canonical
 *  name, so `/?` and `/help` produce the same single row. */
export function matchCommands(query: string): SlashCommand[] {
  const q = normalize(query);
  if (q === '') return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((cmd) => {
    if (cmd.name.startsWith(q)) return true;
    if (cmd.aliases?.some((a) => a.startsWith(q))) return true;
    return false;
  });
}

/** Parse a textarea input into `{ name, args }` when it looks like a
 *  slash command invocation. Returns `null` for plain messages. The
 *  `name` is the literal token typed by the user — not yet resolved
 *  to a canonical command via aliases. Use [`resolveCommand`] for that. */
export function parseInput(input: string): { name: string; args: string } | null {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith('/')) return null;
  // Don't treat multi-line input as a command — once the user hits
  // Shift+Enter they're writing a message, not invoking.
  if (trimmed.includes('\n')) return null;
  const rest = trimmed.slice(1);
  const spaceIdx = rest.indexOf(' ');
  if (spaceIdx < 0) {
    return { name: rest, args: '' };
  }
  return { name: rest.slice(0, spaceIdx), args: rest.slice(spaceIdx + 1) };
}

/** Resolve a typed name (e.g. `?`, `cls`, `term`) to its canonical
 *  command entry, or `null` if no match. Case-insensitive. */
export function resolveCommand(name: string): SlashCommand | null {
  const n = normalize(name);
  return SLASH_COMMANDS.find((cmd) => cmd.name === n || cmd.aliases?.includes(n)) ?? null;
}
