import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import type { ActivityEvent, Issue } from "@paperclipai/shared";
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CircleDot,
  Clock3,
  DollarSign,
  PanelsTopLeft,
  PauseCircle,
  ShieldCheck,
} from "lucide-react";
import { activityApi } from "../api/activity";
import { agentsApi } from "../api/agents";
import { dashboardApi } from "../api/dashboard";
import { heartbeatsApi } from "../api/heartbeats";
import { issuesApi } from "../api/issues";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { queryKeys } from "../lib/queryKeys";
import { agentUrl, cn, formatCents, formatStatusLabel, issueUrl, relativeTime } from "../lib/utils";
import {
  deriveOfficeAgentStates,
  resolveOfficeViewGateState,
  type OfficeAgentState,
  type OfficeZoneId,
} from "./officeViewModel";

const ISSUE_STATUS_RANK: Record<string, number> = {
  in_progress: 0,
  blocked: 1,
  in_review: 2,
  todo: 3,
  backlog: 4,
  done: 5,
  cancelled: 6,
};

const ISSUE_TICKET_POSITIONS = [
  { x: 60, y: 12 },
  { x: 70, y: 18 },
  { x: 69, y: 67 },
  { x: 78, y: 73 },
];

const DESK_DECORATIONS = [
  { x: 24, y: 37, label: "Desk A" },
  { x: 34, y: 37, label: "Desk B" },
  { x: 72, y: 37, label: "Desk C" },
  { x: 82, y: 37, label: "Desk D" },
  { x: 24, y: 63, label: "Desk E" },
  { x: 34, y: 63, label: "Desk F" },
  { x: 72, y: 63, label: "Desk G" },
  { x: 82, y: 63, label: "Desk H" },
];

export function OfficeView() {
  const { selectedCompanyId, selectedCompany, companies } = useCompany();
  const { openOnboarding } = useDialog();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    setBreadcrumbs([{ label: "오피스" }]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 850);
    return () => window.clearInterval(timer);
  }, []);

  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
  });

  const issuesQuery = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 12_000,
    refetchIntervalInBackground: true,
  });

  const dashboardQuery = useQuery({
    queryKey: queryKeys.dashboard(selectedCompanyId!),
    queryFn: () => dashboardApi.summary(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 12_000,
    refetchIntervalInBackground: true,
  });

  const liveRunsQuery = useQuery({
    queryKey: queryKeys.liveRuns(selectedCompanyId!),
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 4_000,
    refetchIntervalInBackground: true,
  });

  const activityQuery = useQuery({
    queryKey: queryKeys.activity(selectedCompanyId!),
    queryFn: () => activityApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });

  const agents = agentsQuery.data ?? [];
  const issues = issuesQuery.data ?? [];
  const dashboard = dashboardQuery.data;
  const liveRuns = liveRunsQuery.data ?? [];
  const activity = activityQuery.data ?? [];

  const agentStates = useMemo(
    () => deriveOfficeAgentStates({ agents, issues, liveRuns, nowMs }),
    [agents, issues, liveRuns, nowMs],
  );

  const liveIssueIds = useMemo(
    () => new Set(liveRuns.map((run) => run.issueId).filter((issueId): issueId is string => Boolean(issueId))),
    [liveRuns],
  );

  const focusIssues = useMemo(() => {
    return [...issues]
      .filter((issue) => !issue.hiddenAt && issue.status !== "done" && issue.status !== "cancelled")
      .sort((a, b) => {
        const liveDiff = Number(liveIssueIds.has(b.id)) - Number(liveIssueIds.has(a.id));
        if (liveDiff !== 0) return liveDiff;
        const statusDiff = (ISSUE_STATUS_RANK[a.status] ?? 99) - (ISSUE_STATUS_RANK[b.status] ?? 99);
        if (statusDiff !== 0) return statusDiff;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      })
      .slice(0, 4);
  }, [issues, liveIssueIds]);

  const activeAgents = useMemo(
    () => agentStates.filter((state) => state.liveRun || state.agent.status === "running").slice(0, 6),
    [agentStates],
  );

  const recentEvents = useMemo(() => activity.slice(0, 6), [activity]);
  const error = agentsQuery.error ?? issuesQuery.error ?? dashboardQuery.error ?? liveRunsQuery.error ?? activityQuery.error;
  const gateState = resolveOfficeViewGateState({
    selectedCompanyId,
    companyCount: companies.length,
    isLoading:
      agentsQuery.isLoading ||
      issuesQuery.isLoading ||
      dashboardQuery.isLoading ||
      liveRunsQuery.isLoading,
    hasBlockingError: Boolean(agentsQuery.error) && agentsQuery.data === undefined,
    agentsCount: agents.length,
  });

  if (gateState === "needs_company_onboarding") {
      return (
        <EmptyState
          icon={PanelsTopLeft}
          message="2D 오피스를 시작하려면 첫 회사와 에이전트를 만들어야 합니다."
          action="온보딩 시작"
          onAction={openOnboarding}
        />
      );
  }

  if (gateState === "needs_company_selection") {
    return <EmptyState icon={PanelsTopLeft} message="오피스를 보려면 회사를 선택하세요." />;
  }

  if (gateState === "loading") {
    return <PageSkeleton variant="dashboard" />;
  }

  if (gateState === "error") {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {error instanceof Error ? error.message : "오피스 상태를 불러오지 못했습니다."}
      </div>
    );
  }

  if (gateState === "empty_agents") {
    return (
      <EmptyState
        icon={PanelsTopLeft}
        message="2D 오피스를 채울 에이전트가 아직 없습니다."
        action="에이전트 만들기"
        onAction={() => openOnboarding({ initialStep: 2, companyId: selectedCompanyId! })}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            <PanelsTopLeft className="h-3.5 w-3.5" />
            Live 2D Office
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {selectedCompany?.name ?? "회사"} 오피스
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              기존 Paperclip 데이터를 그대로 사용해, 에이전트가 어디에서 일하고 있는지 2D 공간으로 보여주는 실시간 뷰입니다.
              무거운 3D 대신 상태 변화와 작업 흐름을 한눈에 읽는 데 집중했습니다.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            기본 대시보드
          </Link>
          <Link
            to="/issues"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            이슈 열기
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error instanceof Error ? error.message : "오피스 상태를 불러오지 못했습니다."}
        </div>
      )}

      {dashboard ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <OfficeStatCard
            icon={Bot}
            label="현장 에이전트"
            value={`${agents.length}`}
            detail={`실행 중 ${liveRuns.length}명`}
          />
          <OfficeStatCard
            icon={CircleDot}
            label="열린 작업"
            value={`${dashboard.tasks.open}`}
            detail={`진행 중 ${dashboard.tasks.inProgress}건 · 막힘 ${dashboard.tasks.blocked}건`}
          />
          <OfficeStatCard
            icon={ShieldCheck}
            label="조치 필요 승인"
            value={`${dashboard.pendingApprovals}`}
            detail={dashboard.pendingApprovals > 0 ? "승인 게이트 확인 필요" : "현재 승인 대기 없음"}
          />
          <OfficeStatCard
            icon={DollarSign}
            label="이번 달 비용"
            value={formatCents(dashboard.costs.monthSpendCents)}
            detail={
              dashboard.budgets.activeIncidents > 0
                ? `예산 사고 ${dashboard.budgets.activeIncidents}건`
                : "예산 사고 없음"
            }
          />
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.75fr)_23rem]">
        <section className="overflow-hidden rounded-[30px] border border-border bg-card shadow-[0_24px_80px_rgba(0,0,0,0.18)]">
          <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">스튜디오 플로어</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                라이브 런은 지휘 보드 주변을 순환하고, 검토/승인/복구 상태는 별도 구역으로 이동합니다.
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground sm:hidden">
                좁은 화면에서는 장면을 좌우로 스크롤해 확인하세요.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/80" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
              </span>
              실시간 갱신
            </div>
          </div>

          <div className="p-4">
            <div className="overflow-x-auto pb-2">
              <div className="office-scene relative min-h-[620px] min-w-[760px] overflow-hidden rounded-[28px] border border-white/10 bg-slate-950 text-slate-100 lg:min-w-0">
              <div className="absolute left-1/2 top-[6%] z-10 w-[300px] max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-[22px] border border-cyan-400/20 bg-slate-950/85 p-4 shadow-[0_0_0_1px_rgba(34,211,238,0.08),0_16px_60px_rgba(8,145,178,0.18)] lg:left-[39%] lg:w-[22%] lg:min-w-[220px] lg:max-w-none lg:translate-x-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-cyan-200/70">
                  Command Screen
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <CommandMetric label="Live" value={String(liveRuns.length)} />
                  <CommandMetric label="Open" value={String(dashboard?.tasks.open ?? 0)} />
                  <CommandMetric label="Alerts" value={String(dashboard?.budgets.activeIncidents ?? 0)} />
                </div>
                <div className="mt-3 rounded-2xl border border-cyan-400/15 bg-cyan-400/8 px-3 py-2 text-[11px] text-cyan-50/80">
                  {dashboard?.pendingApprovals
                    ? `승인 게이트에 ${dashboard.pendingApprovals}건이 대기 중입니다.`
                    : "지금은 승인 대기 없이 흐름이 매끈합니다."}
                </div>
              </div>

              <OfficeZoneCard
                title="복구 구역"
                subtitle="일시중지 · 오류"
                className="left-[4%] top-[8%] w-[170px] lg:w-[19%]"
                tone="recovery"
              />
              <OfficeZoneCard
                title="집중 데스크"
                subtitle="일반 작업"
                className="left-[8%] top-[25%] h-[46%] w-[228px] lg:w-[30%]"
                tone="desk"
              />
              <OfficeZoneCard
                title="집중 데스크"
                subtitle="병렬 작업"
                className="right-[8%] top-[25%] h-[46%] w-[228px] lg:w-[30%]"
                tone="desk"
              />
              <OfficeZoneCard
                title="검토 테이블"
                subtitle="리뷰 · 정리"
                className="right-[9%] bottom-[8%] w-[220px] lg:w-[27%]"
                tone="review"
              />
              <OfficeZoneCard
                title="승인 게이트"
                subtitle="조치 필요"
                className="right-[4%] top-[8%] w-[170px] lg:w-[18%]"
                tone="approval"
              />
              <OfficeZoneCard
                title="라운지"
                subtitle="대기 · 준비"
                className="left-[6%] bottom-[8%] w-[190px] lg:w-[24%]"
                tone="lounge"
              />

              {DESK_DECORATIONS.map((desk) => (
                <OfficeDesk key={desk.label} x={desk.x} y={desk.y} label={desk.label} />
              ))}

              {focusIssues.map((issue, index) => (
                <IssueTicket
                  key={issue.id}
                  issue={issue}
                  x={ISSUE_TICKET_POSITIONS[index]?.x ?? 70}
                  y={ISSUE_TICKET_POSITIONS[index]?.y ?? 20}
                  live={liveIssueIds.has(issue.id)}
                />
              ))}

              {dashboard && dashboard.pendingApprovals > 0 ? (
                <div className="absolute right-[7%] top-[18%] z-20 flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-400/14 px-3 py-1.5 text-xs font-medium text-amber-50">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  승인 {dashboard.pendingApprovals}건
                </div>
              ) : null}

              {dashboard && dashboard.budgets.activeIncidents > 0 ? (
                <div className="absolute left-[9%] top-[18%] z-20 flex items-center gap-2 rounded-full border border-red-300/30 bg-red-400/14 px-3 py-1.5 text-xs font-medium text-red-50">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  예산 사고 {dashboard.budgets.activeIncidents}건
                </div>
              ) : null}

              {agentStates.map((state) => (
                <AgentMarker key={state.agent.id} state={state} />
              ))}
            </div>
            </div>
          </div>
        </section>

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
                      <span className="truncate text-sm font-medium text-foreground">
                        {issue.identifier ?? issue.id.slice(0, 8)}
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                        {formatStatusLabel(issue.status)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{issue.title}</p>
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
      </div>
    </div>
  );
}

function OfficeStatCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Bot;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[24px] border border-border bg-card px-4 py-4 shadow-[0_18px_40px_rgba(0,0,0,0.08)]">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
          <div className="text-2xl font-semibold text-foreground">{value}</div>
        </div>
        <div className="rounded-2xl border border-border bg-muted/40 p-2.5 text-muted-foreground">
          <Icon className="h-[18px] w-[18px]" />
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{detail}</p>
    </div>
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
  children: ReactNode;
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

function CommandMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-cyan-400/[0.08] px-2.5 py-2">
      <div className="text-[9px] uppercase tracking-[0.22em] text-cyan-100/60">{label}</div>
      <div className="mt-1 text-lg font-semibold text-cyan-50">{value}</div>
    </div>
  );
}

function OfficeZoneCard({
  title,
  subtitle,
  className,
  tone,
}: {
  title: string;
  subtitle: string;
  className: string;
  tone: "desk" | "approval" | "review" | "recovery" | "lounge";
}) {
  const toneClass =
    tone === "approval" ? "border-amber-300/16 bg-amber-400/[0.06] text-amber-50"
      : tone === "review" ? "border-cyan-300/18 bg-cyan-400/[0.05] text-cyan-50"
      : tone === "recovery" ? "border-red-300/18 bg-red-400/[0.05] text-red-50"
      : tone === "lounge" ? "border-emerald-300/16 bg-emerald-400/[0.05] text-emerald-50"
      : "border-white/10 bg-white/[0.03] text-slate-100";

  return (
    <div className={cn("pointer-events-none absolute rounded-[24px] border px-4 py-3", toneClass, className)}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.24em]">{title}</div>
      <div className="mt-1 text-xs opacity-75">{subtitle}</div>
    </div>
  );
}

function OfficeDesk({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <div
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <div className="rounded-[16px] border border-white/10 bg-slate-900/80 px-3 py-2 shadow-[0_10px_35px_rgba(0,0,0,0.35)]">
        <div className="mx-auto h-4 w-12 rounded-[6px] border border-cyan-400/20 bg-cyan-300/10" />
        <div className="mx-auto mt-1 h-1.5 w-4 rounded-full bg-cyan-100/20" />
        <div className="mt-2 h-3 w-14 rounded-[6px] bg-[#4c3120]" />
      </div>
      <div className="mt-1 text-center font-mono text-[9px] uppercase tracking-[0.22em] text-slate-400/70">
        {label}
      </div>
    </div>
  );
}

function IssueTicket({
  issue,
  x,
  y,
  live,
}: {
  issue: Issue;
  x: number;
  y: number;
  live: boolean;
}) {
  return (
    <Link
      to={issueUrl(issue)}
      className={cn(
        "absolute z-20 w-40 -translate-x-1/2 -translate-y-1/2 rounded-[18px] border px-3 py-2 text-left shadow-[0_18px_44px_rgba(0,0,0,0.28)] transition-transform hover:-translate-y-[55%]",
        live
          ? "border-cyan-300/25 bg-cyan-400/[0.11] text-cyan-50"
          : "border-white/10 bg-slate-900/85 text-slate-100",
      )}
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[10px] font-semibold uppercase tracking-[0.22em]">
          {issue.identifier ?? issue.id.slice(0, 8)}
        </span>
        <span className="rounded-full bg-black/25 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.18em]">
          {formatStatusLabel(issue.status)}
        </span>
      </div>
      <p className="mt-1 line-clamp-2 text-xs leading-relaxed opacity-85">{issue.title}</p>
    </Link>
  );
}

function AgentMarker({ state }: { state: OfficeAgentState }) {
  const zoneTone = markerTone(state.zoneId);

  return (
    <Link
      to={agentUrl(state.agent)}
      className="absolute z-30 block -translate-x-1/2 -translate-y-1/2 transition-all duration-700 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      style={{ left: `${state.position.x}%`, top: `${state.position.y}%` }}
    >
      <div className="flex flex-col items-center gap-2">
        <div
          className={cn(
            "office-agent-sprite relative flex h-16 w-14 items-end justify-center",
            state.motion === "walk" ? "office-agent-walk" : state.motion === "alert" ? "office-agent-alert" : "office-agent-float",
          )}
        >
          <span className={cn("absolute inset-x-3 bottom-1 h-2 rounded-full blur-md", zoneTone.shadow)} />
          <span className={cn("absolute bottom-10 h-4 w-4 rounded-[6px] border", zoneTone.head)} />
          <span className={cn("absolute bottom-2 h-10 w-5 rounded-t-[6px] border", zoneTone.body)} />
          <span className={cn("absolute bottom-8 left-1 h-1.5 w-4 rounded-full", zoneTone.accent)} />
          {state.liveRun ? (
            <span className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-full border border-emerald-300/30 bg-emerald-400/15 text-[10px] text-emerald-50">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300/40" />
              <span className="relative h-2 w-2 rounded-full bg-emerald-300" />
            </span>
          ) : null}
        </div>
        <div className="min-w-[110px] rounded-[16px] border border-white/10 bg-slate-950/88 px-3 py-2 text-center shadow-[0_16px_36px_rgba(0,0,0,0.35)]">
          <div className="truncate text-sm font-semibold text-slate-50">{state.agent.name}</div>
          <div className="mt-1 truncate text-[10px] uppercase tracking-[0.22em] text-slate-400">
            {state.agent.role}
          </div>
          <div className="mt-2 rounded-full bg-white/5 px-2 py-1 text-[10px] text-slate-200">
            {state.issue ? state.issue.title : fallbackZoneLabel(state.zoneId)}
          </div>
        </div>
      </div>
    </Link>
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

function markerTone(zoneId: OfficeZoneId) {
  if (zoneId === "approval") {
    return {
      head: "border-amber-200/60 bg-amber-300/70",
      body: "border-amber-200/60 bg-amber-500/50",
      accent: "bg-amber-100/70",
      shadow: "bg-amber-400/35",
    };
  }

  if (zoneId === "recovery") {
    return {
      head: "border-red-200/60 bg-red-300/70",
      body: "border-red-200/60 bg-red-500/50",
      accent: "bg-red-100/70",
      shadow: "bg-red-400/35",
    };
  }

  if (zoneId === "review") {
    return {
      head: "border-cyan-200/60 bg-cyan-200/75",
      body: "border-cyan-200/60 bg-cyan-500/50",
      accent: "bg-cyan-100/70",
      shadow: "bg-cyan-400/35",
    };
  }

  if (zoneId === "command") {
    return {
      head: "border-emerald-200/60 bg-emerald-200/75",
      body: "border-emerald-200/60 bg-emerald-500/55",
      accent: "bg-emerald-100/70",
      shadow: "bg-emerald-400/35",
    };
  }

  return {
    head: "border-slate-200/60 bg-slate-200/70",
    body: "border-slate-200/60 bg-violet-400/50",
    accent: "bg-slate-100/70",
    shadow: "bg-slate-300/25",
  };
}

function fallbackZoneLabel(zoneId: OfficeZoneId): string {
  if (zoneId === "command") return "지휘 보드 순찰 중";
  if (zoneId === "approval") return "승인 대기 중";
  if (zoneId === "recovery") return "복구 구역 대기";
  if (zoneId === "review") return "검토 테이블 정리";
  if (zoneId === "desks") return "집중 데스크 작업";
  return "다음 작업 준비";
}

function humanizeActivity(event: ActivityEvent): string {
  const entity = event.entityType === "issue" ? "이슈"
    : event.entityType === "agent" ? "에이전트"
    : event.entityType === "approval" ? "승인"
    : "항목";
  const action = event.action.replaceAll("_", " ");
  return `${entity}에서 ${action} 변화가 있었습니다.`;
}
