import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { databaseError, errorResponse, isUuid, readJsonObject, requireAuthenticatedClient } from "@/lib/api/request";

const demoProjects = [
  { name: "Website Redesign", description: "Redesign a business website and improve its user experience.", status: "Active", color: "#7968e8", startOffset: -12, dueOffset: 35 },
  { name: "Student Management System", description: "Build a system to manage student records and attendance.", status: "Planning", color: "#33a98a", startOffset: 3, dueOffset: 62 },
  { name: "E-Commerce Platform", description: "Develop an online shopping platform.", status: "Active", color: "#e6954b", startOffset: -19, dueOffset: 48 },
  { name: "Data Analytics Dashboard", description: "Build a dashboard for analysing business data.", status: "On Hold", color: "#5889d6", startOffset: -7, dueOffset: 28 },
  { name: "Mobile App Development", description: "Plan and develop a mobile application.", status: "Planning", color: "#d87891", startOffset: 8, dueOffset: 78 },
] as const;

function deterministicProjectId(workspaceId: string, name: string) {
  const namespace = Buffer.from(workspaceId.replaceAll("-", ""), "hex");
  const digest = createHash("sha1").update(namespace).update(`orbit-demo:${name}`).digest();
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
  if (!body || !isUuid(body.workspace_id)) return errorResponse("A valid workspace_id is required.");

  const { supabase, user, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase || !user) return errorResponse("Unauthorized", 401);

  const { data: membership, error: membershipError } = await supabase.from("workspace_members")
    .select("role").eq("workspace_id", body.workspace_id).eq("profile_id", user.id).maybeSingle();
  if (membershipError) return databaseError(membershipError);
  if (!membership) return errorResponse("You do not have access to this workspace.", 403);

  const { data: existing, error: existingError } = await supabase.from("projects")
    .select("id,name").eq("workspace_id", body.workspace_id);
  if (existingError) return databaseError(existingError);

  const created: { id: string; name: string }[] = [];
  const skipped: string[] = [];
  const existingNames = new Set((existing ?? []).map((project) => project.name.trim().toLocaleLowerCase()));
  const existingIds = new Set((existing ?? []).map((project) => project.id));

  for (const project of demoProjects) {
    const id = deterministicProjectId(body.workspace_id, project.name);
    if (existingIds.has(id) || existingNames.has(project.name.toLocaleLowerCase())) {
      skipped.push(project.name);
      continue;
    }

    const { data, error } = await supabase.from("projects").insert({
      id,
      workspace_id: body.workspace_id,
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
    existingIds.add(data.id);
    existingNames.add(data.name.toLocaleLowerCase());
  }

  return NextResponse.json({ created, skipped });
}
