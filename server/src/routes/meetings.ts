import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import { createMeetingSchema, requestMeetingSummarySchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { accessService, issueService, meetingService } from "../services/index.js";
import { forbidden } from "../errors.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";

export function meetingRoutes(db: Db) {
  const router = Router();
  const meetings = meetingService(db);
  const issues = issueService(db);
  const access = accessService(db);

  function paramString(value: string | string[] | undefined) {
    return Array.isArray(value) ? value[0] : value;
  }

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
    const actor = getActorInfo(req);
    const created = await meetings.createMeeting({
      companyId,
      ...req.body,
    }, actor);
    res.status(201).json(created);
  });

  async function loadControlledIssue(req: Request) {
    const issueId = paramString(req.params.issueId);
    if (!issueId) return null;
    const normalizedIssueId = await normalizeIssueIdentifier(issueId);
    const issue = await issues.getById(normalizedIssueId);
    if (!issue) return null;
    await assertBoardTaskAssign(req, issue.companyId);
    return { normalizedIssueId, issue };
  }

  router.post("/issues/:issueId/meeting/start", async (req, res) => {
    const loaded = await loadControlledIssue(req);
    if (!loaded) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    const actor = getActorInfo(req);
    const dto = await meetings.startMeetingByIssueId(loaded.normalizedIssueId, actor);
    res.json(dto);
  });

  router.post("/issues/:issueId/meeting/pause", async (req, res) => {
    const loaded = await loadControlledIssue(req);
    if (!loaded) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    const actor = getActorInfo(req);
    const dto = await meetings.pauseMeetingByIssueId(loaded.normalizedIssueId, actor);
    res.json(dto);
  });

  router.post("/issues/:issueId/meeting/resume", async (req, res) => {
    const loaded = await loadControlledIssue(req);
    if (!loaded) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    const actor = getActorInfo(req);
    const dto = await meetings.resumeMeetingByIssueId(loaded.normalizedIssueId, actor);
    res.json(dto);
  });

  router.post("/issues/:issueId/meeting/archive", async (req, res) => {
    const loaded = await loadControlledIssue(req);
    if (!loaded) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    const actor = getActorInfo(req);
    const archived = await meetings.archiveMeetingByIssueId(loaded.normalizedIssueId, actor);
    res.json(archived);
  });

  router.post("/issues/:issueId/meeting/participants/:agentId/remind", async (req, res) => {
    const loaded = await loadControlledIssue(req);
    if (!loaded) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    const actor = getActorInfo(req);
    const agentId = paramString(req.params.agentId);
    if (!agentId) {
      res.status(400).json({ error: "agentId is required" });
      return;
    }
    const dto = await meetings.remindParticipantByIssueId(loaded.normalizedIssueId, agentId, actor);
    res.json(dto);
  });

  router.post("/issues/:issueId/meeting/continue", async (req, res) => {
    const loaded = await loadControlledIssue(req);
    if (!loaded) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    const actor = getActorInfo(req);
    const dto = await meetings.continueMeetingByIssueId(loaded.normalizedIssueId, actor);
    res.json(dto);
  });

  router.post("/issues/:issueId/meeting/participants/:agentId/skip", async (req, res) => {
    const loaded = await loadControlledIssue(req);
    if (!loaded) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    const actor = getActorInfo(req);
    const agentId = paramString(req.params.agentId);
    if (!agentId) {
      res.status(400).json({ error: "agentId is required" });
      return;
    }
    const dto = await meetings.skipParticipantByIssueId(loaded.normalizedIssueId, agentId, actor);
    res.json(dto);
  });

  router.post("/issues/:issueId/meeting/summary", validate(requestMeetingSummarySchema), async (req, res) => {
    const loaded = await loadControlledIssue(req);
    if (!loaded) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    const actor = getActorInfo(req);
    const dto = await meetings.summaryMeetingByIssueId(loaded.normalizedIssueId, req.body, actor);
    res.json(dto);
  });

  const phaseBSkeletonHandlers = [
    "/issues/:issueId/meeting/cancel",
  ] as const;

  for (const path of phaseBSkeletonHandlers) {
    router.post(path, async (req, res) => {
      const loaded = await loadControlledIssue(req);
      if (!loaded) {
        res.status(404).json({ error: "Issue not found" });
        return;
      }
      res.status(501).json({ error: "Meeting cancel is not yet implemented" });
    });
  }

  return router;
}
