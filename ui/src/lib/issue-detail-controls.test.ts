// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  isIssueDetailReadOnly,
  shouldShowIssueDetailEditableStatus,
  shouldShowIssueDetailHideAction,
} from "./issue-detail-controls";

describe("issue detail control guards", () => {
  it("treats orchestrated meeting roots as read-only in the generic issue plane", () => {
    const issue = { meetingMode: "orchestrated" as const };

    expect(isIssueDetailReadOnly(issue)).toBe(true);
    expect(shouldShowIssueDetailEditableStatus(issue)).toBe(false);
    expect(shouldShowIssueDetailHideAction(issue)).toBe(false);
  });

  it("keeps generic controls available for non-orchestrated issues", () => {
    const issue = { meetingMode: "legacy_thread" as const };

    expect(isIssueDetailReadOnly(issue)).toBe(false);
    expect(shouldShowIssueDetailEditableStatus(issue)).toBe(true);
    expect(shouldShowIssueDetailHideAction(issue)).toBe(true);
  });
});
