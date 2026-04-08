import type { CreateMeeting, MeetingRoomDTO } from "@paperclipai/shared";
import { api } from "./client";

export const meetingsApi = {
  create: (companyId: string, data: CreateMeeting) =>
    api.post<MeetingRoomDTO>(`/companies/${companyId}/meetings`, data),
  get: (meetingId: string) => api.get<MeetingRoomDTO>(`/meetings/${meetingId}`),
  getByIssue: (issueId: string) => api.get<MeetingRoomDTO>(`/issues/${issueId}/meeting`),
  start: (issueId: string) => api.post<MeetingRoomDTO>(`/issues/${issueId}/meeting/start`, {}),
  pause: (issueId: string) => api.post<MeetingRoomDTO>(`/issues/${issueId}/meeting/pause`, {}),
  resume: (issueId: string) => api.post<MeetingRoomDTO>(`/issues/${issueId}/meeting/resume`, {}),
  archive: (issueId: string) =>
    api.post<{ meetingId: string; rootIssueId: string; hiddenAt: string }>(`/issues/${issueId}/meeting/archive`, {}),
  continue: (issueId: string) => api.post<MeetingRoomDTO>(`/issues/${issueId}/meeting/continue`, {}),
  reopenDiscussion: (issueId: string) =>
    api.post<MeetingRoomDTO>(`/issues/${issueId}/meeting/reopen-discussion`, {}),
  summary: (issueId: string, data?: { summaryAgentId?: string | null }) =>
    api.post<MeetingRoomDTO>(`/issues/${issueId}/meeting/summary`, data ?? {}),
  remind: (issueId: string, agentId: string) =>
    api.post<MeetingRoomDTO>(`/issues/${issueId}/meeting/participants/${agentId}/remind`, {}),
  skip: (issueId: string, agentId: string) =>
    api.post<MeetingRoomDTO>(`/issues/${issueId}/meeting/participants/${agentId}/skip`, {}),
};
