/**
 * Protection profile: how much supervision a person needs. It is derived on the
 * server from their birth date and authority, never chosen by the user.
 */
export type Role = 'teen' | 'standard' | 'senior';

/** What a person is allowed to do in the family. Assigned by the family owner. */
export type Authority = 'owner' | 'guardian' | 'member';

/** Whether a membership has been confirmed by the owner. */
export type MembershipStatus = 'pending' | 'active';

export interface User {
  id: number;
  email: string;
  name: string;
  phone: string;
  role: Role;
  birth_date: string;
  avatar: string;
  safety_score: number;
  created_at: string;
}

/** The family group the signed-in user belongs to. Null before they join one. */
export interface FamilyInfo {
  id: number;
  name: string;
  /** Present only for the owner, who is the one who hands invitations out. */
  invite_code?: string;
  role: Role;
  authority: Authority;
  membership_status: MembershipStatus;
  is_owner: boolean;
}

/** Everything the app needs to render a signed-in session. */
export interface SessionPayload {
  user: User;
  accounts: Account[];
  family: FamilyInfo | null;
}

/** Session payload plus a freshly minted JWT, as returned by login and register. */
export interface AuthResult extends SessionPayload {
  access_token: string;
}

export interface RegisterPayload {
  email: string;
  password: string;
  name: string;
  phone: string;
  birth_date: string;
  invite_code?: string;
  family_name?: string;
}

/** A join request shown to the family owner. */
export interface JoinRequest {
  id: number;
  user: User;
  requested_at?: string;
}

/** A family member as the owner sees them. */
export interface FamilyMemberInfo {
  id: number;
  family_id: number;
  user_id: number;
  role: Role;
  authority: Authority;
  status: MembershipStatus;
  requested_at?: string;
  nickname: string;
  user?: User;
}

export const PROFILE_LABELS: Record<Role, string> = {
  teen: 'Подросток',
  standard: 'Взрослый',
  senior: 'Старшее поколение',
};

export const AUTHORITY_LABELS: Record<Authority, string> = {
  owner: 'Владелец',
  guardian: 'Опекун',
  member: 'Участник',
};

/**
 * A short line explaining what the protection profile means in practice.
 * Used where the user needs to understand why an operation was held.
 */
export const PROFILE_HINTS: Record<Role, string> = {
  teen: 'Операции требуют подтверждения родственника',
  standard: 'Операции проходят без подтверждения',
  senior: 'Крупные переводы требуют подтверждения родственника',
};

/** Display names for the `bank_provider` identifier stored on an account. */
export const BANK_LABELS: Record<string, string> = {
  familybank: 'Семейный банк',
};

export interface Account {
  id: number;
  user_id: number;
  bank_provider: string;
  account_number: string;
  card_number: string;
  card_type: string;
  balance: number;
  currency: string;
  created_at: string;
}

export interface Transaction {
  id: number;
  account_id: number;
  user_id: number;
  amount: number;
  currency: string;
  category: string;
  mcc: string;
  description: string;
  recipient_phone?: string;
  recipient_name?: string;
  status: 'completed' | 'pending_approval' | 'rejected' | 'blocked';
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  risk_reason?: string;
  created_at: string;
}

export interface CoSignRequest {
  id: number;
  transaction_id: number;
  user_id: number;
  user_name: string;
  user_role: Role;
  guardian_id: number;
  amount: number;
  recipient: string;
  risk_reason: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  decided_at?: string;
}

export interface SafetyPolicy {
  id: number;
  user_id: number;
  max_instant_transfer: number;
  fast_food_limit_month: number;
  gaming_limit_month: number;
  require_co_signing: boolean;
  trusted_contacts_only: boolean;
  night_lockdown?: boolean;
  anti_dropper_shield?: boolean;
  parent_match_percent?: number;
  trusted_whitelist?: string[];
  updated_at: string;
}

export interface Goal {
  id: number;
  user_id: number;
  title: string;
  target_amount: number;
  current_amount: number;
  boost_multiplier: number;
  sponsor_id: number;
  status: string;
  created_at: string;
}

export interface Quest {
  id: number;
  title: string;
  description: string;
  category: string;
  reward_rub: number;
  safety_score_reward: number;
  scenario: string;
  options: string[];
  correct_option: number;
  explanation: string;
  is_completed: boolean;
}

export interface MemberDashboardInfo {
  member: FamilyMemberInfo;
  accounts: Account[];
  total_balance: number;
  safety_policy?: SafetyPolicy;
}

export interface CategoryExpense {
  category: string;
  mcc: string;
  total: number;
  count: number;
}

export interface MemberSpendingSummary {
  user_id: number;
  user_name: string;
  month_total: number;
  gaming_spend: number;
  gaming_limit: number;
  fast_food_spend: number;
  fast_food_limit: number;
}

export interface FamilyDashboardData {
  family: {
    id: number;
    name: string;
    owner_id: number;
  };
  caller: FamilyMemberInfo;
  total_family_net_worth: number;
  members: MemberDashboardInfo[];
  pending_requests: JoinRequest[];
  pending_requests_count: number;
  recent_transactions: Transaction[];
  category_expenses?: CategoryExpense[];
  spending_summaries?: MemberSpendingSummary[];
}
