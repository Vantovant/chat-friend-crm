import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildScanResponse, collectWarnings, scanGroup, writeAuditLog } from "./index.ts";

function createMockSvc(options?: {
  memberUpsertError?: string | null;
  reportInsertError?: string | null;
  auditInsertError?: string | null;
}) {
  return {
    from(table: string) {
      if (table === "contacts") {
        return {
          select() {
            return {
              in() {
                return {
                  eq: async () => ({
                    data: [{ id: "contact-1", name: "Norah", phone_normalized: "+27123456789", do_not_contact: false }],
                  }),
                };
              },
            };
          },
        };
      }

      if (table === "conversations") {
        return {
          select() {
            return {
              in: async () => ({
                data: [{ contact_id: "contact-1", last_inbound_at: new Date().toISOString() }],
              }),
            };
          },
        };
      }

      if (table === "whatsapp_group_members") {
        return {
          upsert: async () => ({
            error: options?.memberUpsertError ? { message: options.memberUpsertError } : null,
          }),
        };
      }

      if (table === "group_health_reports") {
        return {
          insert: async () => ({
            error: options?.reportInsertError ? { message: options.reportInsertError } : null,
          }),
        };
      }

      if (table === "group_admin_actions") {
        return {
          insert: async () => ({
            error: options?.auditInsertError ? { message: options.auditInsertError } : null,
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

Deno.test("happy path response remains ok with visible persistence success flags", async () => {
  const svc = createMockSvc();
  const report = await scanGroup(
    svc,
    { id: "group-1", group_jid: "120363032143899916@g.us", group_name: "APLGO" },
    async () => ({ phones: ["27123456789"], source: "per_group_endpoint", sample_keys: [], http_status: 200 }),
  );

  if ("error" in report) throw new Error("Expected report, got error");

  const warnings = collectWarnings([report]);
  const audit = await writeAuditLog(svc, { group_jid: report.group_jid }, [report], "user-1", new Date().toISOString(), [report], warnings);
  const response = buildScanResponse({
    reports: [report],
    warnings: audit.warnings,
    audit_logged: audit.audit_logged,
    audit_error: audit.audit_error,
  });

  assertEquals(report.persistence.members_persisted, true);
  assertEquals(report.persistence.report_persisted, true);
  assertEquals(report.persistence.members_error, null);
  assertEquals(report.persistence.report_error, null);
  assertEquals(response.ok, true);
  assertEquals(response.partial, false);
  assertEquals(response.audit_logged, true);
  assertEquals(response.warnings, []);
});

Deno.test("forced member/report/audit failures become visible in warnings and response", async () => {
  const svc = createMockSvc({
    memberUpsertError: "forced member upsert failure",
    reportInsertError: "forced report insert failure",
    auditInsertError: "forced audit insert failure",
  });

  const report = await scanGroup(
    svc,
    { id: "group-1", group_jid: "120363032143899916@g.us", group_name: "APLGO" },
    async () => ({ phones: ["27123456789"], source: "per_group_endpoint", sample_keys: [], http_status: 200 }),
  );

  if ("error" in report) throw new Error("Expected report, got error");

  const warnings = collectWarnings([report]);
  const audit = await writeAuditLog(svc, { group_jid: report.group_jid }, [report], "user-1", new Date().toISOString(), [report], warnings);
  const response = buildScanResponse({
    reports: [report],
    warnings: audit.warnings,
    audit_logged: audit.audit_logged,
    audit_error: audit.audit_error,
  });

  assertEquals(report.ok, false);
  assertEquals(report.persistence.members_persisted, false);
  assertEquals(report.persistence.report_persisted, false);
  assertStringIncludes(report.persistence.members_error ?? "", "forced member upsert failure");
  assertStringIncludes(report.persistence.report_error ?? "", "forced report insert failure");
  assertEquals(response.ok, false);
  assertEquals(response.partial, true);
  assertEquals(response.audit_logged, false);
  assertStringIncludes(response.audit_error ?? "", "forced audit insert failure");
  assertEquals(response.warnings.length, 3);
  assertStringIncludes(response.warnings[0], "members_upsert_failed");
  assertStringIncludes(response.warnings[1], "report_insert_failed");
  assertStringIncludes(response.warnings[2], "audit_insert_failed");
});
