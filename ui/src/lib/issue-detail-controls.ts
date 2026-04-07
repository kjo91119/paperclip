import type { Issue } from "@paperclipai/shared";

type IssueDetailIssueMode = Pick<Issue, "meetingMode">;

export function isIssueDetailReadOnly(issue: IssueDetailIssueMode): boolean {
  return issue.meetingMode === "orchestrated";
}

export function shouldShowIssueDetailEditableStatus(issue: IssueDetailIssueMode): boolean {
  return !isIssueDetailReadOnly(issue);
}

export function shouldShowIssueDetailHideAction(issue: IssueDetailIssueMode): boolean {
  return !isIssueDetailReadOnly(issue);
}
