import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useAuth, useUser } from "@clerk/react";
import {
  ArrowLeftIcon,
  Link2Icon,
  LoaderIcon,
  MessageSquareIcon,
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
  SendIcon,
  Share2Icon,
  VideoIcon,
  VideoOffIcon,
  UsersIcon,
} from "lucide-react";
import toast from "react-hot-toast";
import Navbar from "../components/Navbar";
import { sessionApi } from "../api/sessions";
import { PROBLEMS } from "../data/problems";
import { executeCode } from "../lib/piston";
import CodeEditorPanel from "../components/CodeEditorPanel";
import OutputPanel from "../components/OutputPanel";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
  ],
};

function SessionPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useUser();
  const { getToken } = useAuth();

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const editorRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const sessionPollTimeoutRef = useRef(null);
  const streamReconnectTimeoutRef = useRef(null);
  const codeSyncTimeoutRef = useRef(null);
  const typingStopTimeoutRef = useRef(null);
  const cursorSyncTimeoutRef = useRef(null);
  const remoteCursorHideTimeoutRef = useRef(null);
  const lastEventIdRef = useRef(0);
  const stoppedRef = useRef(false);
  const pendingCandidatesRef = useRef([]);
  const offerInFlightRef = useRef(false);
  const connectedRef = useRef(false);
  const meetingActivationInProgressRef = useRef(false);
  const suppressOutgoingCodeSyncRef = useRef(false);
  const approvalToastShownRef = useRef(false);
  const typingActiveRef = useRef(false);
  const lastCodeSyncPayloadRef = useRef({ language: "", code: "" });
  const workspaceSeedRef = useRef("");
  const presenceSnapshotRef = useRef([]);
  const localAttentionInactiveRef = useRef(false);
  const lastRemoteAttentionInactiveRef = useRef(false);

  const [session, setSession] = useState(null);
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(true);
  const [isLeaving, setIsLeaving] = useState(false);
  const [meetingError, setMeetingError] = useState("");
  const [connectionLabel, setConnectionLabel] = useState("Preparing your meeting...");
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  const [isMirrorEnabled, setIsMirrorEnabled] = useState(true);
  const [videoBrightness, setVideoBrightness] = useState(110);
  const [videoContrast, setVideoContrast] = useState(106);
  const [isSharingLink, setIsSharingLink] = useState(false);
  const [remoteParticipant, setRemoteParticipant] = useState(null);
  const [joinRequests, setJoinRequests] = useState([]);
  const [selectedLanguage, setSelectedLanguage] = useState("javascript");
  const [code, setCode] = useState("");
  const [output, setOutput] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [remoteTyping, setRemoteTyping] = useState(false);
  const [remoteCursor, setRemoteCursor] = useState(null);
  const [remoteAttention, setRemoteAttention] = useState(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isUpdatingProblem, setIsUpdatingProblem] = useState(false);

  const hasInitializedCodingRef = useRef(false);

  const localPreviewStyle = {
    transform: isMirrorEnabled ? "scaleX(-1)" : "scaleX(1)",
    filter: `brightness(${videoBrightness}%) contrast(${videoContrast}%)`,
  };

  function bindLocalVideoElement(element) {
    localVideoRef.current = element;

    if (element && localStreamRef.current && element.srcObject !== localStreamRef.current) {
      element.srcObject = localStreamRef.current;
    }
  }

  function bindRemoteVideoElement(element) {
    remoteVideoRef.current = element;

    if (element && remoteStreamRef.current && element.srcObject !== remoteStreamRef.current) {
      element.srcObject = remoteStreamRef.current;
    }
  }

  function bindEditorInstance(editor) {
    editorRef.current = editor;
  }

  function getJoinRequestSignature(joinRequests = []) {
    return joinRequests
      .map((request) => {
        const requestUser = request?.user;
        const requestUserId =
          typeof requestUser === "object"
            ? requestUser?._id?.toString() || requestUser?.clerkId || ""
            : requestUser?.toString() || "";

        return `${requestUserId}:${request?.status || ""}`;
      })
      .sort()
      .join("|");
  }

  function getSessionSignature(activeSession) {
    if (!activeSession) return "";

    return [
      activeSession._id || "",
      activeSession.status || "",
      activeSession.problem || "",
      activeSession.difficulty || "",
      activeSession.hostLanguage || "",
      activeSession.host?._id || activeSession.host?.toString?.() || "",
      activeSession.host?.clerkId || "",
      activeSession.participant?._id || activeSession.participant?.toString?.() || "",
      activeSession.participant?.clerkId || "",
      getJoinRequestSignature(activeSession.joinRequests || []),
    ].join("::");
  }

  function updateSessionSnapshot(activeSession) {
    setSession((previous) => {
      if (getSessionSignature(previous) === getSessionSignature(activeSession)) {
        return previous;
      }

      return activeSession;
    });

    setJoinRequests((previous) => {
      const nextRequests = activeSession?.joinRequests || [];
      if (getJoinRequestSignature(previous) === getJoinRequestSignature(nextRequests)) {
        return previous;
      }

      return nextRequests;
    });
  }

  function updatePresenceSnapshot(nextPresence, activeRole = role) {
    presenceSnapshotRef.current = nextPresence;
    syncRemoteParticipant(nextPresence, activeRole);
  }

  const currentProblem =
    Object.values(PROBLEMS).find((problem) => problem.title === session?.problem) ||
    Object.values(PROBLEMS)[0];

  function getStarterCode(language, problem = currentProblem) {
    return problem?.starterCode?.[language] || "";
  }

  async function activateMeeting(activeSession, resolvedRole, options = {}) {
    if (meetingActivationInProgressRef.current || connectedRef.current) return;

    const { showLoading = false } = options;

    meetingActivationInProgressRef.current = true;

    if (showLoading) {
      setLoading(true);
    }

    try {
      updateSessionSnapshot(activeSession);
      setRole(resolvedRole);

      await prepareLocalMedia();

      const connectionData = await sessionApi.connectMeeting(id);
      connectedRef.current = true;
      setConnectionLabel(
        resolvedRole === "host"
          ? "Waiting for the other participant to join..."
          : "You joined the room. Waiting for the host..."
      );
      updatePresenceSnapshot(connectionData.presence || [], resolvedRole);
    } finally {
      meetingActivationInProgressRef.current = false;

      if (showLoading) {
        setLoading(false);
      }
    }
  }

  async function refreshSessionSnapshot() {
    const sessionResponse = await sessionApi.getSessionById(id);
    const activeSession = sessionResponse.session;
    updateSessionSnapshot(activeSession);
    return activeSession;
  }
  function cleanupPeerConnection() {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.onconnectionstatechange = null;
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    pendingCandidatesRef.current = [];
    offerInFlightRef.current = false;
    remoteStreamRef.current = null;

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  }

  function stopLocalMedia() {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
  }

  async function flushPendingCandidates() {
    const peerConnection = peerConnectionRef.current;
    if (!peerConnection?.remoteDescription) return;

    while (pendingCandidatesRef.current.length > 0) {
      const candidate = pendingCandidatesRef.current.shift();
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  async function ensurePeerConnection() {
    if (peerConnectionRef.current) return peerConnectionRef.current;

    const peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.onicecandidate = async (event) => {
      if (!event.candidate) return;

      try {
        await sessionApi.sendMeetingSignal(id, {
          type: "ice-candidate",
          payload: event.candidate.toJSON(),
        });
      } catch (error) {
        console.error("Failed to send ICE candidate:", error);
      }
    };

    peerConnection.ontrack = (event) => {
      if (!remoteStreamRef.current) {
        remoteStreamRef.current = new MediaStream();
      }

      event.streams[0]?.getTracks().forEach((track) => {
        if (!remoteStreamRef.current.getTrackById(track.id)) {
          remoteStreamRef.current.addTrack(track);
        }
      });

      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStreamRef.current;
        remoteVideoRef.current.play().catch(() => {
          // Some browsers block autoplay with audio until user interaction.
          // Keep the stream attached; user can interact once to start playback.
        });
      }
    };

    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState;

      if (state === "connected") {
        setConnectionLabel("Connected");
        offerInFlightRef.current = false;
      } else if (state === "connecting") {
        setConnectionLabel("Connecting to the other participant...");
      } else if (state === "disconnected") {
        setConnectionLabel("Connection interrupted. Waiting for reconnection...");
      } else if (state === "failed") {
        setConnectionLabel("Connection failed. Try rejoining the room.");
        offerInFlightRef.current = false;
      } else if (state === "closed") {
        setConnectionLabel("Meeting closed");
        offerInFlightRef.current = false;
      }
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStreamRef.current);
      });
    }

    peerConnectionRef.current = peerConnection;
    return peerConnection;
  }

  async function createAndSendOffer(activeRemoteParticipant = remoteParticipant, activeRole = role) {
    if (activeRole !== "host" || offerInFlightRef.current || !activeRemoteParticipant) return;

    const peerConnection = await ensurePeerConnection();

    if (
      peerConnection.signalingState !== "stable" ||
      peerConnection.remoteDescription ||
      peerConnection.connectionState === "connected"
    ) {
      return;
    }

    offerInFlightRef.current = true;
    setConnectionLabel("Calling the other participant...");

    try {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      await sessionApi.sendMeetingSignal(id, {
        type: "offer",
        payload: offer,
      });
    } catch (error) {
      offerInFlightRef.current = false;
      setConnectionLabel("Unable to start the call. Retrying...");
      throw error;
    }
  }

  async function handleSignalEvent(event) {
    const signalType = event.payload?.type;
    const signalData = event.payload?.data;

    if (!signalType || !signalData) return;

    const peerConnection = await ensurePeerConnection();

    if (signalType === "offer") {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(signalData));
      await flushPendingCandidates();

      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      await sessionApi.sendMeetingSignal(id, {
        type: "answer",
        payload: answer,
      });

      setConnectionLabel("Joining the meeting...");
      return;
    }

    if (signalType === "answer") {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(signalData));
      await flushPendingCandidates();
      setConnectionLabel("Connected");
      return;
    }

    if (signalType === "ice-candidate") {
      if (peerConnection.remoteDescription) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(signalData));
      } else {
        pendingCandidatesRef.current.push(signalData);
      }
    }
  }

  async function handleMeetingEvent(event) {
    if (event.type === "signal") {
      await handleSignalEvent(event);
      return;
    }

    if (event.type === "code-sync") {
      const incomingLanguage = event.payload?.language;
      const incomingCode = event.payload?.code;
      const senderClerkId = event.payload?.sender?.clerkId;

      if (!["javascript", "python", "java"].includes(incomingLanguage) || typeof incomingCode !== "string") {
        return;
      }

      // Ignore local echo from polling to avoid unnecessary editor resets/cursor jumps.
      if (senderClerkId && senderClerkId === user?.id) {
        return;
      }

      if (incomingLanguage === selectedLanguage && incomingCode === code) {
        return;
      }

      const editor = editorRef.current;
      const currentPosition = editor?.getPosition?.();
      const targetLine = currentPosition?.lineNumber ?? null;
      const targetColumn = currentPosition?.column ?? null;

      suppressOutgoingCodeSyncRef.current = true;
      setSelectedLanguage(incomingLanguage);
      setCode(incomingCode);
      setOutput(null);

      requestAnimationFrame(() => {
        const activeEditor = editorRef.current;
        const activeModel = activeEditor?.getModel?.();

        if (!activeEditor || !activeModel || targetLine === null || targetColumn === null) return;

        const nextLine = Math.min(targetLine, activeModel.getLineCount());
        const maxColumn = activeModel.getLineMaxColumn(nextLine);
        const nextColumn = Math.min(targetColumn, maxColumn);
        const nextPosition = { lineNumber: nextLine, column: nextColumn };
        activeEditor.setPosition(nextPosition);
      });

      setTimeout(() => {
        suppressOutgoingCodeSyncRef.current = false;
      }, 0);
      return;
    }

    if (event.type === "presence") {
      const action = event.payload?.action;
      const eventUser = event.payload?.user;

      if (!eventUser?.id) return;

      const currentPresence = presenceSnapshotRef.current || [];
      let nextPresence = currentPresence;

      if (action === "joined") {
        const others = currentPresence.filter((entry) => entry.id !== eventUser.id);
        nextPresence = [...others, eventUser];
      }

      if (action === "left") {
        nextPresence = currentPresence.filter((entry) => entry.id !== eventUser.id);
      }

      if (nextPresence !== currentPresence) {
        updatePresenceSnapshot(nextPresence);
      }
      return;
    }

    if (event.type === "chat") {
      setChatMessages((previous) => {
        if (previous.some((message) => message.id === event.id)) {
          return previous;
        }

        return [
          ...previous,
          {
            id: event.id,
            message: event.payload?.message || "",
            sender: event.payload?.sender || {},
            createdAt: event.createdAt,
          },
        ];
      });
      return;
    }

    if (event.type === "activity") {
      const activityType = event.payload?.activityType;
      const sender = event.payload?.sender || {};

      if (sender.clerkId === user?.id) {
        return;
      }

      if (activityType === "typing") {
        setRemoteTyping(Boolean(event.payload?.typing));
        return;
      }

      if (activityType === "cursor") {
        const line = Number(event.payload?.line || 0);
        const column = Number(event.payload?.column || 0);

        if (line < 1 || column < 1) return;

        setRemoteCursor({
          line,
          column,
          name: sender.name || "Participant",
        });

        if (remoteCursorHideTimeoutRef.current) {
          clearTimeout(remoteCursorHideTimeoutRef.current);
        }

        remoteCursorHideTimeoutRef.current = setTimeout(() => {
          setRemoteCursor(null);
        }, 5000);
      }

      if (activityType === "attention") {
        const isInactive = Boolean(event.payload?.isInactive);
        const reason = event.payload?.reason || "window-change";

        setRemoteAttention({
          isInactive,
          reason,
          at: event.createdAt,
          name: sender.name || "Participant",
        });

        if (isInactive && !lastRemoteAttentionInactiveRef.current && role === "host") {
          toast.error("Participant moved away from the coding window.");
        }

        if (!isInactive && lastRemoteAttentionInactiveRef.current && role === "host") {
          toast.success("Participant is back on the coding window.");
        }

        lastRemoteAttentionInactiveRef.current = isInactive;
      }
      return;
    }

    if (event.type === "session-ended") {
      toast("This meeting has ended.");
      navigate("/dashboard");
    }
  }

  async function handleRunCode() {
    setIsRunning(true);
    setOutput(null);

    const result = await executeCode(selectedLanguage, code);
    setOutput(result);
    setIsRunning(false);
  }

  async function handleLanguageChange(event) {
    const nextLanguage = event.target.value;

    if (role !== "host") {
      return;
    }

    setSelectedLanguage(nextLanguage);
    const nextCode = getStarterCode(nextLanguage);
    setCode(nextCode);
    setOutput(null);

    try {
      const response = await sessionApi.updateSessionTools(id, {
        hostLanguage: nextLanguage,
      });

      if (response?.session) {
        updateSessionSnapshot(response.session);
      }

      await sessionApi.sendMeetingCodeSync(id, {
        language: nextLanguage,
        code: nextCode,
      });
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to update language");
    }
  }

  function handleCodeChange(nextCodeValue) {
    const nextCode = nextCodeValue ?? "";
    setCode(nextCode);

    if (role !== "host" && role !== "participant") return;
    if (!connectedRef.current) return;
    if (suppressOutgoingCodeSyncRef.current) return;

    if (!typingActiveRef.current) {
      typingActiveRef.current = true;
      sessionApi.sendMeetingActivity(id, {
        activityType: "typing",
        typing: true,
      }).catch(() => {});
    }

    if (typingStopTimeoutRef.current) {
      clearTimeout(typingStopTimeoutRef.current);
    }

    typingStopTimeoutRef.current = setTimeout(() => {
      typingActiveRef.current = false;
      sessionApi.sendMeetingActivity(id, {
        activityType: "typing",
        typing: false,
      }).catch(() => {});
    }, 1400);

    if (codeSyncTimeoutRef.current) {
      clearTimeout(codeSyncTimeoutRef.current);
    }

    codeSyncTimeoutRef.current = setTimeout(async () => {
      if (
        lastCodeSyncPayloadRef.current.language === selectedLanguage &&
        lastCodeSyncPayloadRef.current.code === nextCode
      ) {
        return;
      }

      try {
        await sessionApi.sendMeetingCodeSync(id, {
          language: selectedLanguage,
          code: nextCode,
        });
        lastCodeSyncPayloadRef.current = {
          language: selectedLanguage,
          code: nextCode,
        };
      } catch (error) {
        console.error("Failed to sync code:", error);
      }
    }, 450);
  }

  function handleCursorChange(position) {
    if (!position || typeof position.line !== "number" || typeof position.column !== "number") {
      return;
    }

    if (role !== "host" && role !== "participant") return;
    if (!connectedRef.current) return;
    if (suppressOutgoingCodeSyncRef.current) return;

    if (cursorSyncTimeoutRef.current) {
      clearTimeout(cursorSyncTimeoutRef.current);
    }

    cursorSyncTimeoutRef.current = setTimeout(() => {
      sessionApi.sendMeetingActivity(id, {
        activityType: "cursor",
        line: position.line,
        column: position.column,
      }).catch(() => {});
    }, 120);
  }

  function reportWindowAttention(isInactive, reason) {
    if (role !== "host" && role !== "participant") return;
    if (!connectedRef.current) return;
    if (localAttentionInactiveRef.current === isInactive) return;

    localAttentionInactiveRef.current = isInactive;

    sessionApi
      .sendMeetingActivity(id, {
        activityType: "attention",
        isInactive,
        reason,
      })
      .catch(() => {});
  }

  async function sendChatMessage() {
    const message = chatInput.trim();
    if (!message) return;

    try {
      setIsSendingChat(true);
      const response = await sessionApi.sendMeetingChat(id, { message });
      setChatInput("");

      if (response?.event) {
        const event = response.event;
        setChatMessages((previous) => {
          if (previous.some((chat) => chat.id === event.id)) {
            return previous;
          }

          return [
            ...previous,
            {
              id: event.id,
              message: event.payload?.message || "",
              sender: event.payload?.sender || {},
              createdAt: event.createdAt,
            },
          ];
        });
      }
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to send message");
    } finally {
      setIsSendingChat(false);
    }
  }

  function syncRemoteParticipant(presenceSnapshot, activeRole) {
    const otherUser = presenceSnapshot.find((entry) => entry.clerkId !== user?.id) || null;
    setRemoteParticipant(otherUser);

    if (!otherUser) {
      cleanupPeerConnection();
      setConnectionLabel("Waiting for the other participant to join...");
      return;
    }

    if (activeRole === "host") {
      createAndSendOffer(otherUser, activeRole).catch((error) => {
        console.error("Failed to create offer:", error);
        setConnectionLabel("Unable to start the call.");
      });
    }
  }

  async function prepareLocalMedia() {
    const getUserMedia = navigator.mediaDevices?.getUserMedia;

    if (!getUserMedia) {
      throw new Error(
        "Camera and microphone access require a secure context. Open this session on https or on localhost. If you are using a local IP address, the browser will block getUserMedia."
      );
    }

    const stream = await getUserMedia.call(navigator.mediaDevices, {
      video: true,
      audio: true,
    });

    localStreamRef.current = stream;

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }
  }

  async function bootstrapMeeting() {
    setLoading(true);
    setMeetingError("");
    lastEventIdRef.current = 0;
    connectedRef.current = false;
    meetingActivationInProgressRef.current = false;
    hasInitializedCodingRef.current = false;
    presenceSnapshotRef.current = [];
    setChatMessages([]);
    setRemoteTyping(false);
    setRemoteCursor(null);
    setRemoteAttention(null);
    lastRemoteAttentionInactiveRef.current = false;
    approvalToastShownRef.current = false;
    suppressOutgoingCodeSyncRef.current = false;

    if (codeSyncTimeoutRef.current) {
      clearTimeout(codeSyncTimeoutRef.current);
    }

    try {
      let sessionResponse = await sessionApi.getSessionById(id);
      let activeSession = sessionResponse.session;
      updateSessionSnapshot(activeSession);

      if (activeSession.host?.clerkId === user.id) {
        await activateMeeting(activeSession, "host");
      } else if (activeSession.participant?.clerkId === user.id) {
        await activateMeeting(activeSession, "participant");
      } else if (!activeSession.participant) {
        const requestResponse = await sessionApi.joinSession(id);
        activeSession = requestResponse.session;
        updateSessionSnapshot(activeSession);
        setRole("pending");
        setConnectionLabel("Join request sent. Waiting for host approval...");
      } else {
        throw new Error("This 1-to-1 room is already full.");
      }
    } catch (error) {
      console.error("Failed to bootstrap meeting:", error);
      setMeetingError(
        error.response?.data?.message || error.message || "Unable to open this meeting."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user?.id) return undefined;

    stoppedRef.current = false;

    bootstrapMeeting();

    return () => {
      stoppedRef.current = true;

      if (codeSyncTimeoutRef.current) {
        clearTimeout(codeSyncTimeoutRef.current);
      }

      if (typingStopTimeoutRef.current) {
        clearTimeout(typingStopTimeoutRef.current);
      }

      if (cursorSyncTimeoutRef.current) {
        clearTimeout(cursorSyncTimeoutRef.current);
      }

      if (remoteCursorHideTimeoutRef.current) {
        clearTimeout(remoteCursorHideTimeoutRef.current);
      }

      if (streamReconnectTimeoutRef.current) {
        clearTimeout(streamReconnectTimeoutRef.current);
      }

      if (connectedRef.current) {
        sessionApi.disconnectMeeting(id).catch(() => {});
        connectedRef.current = false;
      }

      cleanupPeerConnection();
      stopLocalMedia();
    };
  }, [id, user?.id]);

  useEffect(() => {
    if (!role || loading || meetingError || (role !== "host" && role !== "participant")) return undefined;

    const streamAbortController = new AbortController();
    let reconnectAttempts = 0;

    const connectStream = async () => {
      if (stoppedRef.current) return;

      try {
        const token = await getToken();

        const response = await fetch(`/api/meetings/${id}/stream?after=${lastEventIdRef.current}`, {
          method: "GET",
          headers: {
            Accept: "text/event-stream",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: "include",
          signal: streamAbortController.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`Meeting stream failed with status ${response.status}`);
        }

        reconnectAttempts = 0;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!stoppedRef.current) {
          const { value, done } = await reader.read();

          if (done) {
            throw new Error("Meeting stream closed");
          }

          buffer += decoder.decode(value, { stream: true });

          let separatorIndex = buffer.indexOf("\n\n");

          while (separatorIndex !== -1) {
            const rawChunk = buffer.slice(0, separatorIndex).trim();
            buffer = buffer.slice(separatorIndex + 2);

            if (rawChunk && !rawChunk.startsWith(":")) {
              const dataLines = rawChunk
                .split("\n")
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).trimStart());

              if (dataLines.length > 0) {
                const payload = JSON.parse(dataLines.join("\n"));

                if (payload.kind === "bootstrap") {
                  updatePresenceSnapshot(payload.presence || [], role);

                  for (const event of payload.events || []) {
                    lastEventIdRef.current = Math.max(lastEventIdRef.current, event.id || 0);
                    await handleMeetingEvent(event);
                  }

                  lastEventIdRef.current = Math.max(lastEventIdRef.current, payload.lastEventId || 0);
                }

                if (payload.kind === "event" && payload.event) {
                  const event = payload.event;
                  lastEventIdRef.current = Math.max(lastEventIdRef.current, event.id || 0);
                  await handleMeetingEvent(event);
                }
              }
            }

            separatorIndex = buffer.indexOf("\n\n");
          }
        }
      } catch (error) {
        if (streamAbortController.signal.aborted || stoppedRef.current) {
          return;
        }

        console.error("Meeting stream failed:", error);

        reconnectAttempts += 1;
        const retryDelayMs = Math.min(5000, 1000 * reconnectAttempts);

        streamReconnectTimeoutRef.current = setTimeout(() => {
          connectStream().catch(() => {});
        }, retryDelayMs);
      }
    };

    connectStream().catch((error) => {
      console.error("Unable to establish meeting stream:", error);
    });

    return () => {
      streamAbortController.abort();

      if (streamReconnectTimeoutRef.current) {
        clearTimeout(streamReconnectTimeoutRef.current);
      }
    };
  }, [id, role, loading, meetingError, user?.id, getToken]);

  useEffect(() => {
    if (loading || meetingError || !role) return undefined;

    const pollSession = async () => {
      if (stoppedRef.current) return;

      try {
        const activeSession = await refreshSessionSnapshot();
        const pendingRequest = (activeSession.joinRequests || []).find(
          (request) => request.user?.clerkId === user?.id
        );

        if (role === "pending") {
          if (activeSession.participant?.clerkId === user?.id) {
            if (!approvalToastShownRef.current) {
              toast.success("Host approved your request!");
              approvalToastShownRef.current = true;
            }
            await activateMeeting(activeSession, "participant", { showLoading: true });
            return;
          }

          if (pendingRequest?.status === "rejected") {
            setMeetingError("Host rejected your join request.");
            return;
          }

          setConnectionLabel("Join request sent. Waiting for host approval...");
        }
      } catch (error) {
        console.error("Polling session status failed:", error);
      } finally {
        if (!stoppedRef.current) {
          sessionPollTimeoutRef.current = setTimeout(pollSession, 3000);
        }
      }
    };

    pollSession();

    return () => {
      if (sessionPollTimeoutRef.current) {
        clearTimeout(sessionPollTimeoutRef.current);
      }
    };
  }, [id, role, loading, meetingError, user?.id]);

  useEffect(() => {
    if (!session || !currentProblem) return;

    const sessionLanguage = session.hostLanguage || "javascript";
    const nextWorkspaceSeed = `${currentProblem.id}:${sessionLanguage}`;

    if (!hasInitializedCodingRef.current) {
      hasInitializedCodingRef.current = true;
      workspaceSeedRef.current = nextWorkspaceSeed;
      setSelectedLanguage(sessionLanguage);
      setCode(getStarterCode(sessionLanguage, currentProblem));
      return;
    }

    const shouldResetWorkspace = role !== "host" && workspaceSeedRef.current !== nextWorkspaceSeed;

    if (shouldResetWorkspace) {
      workspaceSeedRef.current = nextWorkspaceSeed;
      setSelectedLanguage(sessionLanguage);
      setCode(getStarterCode(sessionLanguage, currentProblem));
      setOutput(null);
    }
  }, [session, currentProblem, role]);

  useEffect(() => {
    if (!role || loading || meetingError || (role !== "host" && role !== "participant")) return undefined;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        reportWindowAttention(true, "tab-hidden");
      } else {
        reportWindowAttention(false, "tab-visible");
      }
    };

    const handleWindowBlur = () => {
      reportWindowAttention(true, "window-blur");
    };

    const handleWindowFocus = () => {
      reportWindowAttention(false, "window-focus");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [role, loading, meetingError]);

  async function handleProblemChange(event) {
    const nextProblemId = event.target.value;
    const nextProblem = PROBLEMS[nextProblemId];

    if (!nextProblem || role !== "host") {
      return;
    }

    const nextCode = getStarterCode(selectedLanguage, nextProblem);

    setIsUpdatingProblem(true);
    setCode(nextCode);
    setOutput(null);

    try {
      const response = await sessionApi.updateSessionTools(id, {
        problem: nextProblem.title,
        difficulty: nextProblem.difficulty.toLowerCase(),
      });

      if (response?.session) {
        updateSessionSnapshot(response.session);
      }

      await sessionApi.sendMeetingCodeSync(id, {
        language: selectedLanguage,
        code: nextCode,
      });

      lastCodeSyncPayloadRef.current = {
        language: selectedLanguage,
        code: nextCode,
      };

      toast.success("Problem updated for this session");
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to update problem");
    } finally {
      setIsUpdatingProblem(false);
    }
  }

  async function leaveMeeting() {
    if (isLeaving) return;

    setIsLeaving(true);

    try {
      if (role === "host") {
        await sessionApi.endSession(id);
        connectedRef.current = false;
        toast.success("Session ended successfully!");
      } else if (connectedRef.current) {
        await sessionApi.disconnectMeeting(id);
        connectedRef.current = false;
      }

      navigate("/dashboard");
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to leave the session");
    } finally {
      setIsLeaving(false);
    }
  }

  function toggleAudio() {
    const stream = localStreamRef.current;
    if (!stream) return;

    const nextValue = !isMicEnabled;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = nextValue;
    });
    setIsMicEnabled(nextValue);
  }

  function toggleVideo() {
    const stream = localStreamRef.current;
    if (!stream) return;

    const nextValue = !isCameraEnabled;
    stream.getVideoTracks().forEach((track) => {
      track.enabled = nextValue;
    });
    setIsCameraEnabled(nextValue);
  }

  function applyPreviewPreset(preset) {
    if (preset === "normal") {
      setVideoBrightness(100);
      setVideoContrast(100);
      return;
    }

    if (preset === "meet") {
      setVideoBrightness(110);
      setVideoContrast(106);
      return;
    }

    if (preset === "low-light") {
      setVideoBrightness(128);
      setVideoContrast(112);
    }
  }

  async function shareSessionLink() {
    const shareUrl = `${window.location.origin}/session/${id}`;
    const shareText = `Join my HireDesk coding session: ${session?.problem || "Live Session"}`;

    try {
      setIsSharingLink(true);

      if (navigator.share) {
        await navigator.share({
          title: "Join my HireDesk session",
          text: shareText,
          url: shareUrl,
        });
        return;
      }

      await copySessionLink();
    } catch (error) {
      if (error?.name !== "AbortError") {
        toast.error("Unable to share link right now.");
      }
    } finally {
      setIsSharingLink(false);
    }
  }

  async function copySessionLink() {
    const shareUrl = `${window.location.origin}/session/${id}`;

    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Session link copied. Share it with your partner.");
    } catch {
      toast.error("Unable to copy session link.");
    }
  }

  async function approveJoinRequest(requesterId) {
    try {
      const response = await sessionApi.approveJoinRequest(id, requesterId);
      updateSessionSnapshot(response.session);
      toast.success("Join request approved");
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to approve request");
    }
  }

  async function rejectJoinRequest(requesterId) {
    try {
      const response = await sessionApi.rejectJoinRequest(id, requesterId);
      updateSessionSnapshot(response.session);
      toast.success("Join request rejected");
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to reject request");
    }
  }

  function getJoinRequestUserId(request) {
    const requestUser = request?.user;
    if (!requestUser) return "";

    if (typeof requestUser === "object" && requestUser._id) {
      return requestUser._id.toString();
    }

    return requestUser.toString();
  }

  function getDisplayNameForJoinRequest(request) {
    const userName = String(request?.user?.name || "").trim();
    if (userName) return userName;

    const email = String(request?.user?.email || "").trim();
    if (email.includes("@")) {
      return email.split("@")[0];
    }

    return "Participant";
  }

  const currentUserRequest = joinRequests.find((request) => request.user?.clerkId === user?.id);
  const pendingJoinRequests = Array.from(
    joinRequests
      .filter((request) => request.status === "pending")
      .reduce((accumulator, request) => {
        const requestUserId = getJoinRequestUserId(request);
        if (!requestUserId || accumulator.has(requestUserId)) {
          return accumulator;
        }

        accumulator.set(requestUserId, request);
        return accumulator;
      }, new Map())
      .values()
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-base-200">
        <Navbar />
        <main className="max-w-6xl mx-auto px-4 py-12">
          <div className="card bg-base-100 shadow-xl">
            <div className="card-body items-center py-16 text-center">
              <LoaderIcon className="size-10 animate-spin text-primary" />
              <h1 className="text-2xl font-bold mt-4">Preparing your meeting room</h1>
              <p className="text-base-content/70">Checking session access and starting camera/microphone...</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (meetingError) {
    return (
      <div className="min-h-screen bg-base-200">
        <Navbar />
        <main className="max-w-4xl mx-auto px-4 py-12">
          <div className="card bg-base-100 shadow-xl">
            <div className="card-body gap-6">
              <button className="btn btn-ghost w-fit" onClick={() => navigate("/dashboard")}>
                <ArrowLeftIcon className="size-4" />
                Back to Dashboard
              </button>

              <div className="alert alert-error">
                <span>{meetingError}</span>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base-200">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <section className="card bg-base-100 shadow-xl">
          <div className="card-body gap-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.25em] text-primary font-semibold mb-2">
                  1-to-1 Meeting Room
                </p>
                <h1 className="text-3xl font-black">{session?.problem}</h1>
                <p className="text-base-content/70 mt-2">
                  {role === "host"
                    ? "You are hosting this session."
                    : role === "pending"
                      ? "Your request has been sent to the host for approval."
                      : "You joined as the second participant."}
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <div className="badge badge-outline badge-lg">
                  {session?.difficulty?.slice(0, 1).toUpperCase()}
                  {session?.difficulty?.slice(1)}
                </div>
                <div className="badge badge-success badge-lg gap-2">
                  <UsersIcon className="size-4" />
                  {remoteParticipant ? "2 / 2 connected" : "1 / 2 connected"}
                </div>
                <div className="badge badge-secondary badge-lg">{connectionLabel}</div>
                {role === "host" && remoteAttention?.isInactive && (
                  <div className="badge badge-error badge-lg">Participant not focused</div>
                )}
              </div>
            </div>

            {role === "host" && (
              <div className="rounded-2xl border border-base-300 bg-base-200/70 p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h2 className="font-bold text-lg">Join requests</h2>
                  <span className="badge badge-primary badge-outline">{pendingJoinRequests.length} pending</span>
                </div>

                {pendingJoinRequests.length === 0 ? (
                  <p className="text-sm text-base-content/70">No pending requests right now.</p>
                ) : (
                  <div className="space-y-3">
                    {pendingJoinRequests.map((request) => (
                      <div
                        key={getJoinRequestUserId(request) || request.user?.clerkId}
                        className="flex flex-col gap-3 rounded-xl border border-base-300 bg-base-100 p-4 md:flex-row md:items-center md:justify-between"
                      >
                        <div>
                          <p className="font-semibold">{getDisplayNameForJoinRequest(request)}</p>
                          <p className="text-sm text-base-content/60">{request.user?.email || "No email available"}</p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => approveJoinRequest(getJoinRequestUserId(request))}
                            disabled={!getJoinRequestUserId(request)}
                          >
                            Approve
                          </button>
                          <button
                            className="btn btn-sm btn-outline btn-error"
                            onClick={() => rejectJoinRequest(getJoinRequestUserId(request))}
                            disabled={!getJoinRequestUserId(request)}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {role === "pending" && (
              <div className="alert alert-info">
                <div>
                  <h3 className="font-semibold">Waiting for host approval</h3>
                  <p className="text-sm">
                    Your request is pending. The host must approve it before you can join the meeting.
                  </p>
                  {currentUserRequest?.status === "rejected" && (
                    <p className="text-sm mt-2 text-error">Your request was rejected by the host.</p>
                  )}
                </div>
              </div>
            )}

            <div className="relative">
              <button
                className="btn btn-sm btn-primary gap-2 absolute right-3 top-3 z-20 shadow-lg"
                onClick={() => setIsChatOpen((previous) => !previous)}
                title="Toggle meeting chat"
              >
                <MessageSquareIcon className="size-4" />
                {isChatOpen ? "Hide Chat" : "Show Chat"}
              </button>

              {isChatOpen ? (
                <PanelGroup direction="horizontal" className="min-h-[340px] rounded-2xl border border-base-300 bg-base-200/60">
                  <Panel defaultSize={68} minSize={45}>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 p-4 h-full">
                      <div className="rounded-3xl overflow-hidden bg-neutral text-neutral-content min-h-[320px] relative">
                        <video
                          ref={bindLocalVideoElement}
                          autoPlay
                          playsInline
                          muted
                          className="w-full h-full object-cover"
                          style={localPreviewStyle}
                        />
                        <div className="absolute left-4 bottom-4 badge badge-primary badge-lg">You</div>
                        {!isCameraEnabled && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                            <div className="text-center">
                              <VideoOffIcon className="size-10 mx-auto mb-2" />
                              <p>Camera is off</p>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="rounded-3xl overflow-hidden bg-base-300 min-h-[320px] relative border border-base-300">
                        <video
                          ref={bindRemoteVideoElement}
                          autoPlay
                          playsInline
                          className="w-full h-full object-cover"
                        />
                        {remoteParticipant ? (
                          <div className="absolute left-4 bottom-4 badge badge-accent badge-lg">
                            {remoteParticipant.name}
                          </div>
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center text-center px-8">
                            <div>
                              <VideoIcon className="size-12 mx-auto mb-3 text-base-content/50" />
                              <h2 className="text-xl font-bold mb-2">Waiting for someone to join</h2>
                              <p className="text-base-content/70">
                                Share this session from the dashboard and the second participant will appear here.
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </Panel>

                  <PanelResizeHandle className="w-2 bg-base-300 hover:bg-primary/60 transition-colors cursor-col-resize" />

                  <Panel defaultSize={32} minSize={22}>
                    <div className="rounded-2xl bg-base-100 flex flex-col h-full">
                      <div className="p-3 border-b border-base-300">
                        <h3 className="font-bold">Meeting Chat</h3>
                        <p className="text-xs text-base-content/60">Chat stays inside this session.</p>
                      </div>

                      <div className="flex-1 p-3 overflow-y-auto space-y-2">
                        {chatMessages.length === 0 ? (
                          <p className="text-sm text-base-content/50">No messages yet.</p>
                        ) : (
                          chatMessages.map((message) => {
                            const isSelf = message.sender?.clerkId === user?.id;
                            return (
                              <div
                                key={message.id}
                                className={`rounded-lg p-2 text-sm ${isSelf ? "bg-primary text-primary-content ml-4" : "bg-base-200 mr-4"}`}
                              >
                                <p className="text-xs font-semibold opacity-80 mb-1">
                                  {isSelf ? "You" : message.sender?.name || "Participant"}
                                </p>
                                <p className="whitespace-pre-wrap break-words">{message.message}</p>
                              </div>
                            );
                          })
                        )}
                      </div>

                      <div className="p-3 border-t border-base-300 flex items-center gap-2">
                        <input
                          type="text"
                          className="input input-sm input-bordered flex-1"
                          placeholder="Type a message..."
                          value={chatInput}
                          onChange={(event) => setChatInput(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              sendChatMessage();
                            }
                          }}
                        />
                        <button className="btn btn-sm btn-primary" onClick={sendChatMessage} disabled={isSendingChat || !chatInput.trim()}>
                          {isSendingChat ? <LoaderIcon className="size-4 animate-spin" /> : <SendIcon className="size-4" />}
                        </button>
                      </div>
                    </div>
                  </Panel>
                </PanelGroup>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  <div className="rounded-3xl overflow-hidden bg-neutral text-neutral-content min-h-[320px] relative">
                    <video
                      ref={bindLocalVideoElement}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                      style={localPreviewStyle}
                    />
                    <div className="absolute left-4 bottom-4 badge badge-primary badge-lg">You</div>
                    {!isCameraEnabled && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                        <div className="text-center">
                          <VideoOffIcon className="size-10 mx-auto mb-2" />
                          <p>Camera is off</p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="rounded-3xl overflow-hidden bg-base-300 min-h-[320px] relative border border-base-300">
                    <video
                      ref={bindRemoteVideoElement}
                      autoPlay
                      playsInline
                      className="w-full h-full object-cover"
                    />
                    {remoteParticipant ? (
                      <div className="absolute left-4 bottom-4 badge badge-accent badge-lg">
                        {remoteParticipant.name}
                      </div>
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-center px-8">
                        <div>
                          <VideoIcon className="size-12 mx-auto mb-3 text-base-content/50" />
                          <h2 className="text-xl font-bold mb-2">Waiting for someone to join</h2>
                          <p className="text-base-content/70">
                            Share this session from the dashboard and the second participant will appear here.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {role !== "pending" && currentProblem && (
              <div className="rounded-2xl border border-base-300 bg-base-200/70 overflow-hidden">
                  <div className="p-4 border-b border-base-300 bg-base-100">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-bold">Coding Workspace</h2>
                        <p className="text-sm text-base-content/70">
                          Problem selected by host: {currentProblem.title}
                        </p>
                        {remoteTyping && (
                          <p className="text-xs text-primary mt-1">Participant is typing...</p>
                        )}
                        {remoteCursor && (
                          <p className="text-xs text-base-content/70 mt-1">
                            {remoteCursor.name} cursor: Ln {remoteCursor.line}, Col {remoteCursor.column}
                          </p>
                        )}
                        {role === "host" && remoteAttention?.isInactive && (
                          <p className="text-xs text-error mt-1">
                            {remoteAttention.name || "Participant"} left the coding window ({remoteAttention.reason}).
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {role === "host" && (
                          <select
                            className="select select-sm select-bordered"
                            value={currentProblem.id}
                            onChange={handleProblemChange}
                            disabled={isUpdatingProblem}
                          >
                            {Object.values(PROBLEMS).map((problemOption) => (
                              <option key={problemOption.id} value={problemOption.id}>
                                {problemOption.title}
                              </option>
                            ))}
                          </select>
                        )}
                        <span className="badge badge-outline">{currentProblem.difficulty}</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 min-h-[720px]">
                    <PanelGroup direction="horizontal" className="min-h-[680px] rounded-xl border border-base-300 bg-base-100">
                      <Panel defaultSize={34} minSize={22}>
                        <div className="h-full p-4 overflow-y-auto border-r border-base-300">
                          <h3 className="font-semibold mb-2">Problem Description</h3>
                          <p className="text-sm text-base-content/90 mb-3">{currentProblem.description.text}</p>

                          {currentProblem.description.notes?.length > 0 && (
                            <ul className="space-y-2 text-sm text-base-content/80 mb-4">
                              {currentProblem.description.notes.map((note, index) => (
                                <li key={index}>• {note}</li>
                              ))}
                            </ul>
                          )}

                          {currentProblem.examples?.[0] && (
                            <div className="rounded-lg bg-base-200 p-3 text-sm">
                              <p><span className="font-semibold">Input:</span> {currentProblem.examples[0].input}</p>
                              <p><span className="font-semibold">Output:</span> {currentProblem.examples[0].output}</p>
                            </div>
                          )}
                        </div>
                      </Panel>

                      <PanelResizeHandle className="w-2 bg-base-300 hover:bg-primary/60 transition-colors cursor-col-resize" />

                      <Panel defaultSize={66} minSize={30}>
                        <PanelGroup direction="vertical" className="h-full">
                          <Panel defaultSize={76} minSize={45}>
                            <div className="h-full rounded-tr-xl overflow-hidden">
                              <CodeEditorPanel
                                selectedLanguage={selectedLanguage}
                                code={code}
                                isRunning={isRunning}
                                disableLanguageSelect={role !== "host"}
                                onLanguageChange={handleLanguageChange}
                                onCodeChange={handleCodeChange}
                                onCursorChange={handleCursorChange}
                                onEditorMount={bindEditorInstance}
                                onRunCode={handleRunCode}
                              />
                            </div>
                          </Panel>

                          <PanelResizeHandle className="h-2 bg-base-300 hover:bg-primary/60 transition-colors cursor-row-resize" />

                          <Panel defaultSize={24} minSize={12}>
                            <div className="h-full bg-base-100">
                              <OutputPanel output={output} />
                            </div>
                          </Panel>
                        </PanelGroup>
                      </Panel>
                    </PanelGroup>
                  </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                className={`btn gap-2 ${isMirrorEnabled ? "btn-primary" : "btn-outline"}`}
                onClick={() => setIsMirrorEnabled((prev) => !prev)}
              >
                {isMirrorEnabled ? "Mirror On" : "Mirror Off"}
              </button>

              <button className="btn btn-outline gap-2" onClick={shareSessionLink} disabled={isSharingLink}>
                {isSharingLink ? <LoaderIcon className="size-4 animate-spin" /> : <Share2Icon className="size-4" />}
                {isSharingLink ? "Sharing..." : "Share Link"}
              </button>

              <button className="btn btn-outline gap-2" onClick={copySessionLink}>
                <Link2Icon className="size-4" />
                Copy Invite URL
              </button>

              <button className="btn btn-outline gap-2" onClick={toggleAudio}>
                {isMicEnabled ? <MicIcon className="size-4" /> : <MicOffIcon className="size-4" />}
                {isMicEnabled ? "Mute" : "Unmute"}
              </button>

              <button className="btn btn-outline gap-2" onClick={toggleVideo}>
                {isCameraEnabled ? <VideoIcon className="size-4" /> : <VideoOffIcon className="size-4" />}
                {isCameraEnabled ? "Stop Camera" : "Start Camera"}
              </button>

              <button className="btn btn-error gap-2" onClick={leaveMeeting} disabled={isLeaving}>
                {isLeaving ? <LoaderIcon className="size-4 animate-spin" /> : <PhoneOffIcon className="size-4" />}
                {role === "host" ? "End Session" : "Leave Session"}
              </button>
            </div>

            <div className="rounded-2xl border border-base-300 bg-base-200/70 p-4">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-sm font-semibold">Video Look</span>
                <button className="btn btn-xs btn-outline" onClick={() => applyPreviewPreset("normal")}>
                  Normal
                </button>
                <button className="btn btn-xs btn-outline" onClick={() => applyPreviewPreset("meet")}>
                  Meet Style
                </button>
                <button className="btn btn-xs btn-outline" onClick={() => applyPreviewPreset("low-light")}>
                  Low Light
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="text-sm min-w-28">Brightness</label>
                <input
                  type="range"
                  min="80"
                  max="150"
                  value={videoBrightness}
                  onChange={(event) => setVideoBrightness(Number(event.target.value))}
                  className="range range-primary range-sm flex-1 min-w-52"
                />
                <span className="text-sm font-medium w-12 text-right">{videoBrightness}%</span>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default SessionPage;
