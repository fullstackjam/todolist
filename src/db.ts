import type { Todo, TodoWithTags, Tag, Subtask, Comment, DailyStats, TodoFilter } from "./types";

export async function getTodos(
  db: D1Database,
  userId: number,
  filter: TodoFilter = {}
): Promise<TodoWithTags[]> {
  let query = "SELECT * FROM todos WHERE user_id = ?";
  const params: (string | number)[] = [userId];

  if (filter.archived !== undefined) {
    query += " AND archived = ?";
    params.push(filter.archived ? 1 : 0);
  } else {
    query += " AND archived = 0";
  }

  if (filter.status) {
    query += " AND status = ?";
    params.push(filter.status);
  }

  if (filter.priority !== undefined) {
    query += " AND priority = ?";
    params.push(filter.priority);
  }

  if (filter.dueBefore) {
    query += " AND due_date <= ?";
    params.push(filter.dueBefore);
  }

  if (filter.dueAfter) {
    query += " AND due_date >= ?";
    params.push(filter.dueAfter);
  }

  if (filter.search) {
    query += " AND (title LIKE ? OR description LIKE ?)";
    const searchTerm = `%${filter.search}%`;
    params.push(searchTerm, searchTerm);
  }

  query += " ORDER BY priority DESC, due_date ASC NULLS LAST, created_at DESC";

  const { results } = await db.prepare(query).bind(...params).all<Todo>();
  const todos = results || [];

  const todosWithTags: TodoWithTags[] = await Promise.all(
    todos.map(async (todo) => {
      const tags = await getTodoTags(db, todo.id);
      const subtasks = await getSubtasks(db, todo.id);
      const completedSubtasks = subtasks.filter(s => s.completed).length;
      const progress = subtasks.length > 0 ? Math.round((completedSubtasks / subtasks.length) * 100) : 0;
      return { ...todo, tags, subtasks, progress };
    })
  );

  if (filter.tagId) {
    return todosWithTags.filter(t => t.tags.some(tag => tag.id === filter.tagId));
  }

  return todosWithTags;
}

export async function getTodoById(db: D1Database, todoId: number): Promise<TodoWithTags | null> {
  const todo = await db.prepare("SELECT * FROM todos WHERE id = ?").bind(todoId).first<Todo>();
  if (!todo) return null;

  const tags = await getTodoTags(db, todo.id);
  const subtasks = await getSubtasks(db, todo.id);
  const completedSubtasks = subtasks.filter(s => s.completed).length;
  const progress = subtasks.length > 0 ? Math.round((completedSubtasks / subtasks.length) * 100) : 0;

  return { ...todo, tags, subtasks, progress };
}

export async function createTodo(
  db: D1Database,
  userId: number,
  data: {
    title: string;
    description?: string;
    priority?: number;
    due_date?: string;
    estimated_minutes?: number;
    repeat_type?: string;
    repeat_interval?: number;
    tagIds?: number[];
  }
): Promise<TodoWithTags> {
  await db
    .prepare(`
      INSERT INTO todos (user_id, title, description, priority, due_date, estimated_minutes, repeat_type, repeat_interval)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      userId,
      data.title,
      data.description || null,
      data.priority || 0,
      data.due_date || null,
      data.estimated_minutes || null,
      data.repeat_type || null,
      data.repeat_interval || 1
    )
    .run();

  const todo = await db
    .prepare("SELECT * FROM todos WHERE user_id = ? ORDER BY id DESC LIMIT 1")
    .bind(userId)
    .first<Todo>();

  if (data.tagIds && data.tagIds.length > 0) {
    for (const tagId of data.tagIds) {
      await db.prepare("INSERT OR IGNORE INTO todo_tags (todo_id, tag_id) VALUES (?, ?)").bind(todo!.id, tagId).run();
    }
  }

  await updateDailyStats(db, userId, 'created');

  return (await getTodoById(db, todo!.id))!;
}

export async function updateTodo(
  db: D1Database,
  userId: number,
  todoId: number,
  updates: {
    title?: string;
    description?: string;
    priority?: number;
    due_date?: string | null;
    status?: string;
    estimated_minutes?: number;
    actual_minutes?: number;
    completed?: boolean;
    archived?: boolean;
    tagIds?: number[];
  }
): Promise<TodoWithTags | null> {
  const existing = await db
    .prepare("SELECT * FROM todos WHERE id = ? AND user_id = ?")
    .bind(todoId, userId)
    .first<Todo>();

  if (!existing) return null;

  const title = updates.title ?? existing.title;
  const description = updates.description !== undefined ? updates.description : existing.description;
  const priority = updates.priority ?? existing.priority;
  const due_date = updates.due_date !== undefined ? updates.due_date : existing.due_date;
  const status = updates.status ?? existing.status;
  const estimated_minutes = updates.estimated_minutes ?? existing.estimated_minutes;
  const actual_minutes = updates.actual_minutes ?? existing.actual_minutes;
  const archived = updates.archived !== undefined ? (updates.archived ? 1 : 0) : existing.archived;

  let completed = existing.completed;
  let completed_at = existing.completed_at;

  if (updates.completed !== undefined) {
    completed = updates.completed ? 1 : 0;
    completed_at = updates.completed ? new Date().toISOString() : null;
    if (updates.completed && !existing.completed) {
      await updateDailyStats(db, userId, 'completed');
    }
  }

  if (updates.status === 'done' && existing.status !== 'done') {
    completed = 1;
    completed_at = new Date().toISOString();
    await updateDailyStats(db, userId, 'completed');
  }

  await db
    .prepare(`
      UPDATE todos SET 
        title = ?, description = ?, priority = ?, due_date = ?, status = ?,
        estimated_minutes = ?, actual_minutes = ?, archived = ?,
        completed = ?, completed_at = ?, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `)
    .bind(title, description, priority, due_date, status, estimated_minutes, actual_minutes, archived, completed, completed_at, todoId, userId)
    .run();

  if (updates.tagIds !== undefined) {
    await db.prepare("DELETE FROM todo_tags WHERE todo_id = ?").bind(todoId).run();
    for (const tagId of updates.tagIds) {
      await db.prepare("INSERT OR IGNORE INTO todo_tags (todo_id, tag_id) VALUES (?, ?)").bind(todoId, tagId).run();
    }
  }

  return getTodoById(db, todoId);
}

export async function deleteTodo(db: D1Database, userId: number, todoId: number): Promise<boolean> {
  const result = await db.prepare("DELETE FROM todos WHERE id = ? AND user_id = ?").bind(todoId, userId).run();
  return result.meta.changes > 0;
}

export async function getTags(db: D1Database, userId: number): Promise<Tag[]> {
  const { results } = await db.prepare("SELECT * FROM tags WHERE user_id = ? ORDER BY name").bind(userId).all<Tag>();
  return results || [];
}

export async function createTag(db: D1Database, userId: number, name: string, color?: string): Promise<Tag> {
  await db.prepare("INSERT INTO tags (user_id, name, color) VALUES (?, ?, ?)").bind(userId, name, color || '#667eea').run();
  const tag = await db.prepare("SELECT * FROM tags WHERE user_id = ? AND name = ?").bind(userId, name).first<Tag>();
  return tag!;
}

export async function deleteTag(db: D1Database, userId: number, tagId: number): Promise<boolean> {
  const result = await db.prepare("DELETE FROM tags WHERE id = ? AND user_id = ?").bind(tagId, userId).run();
  return result.meta.changes > 0;
}

export async function getTodoTags(db: D1Database, todoId: number): Promise<Tag[]> {
  const { results } = await db
    .prepare("SELECT t.* FROM tags t JOIN todo_tags tt ON t.id = tt.tag_id WHERE tt.todo_id = ?")
    .bind(todoId)
    .all<Tag>();
  return results || [];
}

export async function getSubtasks(db: D1Database, todoId: number): Promise<Subtask[]> {
  const { results } = await db.prepare("SELECT * FROM subtasks WHERE todo_id = ? ORDER BY sort_order, id").bind(todoId).all<Subtask>();
  return results || [];
}

export async function createSubtask(db: D1Database, todoId: number, title: string): Promise<Subtask> {
  const maxOrder = await db.prepare("SELECT MAX(sort_order) as max FROM subtasks WHERE todo_id = ?").bind(todoId).first<{max: number}>();
  const sortOrder = (maxOrder?.max || 0) + 1;
  
  await db.prepare("INSERT INTO subtasks (todo_id, title, sort_order) VALUES (?, ?, ?)").bind(todoId, title, sortOrder).run();
  const subtask = await db.prepare("SELECT * FROM subtasks WHERE todo_id = ? ORDER BY id DESC LIMIT 1").bind(todoId).first<Subtask>();
  return subtask!;
}

export async function updateSubtask(db: D1Database, subtaskId: number, updates: { title?: string; completed?: boolean }): Promise<Subtask | null> {
  const existing = await db.prepare("SELECT * FROM subtasks WHERE id = ?").bind(subtaskId).first<Subtask>();
  if (!existing) return null;

  const title = updates.title ?? existing.title;
  const completed = updates.completed !== undefined ? (updates.completed ? 1 : 0) : existing.completed;

  await db.prepare("UPDATE subtasks SET title = ?, completed = ? WHERE id = ?").bind(title, completed, subtaskId).run();
  return db.prepare("SELECT * FROM subtasks WHERE id = ?").bind(subtaskId).first<Subtask>();
}

export async function deleteSubtask(db: D1Database, subtaskId: number): Promise<boolean> {
  const result = await db.prepare("DELETE FROM subtasks WHERE id = ?").bind(subtaskId).run();
  return result.meta.changes > 0;
}

export async function getComments(db: D1Database, todoId: number): Promise<Comment[]> {
  const { results } = await db
    .prepare(`
      SELECT c.*, u.username, u.avatar_url 
      FROM comments c 
      JOIN users u ON c.user_id = u.id 
      WHERE c.todo_id = ? 
      ORDER BY c.created_at ASC
    `)
    .bind(todoId)
    .all<Comment>();
  return results || [];
}

export async function createComment(db: D1Database, todoId: number, userId: number, content: string): Promise<Comment> {
  await db.prepare("INSERT INTO comments (todo_id, user_id, content) VALUES (?, ?, ?)").bind(todoId, userId, content).run();
  const comment = await db
    .prepare(`
      SELECT c.*, u.username, u.avatar_url 
      FROM comments c 
      JOIN users u ON c.user_id = u.id 
      WHERE c.todo_id = ? AND c.user_id = ?
      ORDER BY c.id DESC LIMIT 1
    `)
    .bind(todoId, userId)
    .first<Comment>();
  return comment!;
}

export async function deleteComment(db: D1Database, commentId: number, userId: number): Promise<boolean> {
  const result = await db.prepare("DELETE FROM comments WHERE id = ? AND user_id = ?").bind(commentId, userId).run();
  return result.meta.changes > 0;
}

function generateShareToken(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function shareTodo(db: D1Database, userId: number, todoId: number): Promise<string | null> {
  const todo = await db.prepare("SELECT * FROM todos WHERE id = ? AND user_id = ?").bind(todoId, userId).first<Todo>();
  if (!todo) return null;
  if (todo.share_token) return todo.share_token;

  const token = generateShareToken();
  await db.prepare("UPDATE todos SET share_token = ? WHERE id = ?").bind(token, todoId).run();
  return token;
}

export async function unshareTodo(db: D1Database, userId: number, todoId: number): Promise<boolean> {
  const result = await db.prepare("UPDATE todos SET share_token = NULL WHERE id = ? AND user_id = ?").bind(todoId, userId).run();
  return result.meta.changes > 0;
}

export async function getTodoByShareToken(db: D1Database, token: string): Promise<(Todo & { username: string; avatar_url: string | null }) | null> {
  const todo = await db
    .prepare(`
      SELECT t.*, u.username, u.avatar_url 
      FROM todos t 
      JOIN users u ON t.user_id = u.id 
      WHERE t.share_token = ?
    `)
    .bind(token)
    .first<Todo & { username: string; avatar_url: string | null }>();
  return todo || null;
}

export async function getGanttByTag(
  db: D1Database,
  userId: number
): Promise<Array<{ tag: Tag | null; items: Array<{ id: number; title: string; start: string; end: string; status: string; priority: number; tagId: number | null }> }>> {
  const { results } = await db
    .prepare(`
      SELECT t.*, tg.id as tag_id, tg.name as tag_name, tg.color as tag_color
      FROM todos t
      LEFT JOIN todo_tags tt ON t.id = tt.todo_id
      LEFT JOIN tags tg ON tt.tag_id = tg.id
      WHERE t.user_id = ? AND t.archived = 0
    `)
    .bind(userId)
    .all<Todo & { tag_id: number | null; tag_name: string | null; tag_color: string | null }>();

  const rows = results || [];
  const groups: Record<string, { tag: Tag | null; items: Array<{ id: number; title: string; start: string; end: string; status: string; priority: number; tagId: number | null }> }> = {};

  for (const row of rows) {
    const tagKey = row.tag_id ?? 'untagged';
    if (!groups[tagKey]) {
      groups[tagKey] = {
        tag: row.tag_id
          ? {
              id: row.tag_id,
              user_id: row.user_id,
              name: row.tag_name || 'Unknown',
              color: row.tag_color || '#9ca3af',
              created_at: row.created_at,
            }
          : null,
        items: [],
      };
    }

    const start = row.created_at;
    const end = row.completed_at || row.due_date || row.created_at;

    groups[tagKey].items.push({
      id: row.id,
      title: row.title,
      start,
      end,
      status: row.status,
      priority: row.priority,
      tagId: row.tag_id ?? null,
    });
  }

  const values = Object.values(groups);
  values.sort((a, b) => {
    const aName = a.tag?.name || 'Untagged';
    const bName = b.tag?.name || 'Untagged';
    return aName.localeCompare(bName);
  });

  return values;
}

export async function updateDailyStats(db: D1Database, userId: number, type: 'created' | 'completed'): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  
  const existing = await db.prepare("SELECT * FROM daily_stats WHERE user_id = ? AND date = ?").bind(userId, today).first<DailyStats>();
  
  if (existing) {
    if (type === 'created') {
      await db.prepare("UPDATE daily_stats SET created_count = created_count + 1 WHERE id = ?").bind(existing.id).run();
    } else {
      await db.prepare("UPDATE daily_stats SET completed_count = completed_count + 1 WHERE id = ?").bind(existing.id).run();
    }
  } else {
    await db
      .prepare("INSERT INTO daily_stats (user_id, date, created_count, completed_count) VALUES (?, ?, ?, ?)")
      .bind(userId, today, type === 'created' ? 1 : 0, type === 'completed' ? 1 : 0)
      .run();
  }
}

export async function getStats(db: D1Database, userId: number): Promise<{
  totalTodos: number;
  completedToday: number;
  completedThisWeek: number;
  streak: number;
  avgCompletionTime: number;
  byPriority: { priority: number; count: number }[];
  byStatus: { status: string; count: number }[];
  recentDays: DailyStats[];
}> {
  const totalTodos = await db.prepare("SELECT COUNT(*) as count FROM todos WHERE user_id = ? AND archived = 0").bind(userId).first<{count: number}>();
  
  const today = new Date().toISOString().split('T')[0];
  const completedToday = await db
    .prepare("SELECT COUNT(*) as count FROM todos WHERE user_id = ? AND completed = 1 AND date(completed_at) = ?")
    .bind(userId, today)
    .first<{count: number}>();

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const completedThisWeek = await db
    .prepare("SELECT COUNT(*) as count FROM todos WHERE user_id = ? AND completed = 1 AND completed_at >= ?")
    .bind(userId, weekAgo)
    .first<{count: number}>();

  const { results: recentDays } = await db
    .prepare("SELECT * FROM daily_stats WHERE user_id = ? ORDER BY date DESC LIMIT 30")
    .bind(userId)
    .all<DailyStats>();

  let streak = 0;
  const sortedDays = (recentDays || []).sort((a, b) => b.date.localeCompare(a.date));
  for (const day of sortedDays) {
    if (day.completed_count > 0) {
      streak++;
    } else {
      break;
    }
  }

  const avgTime = await db
    .prepare("SELECT AVG(actual_minutes) as avg FROM todos WHERE user_id = ? AND actual_minutes IS NOT NULL")
    .bind(userId)
    .first<{avg: number}>();

  const { results: byPriority } = await db
    .prepare("SELECT priority, COUNT(*) as count FROM todos WHERE user_id = ? AND archived = 0 GROUP BY priority")
    .bind(userId)
    .all<{priority: number; count: number}>();

  const { results: byStatus } = await db
    .prepare("SELECT status, COUNT(*) as count FROM todos WHERE user_id = ? AND archived = 0 GROUP BY status")
    .bind(userId)
    .all<{status: string; count: number}>();

  return {
    totalTodos: totalTodos?.count || 0,
    completedToday: completedToday?.count || 0,
    completedThisWeek: completedThisWeek?.count || 0,
    streak,
    avgCompletionTime: Math.round(avgTime?.avg || 0),
    byPriority: byPriority || [],
    byStatus: byStatus || [],
    recentDays: recentDays || [],
  };
}

export async function processRepeatTasks(db: D1Database, userId: number): Promise<void> {
  const now = new Date();
  const { results } = await db
    .prepare(`
      SELECT * FROM todos 
      WHERE user_id = ? AND repeat_type IS NOT NULL AND completed = 1
    `)
    .bind(userId)
    .all<Todo>();

  for (const todo of results || []) {
    if (!todo.completed_at) continue;

    const completedAt = new Date(todo.completed_at);
    let shouldRepeat = false;

    if (todo.repeat_type === 'daily') {
      const daysSince = Math.floor((now.getTime() - completedAt.getTime()) / (24 * 60 * 60 * 1000));
      shouldRepeat = daysSince >= todo.repeat_interval;
    } else if (todo.repeat_type === 'weekly') {
      const weeksSince = Math.floor((now.getTime() - completedAt.getTime()) / (7 * 24 * 60 * 60 * 1000));
      shouldRepeat = weeksSince >= todo.repeat_interval;
    } else if (todo.repeat_type === 'monthly') {
      const monthsSince = (now.getFullYear() - completedAt.getFullYear()) * 12 + (now.getMonth() - completedAt.getMonth());
      shouldRepeat = monthsSince >= todo.repeat_interval;
    }

    if (shouldRepeat) {
      await db
        .prepare("UPDATE todos SET completed = 0, completed_at = NULL, status = 'todo' WHERE id = ?")
        .bind(todo.id)
        .run();
    }
  }
}
