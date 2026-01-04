import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Bindings, Variables, User, Todo, TodoWithTags, Tag, Subtask } from "./types";
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
import {
  getTodos, getTodoById, createTodo, updateTodo, deleteTodo,
  getTags, createTag, deleteTag,
  getSubtasks, createSubtask, updateSubtask, deleteSubtask,
  getComments, createComment, deleteComment,
  shareTodo, unshareTodo, getTodoByShareToken,
  getStats, processRepeatTasks
} from "./db";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use("*", cors());
app.use("*", authMiddleware);

app.get("/", async (c) => {
  const user = c.get("user");
  if (user) {
    await processRepeatTasks(c.env.DB, user.id);
  }
  const view = c.req.query("view") || "list";
  return c.html(renderPage(user, view, c.env.APP_URL));
});

app.get("/auth/github", (c) => {
  const redirectUri = `${c.env.APP_URL}/auth/github/callback`;
  const authUrl = getGitHubAuthUrl(c.env.GITHUB_CLIENT_ID, redirectUri);
  return c.redirect(authUrl);
});

app.get("/auth/github/callback", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.redirect("/?error=no_code");

  const accessToken = await exchangeCodeForToken(c.env.GITHUB_CLIENT_ID, c.env.GITHUB_CLIENT_SECRET, code);
  if (!accessToken) return c.redirect("/?error=token_failed");

  const githubUser = await getGitHubUser(accessToken);
  if (!githubUser) return c.redirect("/?error=user_failed");

  const user = await findOrCreateUser(c.env.DB, githubUser.id, githubUser.login, githubUser.avatar_url);
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
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const filter = {
    status: c.req.query("status"),
    priority: c.req.query("priority") ? parseInt(c.req.query("priority")!) : undefined,
    archived: c.req.query("archived") === "true",
    tagId: c.req.query("tagId") ? parseInt(c.req.query("tagId")!) : undefined,
    dueBefore: c.req.query("dueBefore"),
    dueAfter: c.req.query("dueAfter"),
    search: c.req.query("search"),
  };

  const todos = await getTodos(c.env.DB, user.id, filter);
  return c.json(todos);
});

app.post("/api/todos", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json();
  if (!body.title?.trim()) return c.json({ error: "Title is required" }, 400);

  const todo = await createTodo(c.env.DB, user.id, {
    title: body.title.trim(),
    description: body.description,
    priority: body.priority,
    due_date: body.due_date,
    estimated_minutes: body.estimated_minutes,
    repeat_type: body.repeat_type,
    repeat_interval: body.repeat_interval,
    tagIds: body.tagIds,
  });

  return c.json(todo, 201);
});

app.patch("/api/todos/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const todoId = parseInt(c.req.param("id"));
  const body = await c.req.json();

  const todo = await updateTodo(c.env.DB, user.id, todoId, body);
  if (!todo) return c.json({ error: "Not found" }, 404);

  return c.json(todo);
});

app.delete("/api/todos/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const todoId = parseInt(c.req.param("id"));
  const deleted = await deleteTodo(c.env.DB, user.id, todoId);
  if (!deleted) return c.json({ error: "Not found" }, 404);

  return c.json({ success: true });
});

app.get("/api/tags", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const tags = await getTags(c.env.DB, user.id);
  return c.json(tags);
});

app.post("/api/tags", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json();
  if (!body.name?.trim()) return c.json({ error: "Name is required" }, 400);

  const tag = await createTag(c.env.DB, user.id, body.name.trim(), body.color);
  return c.json(tag, 201);
});

app.delete("/api/tags/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const tagId = parseInt(c.req.param("id"));
  const deleted = await deleteTag(c.env.DB, user.id, tagId);
  if (!deleted) return c.json({ error: "Not found" }, 404);

  return c.json({ success: true });
});

app.get("/api/todos/:id/subtasks", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const todoId = parseInt(c.req.param("id"));
  const subtasks = await getSubtasks(c.env.DB, todoId);
  return c.json(subtasks);
});

app.post("/api/todos/:id/subtasks", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const todoId = parseInt(c.req.param("id"));
  const body = await c.req.json();
  if (!body.title?.trim()) return c.json({ error: "Title is required" }, 400);

  const subtask = await createSubtask(c.env.DB, todoId, body.title.trim());
  return c.json(subtask, 201);
});

app.patch("/api/subtasks/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const subtaskId = parseInt(c.req.param("id"));
  const body = await c.req.json();

  const subtask = await updateSubtask(c.env.DB, subtaskId, body);
  if (!subtask) return c.json({ error: "Not found" }, 404);

  return c.json(subtask);
});

app.delete("/api/subtasks/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const subtaskId = parseInt(c.req.param("id"));
  const deleted = await deleteSubtask(c.env.DB, subtaskId);
  if (!deleted) return c.json({ error: "Not found" }, 404);

  return c.json({ success: true });
});

app.get("/api/todos/:id/comments", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const todoId = parseInt(c.req.param("id"));
  const comments = await getComments(c.env.DB, todoId);
  return c.json(comments);
});

app.post("/api/todos/:id/comments", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const todoId = parseInt(c.req.param("id"));
  const body = await c.req.json();
  if (!body.content?.trim()) return c.json({ error: "Content is required" }, 400);

  const comment = await createComment(c.env.DB, todoId, user.id, body.content.trim());
  return c.json(comment, 201);
});

app.delete("/api/comments/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const commentId = parseInt(c.req.param("id"));
  const deleted = await deleteComment(c.env.DB, commentId, user.id);
  if (!deleted) return c.json({ error: "Not found" }, 404);

  return c.json({ success: true });
});

app.post("/api/todos/:id/share", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const todoId = parseInt(c.req.param("id"));
  const token = await shareTodo(c.env.DB, user.id, todoId);
  if (!token) return c.json({ error: "Not found" }, 404);

  return c.json({ share_token: token, share_url: `${c.env.APP_URL}/share/${token}` });
});

app.delete("/api/todos/:id/share", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const todoId = parseInt(c.req.param("id"));
  const success = await unshareTodo(c.env.DB, user.id, todoId);
  if (!success) return c.json({ error: "Not found" }, 404);

  return c.json({ success: true });
});

app.get("/api/stats", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const stats = await getStats(c.env.DB, user.id);
  return c.json(stats);
});

app.get("/share/:token", async (c) => {
  const token = c.req.param("token");
  const todo = await getTodoByShareToken(c.env.DB, token);
  if (!todo) return c.html(renderNotFound());

  const comments = await getComments(c.env.DB, todo.id);
  const subtasks = await getSubtasks(c.env.DB, todo.id);
  return c.html(renderSharePage(todo, comments, subtasks));
});

function renderPage(user: User | null, view: string, appUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TodoList Pro</title>
  <style>${getStyles()}</style>
</head>
<body>
  <div class="app">
    ${user ? renderApp(user, view) : renderLogin()}
  </div>
  ${user ? `<script>const APP_URL = "${appUrl}";${getScript()}</script>` : ""}
</body>
</html>`;
}

function renderLogin(): string {
  return `
    <div class="login-container">
      <div class="login-card">
        <h1>TodoList Pro</h1>
        <p>A powerful task management app with tags, subtasks, kanban view, and more.</p>
        <a href="/auth/github" class="btn btn-primary btn-lg">Sign in with GitHub</a>
      </div>
    </div>
  `;
}

function renderApp(user: User, view: string): string {
  return `
    <nav class="navbar">
      <div class="nav-brand">TodoList Pro</div>
      <div class="nav-views">
        <a href="/?view=list" class="nav-link ${view === 'list' ? 'active' : ''}">List</a>
        <a href="/?view=kanban" class="nav-link ${view === 'kanban' ? 'active' : ''}">Kanban</a>
        <a href="/?view=gantt" class="nav-link ${view === 'gantt' ? 'active' : ''}">Gantt</a>
        <a href="/?view=dashboard" class="nav-link ${view === 'dashboard' ? 'active' : ''}">Dashboard</a>


      </div>
      <div class="nav-user">
        ${user.avatar_url ? `<img src="${user.avatar_url}" class="avatar" alt="">` : ''}
        <span>${user.username}</span>
        <a href="/auth/logout" class="btn btn-sm">Logout</a>
      </div>
    </nav>
    <main class="main-content">
      <aside class="sidebar">
        <div class="sidebar-section">
          <h3>Filters</h3>
          <div class="filter-group">
            <label>Status</label>
            <select id="filter-status" onchange="applyFilters()">
              <option value="">All</option>
              <option value="todo">Todo</option>
              <option value="doing">Doing</option>
              <option value="done">Done</option>
            </select>
          </div>
          <div class="filter-group">
            <label>Priority</label>
            <select id="filter-priority" onchange="applyFilters()">
              <option value="">All</option>
              <option value="3">High</option>
              <option value="2">Medium</option>
              <option value="1">Low</option>
              <option value="0">None</option>
            </select>
          </div>
          <div class="filter-group">
            <label>Due Date</label>
            <select id="filter-due" onchange="applyFilters()">
              <option value="">All</option>
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="overdue">Overdue</option>
            </select>
          </div>
          <div class="filter-group">
            <input type="text" id="filter-search" placeholder="Search..." oninput="debounceSearch()">
          </div>
          <label class="checkbox-label">
            <input type="checkbox" id="filter-archived" onchange="applyFilters()"> Show Archived
          </label>
        </div>
        <div class="sidebar-section">
          <h3>Tags <button class="btn-icon" onclick="showTagModal()">+</button></h3>
          <div id="tag-list"></div>
        </div>
      </aside>
      <div class="content" id="main-view">
        ${view === 'list' ? renderListView() : view === 'kanban' ? renderKanbanView() : view === 'gantt' ? renderGanttView() : renderDashboardView()}
      </div>
    </main>
    ${renderModals()}
  `;
}

function renderListView(): string {
  return `
    <div class="list-view">
      <div class="list-header">
        <h2>My Tasks</h2>
        <button class="btn btn-primary" onclick="showTodoModal()">+ Add Task</button>
      </div>
      <div id="todo-list" class="todo-list"><div class="loading">Loading...</div></div>
    </div>
  `;
}

function renderKanbanView(): string {
  return `
    <div class="kanban-view">
      <div class="kanban-header">
        <h2>Kanban Board</h2>
        <button class="btn btn-primary" onclick="showTodoModal()">+ Add Task</button>
      </div>
      <div class="kanban-board">
        <div class="kanban-column" data-status="todo">
          <div class="kanban-column-header">Todo</div>
          <div class="kanban-cards" id="kanban-todo" ondrop="drop(event, 'todo')" ondragover="allowDrop(event)"></div>
        </div>
        <div class="kanban-column" data-status="doing">
          <div class="kanban-column-header">Doing</div>
          <div class="kanban-cards" id="kanban-doing" ondrop="drop(event, 'doing')" ondragover="allowDrop(event)"></div>
        </div>
        <div class="kanban-column" data-status="done">
          <div class="kanban-column-header">Done</div>
          <div class="kanban-cards" id="kanban-done" ondrop="drop(event, 'done')" ondragover="allowDrop(event)"></div>
        </div>
      </div>
    </div>
  `;
}

function renderGanttView(): string {
  return `
    <div class="gantt-view">
      <div class="gantt-toolbar">
        <div class="gantt-toolbar-left">
          <h2>Timeline</h2>
          <button class="btn btn-sm" onclick="scrollToToday()" id="btn-today">Today</button>
        </div>
        <div class="gantt-toolbar-center">
          <div class="zoom-controls">
            <button class="zoom-btn" data-zoom="day" onclick="setZoom('day')">Day</button>
            <button class="zoom-btn active" data-zoom="week" onclick="setZoom('week')">Week</button>
            <button class="zoom-btn" data-zoom="month" onclick="setZoom('month')">Month</button>
          </div>
        </div>
        <div class="gantt-toolbar-right">
          <div class="gantt-legend">
            <span class="legend-item"><span class="legend-dot status-todo"></span>Todo</span>
            <span class="legend-item"><span class="legend-dot status-doing"></span>Doing</span>
            <span class="legend-item"><span class="legend-dot status-done"></span>Done</span>
            <span class="legend-item"><span class="legend-dot status-overdue"></span>Overdue</span>
          </div>
        </div>
      </div>
      <div class="gantt-container" id="gantt-container">
        <div class="gantt-panel">
          <div class="gantt-task-list" id="gantt-task-list">
            <div class="gantt-task-header">Tasks</div>
          </div>
          <div class="gantt-timeline" id="gantt-timeline">
            <div class="gantt-timeline-header" id="gantt-timeline-header"></div>
            <div class="gantt-timeline-body" id="gantt-timeline-body"></div>
            <div class="gantt-today-line" id="gantt-today-line"><span class="today-label">Today</span></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderDashboardView(): string {
  return `
    <div class="dashboard-view">
      <h2>Dashboard</h2>
      <div class="stats-grid" id="stats-grid"><div class="loading">Loading stats...</div></div>
      <div class="charts-row">
        <div class="chart-card">
          <h3>By Status</h3>
          <div id="chart-status"></div>
        </div>
        <div class="chart-card">
          <h3>By Priority</h3>
          <div id="chart-priority"></div>
        </div>
      </div>
    </div>
  `;
}

function renderModals(): string {
  return `
    <div id="todo-modal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h3 id="todo-modal-title">Add Task</h3>
          <button class="btn-close" onclick="closeModal('todo-modal')">&times;</button>
        </div>
        <form id="todo-form" onsubmit="saveTodo(event)">
          <input type="hidden" id="todo-id">
          <div class="form-group">
            <label>Title *</label>
            <input type="text" id="todo-title" required>
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea id="todo-description" rows="3"></textarea>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Priority</label>
              <select id="todo-priority">
                <option value="0">None</option>
                <option value="1">Low</option>
                <option value="2">Medium</option>
                <option value="3">High</option>
              </select>
            </div>
            <div class="form-group">
              <label>Due Date</label>
              <input type="datetime-local" id="todo-due">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Estimated (min)</label>
              <input type="number" id="todo-estimated" min="0">
            </div>
            <div class="form-group">
              <label>Actual (min)</label>
              <input type="number" id="todo-actual" min="0">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Repeat</label>
              <select id="todo-repeat">
                <option value="">None</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div class="form-group">
              <label>Every N</label>
              <input type="number" id="todo-repeat-interval" min="1" value="1">
            </div>
          </div>
          <div class="form-group">
            <label>Tags</label>
            <div id="todo-tags-select" class="tags-select"></div>
          </div>
          <div class="form-actions">
            <button type="button" class="btn" onclick="closeModal('todo-modal')">Cancel</button>
            <button type="submit" class="btn btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>
    <div id="tag-modal" class="modal">
      <div class="modal-content modal-sm">
        <div class="modal-header">
          <h3>Add Tag</h3>
          <button class="btn-close" onclick="closeModal('tag-modal')">&times;</button>
        </div>
        <form onsubmit="saveTag(event)">
          <div class="form-group">
            <label>Name</label>
            <input type="text" id="tag-name" required>
          </div>
          <div class="form-group">
            <label>Color</label>
            <input type="color" id="tag-color" value="#667eea">
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">Create</button>
          </div>
        </form>
      </div>
    </div>
    <div id="detail-modal" class="modal">
      <div class="modal-content modal-lg">
        <div class="modal-header">
          <h3 id="detail-title">Task Details</h3>
          <button class="btn-close" onclick="closeModal('detail-modal')">&times;</button>
        </div>
        <div id="detail-content"></div>
      </div>
    </div>
  `;
}

function getStyles(): string {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f7fa; min-height: 100vh; }
    .app { min-height: 100vh; display: flex; flex-direction: column; }
    
    .login-container { display: flex; align-items: center; justify-content: center; min-height: 100vh; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
    .login-card { background: white; padding: 3rem; border-radius: 16px; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,0.2); max-width: 400px; }
    .login-card h1 { margin-bottom: 1rem; color: #333; }
    .login-card p { color: #666; margin-bottom: 2rem; }
    
    .navbar { display: flex; align-items: center; padding: 0 1.5rem; height: 60px; background: white; border-bottom: 1px solid #e1e4e8; gap: 2rem; }
    .nav-brand { font-weight: 700; font-size: 1.25rem; color: #667eea; }
    .nav-views { display: flex; gap: 0.5rem; }
    .nav-link { padding: 0.5rem 1rem; border-radius: 6px; text-decoration: none; color: #666; font-weight: 500; }
    .nav-link:hover, .nav-link.active { background: #f0f0f0; color: #333; }
    .nav-user { margin-left: auto; display: flex; align-items: center; gap: 0.75rem; }
    .avatar { width: 32px; height: 32px; border-radius: 50%; }
    
    .main-content { display: flex; flex: 1; overflow: hidden; }
    .sidebar { width: 260px; background: white; border-right: 1px solid #e1e4e8; padding: 1.5rem; overflow-y: auto; }
    .sidebar-section { margin-bottom: 1.5rem; }
    .sidebar-section h3 { font-size: 0.875rem; color: #666; margin-bottom: 0.75rem; display: flex; align-items: center; justify-content: space-between; }
    .filter-group { margin-bottom: 0.75rem; }
    .filter-group label { display: block; font-size: 0.75rem; color: #999; margin-bottom: 0.25rem; }
    .filter-group select, .filter-group input { width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 6px; font-size: 0.875rem; }
    .checkbox-label { display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; color: #666; cursor: pointer; }
    
    .content { flex: 1; padding: 1.5rem; overflow-y: auto; }
    .list-header, .kanban-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
    .list-header h2, .kanban-header h2 { font-size: 1.5rem; color: #333; }
    
    .todo-list { display: flex; flex-direction: column; gap: 0.75rem; }
    .todo-card { background: white; border-radius: 8px; padding: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); cursor: pointer; transition: box-shadow 0.2s; }
    .todo-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
    .todo-card-header { display: flex; align-items: flex-start; gap: 0.75rem; }
    .todo-checkbox { width: 20px; height: 20px; cursor: pointer; accent-color: #667eea; flex-shrink: 0; margin-top: 2px; }
    .todo-card-content { flex: 1; min-width: 0; }
    .todo-card-title { font-weight: 500; color: #333; margin-bottom: 0.25rem; }
    .todo-card-title.completed { text-decoration: line-through; color: #999; }
    .todo-card-meta { display: flex; flex-wrap: wrap; gap: 0.5rem; font-size: 0.75rem; color: #666; }
    .todo-card-actions { display: flex; gap: 0.5rem; }
    .priority-badge { padding: 0.125rem 0.5rem; border-radius: 4px; font-size: 0.7rem; font-weight: 500; }
    .priority-3 { background: #fee2e2; color: #dc2626; }
    .priority-2 { background: #fef3c7; color: #d97706; }
    .priority-1 { background: #dbeafe; color: #2563eb; }
    .tag-badge { padding: 0.125rem 0.5rem; border-radius: 4px; font-size: 0.7rem; color: white; }
    .due-badge { padding: 0.125rem 0.5rem; border-radius: 4px; background: #f3f4f6; }
    .due-badge.overdue { background: #fee2e2; color: #dc2626; }
    .progress-bar { height: 4px; background: #e5e7eb; border-radius: 2px; overflow: hidden; margin-top: 0.5rem; }
    .progress-fill { height: 100%; background: #667eea; transition: width 0.3s; }
    
    .kanban-board { display: flex; gap: 1rem; overflow-x: auto; padding-bottom: 1rem; }
    .kanban-column { flex: 1; min-width: 280px; background: #f0f0f0; border-radius: 8px; padding: 1rem; }
    .kanban-column-header { font-weight: 600; color: #333; margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 2px solid #ddd; }
    .kanban-cards { min-height: 200px; display: flex; flex-direction: column; gap: 0.75rem; }
    .kanban-card { background: white; border-radius: 6px; padding: 0.75rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); cursor: grab; }
    .kanban-card:active { cursor: grabbing; }
    .kanban-card.dragging { opacity: 0.5; }
    
    .dashboard-view h2 { margin-bottom: 1.5rem; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .stat-card { background: white; border-radius: 8px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .stat-value { font-size: 2rem; font-weight: 700; color: #667eea; }
    .stat-label { font-size: 0.875rem; color: #666; margin-top: 0.25rem; }
    .charts-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem; }
    .chart-card { background: white; border-radius: 8px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .chart-card h3 { font-size: 1rem; color: #333; margin-bottom: 1rem; }
    .chart-bar { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
    .chart-bar-label { width: 60px; font-size: 0.75rem; color: #666; }
    .chart-bar-fill { height: 20px; border-radius: 4px; transition: width 0.3s; }
    .chart-bar-value { font-size: 0.75rem; color: #666; }
    
    .gantt-view { display: flex; flex-direction: column; height: calc(100vh - 180px); }
    .gantt-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; background: white; border-radius: 12px 12px 0 0; border: 1px solid #e2e8f0; border-bottom: none; gap: 1rem; flex-wrap: wrap; }
    .gantt-toolbar h2 { font-size: 1.25rem; margin: 0; color: #1e293b; }
    .gantt-toolbar-left { display: flex; align-items: center; gap: 1rem; }
    .gantt-toolbar-center { display: flex; align-items: center; }
    .gantt-toolbar-right { display: flex; align-items: center; }
    .zoom-controls { display: flex; background: #f1f5f9; border-radius: 8px; padding: 3px; gap: 2px; }
    .zoom-btn { padding: 0.4rem 1rem; border: none; background: transparent; border-radius: 6px; cursor: pointer; font-size: 0.8rem; font-weight: 600; color: #64748b; transition: all 0.2s; }
    .zoom-btn:hover { color: #334155; }
    .zoom-btn.active { background: white; color: #667eea; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .gantt-legend { display: flex; gap: 1rem; font-size: 0.75rem; color: #64748b; font-weight: 500; }
    .legend-item { display: flex; align-items: center; gap: 0.35rem; }
    .legend-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .status-todo { background: #94a3b8; }
    .status-doing { background: #3b82f6; }
    .status-done { background: #22c55e; }
    .status-overdue { background: #ef4444; }
    .gantt-container { flex: 1; background: white; border-radius: 0 0 12px 12px; border: 1px solid #e2e8f0; overflow: hidden; min-height: 300px; }
    .gantt-panel { display: flex; height: 100%; position: relative; }
    .gantt-task-list { width: 200px; flex-shrink: 0; border-right: 1px solid #e2e8f0; background: #f8fafc; display: flex; flex-direction: column; }
    .gantt-task-header { padding: 0.75rem 1rem; font-weight: 600; font-size: 0.75rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #e2e8f0; background: #f1f5f9; height: 65px; display: flex; align-items: flex-end; }
    .gantt-task-item { padding: 0.6rem 1rem; border-bottom: 1px solid #f1f5f9; display: flex; align-items: center; gap: 0.5rem; height: 44px; cursor: pointer; transition: background 0.15s; }
    .gantt-task-item:hover { background: #e2e8f0; }
    .gantt-task-status { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .gantt-task-title { font-size: 0.8rem; color: #334155; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
    .gantt-task-priority { font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; font-weight: 600; }
    .gantt-task-priority.high { background: #fee2e2; color: #dc2626; }
    .gantt-timeline { flex: 1; overflow-x: auto; overflow-y: hidden; position: relative; }
    .gantt-timeline-header { position: sticky; top: 0; background: #f8fafc; z-index: 10; border-bottom: 1px solid #e2e8f0; }
    .gantt-timeline-months { display: flex; border-bottom: 1px solid #e2e8f0; }
    .gantt-month-cell { padding: 0.5rem 0; text-align: center; font-size: 0.75rem; font-weight: 600; color: #334155; border-right: 1px solid #e2e8f0; background: #f1f5f9; }
    .gantt-timeline-units { display: flex; }
    .gantt-unit-cell { padding: 0.4rem 0; text-align: center; font-size: 0.65rem; color: #94a3b8; border-right: 1px solid #f1f5f9; font-weight: 500; }
    .gantt-unit-cell.weekend { background: #fef3c7; }
    .gantt-unit-cell.today { background: #fee2e2; color: #dc2626; font-weight: 700; }
    .gantt-timeline-body { position: relative; min-height: 200px; }
    .gantt-timeline-row { height: 44px; border-bottom: 1px solid #f1f5f9; position: relative; }
    .gantt-timeline-grid { position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; pointer-events: none; }
    .gantt-grid-cell { border-right: 1px solid #f1f5f9; height: 100%; }
    .gantt-grid-cell.weekend { background: rgba(254, 243, 199, 0.3); }
    .gantt-bar { position: absolute; top: 6px; height: 32px; border-radius: 6px; padding: 4px 10px; color: #fff; display: flex; align-items: center; gap: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.15); cursor: pointer; transition: all 0.15s ease; z-index: 2; min-width: 24px; }
    .gantt-bar:hover { transform: translateY(-1px); box-shadow: 0 4px 8px rgba(0,0,0,0.2); z-index: 20; }
    .gantt-bar.status-todo { background: linear-gradient(135deg, #94a3b8 0%, #64748b 100%); }
    .gantt-bar.status-doing { background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); }
    .gantt-bar.status-done { background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); }
    .gantt-bar.overdue { box-shadow: 0 0 0 2px #ef4444, 0 2px 4px rgba(0,0,0,0.15); }
    .gantt-bar.due-today { box-shadow: 0 0 0 2px #f59e0b, 0 2px 4px rgba(0,0,0,0.15); }
    .gantt-bar-title { font-size: 0.75rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 1px 2px rgba(0,0,0,0.2); }
    .gantt-bar-progress { position: absolute; bottom: 2px; left: 4px; right: 4px; height: 3px; background: rgba(255,255,255,0.3); border-radius: 2px; overflow: hidden; }
    .gantt-bar-progress-fill { height: 100%; background: rgba(255,255,255,0.8); border-radius: 2px; }
    .gantt-today-line { position: absolute; top: 0; bottom: 0; width: 2px; background: #ef4444; z-index: 15; pointer-events: none; display: none; }
    .gantt-today-line::before { content: ''; position: absolute; top: -4px; left: -4px; width: 10px; height: 10px; background: #ef4444; border-radius: 50%; }
    .today-label { position: absolute; top: -20px; left: 50%; transform: translateX(-50%); font-size: 0.65rem; font-weight: 700; color: #ef4444; white-space: nowrap; background: white; padding: 2px 6px; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .gantt-empty { display: flex; align-items: center; justify-content: center; height: 100%; color: #94a3b8; font-size: 0.9rem; }
    
    .btn { padding: 0.5rem 1rem; border: none; border-radius: 6px; cursor: pointer; font-size: 0.875rem; font-weight: 500; background: #f0f0f0; color: #333; transition: all 0.2s; text-decoration: none; display: inline-block; }
    .btn:hover { background: #e0e0e0; }
    .btn-primary { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
    .btn-primary:hover { opacity: 0.9; }
    .btn-danger { background: #ef4444; color: white; }
    .btn-sm { padding: 0.25rem 0.75rem; font-size: 0.75rem; }
    .btn-lg { padding: 0.75rem 1.5rem; font-size: 1rem; }
    .btn-icon { background: none; border: none; cursor: pointer; font-size: 1.25rem; color: #667eea; padding: 0; }
    .btn-close { background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #999; }
    
    .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); align-items: center; justify-content: center; z-index: 1000; }
    .modal.active { display: flex; }
    .modal-content { background: white; border-radius: 12px; width: 100%; max-width: 500px; max-height: 90vh; overflow-y: auto; }
    .modal-sm { max-width: 350px; }
    .modal-lg { max-width: 700px; }
    .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.5rem; border-bottom: 1px solid #eee; }
    .modal-header h3 { font-size: 1.125rem; }
    .modal-content form { padding: 1.5rem; }
    .form-group { margin-bottom: 1rem; }
    .form-group label { display: block; font-size: 0.875rem; color: #333; margin-bottom: 0.25rem; }
    .form-group input, .form-group select, .form-group textarea { width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 6px; font-size: 0.875rem; }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .form-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid #eee; }
    .tags-select { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .tag-option { padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.75rem; cursor: pointer; border: 2px solid transparent; }
    .tag-option.selected { border-color: #333; }
    
    .detail-section { padding: 1rem 1.5rem; border-bottom: 1px solid #eee; }
    .detail-section:last-child { border-bottom: none; }
    .detail-section h4 { font-size: 0.875rem; color: #666; margin-bottom: 0.75rem; }
    .subtask-list { display: flex; flex-direction: column; gap: 0.5rem; }
    .subtask-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem; background: #f9f9f9; border-radius: 6px; }
    .subtask-item input[type="checkbox"] { accent-color: #667eea; }
    .subtask-item span { flex: 1; font-size: 0.875rem; }
    .subtask-item span.completed { text-decoration: line-through; color: #999; }
    .subtask-form { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
    .subtask-form input { flex: 1; padding: 0.5rem; border: 1px solid #ddd; border-radius: 6px; font-size: 0.875rem; }
    .comment-list { display: flex; flex-direction: column; gap: 0.75rem; }
    .comment-item { display: flex; gap: 0.5rem; }
    .comment-avatar { width: 28px; height: 28px; border-radius: 50%; }
    .comment-body { flex: 1; }
    .comment-author { font-weight: 500; font-size: 0.875rem; }
    .comment-text { font-size: 0.875rem; color: #666; margin-top: 0.125rem; }
    .comment-form { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
    .comment-form input { flex: 1; padding: 0.5rem; border: 1px solid #ddd; border-radius: 6px; }
    .share-section { display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem; background: #e7f5ff; border-radius: 6px; margin-top: 0.75rem; }
    .share-section input { flex: 1; border: none; background: transparent; font-size: 0.75rem; }
    
    .tag-list-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem; border-radius: 6px; cursor: pointer; margin-bottom: 0.25rem; }
    .tag-list-item:hover { background: #f0f0f0; }
    .tag-list-item.active { background: #e7f5ff; }
    .tag-dot { width: 12px; height: 12px; border-radius: 50%; }
    .tag-name { flex: 1; font-size: 0.875rem; }
    
    .loading { text-align: center; padding: 2rem; color: #666; }
    .empty-state { text-align: center; padding: 3rem; color: #999; }
    
    @media (max-width: 768px) {
      .sidebar { display: none; }
      .nav-views { display: none; }
      .kanban-board { flex-direction: column; }
    }
  `;
}

function getScript(): string {
  return `
    let todos = [];
    let tags = [];
    let selectedTagId = null;
    let searchTimeout = null;
    let ganttZoom = 'week';
    const view = new URLSearchParams(location.search).get('view') || 'list';
    const DAY_MS = 24 * 60 * 60 * 1000;
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    async function init() {
      await Promise.all([loadTodos(), loadTags()]);
      if (view === 'dashboard') loadStats();
    }

    async function loadTodos() {
      const params = new URLSearchParams();
      const status = document.getElementById('filter-status')?.value;
      const priority = document.getElementById('filter-priority')?.value;
      const due = document.getElementById('filter-due')?.value;
      const search = document.getElementById('filter-search')?.value;
      const archived = document.getElementById('filter-archived')?.checked;

      if (status) params.set('status', status);
      if (priority) params.set('priority', priority);
      if (search) params.set('search', search);
      if (archived) params.set('archived', 'true');
      if (selectedTagId) params.set('tagId', selectedTagId);
      
      if (due === 'today') {
        const today = new Date().toISOString().split('T')[0];
        params.set('dueBefore', today + 'T23:59:59');
        params.set('dueAfter', today + 'T00:00:00');
      } else if (due === 'week') {
        const today = new Date();
        const weekLater = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
        params.set('dueBefore', weekLater.toISOString());
      } else if (due === 'overdue') {
        params.set('dueBefore', new Date().toISOString());
      }

      const res = await fetch('/api/todos?' + params);
      todos = await res.json();
      renderTodos();
    }

    async function loadTags() {
      const res = await fetch('/api/tags');
      tags = await res.json();
      renderTags();
      renderTagsSelect();
    }

    async function loadStats() {
      const res = await fetch('/api/stats');
      const stats = await res.json();
      renderStats(stats);
    }

    function renderTodos() {
      if (view === 'kanban') {
        renderKanban();
      } else if (view === 'list') {
        renderList();
      } else if (view === 'gantt') {
        renderGantt();
      }
    }

    function renderList() {
      const container = document.getElementById('todo-list');
      if (!container) return;
      
      if (todos.length === 0) {
        container.innerHTML = '<div class="empty-state">No tasks yet. Click "+ Add Task" to create one.</div>';
        return;
      }

      container.innerHTML = todos.map(todo => renderTodoCard(todo)).join('');
    }

    function renderKanban() {
      ['todo', 'doing', 'done'].forEach(status => {
        const container = document.getElementById('kanban-' + status);
        if (!container) return;

        const statusTodos = todos.filter(t => t.status === status);
        const cards = statusTodos.map(todo => {
          const tagsHtml = todo.tags.length
            ? '<div class="todo-card-meta">' + todo.tags.map(t => '<span class="tag-badge" style="background:' + t.color + '">' + esc(t.name) + '</span>').join('') + '</div>'
            : '';
          const progressHtml = todo.progress > 0
            ? '<div class="progress-bar"><div class="progress-fill" style="width:' + todo.progress + '%"></div></div>'
            : '';
          return (
            '<div class="kanban-card" draggable="true" ondragstart="drag(event)" data-id="' + todo.id + '">' +
            '<div class="todo-card-title ' + (todo.completed ? 'completed' : '') + '">' + esc(todo.title) + '</div>' +
            tagsHtml +
            progressHtml +
            '</div>'
          );
        }).join('');
        container.innerHTML = cards || '<div class="empty-state" style="padding:1rem;font-size:0.875rem;">Drop tasks here</div>';
      });
    }





    function setZoom(level) {
      ganttZoom = level;
      document.querySelectorAll('.zoom-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.zoom === level);
      });
      renderGantt();
    }

    function scrollToToday() {
      const todayLine = document.getElementById('gantt-today-line');
      const timeline = document.getElementById('gantt-timeline');
      if (todayLine && timeline && todayLine.style.display !== 'none') {
        const lineLeft = parseInt(todayLine.style.left) || 0;
        timeline.scrollLeft = Math.max(0, lineLeft - timeline.clientWidth / 2);
      }
    }

    function getWeekNumber(d) {
      const date = new Date(d.getTime());
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
      const week1 = new Date(date.getFullYear(), 0, 4);
      return 1 + Math.round(((date.getTime() - week1.getTime()) / DAY_MS - 3 + (week1.getDay() + 6) % 7) / 7);
    }

    function isWeekend(d) {
      const day = d.getDay();
      return day === 0 || day === 6;
    }

    function isSameDay(d1, d2) {
      return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
    }

    function renderGantt() {
      const taskList = document.getElementById('gantt-task-list');
      const timelineHeader = document.getElementById('gantt-timeline-header');
      const timelineBody = document.getElementById('gantt-timeline-body');
      const todayLine = document.getElementById('gantt-today-line');
      if (!taskList || !timelineHeader || !timelineBody) return;

      if (!todos.length) {
        taskList.innerHTML = '<div class="gantt-task-header">Tasks</div><div class="gantt-empty">No tasks</div>';
        timelineHeader.innerHTML = '';
        timelineBody.innerHTML = '<div class="gantt-empty">Add tasks with due dates to see the timeline</div>';
        if (todayLine) todayLine.style.display = 'none';
        return;
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const parsedTodos = todos.map(todo => {
        const dueDate = todo.due_date ? new Date(todo.due_date) : null;
        const createdDate = new Date(todo.created_at || Date.now());
        const start = dueDate || createdDate;
        const end = dueDate || new Date(start.getTime() + DAY_MS);
        const isOverdue = dueDate && dueDate < today && todo.status !== 'done';
        const isDueToday = dueDate && isSameDay(dueDate, today);
        return { ...todo, start, end, isOverdue, isDueToday };
      }).sort((a, b) => a.start.getTime() - b.start.getTime());

      const unitWidth = ganttZoom === 'day' ? 40 : ganttZoom === 'week' ? 120 : 200;
      const buffer = ganttZoom === 'day' ? 7 : ganttZoom === 'week' ? 2 : 1;

      let minDate = new Date(Math.min(...parsedTodos.map(t => t.start.getTime())));
      let maxDate = new Date(Math.max(...parsedTodos.map(t => t.end.getTime())));
      
      if (ganttZoom === 'week') {
        const dayOfWeek = minDate.getDay();
        minDate = new Date(minDate.getTime() - dayOfWeek * DAY_MS - buffer * 7 * DAY_MS);
        maxDate = new Date(maxDate.getTime() + (6 - maxDate.getDay()) * DAY_MS + buffer * 7 * DAY_MS);
      } else if (ganttZoom === 'month') {
        minDate = new Date(minDate.getFullYear(), minDate.getMonth() - buffer, 1);
        maxDate = new Date(maxDate.getFullYear(), maxDate.getMonth() + buffer + 1, 0);
      } else {
        minDate = new Date(minDate.getTime() - buffer * DAY_MS);
        maxDate = new Date(maxDate.getTime() + buffer * DAY_MS);
      }

      const units = [];
      const monthGroups = [];
      let currentMonth = -1;
      let currentMonthStart = 0;

      if (ganttZoom === 'day') {
        let d = new Date(minDate);
        while (d <= maxDate) {
          if (d.getMonth() !== currentMonth) {
            if (currentMonth !== -1) monthGroups.push({ month: currentMonth, year: d.getFullYear() - (d.getMonth() === 0 ? 1 : 0), count: units.length - currentMonthStart });
            currentMonth = d.getMonth();
            currentMonthStart = units.length;
          }
          units.push({ date: new Date(d), label: d.getDate().toString(), isWeekend: isWeekend(d), isToday: isSameDay(d, today) });
          d = new Date(d.getTime() + DAY_MS);
        }
        if (currentMonth !== -1) monthGroups.push({ month: currentMonth, year: maxDate.getFullYear(), count: units.length - currentMonthStart });
      } else if (ganttZoom === 'week') {
        let d = new Date(minDate);
        while (d <= maxDate) {
          if (d.getMonth() !== currentMonth) {
            if (currentMonth !== -1) monthGroups.push({ month: currentMonth, year: d.getFullYear() - (d.getMonth() === 0 ? 1 : 0), count: units.length - currentMonthStart });
            currentMonth = d.getMonth();
            currentMonthStart = units.length;
          }
          const weekEnd = new Date(d.getTime() + 6 * DAY_MS);
          const hasToday = today >= d && today <= weekEnd;
          units.push({ date: new Date(d), label: 'W' + getWeekNumber(d), isWeekend: false, isToday: hasToday });
          d = new Date(d.getTime() + 7 * DAY_MS);
        }
        if (currentMonth !== -1) monthGroups.push({ month: currentMonth, year: maxDate.getFullYear(), count: units.length - currentMonthStart });
      } else {
        let d = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
        let currentYear = -1;
        while (d <= maxDate) {
          if (d.getFullYear() !== currentYear) {
            if (currentYear !== -1) monthGroups.push({ month: -1, year: currentYear, count: units.length - currentMonthStart });
            currentYear = d.getFullYear();
            currentMonthStart = units.length;
          }
          const hasToday = today.getFullYear() === d.getFullYear() && today.getMonth() === d.getMonth();
          units.push({ date: new Date(d), label: MONTHS[d.getMonth()], isWeekend: false, isToday: hasToday });
          d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
        }
        if (currentYear !== -1) monthGroups.push({ month: -1, year: currentYear, count: units.length - currentMonthStart });
      }

      const totalWidth = units.length * unitWidth;

      let monthsHtml = '';
      if (ganttZoom !== 'month') {
        monthsHtml = '<div class="gantt-timeline-months">' + monthGroups.map(g => 
          '<div class="gantt-month-cell" style="width:' + (g.count * unitWidth) + 'px">' + MONTHS[g.month] + ' ' + g.year + '</div>'
        ).join('') + '</div>';
      } else {
        monthsHtml = '<div class="gantt-timeline-months">' + monthGroups.map(g =>
          '<div class="gantt-month-cell" style="width:' + (g.count * unitWidth) + 'px">' + g.year + '</div>'
        ).join('') + '</div>';
      }

      const unitsHtml = '<div class="gantt-timeline-units">' + units.map(u =>
        '<div class="gantt-unit-cell' + (u.isWeekend ? ' weekend' : '') + (u.isToday ? ' today' : '') + '" style="width:' + unitWidth + 'px">' + u.label + '</div>'
      ).join('') + '</div>';

      timelineHeader.innerHTML = monthsHtml + unitsHtml;

      let taskListHtml = '<div class="gantt-task-header">Tasks</div>';
      let rowsHtml = '';
      const gridHtml = '<div class="gantt-timeline-grid">' + units.map(u =>
        '<div class="gantt-grid-cell' + (u.isWeekend ? ' weekend' : '') + '" style="width:' + unitWidth + 'px"></div>'
      ).join('') + '</div>';

      parsedTodos.forEach(todo => {
        const statusColor = todo.status === 'done' ? '#22c55e' : todo.status === 'doing' ? '#3b82f6' : '#94a3b8';
        const priorityHtml = todo.priority === 3 ? '<span class="gantt-task-priority high">!</span>' : '';
        taskListHtml += '<div class="gantt-task-item" onclick="showDetail(' + todo.id + ')">' +
          '<span class="gantt-task-status" style="background:' + statusColor + '"></span>' +
          '<span class="gantt-task-title">' + esc(todo.title) + '</span>' +
          priorityHtml + '</div>';

        const startOffset = (todo.start.getTime() - minDate.getTime()) / DAY_MS;
        const duration = Math.max(1, (todo.end.getTime() - todo.start.getTime()) / DAY_MS);
        
        let left, width;
        if (ganttZoom === 'day') {
          left = startOffset * unitWidth;
          width = duration * unitWidth;
        } else if (ganttZoom === 'week') {
          left = (startOffset / 7) * unitWidth;
          width = Math.max(unitWidth * 0.8, (duration / 7) * unitWidth);
        } else {
          const monthOffset = (todo.start.getFullYear() - minDate.getFullYear()) * 12 + (todo.start.getMonth() - minDate.getMonth());
          left = monthOffset * unitWidth + (todo.start.getDate() / 30) * unitWidth;
          width = Math.max(unitWidth * 0.5, (duration / 30) * unitWidth);
        }

        const extraClass = todo.isOverdue ? ' overdue' : todo.isDueToday ? ' due-today' : '';
        const progressHtml = todo.progress > 0 ? '<div class="gantt-bar-progress"><div class="gantt-bar-progress-fill" style="width:' + todo.progress + '%"></div></div>' : '';

        rowsHtml += '<div class="gantt-timeline-row">' +
          '<div class="gantt-bar status-' + todo.status + extraClass + '" style="left:' + left + 'px;width:' + width + 'px" onclick="showDetail(' + todo.id + ')" title="' + esc(todo.title) + '">' +
          '<span class="gantt-bar-title">' + esc(todo.title) + '</span>' +
          progressHtml + '</div></div>';
      });

      taskList.innerHTML = taskListHtml;
      timelineBody.innerHTML = gridHtml + rowsHtml;
      timelineBody.style.width = totalWidth + 'px';

      if (todayLine) {
        const todayOffset = (today.getTime() - minDate.getTime()) / DAY_MS;
        let todayLeft;
        if (ganttZoom === 'day') {
          todayLeft = todayOffset * unitWidth;
        } else if (ganttZoom === 'week') {
          todayLeft = (todayOffset / 7) * unitWidth;
        } else {
          const monthOffset = (today.getFullYear() - minDate.getFullYear()) * 12 + (today.getMonth() - minDate.getMonth());
          todayLeft = monthOffset * unitWidth + (today.getDate() / 30) * unitWidth;
        }
        if (todayLeft >= 0 && todayLeft <= totalWidth) {
          todayLine.style.left = todayLeft + 'px';
          todayLine.style.display = 'block';
        } else {
          todayLine.style.display = 'none';
        }
      }

      setTimeout(scrollToToday, 100);
    }

    function renderTodoCard(todo) {

      const priorityLabels = { 3: 'High', 2: 'Medium', 1: 'Low' };
      const dueDate = todo.due_date ? new Date(todo.due_date) : null;
      const isOverdue = dueDate && dueDate < new Date() && !todo.completed;

      return \`
        <div class="todo-card" onclick="showDetail(\${todo.id})">
          <div class="todo-card-header">
            <input type="checkbox" class="todo-checkbox" \${todo.completed ? 'checked' : ''} onclick="event.stopPropagation(); toggleComplete(\${todo.id})">
            <div class="todo-card-content">
              <div class="todo-card-title \${todo.completed ? 'completed' : ''}">\${esc(todo.title)}</div>
              <div class="todo-card-meta">
                \${todo.priority ? '<span class="priority-badge priority-' + todo.priority + '">' + priorityLabels[todo.priority] + '</span>' : ''}
                \${todo.tags.map(t => '<span class="tag-badge" style="background:' + t.color + '">' + esc(t.name) + '</span>').join('')}
                \${dueDate ? '<span class="due-badge ' + (isOverdue ? 'overdue' : '') + '">' + formatDate(dueDate) + '</span>' : ''}
                \${todo.estimated_minutes ? '<span>Est: ' + todo.estimated_minutes + 'm</span>' : ''}
                \${todo.repeat_type ? '<span>🔄 ' + todo.repeat_type + '</span>' : ''}
              </div>
              \${todo.progress > 0 ? '<div class="progress-bar"><div class="progress-fill" style="width:' + todo.progress + '%"></div></div>' : ''}
            </div>
            <div class="todo-card-actions">
              <button class="btn btn-sm" onclick="event.stopPropagation(); editTodo(\${todo.id})">Edit</button>
              <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); deleteTodo(\${todo.id})">Del</button>
            </div>
          </div>
        </div>
      \`;
    }

    function renderTags() {
      const container = document.getElementById('tag-list');
      if (!container) return;

      container.innerHTML = '<div class="tag-list-item ' + (!selectedTagId ? 'active' : '') + '" onclick="filterByTag(null)"><span class="tag-name">All Tags</span></div>' +
        tags.map(tag => \`
          <div class="tag-list-item \${selectedTagId == tag.id ? 'active' : ''}" onclick="filterByTag(\${tag.id})">
            <span class="tag-dot" style="background:\${tag.color}"></span>
            <span class="tag-name">\${esc(tag.name)}</span>
            <button class="btn-icon" style="font-size:0.75rem" onclick="event.stopPropagation(); deleteTag(\${tag.id})">×</button>
          </div>
        \`).join('');
    }

    function renderTagsSelect() {
      const container = document.getElementById('todo-tags-select');
      if (!container) return;
      
      container.innerHTML = tags.map(tag => \`
        <span class="tag-option" style="background:\${tag.color}" data-id="\${tag.id}" onclick="toggleTagSelect(this)">\${esc(tag.name)}</span>
      \`).join('');
    }

    function renderStats(stats) {
      const grid = document.getElementById('stats-grid');
      if (!grid) return;

      grid.innerHTML = \`
        <div class="stat-card"><div class="stat-value">\${stats.totalTodos}</div><div class="stat-label">Total Tasks</div></div>
        <div class="stat-card"><div class="stat-value">\${stats.completedToday}</div><div class="stat-label">Completed Today</div></div>
        <div class="stat-card"><div class="stat-value">\${stats.completedThisWeek}</div><div class="stat-label">Completed This Week</div></div>
        <div class="stat-card"><div class="stat-value">\${stats.streak}</div><div class="stat-label">Day Streak 🔥</div></div>
        <div class="stat-card"><div class="stat-value">\${stats.avgCompletionTime || 0}m</div><div class="stat-label">Avg Completion Time</div></div>
      \`;

      const statusChart = document.getElementById('chart-status');
      const priorityChart = document.getElementById('chart-priority');
      const statusColors = { todo: '#667eea', doing: '#f59e0b', done: '#10b981' };
      const priorityColors = { 0: '#9ca3af', 1: '#3b82f6', 2: '#f59e0b', 3: '#ef4444' };
      const priorityLabels = { 0: 'None', 1: 'Low', 2: 'Medium', 3: 'High' };
      const total = stats.byStatus.reduce((a, b) => a + b.count, 0) || 1;

      if (statusChart) {
        statusChart.innerHTML = stats.byStatus.map(s => \`
          <div class="chart-bar">
            <span class="chart-bar-label">\${s.status}</span>
            <div class="chart-bar-fill" style="width:\${(s.count/total)*100}%;background:\${statusColors[s.status]}"></div>
            <span class="chart-bar-value">\${s.count}</span>
          </div>
        \`).join('');
      }

      if (priorityChart) {
        priorityChart.innerHTML = stats.byPriority.map(p => \`
          <div class="chart-bar">
            <span class="chart-bar-label">\${priorityLabels[p.priority]}</span>
            <div class="chart-bar-fill" style="width:\${(p.count/total)*100}%;background:\${priorityColors[p.priority]}"></div>
            <span class="chart-bar-value">\${p.count}</span>
          </div>
        \`).join('');
      }
    }

    function showTodoModal(todo = null) {
      document.getElementById('todo-modal-title').textContent = todo ? 'Edit Task' : 'Add Task';
      document.getElementById('todo-id').value = todo?.id || '';
      document.getElementById('todo-title').value = todo?.title || '';
      document.getElementById('todo-description').value = todo?.description || '';
      document.getElementById('todo-priority').value = todo?.priority || '0';
      document.getElementById('todo-due').value = todo?.due_date ? todo.due_date.slice(0,16) : '';
      document.getElementById('todo-estimated').value = todo?.estimated_minutes || '';
      document.getElementById('todo-actual').value = todo?.actual_minutes || '';
      document.getElementById('todo-repeat').value = todo?.repeat_type || '';
      document.getElementById('todo-repeat-interval').value = todo?.repeat_interval || '1';
      
      renderTagsSelect();
      if (todo?.tags) {
        todo.tags.forEach(t => {
          const el = document.querySelector('[data-id="' + t.id + '"]');
          if (el) el.classList.add('selected');
        });
      }
      
      openModal('todo-modal');
    }

    async function saveTodo(e) {
      e.preventDefault();
      const id = document.getElementById('todo-id').value;
      const tagEls = document.querySelectorAll('#todo-tags-select .tag-option.selected');
      const tagIds = Array.from(tagEls).map(el => parseInt(el.dataset.id));

      const data = {
        title: document.getElementById('todo-title').value,
        description: document.getElementById('todo-description').value || null,
        priority: parseInt(document.getElementById('todo-priority').value),
        due_date: document.getElementById('todo-due').value || null,
        estimated_minutes: parseInt(document.getElementById('todo-estimated').value) || null,
        actual_minutes: parseInt(document.getElementById('todo-actual').value) || null,
        repeat_type: document.getElementById('todo-repeat').value || null,
        repeat_interval: parseInt(document.getElementById('todo-repeat-interval').value) || 1,
        tagIds
      };

      const res = await fetch('/api/todos' + (id ? '/' + id : ''), {
        method: id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (res.ok) {
        closeModal('todo-modal');
        loadTodos();
      }
    }

    function editTodo(id) {
      const todo = todos.find(t => t.id === id);
      if (todo) showTodoModal(todo);
    }

    async function deleteTodo(id) {
      if (!confirm('Delete this task?')) return;
      await fetch('/api/todos/' + id, { method: 'DELETE' });
      loadTodos();
    }

    async function toggleComplete(id) {
      const todo = todos.find(t => t.id === id);
      if (!todo) return;
      await fetch('/api/todos/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: !todo.completed, status: !todo.completed ? 'done' : 'todo' })
      });
      loadTodos();
    }

    async function showDetail(id) {
      const todo = todos.find(t => t.id === id);
      if (!todo) return;

      const [commentsRes, subtasksRes] = await Promise.all([
        fetch('/api/todos/' + id + '/comments'),
        fetch('/api/todos/' + id + '/subtasks')
      ]);
      const comments = await commentsRes.json();
      const subtasks = await subtasksRes.json();

      document.getElementById('detail-title').textContent = todo.title;
      document.getElementById('detail-content').innerHTML = \`
        <div class="detail-section">
          <p>\${esc(todo.description || 'No description')}</p>
          <div style="margin-top:0.75rem;display:flex;flex-wrap:wrap;gap:0.5rem;">
            \${todo.tags.map(t => '<span class="tag-badge" style="background:' + t.color + '">' + esc(t.name) + '</span>').join('')}
          </div>
          \${todo.share_token ? \`
            <div class="share-section">
              <input type="text" value="\${APP_URL}/share/\${todo.share_token}" readonly id="share-url">
              <button class="btn btn-sm" onclick="copyUrl()">Copy</button>
              <button class="btn btn-sm" onclick="unshare(\${id})">Unshare</button>
            </div>
          \` : '<button class="btn btn-sm" style="margin-top:0.75rem" onclick="share(' + id + ')">Share</button>'}
        </div>
        <div class="detail-section">
          <h4>Subtasks (\${subtasks.filter(s=>s.completed).length}/\${subtasks.length})</h4>
          <div class="subtask-list">
            \${subtasks.map(s => \`
              <div class="subtask-item">
                <input type="checkbox" \${s.completed ? 'checked' : ''} onchange="toggleSubtask(\${s.id}, this.checked)">
                <span class="\${s.completed ? 'completed' : ''}">\${esc(s.title)}</span>
                <button class="btn-icon" onclick="deleteSubtask(\${s.id})">×</button>
              </div>
            \`).join('')}
          </div>
          <form class="subtask-form" onsubmit="addSubtask(event, \${id})">
            <input type="text" placeholder="Add subtask..." id="new-subtask">
            <button type="submit" class="btn btn-sm btn-primary">Add</button>
          </form>
        </div>
        <div class="detail-section">
          <h4>Comments (\${comments.length})</h4>
          <div class="comment-list">
            \${comments.map(c => \`
              <div class="comment-item">
                \${c.avatar_url ? '<img src="' + c.avatar_url + '" class="comment-avatar">' : ''}
                <div class="comment-body">
                  <span class="comment-author">\${esc(c.username)}</span>
                  <div class="comment-text">\${esc(c.content)}</div>
                </div>
              </div>
            \`).join('')}
          </div>
          <form class="comment-form" onsubmit="addComment(event, \${id})">
            <input type="text" placeholder="Add comment..." id="new-comment">
            <button type="submit" class="btn btn-sm btn-primary">Post</button>
          </form>
        </div>
      \`;

      openModal('detail-modal');
    }

    async function addSubtask(e, todoId) {
      e.preventDefault();
      const input = document.getElementById('new-subtask');
      const title = input.value.trim();
      if (!title) return;

      await fetch('/api/todos/' + todoId + '/subtasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title })
      });
      input.value = '';
      showDetail(todoId);
      loadTodos();
    }

    async function toggleSubtask(id, completed) {
      await fetch('/api/subtasks/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed })
      });
      const todoId = todos.find(t => t.subtasks?.some(s => s.id === id))?.id;
      if (todoId) { showDetail(todoId); loadTodos(); }
    }

    async function deleteSubtask(id) {
      await fetch('/api/subtasks/' + id, { method: 'DELETE' });
      const todoId = todos.find(t => t.subtasks?.some(s => s.id === id))?.id;
      if (todoId) { showDetail(todoId); loadTodos(); }
    }

    async function addComment(e, todoId) {
      e.preventDefault();
      const input = document.getElementById('new-comment');
      const content = input.value.trim();
      if (!content) return;

      await fetch('/api/todos/' + todoId + '/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
      input.value = '';
      showDetail(todoId);
    }

    async function share(todoId) {
      await fetch('/api/todos/' + todoId + '/share', { method: 'POST' });
      loadTodos();
      showDetail(todoId);
    }

    async function unshare(todoId) {
      await fetch('/api/todos/' + todoId + '/share', { method: 'DELETE' });
      loadTodos();
      showDetail(todoId);
    }

    function copyUrl() {
      document.getElementById('share-url').select();
      document.execCommand('copy');
      alert('Copied!');
    }

    function showTagModal() { openModal('tag-modal'); }

    async function saveTag(e) {
      e.preventDefault();
      const name = document.getElementById('tag-name').value.trim();
      const color = document.getElementById('tag-color').value;
      if (!name) return;

      await fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color })
      });

      document.getElementById('tag-name').value = '';
      closeModal('tag-modal');
      loadTags();
    }

    async function deleteTag(id) {
      if (!confirm('Delete this tag?')) return;
      await fetch('/api/tags/' + id, { method: 'DELETE' });
      if (selectedTagId == id) selectedTagId = null;
      loadTags();
      loadTodos();
    }

    function filterByTag(id) {
      selectedTagId = id;
      renderTags();
      loadTodos();
    }

    function toggleTagSelect(el) {
      el.classList.toggle('selected');
    }

    function applyFilters() { loadTodos(); }
    function debounceSearch() {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(loadTodos, 300);
    }

    function allowDrop(e) { e.preventDefault(); }
    function drag(e) { e.dataTransfer.setData('text', e.target.dataset.id); }
    async function drop(e, status) {
      e.preventDefault();
      const id = e.dataTransfer.getData('text');
      await fetch('/api/todos/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, completed: status === 'done' })
      });
      loadTodos();
    }

    function openModal(id) { document.getElementById(id).classList.add('active'); }
    function closeModal(id) { document.getElementById(id).classList.remove('active'); }

    function esc(text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function formatDate(date) {
      const today = new Date();
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
      if (date.toDateString() === today.toDateString()) return 'Today';
      if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
      return date.toLocaleDateString();
    }

    init();
  `;
}

function renderNotFound(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Not Found</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: white; padding: 3rem; border-radius: 16px; text-align: center; max-width: 400px; }
    h1 { color: #333; margin-bottom: 1rem; }
    p { color: #666; margin-bottom: 1.5rem; }
    a { color: #667eea; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Not Found</h1>
    <p>This shared task doesn't exist or has been removed.</p>
    <a href="/">Go to TodoList Pro</a>
  </div>
</body>
</html>`;
}

function renderSharePage(
  todo: Todo & { username: string; avatar_url: string | null },
  comments: Array<{ id: number; content: string; username?: string; avatar_url?: string | null }>,
  subtasks: Subtask[]
): string {
  const priorityLabels: Record<number, string> = { 3: 'High', 2: 'Medium', 1: 'Low', 0: 'None' };
  const completedSubtasks = subtasks.filter(s => s.completed).length;
  const progress = subtasks.length > 0 ? Math.round((completedSubtasks / subtasks.length) * 100) : 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(todo.title)} - Shared Task</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; padding: 2rem; }
    .container { max-width: 600px; margin: 0 auto; }
    .card { background: white; border-radius: 16px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); overflow: hidden; }
    .header { padding: 1.5rem; border-bottom: 1px solid #eee; display: flex; align-items: center; gap: 1rem; }
    .avatar { width: 48px; height: 48px; border-radius: 50%; }
    .author-name { font-weight: 600; }
    .shared-label { font-size: 0.75rem; color: #999; }
    .content { padding: 1.5rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; ${todo.completed ? 'text-decoration: line-through; color: #999;' : ''} }
    .description { color: #666; margin-bottom: 1rem; }
    .meta { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem; }
    .badge { padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.75rem; }
    .status-badge { background: ${todo.status === 'done' ? '#d4edda' : todo.status === 'doing' ? '#fff3cd' : '#e2e3e5'}; }
    .priority-badge { background: ${todo.priority === 3 ? '#fee2e2' : todo.priority === 2 ? '#fef3c7' : '#dbeafe'}; }
    .section { margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid #eee; }
    .section h3 { font-size: 1rem; color: #333; margin-bottom: 1rem; }
    .subtask { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0; }
    .subtask-check { color: ${todo.completed ? '#10b981' : '#999'}; }
    .subtask-title { ${todo.completed ? 'text-decoration: line-through; color: #999;' : ''} }
    .progress-bar { height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden; margin-top: 0.5rem; }
    .progress-fill { height: 100%; background: #667eea; width: ${progress}%; }
    .comment { display: flex; gap: 0.75rem; padding: 0.75rem 0; }
    .comment-avatar { width: 32px; height: 32px; border-radius: 50%; }
    .comment-author { font-weight: 500; font-size: 0.875rem; }
    .comment-text { color: #666; font-size: 0.875rem; }
    .footer { padding: 1.5rem; text-align: center; border-top: 1px solid #eee; }
    .footer a { color: #667eea; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="header">
        ${todo.avatar_url ? `<img src="${todo.avatar_url}" class="avatar">` : ''}
        <div>
          <div class="author-name">${escapeHtml(todo.username)}</div>
          <div class="shared-label">Shared a task</div>
        </div>
      </div>
      <div class="content">
        <h1>${escapeHtml(todo.title)}</h1>
        ${todo.description ? `<p class="description">${escapeHtml(todo.description)}</p>` : ''}
        <div class="meta">
          <span class="badge status-badge">${todo.status}</span>
          ${todo.priority ? `<span class="badge priority-badge">${priorityLabels[todo.priority]}</span>` : ''}
          ${todo.due_date ? `<span class="badge">Due: ${new Date(todo.due_date).toLocaleDateString()}</span>` : ''}
        </div>
        ${subtasks.length > 0 ? `
          <div class="section">
            <h3>Subtasks (${completedSubtasks}/${subtasks.length})</h3>
            ${subtasks.map(s => `
              <div class="subtask">
                <span class="subtask-check">${s.completed ? '✓' : '○'}</span>
                <span class="subtask-title" style="${s.completed ? 'text-decoration:line-through;color:#999' : ''}">${escapeHtml(s.title)}</span>
              </div>
            `).join('')}
            <div class="progress-bar"><div class="progress-fill"></div></div>
          </div>
        ` : ''}
        ${comments.length > 0 ? `
          <div class="section">
            <h3>Comments (${comments.length})</h3>
            ${comments.map(c => `
              <div class="comment">
                ${c.avatar_url ? `<img src="${c.avatar_url}" class="comment-avatar">` : ''}
                <div>
                  <div class="comment-author">${escapeHtml(c.username || 'User')}</div>
                  <div class="comment-text">${escapeHtml(c.content)}</div>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
      <div class="footer">
        <a href="/">Create your own TodoList Pro</a>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default app;
