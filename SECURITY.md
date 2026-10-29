# Security

## Reporting a problem

Please report security problems privately, not in a public issue: on GitHub, open the repository's **Security** tab and choose **Report a vulnerability**. You'll get a reply as soon as possible.

Useful things to include: what you found, how to reproduce it, and what someone could do with it.

## What's in scope

- The app at [patchbook-for-reliq.vercel.app](https://patchbook-for-reliq.vercel.app) and the code in this repository.
- The sync functions in [`supabase/migrations/0001_sync.sql`](supabase/migrations/0001_sync.sql).

Please don't test against the live sync database in ways that could affect other people's data or use up its shared limits: no load testing, and no attempts to read or change sync spaces that aren't yours. Run your own Supabase project from the migration instead (see the README's "Run your own sync").

## How sync is protected

Sync is end-to-end encrypted on the device, and the server only ever sees ciphertext and opaque ids. The README's "Device sync" section describes the design and its limits.
