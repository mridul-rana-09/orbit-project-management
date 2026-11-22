import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { databaseError, errorResponse, isUuid, readJsonObject, requireAuthenticatedClient } from "@/lib/api/request";

const demoProjects = [
  { name: "E-Commerce Website Development", description: "Build a responsive online storefront with a product catalog, checkout, and inventory validation.", status: "Active", color: "#e6954b", startOffset: -19, dueOffset: 48 },
  { name: "Student Management System", description: "Create a system for student profiles, course enrollment, attendance, and term reporting.", status: "Active", color: "#33a98a", startOffset: -12, dueOffset: 55 },
  { name: "AI-Powered Task Tracker", description: "Develop a task tracker that ranks work and suggests deadlines from project context.", status: "Planning", color: "#7968e8", startOffset: -4, dueOffset: 68 },
] as const;

const demoTasks = {
  "E-Commerce Website Development": [
    { title: "Approve storefront scope and success criteria", description: "Confirm the launch audience, supported payment methods, and checkout completion target.", status: "Completed", priority: "High", dueOffset: -3 },
    { title: "Build the mobile-first product catalog", description: "Implement category browsing, product details, and responsive layouts for phone and desktop.", status: "In Progress", priority: "High", dueOffset: 5 },
    { title: "Implement cart and checkout flow", description: "Allow shoppers to review quantities, calculate totals, and complete a test purchase.", status: "To Do", priority: "High", dueOffset: 12 },
    { title: "Connect inventory and stock validation", description: "Prevent checkout of unavailable items and show current stock status on product pages.", status: "To Do", priority: "Medium", dueOffset: 19 },
    { title: "Run accessibility and purchase-flow QA", description: "Test keyboard navigation, form errors, and the full checkout flow before the release review.", status: "To Do", priority: "Low", dueOffset: 27 },
  ],
  "Student Management System": [
    { title: "Map student, course, and enrollment records", description: "Document the core student and course fields and how enrollments relate to each term.", status: "Completed", priority: "Medium", dueOffset: -4 },
    { title: "Build enrollment and profile screens", description: "Create staff-facing forms to review student details and register students for courses.", status: "In Progress", priority: "High", dueOffset: 4 },
    { title: "Add the attendance recording workflow", description: "Let instructors record attendance by course session and review recent entries.", status: "To Do", priority: "Medium", dueOffset: 11 },
    { title: "Create role-aware staff access", description: "Limit student record and enrollment actions to the appropriate staff roles.", status: "To Do", priority: "High", dueOffset: 18 },
    { title: "Validate term reports and exports", description: "Check enrollment and attendance totals in the term summary and its downloadable export.", status: "To Do", priority: "Low", dueOffset: 25 },
  ],
  "AI-Powered Task Tracker": [
    { title: "Define task categories and ranking rules", description: "Agree on the task signals and explainable rules used to rank work for a project.", status: "Completed", priority: "Medium", dueOffset: -2 },
    { title: "Implement the task scoring service", description: "Calculate a suggested ordering from priority, due date, and task status.", status: "In Progress", priority: "High", dueOffset: 6 },
    { title: "Build smart deadline recommendations", description: "Show a suggested due date with a clear explanation and keep the user's chosen date intact.", status: "To Do", priority: "Medium", dueOffset: 13 },
    { title: "Add the project activity summary panel", description: "Present a concise view of recent task changes and upcoming work.", status: "To Do", priority: "Low", dueOffset: 21 },
    { title: "Evaluate suggestions against sample tasks", description: "Review ranking and deadline suggestions across a small set of varied task scenarios.", status: "To Do", priority: "Medium", dueOffset: 29 },
  ],
} as const;

function deterministicProjectId(workspaceId: string, name: string) {
  const namespace = Buffer.from(workspaceId.replaceAll("-", ""), "hex");
  const digest = createHash("sha1").update(namespace).update(`orbit-demo:${name}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function deterministicTaskId(projectId: string, title: string) {
  const namespace = Buffer.from(projectId.replaceAll("-", ""), "hex");
  const digest = createHash("sha1").update(namespace).update(`orbit-demo-task:${title}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function relativeDate(offset: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  const workspaceId = body?.workspace_id;
  if (!body || typeof workspaceId !== "string" || !isUuid(workspaceId)) return errorResponse("A valid workspace_id is required.");

  const { supabase, user, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase || !user) return errorResponse("Unauthorized", 401);

  const { data: membership, error: membershipError } = await supabase.from("workspace_members")
    .select("role").eq("workspace_id", workspaceId).eq("profile_id", user.id).maybeSingle();
  if (membershipError) return databaseError(membershipError);
  if (!membership) return errorResponse("You do not have access to this workspace.", 403);
  if (membership.role !== "owner" && membership.role !== "admin") {
    return errorResponse("Only workspace owners and admins can add demo projects.", 403);
  }

  const { data: workspaceMembers, error: workspaceMembersError } = await supabase.from("workspace_members")
    .select("profile_id,role").eq("workspace_id", workspaceId);
  if (workspaceMembersError) return databaseError(workspaceMembersError);
  const memberIds = (workspaceMembers ?? [])
    .filter((member) => member.role !== "guest")
    .map((member) => member.profile_id);
  const assigneeIds = memberIds.length ? memberIds : [user.id];

  const { data: existing, error: existingError } = await supabase.from("projects")
    .select("id,name").eq("workspace_id", workspaceId);
  if (existingError) return databaseError(existingError);

  const created: { id: string; name: string }[] = [];
  const skipped: string[] = [];
  const existingProjectIdsByName = new Map((existing ?? []).map((project) => [project.name.trim().toLocaleLowerCase(), project.id]));
  const projectIdsByName = new Map((existing ?? [])
    .filter((project) => project.id === deterministicProjectId(workspaceId, project.name))
    .map((project) => [project.name.trim().toLocaleLowerCase(), project.id]));

  for (const project of demoProjects) {
    const existingProjectId = existingProjectIdsByName.get(project.name.toLocaleLowerCase());
    if (existingProjectId) {
      skipped.push(project.name);
      if (existingProjectId === deterministicProjectId(workspaceId, project.name)) {
        projectIdsByName.set(project.name.toLocaleLowerCase(), existingProjectId);
      }
      continue;
    }
    const id = deterministicProjectId(workspaceId, project.name);

    const { data, error } = await supabase.from("projects").insert({
      id,
      workspace_id: workspaceId,
      name: project.name,
      description: project.description,
      status: project.status,
      color: project.color,
      start_date: relativeDate(project.startOffset),
      due_date: relativeDate(project.dueOffset),
      created_by: user.id,
    }).select("id,workspace_id,name,description,status,color,start_date,due_date,created_at,tasks(id,status),project_members(profile_id,role)").single();

    if (error?.code === "23505") {
      const { data: concurrentInsert, error: lookupError } = await supabase.from("projects")
        .select("id").eq("id", id).maybeSingle();
      if (lookupError) {
        return NextResponse.json({ error: lookupError.message, created, skipped }, { status: 400 });
      }
      if (concurrentInsert) {
        skipped.push(project.name);
        projectIdsByName.set(project.name.toLocaleLowerCase(), id);
        continue;
      }
    }
    if (error) {
      return NextResponse.json({
        error: `Could not create "${project.name}": ${error.message}`,
        created,
        skipped,
      }, { status: error.code === "42501" ? 403 : 400 });
    }

    created.push(data);
    projectIdsByName.set(data.name.toLocaleLowerCase(), data.id);
  }

  const demoProjectIds = demoProjects
    .map((project) => projectIdsByName.get(project.name.toLocaleLowerCase()))
    .filter((id): id is string => Boolean(id));
  const projectMembersToAdd = demoProjectIds.flatMap((projectId) => memberIds.map((profileId) => ({
    project_id: projectId,
    profile_id: profileId,
    role: "member",
  })));
  let membersAdded = 0;
  if (projectMembersToAdd.length) {
    const { data: insertedMembers, error: insertMembersError } = await supabase.from("project_members")
      .upsert(projectMembersToAdd, { onConflict: "project_id,profile_id", ignoreDuplicates: true })
      .select("profile_id");
    if (insertMembersError) {
      return NextResponse.json({ error: insertMembersError.message, created, skipped, tasksCreated: 0, teammatesAdded: 0, tasksAssigned: 0 }, { status: 400 });
    }
    membersAdded = new Set((insertedMembers ?? []).map((member) => member.profile_id)).size;
  }

  const { data: existingTasks, error: tasksError } = await supabase.from("tasks")
    .select("id,project_id,title,assignee_id").in("project_id", demoProjectIds);
  if (tasksError) return NextResponse.json({ error: tasksError.message, created, skipped, tasksCreated: 0, teammatesAdded: membersAdded, tasksAssigned: 0 }, { status: 400 });

  const existingTasksByKey = new Map((existingTasks ?? []).map((task) => [
    `${task.project_id}:${task.title.trim().toLocaleLowerCase()}`,
    task,
  ]));
  const tasksToCreate = demoProjects.flatMap((project) => {
    const projectId = projectIdsByName.get(project.name.toLocaleLowerCase());
    if (!projectId) return [];
    return demoTasks[project.name].flatMap((task, index) => {
      const taskKey = `${projectId}:${task.title.toLocaleLowerCase()}`;
      if (existingTasksByKey.has(taskKey)) return [];
      return [{
        id: deterministicTaskId(projectId, task.title),
        project_id: projectId,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        assignee_id: assigneeIds[index % assigneeIds.length],
        due_date: relativeDate(task.dueOffset),
        position: index,
        created_by: user.id,
      }];
    });
  });

  let tasksCreated = 0;
  let tasksAssigned = 0;
  for (const project of demoProjects) {
    const projectId = projectIdsByName.get(project.name.toLocaleLowerCase());
    if (!projectId) continue;
    for (const [index, task] of demoTasks[project.name].entries()) {
      const existingTask = existingTasksByKey.get(`${projectId}:${task.title.toLocaleLowerCase()}`);
      if (!existingTask || existingTask.id !== deterministicTaskId(projectId, task.title) || existingTask.assignee_id) continue;
      const { data: assignedTask, error: assignTaskError } = await supabase.from("tasks")
        .update({ assignee_id: assigneeIds[index % assigneeIds.length] })
        .eq("id", existingTask.id)
        .is("assignee_id", null)
        .select("id")
        .maybeSingle();
      if (assignTaskError) {
        return NextResponse.json({ error: assignTaskError.message, created, skipped, tasksCreated, teammatesAdded: membersAdded, tasksAssigned }, { status: 400 });
      }
      if (assignedTask) tasksAssigned += 1;
    }
  }

  if (tasksToCreate.length) {
    const { data: insertedTasks, error: insertTasksError } = await supabase.from("tasks")
      .upsert(tasksToCreate, { onConflict: "id", ignoreDuplicates: true })
      .select("id");
    if (insertTasksError) {
      return NextResponse.json({ error: insertTasksError.message, created, skipped, tasksCreated, teammatesAdded: membersAdded, tasksAssigned }, { status: 400 });
    }
    tasksCreated = insertedTasks?.length ?? 0;
    tasksAssigned += tasksCreated;
  }

  return NextResponse.json({ created, skipped, tasksCreated, teammatesAdded: membersAdded, tasksAssigned });
}
