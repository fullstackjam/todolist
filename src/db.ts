import type { Todo, Comment } from "./types";

export async function getTodos(db: D1Database, userId: number): Promise<Todo[]> {
  const { results } = await db
    .prepare("SELECT * FROM todos WHERE user_id = ? ORDER BY created_at DESC")
    .bind(userId)
    .all<Todo>();

  return results || [];
}

export async function createTodo(
  db: D1Database,
  userId: number,
  title: string
): Promise<Todo> {
  await db
    .prepare("INSERT INTO todos (user_id, title) VALUES (?, ?)")
    .bind(userId, title)
    .run();

  const todo = await db
    .prepare(
      "SELECT * FROM todos WHERE user_id = ? ORDER BY id DESC LIMIT 1"
    )
    .bind(userId)
    .first<Todo>();

  return todo!;
}

export async function updateTodo(
  db: D1Database,
  userId: number,
  todoId: number,
  updates: { title?: string; completed?: boolean }
): Promise<Todo | null> {
  const existing = await db
    .prepare("SELECT * FROM todos WHERE id = ? AND user_id = ?")
    .bind(todoId, userId)
    .first<Todo>();

  if (!existing) return null;

  const title = updates.title ?? existing.title;
  const completed = updates.completed !== undefined ? (updates.completed ? 1 : 0) : existing.completed;

  await db
    .prepare(
      "UPDATE todos SET title = ?, completed = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?"
    )
    .bind(title, completed, todoId, userId)
    .run();

  return db
    .prepare("SELECT * FROM todos WHERE id = ?")
    .bind(todoId)
    .first<Todo>();
}

export async function deleteTodo(
  db: D1Database,
  userId: number,
  todoId: number
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM todos WHERE id = ? AND user_id = ?")
    .bind(todoId, userId)
    .run();

  return result.meta.changes > 0;
}

export async function getComments(
  db: D1Database,
  todoId: number
): Promise<Comment[]> {
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

export async function createComment(
  db: D1Database,
  todoId: number,
  userId: number,
  content: string
): Promise<Comment> {
  await db
    .prepare("INSERT INTO comments (todo_id, user_id, content) VALUES (?, ?, ?)")
    .bind(todoId, userId, content)
    .run();

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

export async function deleteComment(
  db: D1Database,
  commentId: number,
  userId: number
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM comments WHERE id = ? AND user_id = ?")
    .bind(commentId, userId)
    .run();

  return result.meta.changes > 0;
}
