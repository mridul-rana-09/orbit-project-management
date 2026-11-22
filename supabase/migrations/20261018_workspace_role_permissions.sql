-- Apply this additive migration to an existing Orbit database.
-- Existing rows and role enum values are preserved. The existing "admin" role
-- is presented in Orbit as "Team Leader".

begin;

create or replace function public.can_manage_project(target_project uuid)
returns boolean
language sql stable security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = target_project
      and public.is_workspace_member(p.workspace_id)
      and (
        public.has_workspace_role(p.workspace_id, array['owner', 'admin']::public.workspace_role[])
        or exists (
          select 1 from public.project_members pm
          where pm.project_id = p.id
            and pm.profile_id = auth.uid()
            and pm.role = 'lead'
        )
      )
  );
$$;

create or replace function public.can_read_project(target_project uuid)
returns boolean
language sql stable security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = target_project
      and public.is_workspace_member(p.workspace_id)
      and (
        public.has_workspace_role(p.workspace_id, array['owner', 'admin']::public.workspace_role[])
        or exists (
          select 1 from public.project_members pm
          where pm.project_id = p.id and pm.profile_id = auth.uid()
        )
        or exists (
          select 1 from public.tasks t
          where t.project_id = p.id and t.assignee_id = auth.uid()
        )
      )
  );
$$;

create or replace function public.can_read_task(target_task uuid)
returns boolean
language sql stable security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
    from public.tasks t
    join public.projects p on p.id = t.project_id
    where t.id = target_task
      and public.is_workspace_member(p.workspace_id)
      and (
        public.has_workspace_role(p.workspace_id, array['owner', 'admin']::public.workspace_role[])
        or t.assignee_id = auth.uid()
        or exists (
          select 1 from public.project_members pm
          where pm.project_id = p.id and pm.profile_id = auth.uid()
        )
      )
  );
$$;

create or replace function public.guard_assigned_task_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_project(old.project_id) then
    if old.assignee_id is distinct from auth.uid()
      or row(
        new.id, new.project_id, new.parent_task_id, new.title, new.description,
        new.priority, new.assignee_id, new.created_by, new.due_date,
        new.position, new.completed_at, new.created_at, new.updated_at
      ) is distinct from row(
        old.id, old.project_id, old.parent_task_id, old.title, old.description,
        old.priority, old.assignee_id, old.created_by, old.due_date,
        old.position, old.completed_at, old.created_at, old.updated_at
      )
    then
      raise exception 'Members may only update the status of tasks assigned to them';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_guard_assigned_update on public.tasks;
create trigger tasks_guard_assigned_update
before update on public.tasks
for each row execute function public.guard_assigned_task_update();

revoke all on function public.can_manage_project(uuid) from public, anon;
revoke all on function public.can_read_project(uuid) from public, anon;
revoke all on function public.can_read_task(uuid) from public, anon;
grant execute on function public.can_manage_project(uuid) to authenticated;
grant execute on function public.can_read_project(uuid) to authenticated;
grant execute on function public.can_read_task(uuid) to authenticated;

-- Restrictive policies preserve existing permissive policies while ensuring
-- that none can grant access outside these role and assignment checks.
drop policy if exists "Orbit project read scope" on public.projects;
create policy "Orbit project read scope" on public.projects
as restrictive for select to authenticated
using (public.can_read_project(id));

drop policy if exists "Orbit project insert scope" on public.projects;
create policy "Orbit project insert scope" on public.projects
as restrictive for insert to authenticated
with check (
  created_by = auth.uid()
  and public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
);

drop policy if exists "Orbit project update scope" on public.projects;
create policy "Orbit project update scope" on public.projects
as restrictive for update to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]))
with check (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));

drop policy if exists "Orbit project delete scope" on public.projects;
create policy "Orbit project delete scope" on public.projects
as restrictive for delete to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));

drop policy if exists "Orbit project member read scope" on public.project_members;
create policy "Orbit project member read scope" on public.project_members
as restrictive for select to authenticated
using (public.can_read_project(project_id));

drop policy if exists "Orbit project member insert scope" on public.project_members;
create policy "Orbit project member insert scope" on public.project_members
as restrictive for insert to authenticated
with check (
  public.can_manage_project(project_id)
  and exists (
    select 1 from public.projects p
    where p.id = project_id
      and public.is_workspace_profile_member(p.workspace_id, profile_id)
  )
);

drop policy if exists "Orbit project member update scope" on public.project_members;
create policy "Orbit project member update scope" on public.project_members
as restrictive for update to authenticated
using (public.can_manage_project(project_id))
with check (
  public.can_manage_project(project_id)
  and exists (
    select 1 from public.projects p
    where p.id = project_id
      and public.is_workspace_profile_member(p.workspace_id, profile_id)
  )
);

drop policy if exists "Orbit project member delete scope" on public.project_members;
create policy "Orbit project member delete scope" on public.project_members
as restrictive for delete to authenticated
using (public.can_manage_project(project_id));

drop policy if exists "Orbit task read scope" on public.tasks;
create policy "Orbit task read scope" on public.tasks
as restrictive for select to authenticated
using (public.can_read_task(id));

drop policy if exists "Orbit task insert scope" on public.tasks;
create policy "Orbit task insert scope" on public.tasks
as restrictive for insert to authenticated
with check (
  public.can_manage_project(project_id)
  and created_by = auth.uid()
  and (assignee_id is null or exists (
    select 1 from public.projects p
    where p.id = project_id
      and public.is_workspace_profile_member(p.workspace_id, assignee_id)
  ))
);

drop policy if exists "Orbit task update scope" on public.tasks;
create policy "Orbit task update scope" on public.tasks
as restrictive for update to authenticated
using (public.can_manage_project(project_id) or assignee_id = auth.uid())
with check (public.can_manage_project(project_id) or assignee_id = auth.uid());

drop policy if exists "Orbit task delete scope" on public.tasks;
create policy "Orbit task delete scope" on public.tasks
as restrictive for delete to authenticated
using (public.can_manage_project(project_id));

drop policy if exists "Orbit comment access scope" on public.comments;
create policy "Orbit comment access scope" on public.comments
as restrictive for all to authenticated
using (public.can_read_task(task_id))
with check (public.can_read_task(task_id));

drop policy if exists "Orbit attachment read scope" on public.attachments;
create policy "Orbit attachment read scope" on public.attachments
as restrictive for select to authenticated
using (public.can_read_task(task_id));

drop policy if exists "Orbit attachment insert scope" on public.attachments;
create policy "Orbit attachment insert scope" on public.attachments
as restrictive for insert to authenticated
with check (public.can_read_task(task_id) and uploaded_by = auth.uid());

drop policy if exists "Orbit attachment delete scope" on public.attachments;
create policy "Orbit attachment delete scope" on public.attachments
as restrictive for delete to authenticated
using (public.can_read_task(task_id) and (uploaded_by = auth.uid() or public.can_manage_project(
  (select t.project_id from public.tasks t where t.id = task_id)
)));

drop policy if exists "Orbit activity read scope" on public.activity_events;
create policy "Orbit activity read scope" on public.activity_events
as restrictive for select to authenticated
using (
  public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
  or (
    project_id is not null
    and public.can_read_project(project_id)
    and (task_id is null or public.can_read_task(task_id))
  )
);

drop policy if exists "Orbit membership insert scope" on public.workspace_members;
create policy "Orbit membership insert scope" on public.workspace_members
as restrictive for insert to authenticated
with check (
  role <> 'owner'
  and public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
  and (role <> 'admin' or public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[]))
);

drop policy if exists "Orbit membership update scope" on public.workspace_members;
create policy "Orbit membership update scope" on public.workspace_members
as restrictive for update to authenticated
using (
  role <> 'owner'
  and (role <> 'admin' or public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[]))
  and public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
)
with check (
  role <> 'owner'
  and public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
  and (role <> 'admin' or public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[]))
);

drop policy if exists "Orbit membership delete scope" on public.workspace_members;
create policy "Orbit membership delete scope" on public.workspace_members
as restrictive for delete to authenticated
using (
  role <> 'owner'
  and (role <> 'admin' or public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[]))
  and public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
);

drop policy if exists "Orbit invitation access scope" on public.workspace_invitations;
create policy "Orbit invitation access scope" on public.workspace_invitations
as restrictive for all to authenticated
using (
  public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
  and (role <> 'admin' or public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[]))
)
with check (
  role <> 'owner'
  and public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
  and (role <> 'admin' or public.has_workspace_role(workspace_id, array['owner']::public.workspace_role[]))
);

drop policy if exists "Orbit task file read scope" on storage.objects;
create policy "Orbit task file read scope" on storage.objects
as restrictive for select to authenticated
using (
  bucket_id <> 'task-attachments'
  or exists (
    select 1 from public.tasks t
    where t.id::text = (storage.foldername(name))[1]
      and public.can_read_task(t.id)
  )
);

drop policy if exists "Orbit task file insert scope" on storage.objects;
create policy "Orbit task file insert scope" on storage.objects
as restrictive for insert to authenticated
with check (
  bucket_id <> 'task-attachments'
  or exists (
    select 1 from public.tasks t
    where t.id::text = (storage.foldername(name))[1]
      and public.can_read_task(t.id)
  )
);

drop policy if exists "Orbit task file delete scope" on storage.objects;
create policy "Orbit task file delete scope" on storage.objects
as restrictive for delete to authenticated
using (
  bucket_id <> 'task-attachments'
  or exists (
    select 1 from public.tasks t
    where t.id::text = (storage.foldername(name))[1]
      and public.can_read_task(t.id)
      and (t.assignee_id = auth.uid() or public.can_manage_project(t.project_id))
  )
);

create or replace function public.accept_workspace_invitation(invitation_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invite public.workspace_invitations%rowtype;
  account_email text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select email into account_email from auth.users where id = auth.uid();
  select * into invite
  from public.workspace_invitations
  where token = invitation_token
    and lower(email) = lower(account_email)
    and expires_at > now()
    and accepted_at is null
  for update;
  if invite.id is null then raise exception 'Invitation is invalid, expired, or already accepted'; end if;
  if invite.role = 'owner' or (invite.role = 'admin' and not exists (
    select 1 from public.workspace_members
    where workspace_id = invite.workspace_id
      and profile_id = invite.invited_by
      and role = 'owner'
  )) then raise exception 'Invitation role is no longer authorized'; end if;
  insert into public.workspace_members(workspace_id, profile_id, role)
  values (invite.workspace_id, auth.uid(), invite.role)
  on conflict (workspace_id, profile_id) do nothing;
  update public.workspace_invitations set accepted_at = now() where id = invite.id;
  return invite.workspace_id;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_workspace uuid;
begin
  insert into public.profiles(id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  );

  if exists (
    select 1 from public.workspace_invitations
    where token::text = new.raw_user_meta_data->>'orbit_invitation_token'
      and lower(email) = lower(new.email)
      and accepted_at is null
      and expires_at > now()
  ) then
    return new;
  end if;

  insert into public.workspaces(name, slug, owner_id)
  values (
    coalesce(new.raw_user_meta_data->>'workspace_name', 'My workspace'),
    'workspace-' || replace(new.id::text, '-', ''),
    new.id
  )
  returning id into new_workspace;
  insert into public.workspace_members(workspace_id, profile_id, role)
  values (new_workspace, new.id, 'owner');
  insert into public.projects(workspace_id, name, description, status, created_by)
  values (new_workspace, 'Getting started', 'Your first project. Add tasks and invite your team when you are ready.', 'Active', new.id);
  return new;
end;
$$;

commit;
