import axiosInstance from "../lib/axios";

export const sessionApi = {
  createSession: async (data) => {
    const response = await axiosInstance.post("/sessions", data);
    return response.data;
  },

  getActiveSessions: async () => {
    const response = await axiosInstance.get("/sessions/active");
    return response.data;
  },
  getMyRecentSessions: async () => {
    const response = await axiosInstance.get("/sessions/my-recent");
    return response.data;
  },

  getSessionById: async (id) => {
    const response = await axiosInstance.get(`/sessions/${id}`);
    return response.data;
  },

  joinSession: async (id) => {
    const response = await axiosInstance.post(`/sessions/${id}/request-join`);
    return response.data;
  },
  approveJoinRequest: async (id, requesterId) => {
    const response = await axiosInstance.post(`/sessions/${id}/join-requests/${requesterId}/approve`);
    return response.data;
  },
  rejectJoinRequest: async (id, requesterId) => {
    const response = await axiosInstance.post(`/sessions/${id}/join-requests/${requesterId}/reject`);
    return response.data;
  },
  endSession: async (id) => {
    const response = await axiosInstance.post(`/sessions/${id}/end`);
    return response.data;
  },
  updateSessionTools: async (id, data) => {
    const response = await axiosInstance.patch(`/sessions/${id}/tools`, data);
    return response.data;
  },
  connectMeeting: async (id) => {
    const response = await axiosInstance.post(`/meetings/${id}/connect`);
    return response.data;
  },
  disconnectMeeting: async (id) => {
    const response = await axiosInstance.post(`/meetings/${id}/disconnect`);
    return response.data;
  },
  getMeetingEvents: async (id, after = 0) => {
    const response = await axiosInstance.get(`/meetings/${id}/events`, {
      params: { after },
    });
    return response.data;
  },
  sendMeetingSignal: async (id, data) => {
    const response = await axiosInstance.post(`/meetings/${id}/signal`, data);
    return response.data;
  },
  sendMeetingChat: async (id, data) => {
    const response = await axiosInstance.post(`/meetings/${id}/chat`, data);
    return response.data;
  },
  sendMeetingCodeSync: async (id, data) => {
    const response = await axiosInstance.post(`/meetings/${id}/code`, data);
    return response.data;
  },
  sendMeetingActivity: async (id, data) => {
    const response = await axiosInstance.post(`/meetings/${id}/activity`, data);
    return response.data;
  },
};
