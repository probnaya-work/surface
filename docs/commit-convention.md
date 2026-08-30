# Commit message convention

Strict, conventional-style commits. No vague or noisy wording; history should be easy to scan.

---

## 1. Commit format

```
<type>(<scope>): <subject>

[optional body]
```

- **Subject:** One line, imperative mood, lowercase after the colon, no period at the end. Max ~72 chars.
- **Scope:** Optional; use when it clarifies *where* the change lives (e.g. `api`, `auth`, `ui`, `db`).
- **Body:** Optional; use only when one line is not enough (e.g. breaking change, non-obvious fix).

**Subject rules:**

- Start with a verb: *add*, *fix*, *refactor*, *remove*, *upgrade*, etc.
- Be specific: what changed, not why you did it.
- No emoji, no "WIP", no "finally", no "hopefully", no "small"/"minor"/"quick".

---

## 2. Allowed types

| Type       | Use for |
|-----------|---------|
| `feat`    | New user-facing behavior or capability. |
| `fix`     | Bug fix (behavior was wrong; now correct). |
| `refactor`| Code change that doesn't fix a bug or add a feature (reorg, rename, simplify). |
| `perf`    | Performance improvement. |
| `chore`   | Build, tooling, deps, config, scripts. No app logic. |
| `docs`    | Documentation only (README, docs/, comments that are purely docs). |
| `style`   | Formatting, whitespace, quotes. No logic or UI change. |
| `test`    | Adding or changing tests only. |

**Not used:** `ci` (use `chore`), `revert` (write a normal `fix` or `revert` message instead).

---

## 3. Rules

1. **One logical change per commit.** One feature slice, one fix, one refactor. No "and also" in the subject.
2. **Scope only when it helps.** Prefer `feat(auth): add password reset flow` over `feat: add password reset flow` when the change is clearly in one area. Omit scope for app-wide or small changes.
3. **Imperative, present tense.** "add search highlight" not "added search highlight" or "adds search highlight".
4. **No emotional or filler words.** Avoid: *finally*, *hopefully*, *quick*, *small*, *minor*, *just*, *really*, *actually*, *sorry*, *oops*, *WIP*, *wip*, *temp*, *temporary*.
5. **No vague subjects.** "fix bug" and "update code" are forbidden. Say what you fixed or what you updated.
6. **Body only when needed.** Use body for breaking changes, non-obvious rationale, or multiple concrete points. Keep it short and factual.
7. **Granularity (see below).** Prefer smaller, scannable commits over one big "stuff" commit.
8. **No AI/tool attribution.** Do not add "Co-Authored-By", "Generated with", model names, or any other authorship trailer for the tool that helped write the commit. Commits are attributed to the person, full stop.

---

## 4. Granularity: one commit vs several

**One commit when:**

- A single feature slice (e.g. "submit form on Enter key") that touches a few files and one concern.
- One bug fix with a clear cause (e.g. "fix search not updating when query is cleared").
- One refactor that doesn't mix with features (e.g. "refactor list into a separate component").
- Dependency or tooling change that's clearly one step (e.g. "chore: upgrade build tool to 2.x").

**Split into several commits when:**

- You add a feature *and* fix an unrelated bug. Two commits: one `feat`, one `fix`.
- You refactor and add behavior. Prefer: refactor first (one commit), then add behavior (second commit).
- You change UI and move files. Prefer: move/refactor first, then UI change.
- Multiple unrelated files (e.g. a new component + new API + styles). Consider one commit per "layer" if the change is large; otherwise one commit is fine if it's one logical feature.

**Rule of thumb:** If the subject would need "and" or "also", split or rephrase so one subject = one thing.

---

## 5. Good examples

```
feat(auth): add password reset flow
feat(search): show empty state when no results
fix(search): refresh list when query is cleared
fix(auth): redirect to login after session expiry
refactor(api): extract request client from views
refactor(db): rename userTable to users
perf(search): debounce query by 150ms
chore: add npm script for local dev server
chore: upgrade build dependencies
docs: add architecture and commit convention
style: normalize quote style in source files
```

With scope omitted where it's obvious or app-wide:

```
feat: add full-text search
fix: prevent double submit on Enter
refactor: move shared types to types/
```

With body (only when needed):

```
fix(build): allow read access to app data dir

Capability was missing for the local database path; add the
missing filesystem scope.
```

---

## 6. Bad examples (avoid)

```
fix bug
update stuff
WIP search
fix: fix the thing
feat: added new feature
chore: small changes
refactor: refactor code
fix: hopefully this works
chore: oops fix typo
feat(auth): add login and refactor form and fix focus
docs: update readme
style: improve UI
```

**Why they're bad:**

- "fix bug" / "update stuff" – vague; no idea what changed.
- "WIP search" – not a proper type/subject; noisy.
- "fix: fix the thing" – redundant and vague.
- "added new feature" – past tense; not imperative.
- "small changes" – emotional/filler; not specific.
- "refactor code" – says nothing about what was refactored.
- "hopefully this works" / "oops fix typo" – emotional/noisy.
- "add login and refactor form and fix focus" – multiple logical changes; split into three commits.
- "update readme" – too vague; prefer "docs: add setup instructions to README" or similar.
- "style: improve UI" – "style" is for formatting (e.g. quotes); UI changes are `feat` or `fix`.

---

## Summary

- **Format:** `type(scope): imperative subject`, optional body.
- **Types:** `feat` | `fix` | `refactor` | `perf` | `chore` | `docs` | `style` | `test`.
- **Rules:** One logical change per commit; imperative; no vague, emotional, or AI-attribution wording; scope when it helps.
- **Granularity:** One commit per feature slice / fix / refactor; split when you'd need "and" in the subject.
