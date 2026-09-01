# Connecting this site to Supabase

Your site already expects a specific database shape — `main.js` and `admin.js`
call tables named `teams`, `matches`, `tournament_settings` and a view
`teams_public`, plus three functions (`register_team`, `submit_match_result`,
`approve_match`). The `supabase/schema.sql` file in this folder creates all
of it in one go. This guide just walks you through running it.

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project**.
2. Pick a name, a database password (save it somewhere), and a region close
   to your players.
3. Wait ~2 minutes for it to finish provisioning.

## 2. Run the schema

1. In your project, open **SQL Editor** (left sidebar) → **New query**.
2. Open `supabase/schema.sql` from this folder, copy the whole file, paste
   it into the editor.
3. Click **Run**. You should see "Success. No rows returned."

This creates:
- **`teams`** — registered teams, their phone/code (private)
- **`teams_public`** — a safe view (no phone/code) that the public site reads
- **`matches`** — the bracket fixtures
- **`tournament_settings`** — a single row holding the tournament name/status
- **`register_team`**, **`submit_match_result`**, **`approve_match`** — the
  three functions the site calls via `sb.rpc(...)`
- Row Level Security policies (below) and Realtime replication

## 3. Connect your API keys

1. In Supabase, go to **Project Settings → API**.
2. Copy the **Project URL** and the **anon / public** key.
3. Open `js/config.js` and replace the placeholders:

```js
const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY";
```

Never put the **service_role** key here — only the anon/public one. The anon
key is safe to expose in client-side code; it's what Row Level Security is
for.

## 4. Create your admin account

The admin dashboard (`admin.html`) treats **any signed-in Supabase Auth
user** as an admin — there's no separate roles table. So only create logins
for people you trust with full control of the tournament.

1. Go to **Authentication → Users → Add user**.
2. Enter an email + password, and untick "Auto confirm" only if you want to
   verify by email first (otherwise leave it checked for instant access).
3. Sign in at `admin.html` with those credentials.

Add more users the same way if you have co-admins.

## 5. Confirm Realtime is on

The schema script already runs the commands to enable it, but to double
check: **Database → Replication** → the `supabase_realtime` publication
should list `teams`, `matches`, and `tournament_settings`. If any are
missing, toggle them on there.

## 6. Test it end-to-end

1. Open `index.html` → **Register** tab → register a test team → you should
   see a one-time code in a popup.
2. Register a second team the same way.
3. Sign in to `admin.html` → **Bracket Builder** → add a Round 1 fixture with
   your two test teams → **Finalize bracket & start tournament**.
4. Back on the public site, **Submit Result** using one team's code → submit
   a score.
5. In `admin.html` → **Approvals** → approve it. The winner should advance,
   the loser gets marked eliminated, and the bracket updates live on the
   public site without a refresh.

## How the access rules work (Row Level Security)

| Table                 | Public (anon)                          | Admin (signed in)      |
|------------------------|-----------------------------------------|-------------------------|
| `teams`                | no direct access                        | full read/write         |
| `teams_public` (view)  | read-only                               | read-only                |
| `matches`               | read-only                               | full read/write          |
| `tournament_settings`  | read-only                               | can update               |

Players never write to `matches` or `teams` directly — registering and
submitting results both go through the `register_team` /
`submit_match_result` functions, which validate everything (team name
uniqueness, matching secret code, etc.) before touching the database. This
is what lets anonymous visitors register and submit scores safely without
giving them raw write access to your tables.

## Troubleshooting

- **"row-level security policy" error on register/submit** → the `grant
  execute ... to anon` lines at the bottom of each function in `schema.sql`
  didn't run — re-run the whole script.
- **Admin dashboard shows nothing / infinite spinner** → check the browser
  console; usually means `SUPABASE_URL` / `SUPABASE_ANON_KEY` in
  `js/config.js` are still placeholders.
- **Bracket doesn't update live** → re-check step 5 (Realtime replication).
- **Next round doesn't appear after approving both semi-finals** → this is
  expected until *both* semi-final winners are known; `approve_match`
  creates the next-round fixture on the first winner and fills the second
  slot in when the other match is approved.
