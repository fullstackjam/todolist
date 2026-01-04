export type Bindings = {
  DB: D1Database;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  APP_URL: string;
};

export type User = {
  id: number;
  github_id: string;
  username: string;
  avatar_url: string | null;
  created_at: string;
};

export type Todo = {
  id: number;
  user_id: number;
  title: string;
  description: string | null;
  priority: number;
  due_date: string | null;
  status: 'todo' | 'doing' | 'done';
  estimated_minutes: number | null;
  actual_minutes: number | null;
  archived: number;
  repeat_type: 'daily' | 'weekly' | 'monthly' | null;
  repeat_interval: number;
  completed: number;
  share_token: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type TodoWithTags = Todo & {
  tags: Tag[];
  subtasks: Subtask[];
  progress: number;
};

export type Tag = {
  id: number;
  user_id: number;
  name: string;
  color: string;
  created_at: string;
};

export type Subtask = {
  id: number;
  todo_id: number;
  title: string;
  completed: number;
  sort_order: number;
  created_at: string;
};

export type Comment = {
  id: number;
  todo_id: number;
  user_id: number;
  content: string;
  created_at: string;
  username?: string;
  avatar_url?: string | null;
};

export type DailyStats = {
  id: number;
  user_id: number;
  date: string;
  completed_count: number;
  created_count: number;
  total_estimated_minutes: number;
  total_actual_minutes: number;
};

export type SummaryReportDay = {
  date: string;
  createdCount: number;
  completedCount: number;
  totalActualMinutes: number;
  avgActualMinutes: number;
  actualMinutesSampleCount: number;
  totalEstimatedMinutes: number;
  avgEstimatedMinutes: number;
  estimatedMinutesSampleCount: number;
};

export type SummaryReport = {
  range: {
    start: string;
    end: string;
    days: number;
  };
  totals: {
    createdCount: number;
    completedCount: number;
    totalActualMinutes: number;
    avgActualMinutes: number;
    actualMinutesSampleCount: number;
    totalEstimatedMinutes: number;
    avgEstimatedMinutes: number;
    estimatedMinutesSampleCount: number;
  };
  perDay: SummaryReportDay[];
};

export type Session = {
  id: string;
  user_id: number;
  expires_at: string;
  created_at: string;
};

export type Variables = {
  user: User | null;
  session: Session | null;
};

export type TodoFilter = {
  status?: string;
  priority?: number;
  archived?: boolean;
  tagId?: number;
  dueBefore?: string;
  dueAfter?: string;
  search?: string;
};
