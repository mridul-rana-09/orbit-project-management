import { NextResponse } from "next/server";
import { databaseError, errorResponse, isText, readJsonObject, requireAuthenticatedClient } from "@/lib/api/request";

export async function GET() {
  const { supabase, response } = await requireAuthenticatedClient();
  if (response || !supabase) return response;
  const { data, error } = await supabase.from("workspace_members").select("role, workspace:workspaces(id,name,slug,owner_id)").order("joined_at");
  if (error) return databaseError(error);
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body || !isText(body.name, 1, 100)) return errorResponse("Workspace name must be between 1 and 100 characters.");
  const { supabase, response } = await requireAuthenticatedClient();
  if (response || !supabase) return response;
  const { data, error } = await supabase.rpc("create_workspace", { workspace_name: body.name.trim() });
  if (error) return databaseError(error);
  return NextResponse.json({ id: data }, { status: 201 });
}
