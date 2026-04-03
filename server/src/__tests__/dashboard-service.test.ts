import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  approvals,
  budgetIncidents,
  budgetPolicies,
  companies,
  createDb,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { dashboardService } from "../services/dashboard.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres dashboard service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("dashboardService.summary approval counts", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-dashboard-service-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(budgetIncidents);
    await db.delete(approvals);
    await db.delete(budgetPolicies);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("counts actionable approvals once while keeping budget approvals as a subset", async () => {
    const companyId = randomUUID();
    const policyId = randomUUID();
    const budgetApprovalId = randomUUID();
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    const now = new Date();
    const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
    const windowEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix,
      budgetMonthlyCents: 10_000,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(approvals).values([
      {
        id: randomUUID(),
        companyId,
        type: "hire_agent",
        status: "pending",
        payload: {},
      },
      {
        id: budgetApprovalId,
        companyId,
        type: "budget_override_required",
        status: "revision_requested",
        payload: {},
      },
      {
        id: randomUUID(),
        companyId,
        type: "approve_ceo_strategy",
        status: "approved",
        payload: {},
      },
    ]);

    await db.insert(budgetPolicies).values({
      id: policyId,
      companyId,
      scopeType: "company",
      scopeId: companyId,
      metric: "billed_cents",
      windowKind: "calendar_month_utc",
      amount: 5_000,
      warnPercent: 80,
      hardStopEnabled: true,
      notifyEnabled: true,
      isActive: true,
    });

    await db.insert(budgetIncidents).values({
      companyId,
      policyId,
      scopeType: "company",
      scopeId: companyId,
      metric: "billed_cents",
      windowKind: "calendar_month_utc",
      windowStart,
      windowEnd,
      thresholdType: "hard",
      amountLimit: 5_000,
      amountObserved: 6_100,
      status: "open",
      approvalId: budgetApprovalId,
    });

    const summary = await dashboardService(db).summary(companyId);

    expect(summary.pendingApprovals).toBe(2);
    expect(summary.budgets.pendingApprovals).toBe(1);
  });
});
