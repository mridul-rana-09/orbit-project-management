# Orbit Project Management Tool

Orbit is a responsive project management workspace for teams. It combines workspace and project planning, task tracking, a Kanban board, deadlines, comments, notifications, activity history, and file attachments with Supabase authentication and PostgreSQL row-level security.

## Features

- Email/password signup and login, session cookies, logout, protected dashboard/API routes, and email confirmation callback.
- Profiles and multiple workspaces with owner, admin, member, and guest roles.
- Project creation, rename/edit, status updates, and deletion.
- Task creation, editing, deletion, assignment, priorities, statuses, due dates, and drag-and-drop status changes.
- Workspace member invites by shareable link, role management, and removal.
- Calendar deadlines, task comments, activity history, assignment/comment notifications, and private task attachments.
- Search and status filtering, project/task statistics, completion chart, responsive layouts, and saved light/dark theme.
- Supabase Realtime refresh for tasks, projects, comments, activity, notifications, and workspace membership.

AI prioritization, deadline advice, and generated summaries are not implemented. Invitations are shareable links; the app does not send invitation emails.

## Technology stack

- Next.js 16 App Router and Proxy
- React 19, TypeScript, Tailwind CSS 4
- Supabase PostgreSQL, Auth, Realtime, and Storage
- Lucide React, Recharts, and dnd-kit
- pnpm

## Project structure

```text
src/
  app/
    api/                 Authenticated Supabase route handlers
    auth/callback/       Supabase PKCE/email confirmation callback
    login/               Signup and login
    globals.css           Responsive light/dark UI styles
    page.tsx              Workspace dashboard and views
  lib/
    api/request.ts        Request validation and authenticated Supabase access
    supabase/             Browser and server Supabase clients
  proxy.ts                Session gate for the dashboard and API routes
supabase/
  schema.sql              Initial schema for a new Supabase project
  repair_rls.sql          Idempotent repair for an existing schema installation
```

## Supabase setup

1. Create or select a Supabase project.
2. In the project settings, copy its Project URL and **Publishable key** into the root `.env.local` file using the variable names below. The publishable key is safe for browser use; never put a Secret/service-role key in this app.
3. Enable Email and Password under Supabase Auth providers.
4. Add these Auth redirect URLs (and the equivalent callback URL for the deployed app) to the Supabase Auth redirect allow list:
   - `http://localhost:3000/auth/callback`
   - `https://<your-vercel-domain>/auth/callback`
5. For a **new** database, run `supabase/schema.sql` once in the Supabase SQL Editor.
6. For the existing project where `schema.sql` has already run, do **not** rerun it. Run `supabase/repair_rls.sql` in the SQL Editor if its RLS repair has not yet been applied.

This workspace cannot inspect or change the hosted database through the publishable key, so the current Supabase policy state is not claimed as verified. If the app reports `infinite recursion detected in policy for relation workspace_members`, run `supabase/repair_rls.sql` as a database administrator in the SQL Editor. It replaces every existing `workspace_members` policy (including stale policies with different names) with membership checks backed by security-definer helpers, grants the authenticated role the required table access, and retains role and workspace boundaries. It does not recreate tables or delete rows. The app's publishable key cannot apply DDL.

## Environment variables

`.env.local` is ignored by Git. Set only:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-publishable-key>
```

The `ANON_KEY` variable name is retained for compatibility with the current app. Its value may be the project's `sb_publishable_...` key. No service-role or secret key is needed.

## Local development

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`. In PowerShell installations where script execution blocks `pnpm.ps1`, use `pnpm.cmd` for the same commands.

Validation commands:

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```

## Main modules

- `src/app/page.tsx`: workspace dashboard, board, calendar, projects, team, comments, attachments, notifications, and Realtime refresh.
- `src/app/login/page.tsx`: signup, sign-in, and invitation acceptance for active sessions.
- `src/app/auth/callback/route.ts`: PKCE code exchange and email-confirmation/invitation return.
- `src/app/api/`: server handlers for workspaces, projects, tasks, members, comments, activity, notifications, and signed attachment URLs.
- `src/lib/supabase/`: SSR/browser clients, both configured with the public URL and publishable key.
- `src/lib/api/request.ts`: authenticated server client access and input validators.
- `supabase/schema.sql` and `supabase/repair_rls.sql`: tables, relations, triggers, storage, Realtime publication, grants, and RLS.

## Security and data access

- The Proxy checks the Supabase session before dashboard/API requests. Route handlers also require an authenticated Supabase user.
- PostgreSQL RLS is the data authorization boundary. Policies restrict workspace, project, task, profile, membership, invitation, comment, attachment, activity, and notification access.
- Owner/admin/member role changes are constrained in the database; only workspace owners can assign admins. Workspace owner records cannot be removed by member-management writes.
- Task assignees and project members must belong to the same workspace. Invitation acceptance verifies both the authenticated email and token.
- Attachments use a private Storage bucket and short-lived signed download URLs.
- `.env.local` is ignored. Do not add a Secret/service-role key to client code, Vercel client variables, or source control.

## Vercel deployment

1. Push the project to your Git provider and import it into Vercel. Do not include `.env.local` in the repository.
2. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the Vercel project's Production, Preview, and Development environment settings as needed.
3. Add the deployed callback URL to Supabase Auth redirect URLs.
4. Confirm `supabase/repair_rls.sql` has been applied to the existing database. For new deployments, initialize a new database with `schema.sql` instead.
5. Deploy from Vercel after the production build succeeds. The project uses the standard Next.js build command `pnpm build`; no deployment is performed from this repository.

## Current verification limits

The production build and static code checks can run locally. Completing authenticated CRUD, profile-trigger, cross-workspace RLS, and database-event tests requires the RLS repair to be applied and a Supabase test user. Authenticated Realtime delivery also requires a signed-in test session. Do not treat remote database policies, Auth redirect allow-list settings, or live CRUD as verified until tested in the Supabase project.
