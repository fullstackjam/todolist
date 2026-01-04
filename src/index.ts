import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Bindings, Variables, User, Todo } from "./types";
import {
  authMiddleware,
  getGitHubAuthUrl,
  exchangeCodeForToken,
  getGitHubUser,
  findOrCreateUser,
  createSession,
  deleteSession,
  setSessionCookie,
  clearSessionCookie,
} from "./auth";
import { getTodos, createTodo, updateTodo, deleteTodo } from "./db";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use("*", cors());
app.use("*", authMiddleware);

app.get("/", (c) => {
  const user = c.get("user");
  return c.html(renderPage(user));
});

app.get("/auth/github", (c) => {
  const redirectUri = `${c.env.APP_URL}/auth/github/callback`;
  const authUrl = getGitHubAuthUrl(c.env.GITHUB_CLIENT_ID, redirectUri);
  return c.redirect(authUrl);
});

app.get("/auth/github/callback", async (c) => {
  const code = c.req.query("code");
  if (!code) {
    return c.redirect("/?error=no_code");
  }

  const accessToken = await exchangeCodeForToken(
    c.env.GITHUB_CLIENT_ID,
    c.env.GITHUB_CLIENT_SECRET,
    code
  );

  if (!accessToken) {
    return c.redirect("/?error=token_failed");
  }

  const githubUser = await getGitHubUser(accessToken);
  if (!githubUser) {
    return c.redirect("/?error=user_failed");
  }

  const user = await findOrCreateUser(
    c.env.DB,
    githubUser.id,
    githubUser.login,
    githubUser.avatar_url
  );

  const sessionId = await createSession(c.env.DB, user.id);
  setSessionCookie(c, sessionId);

  return c.redirect("/");
});

app.get("/auth/logout", async (c) => {
  const session = c.get("session");
  if (session) {
    await deleteSession(c.env.DB, session.id);
    clearSessionCookie(c);
  }
  return c.redirect("/");
});

app.get("/api/todos", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const todos = await getTodos(c.env.DB, user.id);
  return c.json(todos);
});

app.post("/api/todos", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json<{ title: string }>();
  if (!body.title?.trim()) {
    return c.json({ error: "Title is required" }, 400);
  }

  const todo = await createTodo(c.env.DB, user.id, body.title.trim());
  return c.json(todo, 201);
});

app.patch("/api/todos/:id", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const todoId = parseInt(c.req.param("id"));
  const body = await c.req.json<{ title?: string; completed?: boolean }>();

  const todo = await updateTodo(c.env.DB, user.id, todoId, body);
  if (!todo) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.json(todo);
});

app.delete("/api/todos/:id", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const todoId = parseInt(c.req.param("id"));
  const deleted = await deleteTodo(c.env.DB, user.id, todoId);

  if (!deleted) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.json({ success: true });
});

function renderPage(user: User | null): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TodoList</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 2rem;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
    }
    .card {
      background: white;
      border-radius: 16px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
      padding: 2rem;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
    }
    .header h1 {
      font-size: 1.75rem;
      color: #333;
    }
    .user-info {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
    }
    .btn {
      padding: 0.5rem 1rem;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.875rem;
      font-weight: 500;
      transition: all 0.2s;
    }
    .btn-primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .btn-primary:hover { opacity: 0.9; transform: translateY(-1px); }
    .btn-secondary {
      background: #f1f1f1;
      color: #333;
    }
    .btn-secondary:hover { background: #e5e5e5; }
    .btn-danger {
      background: #ff4757;
      color: white;
      padding: 0.25rem 0.5rem;
    }
    .btn-danger:hover { background: #ff3344; }
    .login-section {
      text-align: center;
      padding: 3rem;
    }
    .login-section p {
      color: #666;
      margin-bottom: 1.5rem;
    }
    .add-form {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1.5rem;
    }
    .add-form input {
      flex: 1;
      padding: 0.75rem 1rem;
      border: 2px solid #eee;
      border-radius: 8px;
      font-size: 1rem;
      transition: border-color 0.2s;
    }
    .add-form input:focus {
      outline: none;
      border-color: #667eea;
    }
    .todo-list {
      list-style: none;
    }
    .todo-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 1rem;
      border-bottom: 1px solid #eee;
      transition: background 0.2s;
    }
    .todo-item:hover { background: #f9f9f9; }
    .todo-item:last-child { border-bottom: none; }
    .todo-checkbox {
      width: 22px;
      height: 22px;
      cursor: pointer;
      accent-color: #667eea;
    }
    .todo-title {
      flex: 1;
      font-size: 1rem;
      color: #333;
    }
    .todo-title.completed {
      text-decoration: line-through;
      color: #aaa;
    }
    .empty-state {
      text-align: center;
      padding: 2rem;
      color: #999;
    }
    .loading {
      text-align: center;
      padding: 2rem;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      ${user ? renderApp(user) : renderLogin()}
    </div>
  </div>
  ${user ? renderScript() : ""}
</body>
</html>`;
}

function renderLogin(): string {
  return `
    <div class="login-section">
      <h1>TodoList</h1>
      <p>Sign in with GitHub to manage your tasks</p>
      <a href="/auth/github" class="btn btn-primary" style="text-decoration: none; display: inline-block; padding: 0.75rem 1.5rem;">
        Sign in with GitHub
      </a>
    </div>
  `;
}

function renderApp(user: User): string {
  return `
    <div class="header">
      <h1>My Todos</h1>
      <div class="user-info">
        ${user.avatar_url ? `<img src="${user.avatar_url}" alt="${user.username}" class="avatar">` : ""}
        <span>${user.username}</span>
        <a href="/auth/logout" class="btn btn-secondary">Logout</a>
      </div>
    </div>
    <form class="add-form" onsubmit="addTodo(event)">
      <input type="text" id="todo-input" placeholder="What needs to be done?" autocomplete="off">
      <button type="submit" class="btn btn-primary">Add</button>
    </form>
    <ul class="todo-list" id="todo-list">
      <li class="loading">Loading...</li>
    </ul>
  `;
}

function renderScript(): string {
  return `
  <script>
    let todos = [];

    async function loadTodos() {
      const res = await fetch('/api/todos');
      todos = await res.json();
      renderTodos();
    }

    function renderTodos() {
      const list = document.getElementById('todo-list');
      if (todos.length === 0) {
        list.innerHTML = '<li class="empty-state">No todos yet. Add one above!</li>';
        return;
      }
      list.innerHTML = todos.map(todo => \`
        <li class="todo-item">
          <input type="checkbox" class="todo-checkbox" 
            \${todo.completed ? 'checked' : ''} 
            onchange="toggleTodo(\${todo.id})">
          <span class="todo-title \${todo.completed ? 'completed' : ''}">\${escapeHtml(todo.title)}</span>
          <button class="btn btn-danger" onclick="deleteTodo(\${todo.id})">Delete</button>
        </li>
      \`).join('');
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    async function addTodo(e) {
      e.preventDefault();
      const input = document.getElementById('todo-input');
      const title = input.value.trim();
      if (!title) return;

      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title })
      });

      if (res.ok) {
        const todo = await res.json();
        todos.unshift(todo);
        renderTodos();
        input.value = '';
      }
    }

    async function toggleTodo(id) {
      const todo = todos.find(t => t.id === id);
      if (!todo) return;

      const res = await fetch('/api/todos/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: !todo.completed })
      });

      if (res.ok) {
        const updated = await res.json();
        const idx = todos.findIndex(t => t.id === id);
        todos[idx] = updated;
        renderTodos();
      }
    }

    async function deleteTodo(id) {
      const res = await fetch('/api/todos/' + id, { method: 'DELETE' });
      if (res.ok) {
        todos = todos.filter(t => t.id !== id);
        renderTodos();
      }
    }

    loadTodos();
  </script>
  `;
}

export default app;
