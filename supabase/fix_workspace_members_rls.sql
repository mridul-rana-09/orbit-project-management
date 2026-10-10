-- Run this in the Supabase SQL Editor against the existing project.
-- This is a targeted repair for the infinite recursion in the workspace_members RLS policy.
-- It does not reset or recreate the database and only replaces the recursive policy on workspace_members.

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read membership" ON public.workspace_members;
CREATE POLICY "Members read membership"
ON public.workspace_members
FOR SELECT
USING (
  profile_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.workspace_members AS membership
    WHERE membership.workspace_id = workspace_members.workspace_id
      AND membership.profile_id = auth.uid()
      AND membership.role IN ('owner', 'admin')
  )
);

DROP POLICY IF EXISTS "Admins manage membership" ON public.workspace_members;
CREATE POLICY "Admins manage membership"
ON public.workspace_members
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.workspace_members AS membership
    WHERE membership.workspace_id = workspace_members.workspace_id
      AND membership.profile_id = auth.uid()
      AND membership.role IN ('owner', 'admin')
  )
  AND role <> 'owner'
);

DROP POLICY IF EXISTS "Admins update membership" ON public.workspace_members;
CREATE POLICY "Admins update membership"
ON public.workspace_members
FOR UPDATE
USING (
  profile_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.workspace_members AS membership
    WHERE membership.workspace_id = workspace_members.workspace_id
      AND membership.profile_id = auth.uid()
      AND membership.role IN ('owner', 'admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.workspace_members AS membership
    WHERE membership.workspace_id = workspace_members.workspace_id
      AND membership.profile_id = auth.uid()
      AND membership.role IN ('owner', 'admin')
  )
  AND role <> 'owner'
  AND (
    role <> 'admin'
    OR EXISTS (
      SELECT 1
      FROM public.workspace_members AS owner_membership
      WHERE owner_membership.workspace_id = workspace_members.workspace_id
        AND owner_membership.profile_id = auth.uid()
        AND owner_membership.role = 'owner'
    )
  )
);

DROP POLICY IF EXISTS "Members leave workspace" ON public.workspace_members;
CREATE POLICY "Members leave workspace"
ON public.workspace_members
FOR DELETE
USING (
  profile_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.workspace_members AS membership
    WHERE membership.workspace_id = workspace_members.workspace_id
      AND membership.profile_id = auth.uid()
      AND membership.role IN ('owner', 'admin')
  )
);

-- Optional safety check: confirm the recursive policy is no longer in use.
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'workspace_members'
ORDER BY policyname;
