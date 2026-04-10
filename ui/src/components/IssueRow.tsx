import type { ReactNode } from "react";
import type { Issue } from "@paperclipai/shared";
import { Link } from "@/lib/router";
import { X } from "lucide-react";
import { createIssueDetailPath } from "../lib/issueDetailBreadcrumb";
import { cn } from "../lib/utils";
import { buildIssueBrief } from "../lib/issue-brief";
import { StatusIcon } from "./StatusIcon";

type UnreadState = "hidden" | "visible" | "fading";

interface IssueRowProps {
  issue: Issue;
  issueLinkState?: unknown;
  selected?: boolean;
  mobileLeading?: ReactNode;
  desktopStatusSlot?: ReactNode;
  desktopMetaBadges?: ReactNode;
  desktopLeadingSpacer?: boolean;
  mobileMeta?: ReactNode;
  desktopTrailing?: ReactNode;
  trailingMeta?: ReactNode;
  unreadState?: UnreadState | null;
  onMarkRead?: () => void;
  onArchive?: () => void;
  archiveDisabled?: boolean;
  className?: string;
}

export function IssueRow({
  issue,
  issueLinkState,
  selected = false,
  mobileLeading,
  desktopStatusSlot,
  desktopMetaBadges,
  desktopLeadingSpacer = false,
  mobileMeta,
  desktopTrailing,
  trailingMeta,
  unreadState = null,
  onMarkRead,
  onArchive,
  archiveDisabled,
  className,
}: IssueRowProps) {
  const issuePathId = issue.identifier ?? issue.id;
  const identifier = issue.issueNumber ?? issue.identifier ?? issue.id.slice(0, 8);
  const showUnreadSlot = unreadState !== null;
  const showUnreadDot = unreadState === "visible" || unreadState === "fading";
  const selectedStatusClass = selected ? "!text-muted-foreground !border-muted-foreground" : undefined;
  const issueBrief = buildIssueBrief({ title: issue.title, description: issue.description });

  return (
    <Link
      to={createIssueDetailPath(issuePathId, issueLinkState)}
      state={issueLinkState}
      data-inbox-issue-link
      className={cn(
        "group flex items-start gap-2 border-b border-border py-2.5 pl-2 pr-3 text-sm no-underline text-inherit transition-colors last:border-b-0 sm:items-center sm:py-2 sm:pl-1",
        selected ? "hover:bg-transparent" : "hover:bg-accent/50",
        className,
      )}
    >
      <span className="shrink-0 pt-px sm:hidden">
        {mobileLeading ?? <StatusIcon status={issue.status} className={selectedStatusClass} />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1 sm:contents">
        <span className="sm:order-1 sm:min-w-0 sm:flex-1">
          <span className="line-clamp-2 text-sm font-medium sm:block sm:truncate sm:line-clamp-none">
            {issueBrief.cleanTitle}
          </span>
          {issueBrief.summary ? (
            <span className="mt-1 line-clamp-1 block text-xs text-muted-foreground">
              {issueBrief.summary}
            </span>
          ) : null}
        </span>
        <span className="flex items-center gap-2 sm:order-2 sm:shrink-0">
          {desktopLeadingSpacer ? (
            <span className="hidden w-3.5 shrink-0 sm:block" />
          ) : null}
          <span className="hidden shrink-0 sm:inline-flex">
            {desktopStatusSlot ?? <StatusIcon status={issue.status} className={selectedStatusClass} />}
          </span>
          {issueBrief.badge ? (
            <span className="inline-flex shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {issueBrief.badge}
            </span>
          ) : null}
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground/35">
            작업 #{identifier}
          </span>
          {desktopMetaBadges}
          {mobileMeta ? (
            <>
              <span className="text-xs text-muted-foreground sm:hidden" aria-hidden="true">
                &middot;
              </span>
              <span className="text-xs text-muted-foreground sm:hidden">{mobileMeta}</span>
            </>
          ) : null}
        </span>
      </span>
      {(desktopTrailing || trailingMeta) ? (
        <span className="ml-auto hidden shrink-0 items-center gap-2 sm:order-3 sm:flex sm:gap-3">
          {desktopTrailing}
          {trailingMeta ? (
            <span className="text-xs text-muted-foreground">{trailingMeta}</span>
          ) : null}
        </span>
      ) : null}
      {showUnreadSlot ? (
        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center self-center">
          {showUnreadDot ? (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onMarkRead?.();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onMarkRead?.();
                }
              }}
              className={cn(
                "inline-flex h-4 w-4 items-center justify-center rounded-full transition-colors",
                selected ? "hover:bg-muted/80" : "hover:bg-blue-500/20",
              )}
              aria-label="Mark as read"
            >
              <span
                className={cn(
                  "block h-2 w-2 rounded-full transition-opacity duration-300",
                  selected ? "bg-muted-foreground/70" : "bg-blue-600 dark:bg-blue-400",
                  unreadState === "fading" ? "opacity-0" : "opacity-100",
                )}
              />
            </button>
          ) : onArchive ? (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onArchive();
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.stopPropagation();
                onArchive();
              }}
              disabled={archiveDisabled}
              className="inline-flex h-4 w-4 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 disabled:pointer-events-none disabled:opacity-30"
              aria-label="Dismiss from inbox"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <span className="inline-flex h-4 w-4" aria-hidden="true" />
          )}
        </span>
      ) : null}
    </Link>
  );
}
