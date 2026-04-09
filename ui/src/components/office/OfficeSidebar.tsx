import { Link } from "@/lib/router";
import type { ActivityEvent, Issue } from "@paperclipai/shared";
import { ArrowUpRight, Bot, CircleDot, Clock3, PauseCircle } from "lucide-react";
import { relativeTime, issueUrl, agentUrl, formatStatusLabel } from "../../lib/utils";
import type { OfficeAgentState } from "../../pages/officeViewModel";
import { humanizeActivity } from "./OfficeScene";

export function OfficeSidebar({
  activeAgents,
  focusIssues,
  recentEvents,
}: {
  activeAgents: OfficeAgentState[];
  focusIssues: Issue[];
  recentEvents: ActivityEvent[];
}) {
  return (
    <aside className="space-y-4">
      <InfoCard
        title="라이브 런"
        icon={Clock3}
        description={activeAgents.length > 0 ? "지금 움직이는 에이전트" : "현재는 모두 자리에서 대기 중입니다."}
      >
        <div className="space-y-3">
          {activeAgents.length > 0 ? (
            activeAgents.map((state) => (
              <Link
                key={state.agent.id}
                to={agentUrl(state.agent)}
                className="flex items-start justify-between gap-3 rounded-2xl border border-border bg-background/70 px-3 py-3 transition-colors hover:bg-accent/60"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                    <span className="text-sm font-medium text-foreground">{state.agent.name}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                      {state.agent.role}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {state.issue ? state.issue.title : "실행 중인 작업 감시"}
                  </p>
                </div>
                <ArrowUpRight className="mt-0.5 h-4 w-4 text-muted-foreground" />
              </Link>
            ))
          ) : (
            <p className="rounded-2xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              지금은 라이브 런이 없습니다. 다음 heartbeat가 시작되면 여기에서 바로 움직임이 보입니다.
            </p>
          )}
        </div>
      </InfoCard>

      <InfoCard
        title="작업 큐"
        icon={CircleDot}
        description="현재 오피스에서 눈에 띄는 작업"
      >
        <div className="space-y-3">
          {focusIssues.length > 0 ? (
            focusIssues.map((issue) => (
              <Link
                key={issue.id}
                to={issueUrl(issue)}
                className="block rounded-2xl border border-border bg-background/70 px-3 py-3 transition-colors hover:bg-accent/60"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-medium text-foreground line-clamp-2">{issue.title}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground shrink-0">
                    {formatStatusLabel(issue.status)}
                  </span>
                </div>
                {issue.identifier ? (
                  <p className="mt-1 text-[10px] text-muted-foreground/50 font-mono">{issue.identifier}</p>
                ) : null}
              </Link>
            ))
          ) : (
            <p className="rounded-2xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              열려 있는 작업이 없습니다.
            </p>
          )}
        </div>
      </InfoCard>

      <InfoCard
        title="최근 활동"
        icon={PauseCircle}
        description="오피스에 방금 반영된 변화"
      >
        <div className="space-y-3">
          {recentEvents.length > 0 ? (
            recentEvents.map((event) => (
              <ActivitySnippet key={event.id} event={event} />
            ))
          ) : (
            <p className="rounded-2xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              최근 활동이 아직 없습니다.
            </p>
          )}
        </div>
      </InfoCard>
    </aside>
  );
}

function InfoCard({
  title,
  icon: Icon,
  description,
  children,
}: {
  title: string;
  icon: typeof Bot;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-border bg-card px-4 py-4 shadow-[0_18px_40px_rgba(0,0,0,0.08)]">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-2xl border border-border bg-muted/40 p-2.5 text-muted-foreground">
          <Icon className="h-[18px] w-[18px]" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ActivitySnippet({ event }: { event: ActivityEvent }) {
  return (
    <div className="rounded-2xl border border-border bg-background/70 px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {event.entityType}
        </span>
        <span className="text-xs text-muted-foreground">{relativeTime(event.createdAt)}</span>
      </div>
      <p className="mt-2 text-sm font-medium text-foreground">{humanizeActivity(event)}</p>
    </div>
  );
}
