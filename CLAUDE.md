# Vault Planner

Unofficial planner for USSA's Vault 3D-printable storage system, targeting Bambu printers and Bambu Studio. A static web app that runs entirely in the browser.

- The licensed Vault files (`261021_VAULT_USSA_S/`, STLs and PDF manuals) are git-ignored and must never be committed or bundled. Only measured numbers per part are shipped (see `docs/adr/0001-ship-part-measurements-not-geometry.md`).
- When the manuals conflict or a part rule is inferred, flag it with its source; never pick a value silently.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on Opoz/vault_sorter, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels, unchanged (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
