-- Run this in the Supabase SQL Editor against an existing Orbit schema.
-- Replaces every workspace_members policy with checks that use security-definer
-- helpers, avoiding recursive reads of the RLS-protected membership table.
-- This targeted repair does not recreate tables or change stored rows.

begin;

alter table public.workspace_members enable row level security;

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean
language sql stable security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace and profile_id = auth.uid()
  );
$$;

create or replace function public.has_workspace_role(
  target_workspace uuid,
  target_roles public.workspace_role[]
)
returns boolean
language sql stable security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace
      and profile_id = auth.uid()
      and role = any(target_roles)
  );
$$;

revoke all on function public.is_workspace_member(uuid) from public, anon;
revoke all on function public.has_workspace_role(uuid, public.workspace_role[]) from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.has_workspace_role(uuid, public.workspace_role[]) to authenticated;
grant select, insert, update, delete on public.workspace_members to authenticated;

-- Policies are OR-combined, so remove stale/custom policies with any name.
do $$
declare policy_name text;
begin
  for policy_name in
    select polname
    from pg_policy
    where polrelid = 'public.workspace_members'::regclass
  loop
    execute format('drop policy %I on public.workspace_members', policy_name);
  end loop;
end
$$;

create policy "Members read membership" on public.workspace_members
for select using (public.is_workspace_member(workspace_id));

create policy "Admins manage membership" on public.workspace_members
for all
using (
  role <> 'owner'
  and public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
)
with check (
  public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
  and role <> 'owner'
  and (
    role <> 'admin'
    or public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[])
  )
);

commit;
