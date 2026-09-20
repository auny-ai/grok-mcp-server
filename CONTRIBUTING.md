# Contributing

Thanks for looking. Two kinds of contribution land well here: a **failure you hit** (the request you sent and the response you got back), and a **fix with a check that fails without it**.

## Before you open anything

- **Search** the issues, open and closed.
- **Reproduce** against `wrangler dev` or a deployed copy. Redact your `AUTH_SECRET` and xAI key from anything you paste.

## Running the checks

```bash
npm ci
npx tsc --noEmit    # type check; there is no test runner in this repo
./verify.sh         # adversarial: asserts an unauthenticated request is refused
```

CI runs `npm ci`, `npx tsc --noEmit`, and `npx wrangler deploy --dry-run` on Node 22, on every push to `main` and every pull request.

## Adding a tool

A new xAI tool goes in `src/index.ts`, alongside the existing handlers. State the xAI endpoint it calls and what it returns.

## Pull requests

- One concern per PR.
- If you touched the auth gate (`src/auth.ts`) or a tool handler, say what you tested and what it refused.
- No em dashes in prose you add.
- Add a line under `[Unreleased]` in `CHANGELOG.md`.
- Nothing that looks like a credential, real or example-looking: no key, token, `AUTH_SECRET` value, account id, or hostname.
