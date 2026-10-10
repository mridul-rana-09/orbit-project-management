import { NextResponse } from "next/server";
import { databaseError, errorResponse, isUuid, readJsonObject, requireAuthenticatedClient } from "@/lib/api/request";

export async function GET() {
  const { supabase, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase) return errorResponse("Supabase is not configured", 503);
  const { data, error } = await supabase.from("notifications")
    .select("*, actor:profiles!notifications_actor_id_fkey(full_name), task:tasks(title)")
    .order("created_at", { ascending: false }).limit(50);
  if (error) return databaseError(error);
  return NextResponse.json(data);
}

export async function PATCH(request: Request) {
  const body = await readJsonObject(request);
  if (!body || (body.id !== undefined && !isUuid(body.id))) return errorResponse("Notification id must be a valid UUID.");
  const { supabase, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase) return errorResponse("Supabase is not configured", 503);
  const update = supabase.from("notifications").update({ read_at: new Date().toISOString() });
  const { data, error } = body.id
    ? await update.eq("id", body.id as string).select("id").maybeSingle()
    : await update.is("read_at", null).select("id");
  if (error) return databaseError(error);
  if (body.id && !data) return errorResponse("Notification not found or access was denied.", 404);
  return NextResponse.json({ success: true });
}
