import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import { createMeetingSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { accessService, issueService, meetingService } from "../services/index.js";
import { forbidden } from "../errors.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";

export function meetingRoutes(db: Db) {
  const router = Router();
  const meetings = meetingService(db);
  const issues = issueService(db);
  const access = accessService(db);

  async function normalizeIssueIdentifier(rawId: string): Promise<string> {
    if (/^[A-Z]+-\d+$/i.test(rawId)) {
      const issue = await issues.getByIdentifier(rawId);
      if (issue) return issue.id;
    }
    return rawId;
  }

  async function assertBoardTaskAssign(req: Request, companyId: string) {
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
    const allowed = await access.canUser(companyId, req.actor.userId, "tasks:assign");
    if (!allowed) throw forbidden("Missing permission: tasks:assign");
  }

  router.get("/meetings/:meetingId", async (req, res) => {
    const dto = await meetings.getById(req.params.meetingId);
    if (!dto) {
      res.status(404).json({ error: "Meeting not found" });
      return;
    }
    assertCompanyAccess(req, dto.meeting.companyId);
    res.json(dto);
  });

  router.get("/issues/:issueId/meeting", async (req, res) => {
    const normalizedIssueId = await normalizeIssueIdentifier(req.params.issueId);
    const issue = await issues.getById(normalizedIssueId);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);
    const dto = await meetings.getByIssueId(normalizedIssueId);
    if (!dto) {
      res.status(404).json({ error: "Meeting not found" });
      return;
    }
    res.json(dto);
  });

  router.post("/companies/:companyId/meetings", validate(createMeetingSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertBoardTaskAssign(req, companyId);
    res.status(501).json({ error: "Meeting creation is not implemented in Phase A" });
  });

  const controlHandlers = [
    "/issues/:issueId/meeting/start",
    "/issues/:issueId/meeting/continue",
    "/issues/:issueId/meeting/pause",
    "/issues/:issueId/meeting/resume",
    "/issues/:issueId/meeting/cancel",
    "/issues/:issueId/meeting/summary",
    "/issues/:issueId/meeting/participants/:agentId/remind",
    "/issues/:issueId/meeting/participants/:agentId/skip",
  ] as const;

  for (const path of controlHandlers) {
    router.post(path, async (req, res) => {
      const normalizedIssueId = await normalizeIssueIdentifier(req.params.issueId);
      const issue = await issues.getById(normalizedIssueId);
      if (!issue) {
        res.status(404).json({ error: "Issue not found" });
        return;
      }
      await assertBoardTaskAssign(req, issue.companyId);
      res.status(501).json({ error: "Meeting control is not implemented in Phase A" });
    });
  }

  return router;
}
