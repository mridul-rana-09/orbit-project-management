import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export type JsonObject = Record<string, unknown>;

export async function requireAuthenticatedClient() {
  const supabase = await createClient();
  if (!supabase) {
    return { supabase: null, user: null, response: NextResponse.json({ error: "Supabase is not configured" }, { status: 503 }) };
  }

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { supabase: null, user: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  return { supabase, user: data.user, response: null };
}

export async function readJsonObject(request: Request): Promise<JsonObject | null> {
  try {
    const value: unknown = await request.json();
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
  } catch {
    return null;
  }
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isText(value: unknown, min = 0, max = 5000): value is string {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max;
}

export function isOptionalText(value: unknown, max = 5000): value is string | null | undefined {
  return value === undefined || value === null || isText(value, 0, max);
}

export function isEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function isIsoDateOrNull(value: unknown): value is string | null | undefined {
  if (value === undefined || value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isOneOf<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === "string" && choices.includes(value as T);
}

export function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function databaseError(error: { message: string; code?: string }) {
  return errorResponse(error.message, error.code === "42501" ? 403 : 400);
}
