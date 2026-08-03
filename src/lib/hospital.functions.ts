import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const dischargeStatus = z.enum([
  "waiting_cleaning",
  "en_route",
  "in_progress",
  "paused",
  "maintenance",
  "completed",
  "completed_with_issues",
]);

const staffStatus = z.enum([
  "available",
  "assigned",
  "coffee_break",
  "lunch_break",
  "dinner_break",
  "off_duty",
]);

const createDischargeSchema = z.object({
  bed_number: z.string().trim().min(1).max(60),
  unit: z.string().trim().min(1).max(120),
  status: dischargeStatus,
  priority: z.boolean(),
  pause_reason: z.string().trim().max(500).nullable().optional(),
  assigned_staff_id: z.string().uuid().nullable().optional(),
});

const updateDischargeSchema = z.object({
  id: z.string().uuid(),
  patch: z
    .object({
      status: dischargeStatus.optional(),
      priority: z.boolean().optional(),
      pause_reason: z.string().trim().max(500).nullable().optional(),
      assigned_staff_id: z.string().uuid().nullable().optional(),
    })
    .strict(),
});

export const createDischarge = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => createDischargeSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("discharges").insert({
      ...data,
      pause_reason: data.pause_reason ?? null,
      assigned_staff_id: data.assigned_staff_id ?? null,
      status_updated_at: new Date().toISOString(),
    });
    if (error) {
      console.error("[createDischarge]", error);
      throw new Error("Não foi possível salvar a alta.");
    }
    return { ok: true as const };
  });

export const updateDischarge = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => updateDischargeSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("discharges")
      .update({ ...data.patch, status_updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) {
      console.error("[updateDischarge]", error);
      throw new Error("Não foi possível atualizar o leito.");
    }
    return { ok: true as const };
  });

export const createStaff = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ name: z.string().trim().min(1).max(120) }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("staff").insert({ name: data.name });
    if (error) {
      console.error("[createStaff]", error);
      throw new Error("Não foi possível adicionar o colaborador.");
    }
    return { ok: true as const };
  });

export const updateStaffStatus = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({ id: z.string().uuid(), status: staffStatus }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("staff")
      .update({ status: data.status, status_updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) {
      console.error("[updateStaffStatus]", error);
      throw new Error("Não foi possível atualizar o colaborador.");
    }
    return { ok: true as const };
  });
