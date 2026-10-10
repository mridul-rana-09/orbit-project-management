-- Orbit Project Management: run in Supabase SQL Editor.
create extension if not exists pgcrypto;

create type public.workspace_role as enum ('owner','admin','member','guest');
create type public.project_status as enum ('Planning','Active','On Hold','Completed','Archived');
create type public.task_status as enum ('Backlog','To Do','In Progress','In Review','Completed');
create type public.task_priority as enum ('Low','Medium','High','Critical');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'New member',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role public.workspace_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key(workspace_id, profile_id)
);
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text not null default '',
  status public.project_status not null default 'Planning',
  color text not null default '#7968e8',
  start_date date,
  due_date date,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check(role in ('lead','member','viewer')),
  added_at timestamptz not null default now(),
  primary key(project_id, profile_id)
);
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_task_id uuid references public.tasks(id) on delete set null,
  title text not null,
  description text not null default '',
  status public.task_status not null default 'To Do',
  priority public.task_priority not null default 'Medium',
  assignee_id uuid references public.profiles(id) on delete set null,
  created_by uuid not null default auth.uid() references public.profiles(id),
  due_date date,
  position numeric not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles(id),
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  uploaded_by uuid not null default auth.uid() references public.profiles(id),
  storage_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);
create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  project_id uuid references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  task_id uuid references public.tasks(id) on delete cascade,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role public.workspace_role not null default 'member',
  invited_by uuid not null references public.profiles(id) on delete cascade,
  token uuid not null default gen_random_uuid() unique,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique(workspace_id,email)
);

create index tasks_project_status_position on public.tasks(project_id,status,position);
create index tasks_assignee_due on public.tasks(assignee_id,due_date);
create index projects_workspace_status on public.projects(workspace_id,status);
create index activity_workspace_created on public.activity_events(workspace_id,created_at desc);
create index notifications_recipient_unread on public.notifications(recipient_id,created_at desc) where read_at is null;

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean language sql stable security definer set search_path=public set row_security=off as $$
 select exists(select 1 from public.workspace_members where workspace_id=target_workspace and profile_id=auth.uid());
$$;
create or replace function public.has_workspace_role(target_workspace uuid, target_roles public.workspace_role[])
returns boolean language sql stable security definer set search_path=public set row_security=off as $$
 select exists(select 1 from public.workspace_members where workspace_id=target_workspace and profile_id=auth.uid() and role=any(target_roles));
$$;
create or replace function public.are_workspace_peers(target_profile uuid)
returns boolean language sql stable security definer set search_path=public set row_security=off as $$
 select exists(
  select 1 from public.workspace_members mine
  join public.workspace_members peer using(workspace_id)
  where mine.profile_id=auth.uid() and peer.profile_id=target_profile
 );
$$;
create or replace function public.is_workspace_profile_member(target_workspace uuid, target_profile uuid)
returns boolean language sql stable security definer set search_path=public set row_security=off as $$
 select exists(select 1 from public.workspace_members where workspace_id=target_workspace and profile_id=target_profile);
$$;
create or replace function public.create_workspace(workspace_name text)
returns uuid language plpgsql security definer set search_path=public as $$
declare new_workspace uuid; new_slug text;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 new_slug := 'workspace-'||replace(gen_random_uuid()::text,'-','');
 insert into public.workspaces(name,slug,owner_id) values(trim(workspace_name),new_slug,auth.uid()) returning id into new_workspace;
 insert into public.workspace_members(workspace_id,profile_id,role) values(new_workspace,auth.uid(),'owner');
 insert into public.projects(workspace_id,name,description,status,created_by) values(new_workspace,'Getting started','Your first project.','Active',auth.uid());
 return new_workspace;
end $$;
revoke all on function public.create_workspace(text) from public;
grant execute on function public.create_workspace(text) to authenticated;
create or replace function public.accept_workspace_invitation(invitation_token uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare invite public.workspace_invitations%rowtype; account_email text;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select email into account_email from auth.users where id=auth.uid();
 select * into invite from public.workspace_invitations where token=invitation_token and lower(email)=lower(account_email) and expires_at>now() for update;
 if invite.id is null then raise exception 'Invitation is invalid, expired, or belongs to another account'; end if;
 if invite.role='owner' or (invite.role='admin' and not exists(
  select 1 from public.workspace_members
  where workspace_id=invite.workspace_id and profile_id=invite.invited_by and role='owner'
 )) then raise exception 'Invitation role is no longer authorized'; end if;
 insert into public.workspace_members(workspace_id,profile_id,role) values(invite.workspace_id,auth.uid(),invite.role)
 on conflict(workspace_id,profile_id) do update set role=excluded.role;
 update public.workspace_invitations set accepted_at=now() where id=invite.id;
 return invite.workspace_id;
end $$;
revoke all on function public.accept_workspace_invitation(uuid) from public;
grant execute on function public.accept_workspace_invitation(uuid) to authenticated;
create or replace function public.task_workspace_id(target_task uuid)
returns uuid language sql stable security definer set search_path=public set row_security=off as $$
 select p.workspace_id from public.tasks t join public.projects p on p.id=t.project_id where t.id=target_task;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
declare new_workspace uuid;
begin
 insert into public.profiles(id,full_name) values(new.id,coalesce(new.raw_user_meta_data->>'full_name',split_part(new.email,'@',1)));
 insert into public.workspaces(name,slug,owner_id) values(coalesce(new.raw_user_meta_data->>'workspace_name','My workspace'), 'workspace-'||replace(new.id::text,'-',''),new.id) returning id into new_workspace;
 insert into public.workspace_members(workspace_id,profile_id,role) values(new_workspace,new.id,'owner');
 insert into public.projects(workspace_id,name,description,status,created_by)
 values(new_workspace,'Getting started','Your first project. Add tasks and invite your team when you are ready.','Active',new.id);
 return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

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

create policy "Profiles visible to workspace peers" on public.profiles for select using (
 id=auth.uid() or public.are_workspace_peers(id)
);
create policy "Users update own profile" on public.profiles for update using(id=auth.uid()) with check(id=auth.uid());
create policy "Members read workspaces" on public.workspaces for select using(public.is_workspace_member(id));
create policy "Owner updates workspace" on public.workspaces for update using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy "Members read membership" on public.workspace_members for select using(public.is_workspace_member(workspace_id));
create policy "Admins manage membership" on public.workspace_members for all
 using(role <> 'owner' and public.has_workspace_role(workspace_id,array['owner','admin']::public.workspace_role[]))
 with check(
  public.has_workspace_role(workspace_id,array['owner','admin']::public.workspace_role[])
  and role <> 'owner'
  and (role <> 'admin' or public.has_workspace_role(workspace_id,array['owner']::public.workspace_role[]))
 );
create policy "Members read projects" on public.projects for select using(public.is_workspace_member(workspace_id));
create policy "Members create projects" on public.projects for insert with check(public.is_workspace_member(workspace_id) and created_by=auth.uid());
create policy "Members update projects" on public.projects for update using(public.is_workspace_member(workspace_id)) with check(public.is_workspace_member(workspace_id));
create policy "Admins delete projects" on public.projects for delete using(public.has_workspace_role(workspace_id,array['owner','admin']::public.workspace_role[]));
create policy "Members read project team" on public.project_members for select using(exists(select 1 from public.projects p where p.id=project_id and public.is_workspace_member(p.workspace_id)));
create policy "Members manage project team" on public.project_members for all
 using(exists(select 1 from public.projects p where p.id=project_id and public.is_workspace_member(p.workspace_id)))
 with check(exists(select 1 from public.projects p where p.id=project_id and public.is_workspace_member(p.workspace_id) and public.is_workspace_profile_member(p.workspace_id,profile_id)));
create policy "Workspace members read tasks" on public.tasks for select using(public.is_workspace_member(public.task_workspace_id(id)));
create policy "Workspace members create tasks" on public.tasks for insert with check(
 public.is_workspace_member((select workspace_id from public.projects where id=project_id))
 and created_by=auth.uid()
 and (assignee_id is null or public.is_workspace_profile_member((select workspace_id from public.projects where id=project_id),assignee_id))
);
create policy "Workspace members update tasks" on public.tasks for update
 using(public.is_workspace_member(public.task_workspace_id(id)))
 with check(
  public.is_workspace_member((select workspace_id from public.projects where id=project_id))
  and (assignee_id is null or public.is_workspace_profile_member((select workspace_id from public.projects where id=project_id),assignee_id))
 );
create policy "Workspace members delete tasks" on public.tasks for delete using(public.is_workspace_member(public.task_workspace_id(id)));
create policy "Workspace members read comments" on public.comments for select using(public.is_workspace_member(public.task_workspace_id(task_id)));
create policy "Members create comments" on public.comments for insert with check(public.is_workspace_member(public.task_workspace_id(task_id)) and author_id=auth.uid());
create policy "Authors update comments" on public.comments for update using(author_id=auth.uid()) with check(author_id=auth.uid());
create policy "Authors delete comments" on public.comments for delete using(author_id=auth.uid());
create policy "Workspace members read attachments" on public.attachments for select using(public.is_workspace_member(public.task_workspace_id(task_id)));
create policy "Members upload attachments" on public.attachments for insert with check(public.is_workspace_member(public.task_workspace_id(task_id)) and uploaded_by=auth.uid());
create policy "Uploader deletes attachment" on public.attachments for delete using(uploaded_by=auth.uid());
create policy "Members read activity" on public.activity_events for select using(public.is_workspace_member(workspace_id));
create policy "Members log activity" on public.activity_events for insert with check(public.is_workspace_member(workspace_id) and actor_id=auth.uid());
create policy "Users read own notifications" on public.notifications for select using(recipient_id=auth.uid());
create policy "Users update own notifications" on public.notifications for update using(recipient_id=auth.uid()) with check(recipient_id=auth.uid());
create policy "Admins manage workspace invitations" on public.workspace_invitations for all
 using(public.has_workspace_role(workspace_id,array['owner','admin']::public.workspace_role[]))
 with check(
  public.has_workspace_role(workspace_id,array['owner','admin']::public.workspace_role[])
  and role <> 'owner'
  and (role <> 'admin' or public.has_workspace_role(workspace_id,array['owner']::public.workspace_role[]))
 );

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger workspaces_set_updated_at before update on public.workspaces for each row execute function public.set_updated_at();
create trigger projects_set_updated_at before update on public.projects for each row execute function public.set_updated_at();
create trigger tasks_set_updated_at before update on public.tasks for each row execute function public.set_updated_at();
create trigger comments_set_updated_at before update on public.comments for each row execute function public.set_updated_at();
create or replace function public.set_task_completed_at()
returns trigger language plpgsql as $$
begin
 if new.status='Completed' then new.completed_at=coalesce(new.completed_at,now()); else new.completed_at=null; end if;
 return new;
end $$;
create trigger tasks_set_completed_at before insert or update of status on public.tasks for each row execute function public.set_task_completed_at();

create or replace function public.log_project_activity()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.activity_events(workspace_id,actor_id,project_id,action,details)
 values(new.workspace_id,auth.uid(),new.id,case when tg_op='INSERT' then 'project_created' else 'project_updated' end,jsonb_build_object('name',new.name,'status',new.status));
 return new;
end $$;
create trigger project_activity_after_write after insert or update on public.projects for each row execute function public.log_project_activity();

create or replace function public.log_task_activity()
returns trigger language plpgsql security definer set search_path=public as $$
declare target_workspace uuid; event_action text;
begin
 select workspace_id into target_workspace from public.projects where id=new.project_id;
 event_action := case when tg_op='INSERT' then 'task_created' when old.status is distinct from new.status then 'task_status_changed' else 'task_updated' end;
 insert into public.activity_events(workspace_id,actor_id,project_id,task_id,action,details)
 values(target_workspace,auth.uid(),new.project_id,new.id,event_action,jsonb_build_object('title',new.title,'status',new.status,'priority',new.priority));
 if new.assignee_id is not null and new.assignee_id is distinct from auth.uid() and (tg_op='INSERT' or old.assignee_id is distinct from new.assignee_id) then
  insert into public.notifications(recipient_id,actor_id,task_id,message) values(new.assignee_id,auth.uid(),new.id,'You were assigned: '||new.title);
 end if;
 return new;
end $$;
create trigger task_activity_after_write after insert or update on public.tasks for each row execute function public.log_task_activity();
create or replace function public.log_comment_activity()
returns trigger language plpgsql security definer set search_path=public as $$
declare target_workspace uuid; target_project uuid; target_assignee uuid; target_title text;
begin
 select p.workspace_id,p.id,t.assignee_id,t.title into target_workspace,target_project,target_assignee,target_title
 from public.tasks t join public.projects p on p.id=t.project_id where t.id=new.task_id;
 insert into public.activity_events(workspace_id,actor_id,project_id,task_id,action,details)
 values(target_workspace,new.author_id,target_project,new.task_id,'comment_added',jsonb_build_object('preview',left(new.body,160)));
 if target_assignee is not null and target_assignee<>new.author_id then
  insert into public.notifications(recipient_id,actor_id,task_id,message) values(target_assignee,new.author_id,new.task_id,'New comment on: '||target_title);
 end if;
 return new;
end $$;
create trigger comment_activity_after_insert after insert on public.comments for each row execute function public.log_comment_activity();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('task-attachments','task-attachments',false,26214400,array['image/*','application/pdf','text/plain','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict(id) do nothing;
create policy "Workspace members download task files" on storage.objects for select using(bucket_id='task-attachments' and exists(select 1 from public.tasks t where t.id::text=(storage.foldername(name))[1] and public.is_workspace_member(public.task_workspace_id(t.id))));
create policy "Workspace members upload task files" on storage.objects for insert with check(bucket_id='task-attachments' and auth.uid() is not null and exists(select 1 from public.tasks t where t.id::text=(storage.foldername(name))[1] and public.is_workspace_member(public.task_workspace_id(t.id))));
create policy "Workspace members delete task files" on storage.objects for delete using(
 bucket_id='task-attachments'
 and exists(select 1 from public.tasks t where t.id::text=(storage.foldername(name))[1] and public.is_workspace_member(public.task_workspace_id(t.id)))
);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.workspaces, public.workspace_members,
 public.projects, public.project_members, public.tasks, public.comments, public.attachments,
 public.activity_events, public.notifications, public.workspace_invitations to authenticated;
revoke all on function public.is_workspace_member(uuid) from public, anon;
revoke all on function public.has_workspace_role(uuid,public.workspace_role[]) from public, anon;
revoke all on function public.are_workspace_peers(uuid) from public, anon;
revoke all on function public.is_workspace_profile_member(uuid,uuid) from public, anon;
revoke all on function public.task_workspace_id(uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.has_workspace_role(uuid,public.workspace_role[]) to authenticated;
grant execute on function public.are_workspace_peers(uuid) to authenticated;
grant execute on function public.is_workspace_profile_member(uuid,uuid) to authenticated;
grant execute on function public.task_workspace_id(uuid) to authenticated;

do $$ begin
 alter publication supabase_realtime add table public.tasks;
exception when duplicate_object then null; when duplicate_table then null; end $$;
do $$ begin
 alter publication supabase_realtime add table public.comments;
exception when duplicate_object then null; when duplicate_table then null; end $$;
do $$ begin
 alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; when duplicate_table then null; end $$;
do $$ begin
 alter publication supabase_realtime add table public.projects;
exception when duplicate_object then null; when duplicate_table then null; end $$;
do $$ begin
 alter publication supabase_realtime add table public.workspace_members;
exception when duplicate_object then null; when duplicate_table then null; end $$;
do $$ begin
 alter publication supabase_realtime add table public.activity_events;
exception when duplicate_object then null; when duplicate_table then null; end $$;
