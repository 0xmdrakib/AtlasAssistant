# Atlas Assistant

*Stop doomscrolling. Start reading **signal**.*

Atlas Assistant is a calm, high‑signal news portal that turns chaos into clarity.

**Live app:** https://atlasassistant.rakibhq.xyz

---

## Features

### 8 focused tabs (huge international news, in one place)
- Global
- Tech
- Innovators
- Early Signals
- Great Creators
- Universe
- History
- Faith

### Filters that actually help
Pick a **Country** + **Topic** + **time window (1d / 7d)** and Atlas curates the feed using **scoring + caps** (so you don’t get a junk flood).

### AI experience
- **1‑click AI Digest** (daily/weekly context in one summary):
  - Overview → Themes → Highlights → Why it matters → Watchlist  
  - Optional **text‑to‑speech** if you’re short on time
- **Per‑item AI summaries** + key points
- **Listen mode** (text‑to‑speech)
- **Multi‑language UI** (broad language support)

### Freshness
- Updates hourly

### Saved posts
- Bookmark any post and find it in **Settings → Saved**.
- Free accounts can keep 10 posts; Pro accounts can keep 50.
- Removing a bookmark or deleting its original post frees a slot immediately.
- Saves are private account references, not permanent copies. Existing saves survive a plan downgrade, but new saves require room under the current limit.

### Database deployment
The existing database is managed with `npm run db:migrate` (Prisma db push).
Vercel runs `npm run db:migrate:saved` before the application build to apply the
additive, repeatable SQL in `prisma/changes/20260909_saved_items.sql` through `DIRECT_URL`.
This only adds the saved-items table, indexes and cascading foreign keys. Local
databases can use the normal schema push. It does not delete existing records.

Run `npm run test:saved` against an isolated PostgreSQL database by setting
`SAVED_TEST_DATABASE_URL` to a localhost database whose name ends in `_test`.
The suite uses its own temporary users and source, and removes those fixtures afterward.

---

## License

This project is licensed under the [MIT License](./LICENSE).
