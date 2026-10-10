import { NextResponse } from "next/server";
import { databaseError, errorResponse, isUuid, requireAuthenticatedClient } from "@/lib/api/request";

export async function GET(request: Request) {
  const taskId = new URL(request.url).searchParams.get("task_id");
  if (!isUuid(taskId)) return errorResponse("A valid task_id is required.");
  const { supabase, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase) return errorResponse("Supabase is not configured", 503);
  const { data, error } = await supabase.from("attachments")
    .select("id,file_name,mime_type,size_bytes,storage_path,created_at")
    .eq("task_id", taskId).order("created_at", { ascending: false });
  if (error) return databaseError(error);
  const files = await Promise.all(data.map(async file => {
    const { data: signed, error: signError } = await supabase.storage.from("task-attachments").createSignedUrl(file.storage_path, 10 * 60);
    return { ...file, url: signError ? null : signed.signedUrl };
  }));
  return NextResponse.json(files);
}
