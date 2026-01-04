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
  completed: number;
  created_at: string;
  updated_at: string;
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
