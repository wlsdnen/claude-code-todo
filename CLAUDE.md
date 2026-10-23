# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`todo` is a Claude Code mod (a plugin with a hooks module): a persistent TODO list shown in a pane, a band above the prompt, a `/todo` command and a model tool. There is no build step and no package.json; the engine loads `hooks/register.tsx` directly.

## Commands

```sh
claude plugin test .                    # runs every *.test.ts(x); no per-test filter, so `test.only` is the way to narrow
claude plugin validate .                # manifest + module checks the engine applies on load
npx -p typescript tsc -p . --noEmit     # type-check; needs .claude-plugin/types/ (written by the engine once the mod loads)
claude --plugin-dir .                   # run Claude Code with the working copy loaded
```

If `claude` is a shell alias here, call `command claude`.

## Architecture

- `hooks/todo.ts`: pure logic with no `$`. Markdown parse and serialize (`- [ ] text !high due:YYYY-MM-DD`, indented lines are the memo, other lines kept verbatim), sorting (open, then priority, then due), due-word parsing in Korean and English, and `/todo` argument parsing. Unit-tested in `tests/todo.test.ts`.
- `hooks/register.tsx`: everything that touches the engine. One `register` wires `session.start` (registers the command and the `todo` tool, reopens the pane from `$.store`), `command.run`, `tool.call` (`mcp__todo__todo`), and `ui.render` for both `Pane` and `AbovePrompt`. Every write goes through `save()`, which calls `$.ui.invalidate('ui.render')` so the pane and band redraw.
- `hooks/i18n.ts`: KO and EN string tables. `pickLang` uses the Claude Code `language` setting first, then the POSIX locale.
- `types/index.d.ts`: the `$.state` contract (`tab`, `selected`, `editing`). `claude plugin validate` checks every `$.state` key against it, so add new atoms here first.

### Scope resolution

Two lists: `global` is `~/.claude/todo.md`, `project` is `<git root>/TODO.md` (cwd when not in a repo). When the user names no scope (`-p`/`-g`, the tool's `scope`, or a tab press), `defaultScope()` picks `project` inside a git repo and `global` elsewhere. The command, the tool and the pane's initial tab (`tab` atom is `null` until pressed) all use it.

### Pane focus

The focus ring follows element `key`s across redraws. The selected row is keyed `sel-N` and others `row-N`, exactly one element carries `autoFocus`, and every action leaves a row selected. This keeps `d`/`e`/`x` drawn and stops a redraw from landing focus on the Delete button. Keep this when changing the pane.

### Tool behavior

The tool description tells the model to act only when the user asks, and states that it is not TodoWrite. Paths in tool output go through `shownPath()` so the home directory shows as `~`.

## Release

The plugin `name` (`todo`) and the marketplace `name` (`todo-pane`) must not change: installs are identified as `todo@todo-pane`. Bump `version` in `.claude-plugin/plugin.json`, then tag `vX.Y.Z` and create a GitHub release on `wlsdnen/claude-code-todo`. Commits in this repo use the repo-local `wlsdnen` noreply identity.
