# Running Rendly in Claude Code on the web

Claude Code on the web (claude.ai/code) runs sessions in a cloud sandbox cloned from GitHub.
Usage counts against the Claude plan of the account you sign in with (for example Pro).

## One-time setup

1. Sign in at https://claude.ai/code with the account that holds your plan.
2. Connect GitHub and install the Claude GitHub app on the **TeamAnoryx** organization,
   with access to the `Rendly` repository. An org owner must approve the install.
3. Create an environment for the repo and add these environment variables
   (never commit them):

   | Variable | Used by |
   |---|---|
   | `SUPABASE_URL` | auth-service |
   | `SUPABASE_SERVICE_ROLE_KEY` | auth-service (server only) |
   | `JWT_SECRET` | auth-service |
   | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | OAuth (optional) |
   | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | OAuth (optional) |
   | `NEXT_PUBLIC_API_URL=http://localhost:4001` | frontend |

   Network access must allow npm and your Supabase host.
4. Start a session on the branch you want (for example `claude/dreamy-archimedes-uvnafv`).

On session start, `.claude/settings.json` runs `rendly-mvp/scripts/cloud-setup.sh`,
which installs backend and frontend dependencies. It does nothing on local machines.

## Database

Apply migrations in order in the Supabase SQL editor (or `supabase db push`):

- `backend/supabase/migrations/20250612_huddles.sql`
- `backend/supabase/migrations/20250613_huddle_join_and_rls.sql`

## Run and test

```bash
cd rendly-mvp/backend && npm run dev:auth                 # auth-service on :4001
cd rendly-mvp/frontend && npm run dev                     # Next.js on :3001
cd rendly-mvp/backend/services/auth-service && npx jest   # huddle rule tests
```
