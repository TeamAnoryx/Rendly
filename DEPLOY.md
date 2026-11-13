# Deploying Rendly

Frontend → **Vercel**. Backend (auth-service + chat-service) → **Render**. Database → **Supabase** (already hosted).

Deploy the backend first: the frontend needs its URLs.

---

## 1. Backend on Render

1. Render dashboard → **New → Blueprint** → select the `TeamAnoryx/Rendly` repo. Render reads `render.yaml` and creates two web services: `rendly-auth` and `rendly-chat`.
2. Render asks for every variable marked `sync: false`. Fill them in:

| Variable | Service | Value |
|---|---|---|
| `JWT_SECRET` | both | Long random string. **Same value on both.** |
| `SUPABASE_URL` | both | Supabase → Project Settings → API |
| `SUPABASE_ANON_KEY` | both | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | both | Supabase → Project Settings → API (keep secret) |
| `DATABASE_URL` | chat | Supabase → Connect → **Transaction pooler** URI |
| `ALLOWED_ORIGINS` | both | Your Vercel URL, e.g. `https://rendly.vercel.app` (comma-separate several). Leave blank on the first deploy if you don't know it yet, then set it after step 2. |
| `OAUTH_REDIRECT_URI` | auth | `https://<your-vercel-domain>/auth/callback` |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | auth | GitHub OAuth app |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | auth | LinkedIn app |
| `SMTP_*`, `MAIL_FROM` | auth | Optional, for password-reset email |

3. Do **not** set `AUTH_SERVICE_PORT` or `CHAT_SERVICE_PORT` on Render. They override the `PORT` Render assigns and the service will not be reachable.
4. When both are live, open `https://<service>.onrender.com/health`. Auth answers `{"status":"OK",...}`, chat answers `{"service":"chat-service","ok":true}`.

Notes:
- `rendly-chat` keeps live chat and call rooms in memory. Keep it at **one instance**.
- On Render's **free** plan, services sleep after ~15 min idle and take ~1 min to wake, which drops live calls and chats. Use a paid instance for launch.

## 2. Frontend on Vercel

1. Vercel → **Add New → Project** → import `TeamAnoryx/Rendly`.
2. **Root Directory:** `rendly-mvp/frontend`. Framework is detected as Next.js; keep the default build settings.
3. **Environment Variables** (Production):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://rendly-auth.onrender.com` (your auth URL) |
| `NEXT_PUBLIC_CHAT_API_URL` | `https://rendly-chat.onrender.com` (your chat URL) |
| `NEXT_PUBLIC_CCS_WS_URL` | `wss://rendly-chat.onrender.com` (optional; derived from the chat URL if unset) |
| `NEXT_PUBLIC_GITHUB_CLIENT_ID` | Same as backend `GITHUB_CLIENT_ID` |
| `NEXT_PUBLIC_LINKEDIN_CLIENT_ID` | Same as backend `LINKEDIN_CLIENT_ID` |
| `NEXT_PUBLIC_OAUTH_REDIRECT_URI` | `https://<your-vercel-domain>/auth/callback` |

   Do **not** set `NEXT_DIST_DIR` on Vercel. `NEXT_PUBLIC_*` values are baked in at build time: after changing one, **redeploy**.
4. Deploy.

## 3. Connect them

1. Put the final Vercel URL into `ALLOWED_ORIGINS` on **both** Render services and redeploy them.
2. In the **GitHub** and **LinkedIn** OAuth app settings, set the callback/redirect URL to `https://<your-vercel-domain>/auth/callback`.
3. In **Supabase → Authentication → URL Configuration**, add the Vercel domain to the allowed redirect URLs if you use Supabase auth links.

## 4. Smoke test

- Landing page loads and the launch film plays.
- Sign up / log in (password and GitHub/LinkedIn).
- Open chat between two accounts: messages arrive live.
- Start a Spark video call.

If a request fails with a CORS error in the browser console, the origin is missing from `ALLOWED_ORIGINS`.

## Keep Supabase awake

Free-tier Supabase projects pause after ~1 week without activity, and every database call then fails with `ENOTFOUND`. Restore it from the Supabase dashboard, or upgrade the plan before launch.
