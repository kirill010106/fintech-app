import axios, { AxiosError } from 'axios';
import type {
  Account,
  AuthResult,
  Authority,
  CoSignRequest,
  FamilyDashboardData,
  FamilyMemberInfo,
  Goal,
  JoinRequest,
  Quest,
  RegisterPayload,
  SafetyPolicy,
  SessionPayload,
  Transaction,
  User,
} from './types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8080/api/v1';

export const TOKEN_STORAGE_KEY = 'vtb.access_token';

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_STORAGE_KEY);
    } catch {
      return null;
    }
  },
  set(token: string): void {
    try {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } catch {
      /* private mode — the session simply will not survive a reload */
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      /* nothing to do */
    }
  },
};

export const apiClient = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * Endpoints where a 401 means "you typed the wrong password", not
 * "your session died" — they must never trigger a global sign-out.
 */
const CREDENTIAL_ENDPOINTS = ['/auth/login', '/auth/register', '/auth/password'];

let unauthorizedHandler: (() => void) | null = null;

/** AuthContext registers here so an expired token signs the user out cleanly. */
export const setUnauthorizedHandler = (handler: (() => void) | null): void => {
  unauthorizedHandler = handler;
};

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const url = error.config?.url ?? '';
    const isCredentialCheck = CREDENTIAL_ENDPOINTS.some((path) => url.includes(path));

    if (error.response?.status === 401 && !isCredentialCheck) {
      tokenStore.clear();
      unauthorizedHandler?.();
    }

    return Promise.reject(error);
  },
);

/** Turns any thrown value into a message we can show a human. */
export const extractErrorMessage = (error: unknown, fallback = 'Что-то пошло не так'): string => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: string; message?: string } | undefined;
    if (data?.error) return data.error;
    if (data?.message) return data.message;
    if (!error.response) return 'Нет связи с сервером. Проверьте подключение.';
    return fallback;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
};

export const api = {
  // ---- Session -----------------------------------------------------------
  register: async (payload: RegisterPayload): Promise<AuthResult> => {
    const res = await apiClient.post('/auth/register', payload);
    return res.data.data;
  },

  login: async (email: string, password: string): Promise<AuthResult> => {
    const res = await apiClient.post('/auth/login', { email, password });
    return res.data.data;
  },

  logout: async (): Promise<void> => {
    try {
      await apiClient.post('/auth/logout');
    } catch {
      /* the session is client-side anyway — never block sign-out on the network */
    }
  },

  getMe: async (): Promise<SessionPayload> => {
    const res = await apiClient.get('/auth/me');
    return res.data.data;
  },

  updateProfile: async (payload: { name: string; phone: string }): Promise<SessionPayload> => {
    const res = await apiClient.patch('/auth/profile', payload);
    return res.data.data;
  },

  changePassword: async (currentPassword: string, newPassword: string): Promise<void> => {
    await apiClient.post('/auth/password', {
      current_password: currentPassword,
      new_password: newPassword,
    });
  },

  // ---- Family ------------------------------------------------------------
  getFamilyInvite: async (): Promise<{ invite_code: string; family_name: string }> => {
    const res = await apiClient.get('/family/invite');
    return res.data.data;
  },

  regenerateFamilyInvite: async (): Promise<{ invite_code: string; family_name: string }> => {
    const res = await apiClient.post('/family/invite/regenerate');
    return res.data.data;
  },

  /** Files a request to join the family identified by an invite code. */
  joinFamily: async (
    inviteCode: string,
  ): Promise<{ membership_status: string; family_name: string; message: string }> => {
    const res = await apiClient.post('/family/join', { invite_code: inviteCode });
    return res.data.data;
  },

  getFamilyDashboard: async (): Promise<FamilyDashboardData> => {
    const res = await apiClient.get('/family/dashboard');
    return res.data.data;
  },

  getPolicy: async (userId: number): Promise<SafetyPolicy> => {
    const res = await apiClient.get(`/family/policies/${userId}`);
    return res.data.data;
  },

  updatePolicy: async (userId: number, policy: Partial<SafetyPolicy>): Promise<SafetyPolicy> => {
    const res = await apiClient.put(`/family/policies/${userId}`, policy);
    return res.data.data;
  },

  // ---- Family management (owner only) ------------------------------------
  getFamilyMembers: async (): Promise<FamilyMemberInfo[]> => {
    const res = await apiClient.get('/family/members');
    return res.data.data || [];
  },

  getJoinRequests: async (): Promise<JoinRequest[]> => {
    const res = await apiClient.get('/family/requests');
    return res.data.data || [];
  },

  confirmJoinRequest: async (payload: {
    user_id: number;
    authority: Authority;
    birth_date?: string;
    nickname?: string;
  }): Promise<void> => {
    await apiClient.post('/family/requests/confirm', payload);
  },

  rejectJoinRequest: async (userId: number): Promise<void> => {
    await apiClient.delete(`/family/requests/${userId}`);
  },

  updateMemberAuthority: async (userId: number, authority: Authority): Promise<void> => {
    await apiClient.put(`/family/members/${userId}/authority`, { authority });
  },

  updateMemberBirthDate: async (userId: number, birthDate: string): Promise<void> => {
    await apiClient.put(`/family/members/${userId}/birth-date`, { birth_date: birthDate });
  },

  removeFamilyMember: async (userId: number): Promise<void> => {
    await apiClient.delete(`/family/members/${userId}`);
  },

  // ---- Transfers ---------------------------------------------------------
  transfer: async (payload: {
    account_id: number;
    recipient_phone: string;
    recipient_name: string;
    amount: number;
    description: string;
  }): Promise<{
    transaction: Transaction;
    requires_co_sign: boolean;
    co_sign_request_id?: number;
    warning_message?: string;
    tips?: string[];
  }> => {
    const res = await apiClient.post('/transfers', payload);
    return res.data.data;
  },

  getHistory: async (): Promise<Transaction[]> => {
    const res = await apiClient.get('/transfers/history');
    return res.data.data || [];
  },

  // ---- Guardian co-signing ----------------------------------------------
  getPendingRequests: async (): Promise<CoSignRequest[]> => {
    const res = await apiClient.get('/guardian/pending');
    return res.data.data || [];
  },

  getGuardianHistory: async (): Promise<CoSignRequest[]> => {
    const res = await apiClient.get('/guardian/history');
    return res.data.data || [];
  },

  decideRequest: async (requestId: number, action: 'approve' | 'reject'): Promise<void> => {
    await apiClient.post('/guardian/decide', { request_id: requestId, action });
  },

  // ---- Learning quests ---------------------------------------------------
  getQuests: async (): Promise<Quest[]> => {
    const res = await apiClient.get('/quests');
    return res.data.data || [];
  },

  answerQuest: async (
    questId: number,
    optionIndex: number,
  ): Promise<{
    is_correct: boolean;
    explanation: string;
    safety_score_reward: number;
    reward_rub: number;
    new_safety_score: number;
    /** True when the quest had already been completed, so nothing was paid out. */
    already_completed: boolean;
  }> => {
    const res = await apiClient.post(`/quests/${questId}/answer`, { option_index: optionIndex });
    return res.data.data;
  },

  // ---- Savings goals -----------------------------------------------------
  getGoals: async (): Promise<Goal[]> => {
    const res = await apiClient.get('/goals');
    return res.data.data || [];
  },

  createGoal: async (payload: { title: string; target_amount: number }): Promise<Goal[]> => {
    const res = await apiClient.post('/goals', payload);
    return res.data.data || [];
  },

  topUpGoal: async (goalId: number, amount: number): Promise<Goal[]> => {
    const res = await apiClient.post(`/goals/${goalId}/topup`, { amount });
    return res.data.data || [];
  },
};

export interface AppRealtimeEvent {
  type: string;
  user_id?: number;
  family_id?: number;
  payload: unknown;
  created_at?: string;
}

/**
 * Server-Sent Events stream. EventSource cannot set an Authorization header,
 * so the JWT travels as a query parameter (the backend validates it the same way).
 */
export const subscribeEvents = (
  token: string | null,
  onEvent: (event: AppRealtimeEvent) => void,
): (() => void) => {
  if (!token) return () => {};

  const url = `${API_BASE}/events/stream?token=${encodeURIComponent(token)}`;
  const es = new EventSource(url);

  const eventTypes = [
    'connected',
    'co_sign_created',
    'co_sign_resolved',
    'balance_updated',
    'goal_updated',
    'quest_completed',
  ];

  const dispatch = (type: string, raw: string) => {
    try {
      const parsed = JSON.parse(raw);
      onEvent({
        type,
        user_id: parsed.user_id,
        family_id: parsed.family_id,
        payload: parsed.payload !== undefined ? parsed.payload : parsed,
        created_at: parsed.created_at,
      });
    } catch (err) {
      console.error('SSE parse error for event', type, err);
    }
  };

  eventTypes.forEach((type) => {
    es.addEventListener(type, (e: MessageEvent) => dispatch(type, e.data));
  });

  es.onmessage = (e: MessageEvent) => {
    try {
      const parsed = JSON.parse(e.data);
      dispatch(parsed.type || 'message', e.data);
    } catch (err) {
      console.error('SSE onmessage parse error', err);
    }
  };

  es.onerror = () => {
    // The browser reconnects on its own; nothing to do beyond staying quiet.
  };

  return () => es.close();
};

export type { User, Account };
