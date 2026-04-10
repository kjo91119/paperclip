function normalizeText(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/[_~>#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sentenceSummary(value: string): string {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  const sentence = normalized.match(/^(.+?[.!?])(\s|$)/);
  if (sentence) return sentence[1].trim();
  return normalized;
}

function splitMarkdownSections(markdown: string): Record<string, string> {
  const sections: Record<string, string[]> = {
    objective: [],
    context: [],
    deliverable: [],
    constraints: [],
  };
  let current: keyof typeof sections | null = null;
  const headingMap: Array<[keyof typeof sections, RegExp]> = [
    ["objective", /^(objective|goal|목표|핵심 질문)$/i],
    ["context", /^(context|background|배경|상황|참고)$/i],
    ["deliverable", /^(deliverable|decision|output|해야 할 일|결정할 것|산출물|요청 사항)$/i],
    ["constraints", /^(constraints?|guardrails?|주의할 점|제약|가드레일)$/i],
  ];

  for (const rawLine of markdown.replace(/\r/g, "").split("\n")) {
    const line = rawLine.trim();
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading) {
      const matched = headingMap.find(([, pattern]) => pattern.test(heading[1]));
      current = matched?.[0] ?? null;
      continue;
    }
    if (current) {
      sections[current].push(rawLine);
    }
  }

  return Object.fromEntries(
    Object.entries(sections).map(([key, lines]) => [key, lines.join("\n").trim()]),
  ) as Record<string, string>;
}

function toBulletLines(sectionText: string, limit = 4): string[] {
  const lines = sectionText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, ""))
    .map(normalizeText)
    .filter(Boolean);

  return lines.slice(0, limit);
}

function toFirstParagraph(markdown: string): string {
  const firstParagraph = markdown
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((block) => normalizeText(block))
    .find(Boolean);
  return firstParagraph ?? "";
}

export function splitTitlePrefix(title: string): { badge: string | null; cleanTitle: string } {
  const match = title.match(/^\[([^\]]+)\]\s*(.+)$/);
  if (!match) return { badge: null, cleanTitle: title };
  return {
    badge: match[1].trim() || null,
    cleanTitle: match[2].trim() || title,
  };
}

export interface IssueBrief {
  badge: string | null;
  cleanTitle: string;
  summary: string;
  decisionItems: string[];
  backgroundItems: string[];
  constraintItems: string[];
  hasStructuredSections: boolean;
}

export interface CommentBrief {
  summary: string;
  statusItems: string[];
  actionItems: string[];
  noteItems: string[];
  showSummaryCard: boolean;
}

export function buildIssueBrief(input: { title: string; description?: string | null }): IssueBrief {
  const description = input.description?.trim() ?? "";
  const sections = splitMarkdownSections(description);
  const summary = normalizeText(sections.objective || toFirstParagraph(description));
  const decisionItems = toBulletLines(sections.deliverable);
  const backgroundItems = toBulletLines(sections.context);
  const constraintItems = toBulletLines(sections.constraints);
  const { badge, cleanTitle } = splitTitlePrefix(input.title);

  return {
    badge,
    cleanTitle,
    summary,
    decisionItems,
    backgroundItems,
    constraintItems,
    hasStructuredSections: Boolean(
      sections.objective || sections.context || sections.deliverable || sections.constraints,
    ),
  };
}

function extractLabeledLine(markdown: string, labels: string[]): string[] {
  const found: string[] = [];
  const pattern = new RegExp(`^(${labels.join("|")})\\s*[:：]?\\s*(.+)$`, "i");
  for (const rawLine of markdown.replace(/\r/g, "").split("\n")) {
    const line = rawLine.trim();
    const match = line.match(pattern);
    if (!match) continue;
    const value = normalizeText(match[2] ?? "");
    if (value) found.push(value);
  }
  return found;
}

export function buildCommentBrief(body: string): CommentBrief {
  const sections = splitMarkdownSections(body);
  const summaryCandidates = [
    ...extractLabeledLine(body, ["쉽게 말하면", "한줄 결론", "결론", "summary", "decision", "approval", "status"]),
  ];
  const summary = summaryCandidates[0]
    || normalizeText(sections.objective)
    || sentenceSummary(body);
  const statusItems = [
    ...extractLabeledLine(body, ["지금 상태", "현재 상태", "status"]),
    ...toBulletLines(sections.context, 3),
  ].filter(Boolean).slice(0, 3);
  const actionItems = [
    ...extractLabeledLine(body, ["다음 할 일", "해야 할 일", "next", "action"]),
    ...toBulletLines(sections.deliverable, 3),
  ].filter(Boolean).slice(0, 3);
  const noteItems = [
    ...extractLabeledLine(body, ["추가 메모", "참고", "note", "update"]),
    ...toBulletLines(sections.constraints, 3),
  ].filter(Boolean).slice(0, 3);
  const normalizedBody = normalizeText(body);
  const showSummaryCard = normalizedBody.length > 220
    || actionItems.length > 0
    || statusItems.length > 0
    || noteItems.length > 0;

  return {
    summary,
    statusItems,
    actionItems,
    noteItems,
    showSummaryCard,
  };
}
