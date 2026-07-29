# Contributing to Hive

Thanks for your interest in Hive! Contributions of all kinds are welcome — bug reports, docs,
and code. Support is provided on a best-effort basis.

## Before you start

- For bugs and small fixes, [open an issue](https://github.com/unfence-labs/hive/issues) or send a
  PR directly.
- For larger changes or new features, open an issue first so we can discuss the approach before you
  invest time in it.
- Report suspected vulnerabilities privately as described in [SECURITY.md](SECURITY.md), never in
  a public issue.

## Development setup

```bash
git clone https://github.com/unfence-labs/hive.git
cd hive
npm install
cd backend && npm run dev      # → http://127.0.0.1:3000
cd frontend && npm run dev     # → http://localhost:5173
```

Commands, the repository map, coding rules, and testing expectations live in
**[AGENTS.md](AGENTS.md)** — it is written for coding agents and works just as well for humans.
Architecture notes and the API surface are in **[docs/architecture.md](docs/architecture.md)**.
To exercise the real server install flow end to end, see
**[docs/install-flow-orbstack.md](docs/install-flow-orbstack.md)**.

## Pull requests

- Branch from `main`.
- Run the relevant `lint`, `typecheck`, and tests for the packages you touched; run the root checks
  for cross-cutting changes.
- Keep the WebSocket protocol types aligned across `backend`, `frontend`, and `ios`.
- Use English for all code, comments, UI copy, and commit messages.

## License

By contributing, you agree that your contributions are licensed under the
[GNU General Public License v3.0 or later](LICENSE). The project does not require a contributor
license agreement; you retain copyright in your contribution.
