-- Apply after schema.sql when tables already exist in a Supabase project.
-- Repairs missing authenticated table grants and recursive membership policies.

begin;

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

create or replace function public.are_workspace_peers(target_profile uuid)
returns boolean
language sql stable security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
    from public.workspace_members mine
    join public.workspace_members peer using (workspace_id)
    where mine.profile_id = auth.uid()
      and peer.profile_id = target_profile
  );
$$;

create or replace function public.is_workspace_profile_member(target_workspace uuid, target_profile uuid)
returns boolean
language sql stable security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace and profile_id = target_profile
  ) and public.is_workspace_member(target_workspace);
$$;

create or replace function public.task_workspace_id(target_task uuid)
returns uuid
language sql stable security definer
set search_path = public
set row_security = off
as $$
  select p.workspace_id
  from public.tasks t
  join public.projects p on p.id = t.project_id
  where t.id = target_task
    and public.is_workspace_member(p.workspace_id);
$$;

-- Ensure policies remain active if a table was partially repaired before.
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks enable row level security;
alter table public.comments enable row level security;
alter table public.attachments enable row level security;
alter table public.activity_events enable row level security;
alter table public.notifications enable row level security;
alter table public.workspace_invitations enable row level security;

drop policy if exists "Profiles visible to workspace peers" on public.profiles;
create policy "Profiles visible to workspace peers" on public.profiles
for select using (id = auth.uid() or public.are_workspace_peers(id));

-- Remove stale/custom policies too: permissive policies are ORed together, so a
-- differently named recursive policy would otherwise survive this repair.
do $$
declare policy_name text;
begin
  for policy_name in
    select polname from pg_policy
    where polrelid = 'public.workspace_members'::regclass
  loop
    execute format('drop policy %I on public.workspace_members', policy_name);
  end loop;
end
$$;

drop policy if exists "Members read membership" on public.workspace_members;
create policy "Members read membership" on public.workspace_members
for select using (public.is_workspace_member(workspace_id));

drop policy if exists "Admins manage membership" on public.workspace_members;
create policy "Admins manage membership" on public.workspace_members
for all
using (role <> 'owner' and public.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]))
with check (
  public.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[])
  and role <> 'owner'
  and (role <> 'admin' or public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[]))
);

drop policy if exists "Admins delete projects" on public.projects;
create policy "Admins delete projects" on public.projects
for delete using (public.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]));

drop policy if exists "Members manage project team" on public.project_members;
create policy "Members manage project team" on public.project_members
for all
using (exists (
  select 1 from public.projects p
  where p.id = project_id and public.is_workspace_member(p.workspace_id)
))
with check (exists (
  select 1 from public.projects p
  where p.id = project_id
    and public.is_workspace_member(p.workspace_id)
    and public.is_workspace_profile_member(p.workspace_id, profile_id)
));

drop policy if exists "Workspace members create tasks" on public.tasks;
create policy "Workspace members create tasks" on public.tasks
for insert with check (
  public.is_workspace_member((select workspace_id from public.projects where id = project_id))
  and created_by = auth.uid()
  and (assignee_id is null or public.is_workspace_profile_member(
    (select workspace_id from public.projects where id = project_id), assignee_id
  ))
);

drop policy if exists "Workspace members update tasks" on public.tasks;
create policy "Workspace members update tasks" on public.tasks
for update
using (public.is_workspace_member(public.task_workspace_id(id)))
with check (
  public.is_workspace_member((select workspace_id from public.projects where id = project_id))
  and (assignee_id is null or public.is_workspace_profile_member(
    (select workspace_id from public.projects where id = project_id), assignee_id
  ))
);

drop policy if exists "Uploader deletes task files" on storage.objects;
drop policy if exists "Workspace members delete task files" on storage.objects;
create policy "Workspace members delete task files" on storage.objects
for delete using (
  bucket_id = 'task-attachments'
  and exists (
    select 1 from public.tasks t
    where t.id::text = (storage.foldername(name))[1]
      and public.is_workspace_member(public.task_workspace_id(t.id))
  )
);

drop policy if exists "Admins manage workspace invitations" on public.workspace_invitations;
create policy "Admins manage workspace invitations" on public.workspace_invitations
for all
using (public.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]))
with check (
  public.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[])
  and role <> 'owner'
  and (role <> 'admin' or public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[]))
);

create or replace function public.accept_workspace_invitation(invitation_token uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare invite public.workspace_invitations%rowtype; account_email text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select email into account_email from auth.users where id = auth.uid();
  select * into invite
  from public.workspace_invitations
  where token = invitation_token
    and lower(email) = lower(account_email)
    and expires_at > now()
  for update;
  if invite.id is null then raise exception 'Invitation is invalid, expired, or belongs to another account'; end if;
  if invite.role = 'owner' or (invite.role = 'admin' and not exists (
    select 1 from public.workspace_members
    where workspace_id = invite.workspace_id
      and profile_id = invite.invited_by
      and role = 'owner'
  )) then raise exception 'Invitation role is no longer authorized'; end if;
  insert into public.workspace_members(workspace_id, profile_id, role)
  values (invite.workspace_id, auth.uid(), invite.role)
  on conflict (workspace_id, profile_id) do update set role = excluded.role;
  update public.workspace_invitations set accepted_at = now() where id = invite.id;
  return invite.workspace_id;
end;
$$;
revoke all on function public.accept_workspace_invitation(uuid) from public;
grant execute on function public.accept_workspace_invitation(uuid) to authenticated;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.workspaces,
  public.workspace_members, public.projects, public.project_members,
  public.tasks, public.comments, public.attachments, public.activity_events,
  public.notifications, public.workspace_invitations to authenticated;
revoke all on function public.is_workspace_member(uuid) from public, anon;
revoke all on function public.has_workspace_role(uuid, public.workspace_role[]) from public, anon;
revoke all on function public.are_workspace_peers(uuid) from public, anon;
revoke all on function public.is_workspace_profile_member(uuid, uuid) from public, anon;
revoke all on function public.task_workspace_id(uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.has_workspace_role(uuid, public.workspace_role[]) to authenticated;
grant execute on function public.are_workspace_peers(uuid) to authenticated;
grant execute on function public.is_workspace_profile_member(uuid, uuid) to authenticated;
grant execute on function public.task_workspace_id(uuid) to authenticated;

commit;
