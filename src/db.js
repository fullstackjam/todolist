export async function getTodos(db, userId, filter = {}) {
    let query = "SELECT * FROM todos WHERE user_id = ?";
    const params = [userId];
    if (filter.archived !== undefined) {
        query += " AND archived = ?";
        params.push(filter.archived ? 1 : 0);
    }
    else {
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
    const { results } = await db.prepare(query).bind(...params).all();
    const todos = results || [];
    const todosWithTags = await Promise.all(todos.map(async (todo) => {
        const tags = await getTodoTags(db, todo.id);
        const subtasks = await getSubtasks(db, todo.id);
        const completedSubtasks = subtasks.filter(s => s.completed).length;
        const progress = subtasks.length > 0 ? Math.round((completedSubtasks / subtasks.length) * 100) : 0;
        return { ...todo, tags, subtasks, progress };
    }));
    if (filter.tagId) {
        return todosWithTags.filter(t => t.tags.some(tag => tag.id === filter.tagId));
    }
    return todosWithTags;
}
export async function getTodoById(db, todoId) {
    const todo = await db.prepare("SELECT * FROM todos WHERE id = ?").bind(todoId).first();
    if (!todo)
        return null;
    const tags = await getTodoTags(db, todo.id);
    const subtasks = await getSubtasks(db, todo.id);
    const completedSubtasks = subtasks.filter(s => s.completed).length;
    const progress = subtasks.length > 0 ? Math.round((completedSubtasks / subtasks.length) * 100) : 0;
    return { ...todo, tags, subtasks, progress };
}
export async function createTodo(db, userId, data) {
    await db
        .prepare(`
      INSERT INTO todos (user_id, title, description, priority, due_date, estimated_minutes, repeat_type, repeat_interval)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
        .bind(userId, data.title, data.description || null, data.priority || 0, data.due_date || null, data.estimated_minutes || null, data.repeat_type || null, data.repeat_interval || 1)
        .run();
    const todo = await db
        .prepare("SELECT * FROM todos WHERE user_id = ? ORDER BY id DESC LIMIT 1")
        .bind(userId)
        .first();
    if (data.tagIds && data.tagIds.length > 0) {
        for (const tagId of data.tagIds) {
            await db.prepare("INSERT OR IGNORE INTO todo_tags (todo_id, tag_id) VALUES (?, ?)").bind(todo.id, tagId).run();
        }
    }
    await updateDailyStats(db, userId, 'created');
    return (await getTodoById(db, todo.id));
}
export async function updateTodo(db, userId, todoId, updates) {
    const existing = await db
        .prepare("SELECT * FROM todos WHERE id = ? AND user_id = ?")
        .bind(todoId, userId)
        .first();
    if (!existing)
        return null;
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
export async function deleteTodo(db, userId, todoId) {
    const result = await db.prepare("DELETE FROM todos WHERE id = ? AND user_id = ?").bind(todoId, userId).run();
    return result.meta.changes > 0;
}
export async function getTags(db, userId) {
    const { results } = await db.prepare("SELECT * FROM tags WHERE user_id = ? ORDER BY name").bind(userId).all();
    return results || [];
}
export async function createTag(db, userId, name, color) {
    await db.prepare("INSERT INTO tags (user_id, name, color) VALUES (?, ?, ?)").bind(userId, name, color || '#667eea').run();
    const tag = await db.prepare("SELECT * FROM tags WHERE user_id = ? AND name = ?").bind(userId, name).first();
    return tag;
}
export async function deleteTag(db, userId, tagId) {
    const result = await db.prepare("DELETE FROM tags WHERE id = ? AND user_id = ?").bind(tagId, userId).run();
    return result.meta.changes > 0;
}
export async function getTodoTags(db, todoId) {
    const { results } = await db
        .prepare("SELECT t.* FROM tags t JOIN todo_tags tt ON t.id = tt.tag_id WHERE tt.todo_id = ?")
        .bind(todoId)
        .all();
    return results || [];
}
export async function getSubtasks(db, todoId) {
    const { results } = await db.prepare("SELECT * FROM subtasks WHERE todo_id = ? ORDER BY sort_order, id").bind(todoId).all();
    return results || [];
}
export async function createSubtask(db, todoId, title) {
    const maxOrder = await db.prepare("SELECT MAX(sort_order) as max FROM subtasks WHERE todo_id = ?").bind(todoId).first();
    const sortOrder = (maxOrder?.max || 0) + 1;
    await db.prepare("INSERT INTO subtasks (todo_id, title, sort_order) VALUES (?, ?, ?)").bind(todoId, title, sortOrder).run();
    const subtask = await db.prepare("SELECT * FROM subtasks WHERE todo_id = ? ORDER BY id DESC LIMIT 1").bind(todoId).first();
    return subtask;
}
export async function updateSubtask(db, subtaskId, updates) {
    const existing = await db.prepare("SELECT * FROM subtasks WHERE id = ?").bind(subtaskId).first();
    if (!existing)
        return null;
    const title = updates.title ?? existing.title;
    const completed = updates.completed !== undefined ? (updates.completed ? 1 : 0) : existing.completed;
    await db.prepare("UPDATE subtasks SET title = ?, completed = ? WHERE id = ?").bind(title, completed, subtaskId).run();
    return db.prepare("SELECT * FROM subtasks WHERE id = ?").bind(subtaskId).first();
}
export async function deleteSubtask(db, subtaskId) {
    const result = await db.prepare("DELETE FROM subtasks WHERE id = ?").bind(subtaskId).run();
    return result.meta.changes > 0;
}
export async function getComments(db, todoId) {
    const { results } = await db
        .prepare(`
      SELECT c.*, u.username, u.avatar_url 
      FROM comments c 
      JOIN users u ON c.user_id = u.id 
      WHERE c.todo_id = ? 
      ORDER BY c.created_at ASC
    `)
        .bind(todoId)
        .all();
    return results || [];
}
export async function createComment(db, todoId, userId, content) {
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
        .first();
    return comment;
}
export async function deleteComment(db, commentId, userId) {
    const result = await db.prepare("DELETE FROM comments WHERE id = ? AND user_id = ?").bind(commentId, userId).run();
    return result.meta.changes > 0;
}
function generateShareToken() {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}
export async function shareTodo(db, userId, todoId) {
    const todo = await db.prepare("SELECT * FROM todos WHERE id = ? AND user_id = ?").bind(todoId, userId).first();
    if (!todo)
        return null;
    if (todo.share_token)
        return todo.share_token;
    const token = generateShareToken();
    await db.prepare("UPDATE todos SET share_token = ? WHERE id = ?").bind(token, todoId).run();
    return token;
}
export async function unshareTodo(db, userId, todoId) {
    const result = await db.prepare("UPDATE todos SET share_token = NULL WHERE id = ? AND user_id = ?").bind(todoId, userId).run();
    return result.meta.changes > 0;
}
export async function getTodoByShareToken(db, token) {
    const todo = await db
        .prepare(`
      SELECT t.*, u.username, u.avatar_url 
      FROM todos t 
      JOIN users u ON t.user_id = u.id 
      WHERE t.share_token = ?
    `)
        .bind(token)
        .first();
    return todo || null;
}
export async function getGanttByTag(db, userId) {
    const { results } = await db
        .prepare(`
      SELECT t.*, tg.id as tag_id, tg.name as tag_name, tg.color as tag_color
      FROM todos t
      LEFT JOIN todo_tags tt ON t.id = tt.todo_id
      LEFT JOIN tags tg ON tt.tag_id = tg.id
      WHERE t.user_id = ? AND t.archived = 0
    `)
        .bind(userId)
        .all();
    const rows = results || [];
    const groups = {};
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
export async function updateDailyStats(db, userId, type) {
    const today = new Date().toISOString().split('T')[0];
    const existing = await db.prepare("SELECT * FROM daily_stats WHERE user_id = ? AND date = ?").bind(userId, today).first();
    if (existing) {
        if (type === 'created') {
            await db.prepare("UPDATE daily_stats SET created_count = created_count + 1 WHERE id = ?").bind(existing.id).run();
        }
        else {
            await db.prepare("UPDATE daily_stats SET completed_count = completed_count + 1 WHERE id = ?").bind(existing.id).run();
        }
    }
    else {
        await db
            .prepare("INSERT INTO daily_stats (user_id, date, created_count, completed_count) VALUES (?, ?, ?, ?)")
            .bind(userId, today, type === 'created' ? 1 : 0, type === 'completed' ? 1 : 0)
            .run();
    }
}
export async function getStats(db, userId) {
    const totalTodos = await db.prepare("SELECT COUNT(*) as count FROM todos WHERE user_id = ? AND archived = 0").bind(userId).first();
    const today = new Date().toISOString().split('T')[0];
    const completedToday = await db
        .prepare("SELECT COUNT(*) as count FROM todos WHERE user_id = ? AND completed = 1 AND date(completed_at) = ?")
        .bind(userId, today)
        .first();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const completedThisWeek = await db
        .prepare("SELECT COUNT(*) as count FROM todos WHERE user_id = ? AND completed = 1 AND completed_at >= ?")
        .bind(userId, weekAgo)
        .first();
    const { results: recentDays } = await db
        .prepare("SELECT * FROM daily_stats WHERE user_id = ? ORDER BY date DESC LIMIT 30")
        .bind(userId)
        .all();
    let streak = 0;
    const sortedDays = (recentDays || []).sort((a, b) => b.date.localeCompare(a.date));
    for (const day of sortedDays) {
        if (day.completed_count > 0) {
            streak++;
        }
        else {
            break;
        }
    }
    const avgTime = await db
        .prepare("SELECT AVG(actual_minutes) as avg FROM todos WHERE user_id = ? AND actual_minutes IS NOT NULL")
        .bind(userId)
        .first();
    const { results: byPriority } = await db
        .prepare("SELECT priority, COUNT(*) as count FROM todos WHERE user_id = ? AND archived = 0 GROUP BY priority")
        .bind(userId)
        .all();
    const { results: byStatus } = await db
        .prepare("SELECT status, COUNT(*) as count FROM todos WHERE user_id = ? AND archived = 0 GROUP BY status")
        .bind(userId)
        .all();
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
function isIsoDateOnly(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
function addDaysIsoDateOnly(isoDate, days) {
    const base = new Date(`${isoDate}T00:00:00.000Z`);
    const next = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
    return next.toISOString().split("T")[0];
}
function clampDays(value) {
    if (!Number.isFinite(value))
        return 7;
    return Math.min(365, Math.max(1, Math.trunc(value)));
}
export async function getSummaryReport(db, userId, options = {}) {
    const today = new Date().toISOString().split("T")[0];
    const end = options.end && isIsoDateOnly(options.end) ? options.end : today;
    const days = clampDays(options.days ?? 7);
    const start = options.start && isIsoDateOnly(options.start)
        ? options.start
        : addDaysIsoDateOnly(end, -(days - 1));
    const dateList = [];
    for (let d = start; d <= end; d = addDaysIsoDateOnly(d, 1)) {
        dateList.push(d);
    }
    const createdTotalRow = await db
        .prepare("SELECT COUNT(*) as count FROM todos WHERE user_id = ? AND date(created_at) BETWEEN ? AND ?")
        .bind(userId, start, end)
        .first();
    const completedTotalRow = await db
        .prepare("SELECT COUNT(*) as count FROM todos WHERE user_id = ? AND completed = 1 AND completed_at IS NOT NULL AND date(completed_at) BETWEEN ? AND ?")
        .bind(userId, start, end)
        .first();
    const actualTotalsRow = await db
        .prepare("SELECT COUNT(actual_minutes) as samples, AVG(actual_minutes) as avg, SUM(actual_minutes) as total FROM todos WHERE user_id = ? AND completed = 1 AND actual_minutes IS NOT NULL AND completed_at IS NOT NULL AND date(completed_at) BETWEEN ? AND ?")
        .bind(userId, start, end)
        .first();
    const estimatedTotalsRow = await db
        .prepare("SELECT COUNT(estimated_minutes) as samples, AVG(estimated_minutes) as avg, SUM(estimated_minutes) as total FROM todos WHERE user_id = ? AND completed = 1 AND estimated_minutes IS NOT NULL AND completed_at IS NOT NULL AND date(completed_at) BETWEEN ? AND ?")
        .bind(userId, start, end)
        .first();
    const { results: createdByDayRows } = await db
        .prepare("SELECT date(created_at) as date, COUNT(*) as count FROM todos WHERE user_id = ? AND date(created_at) BETWEEN ? AND ? GROUP BY date(created_at)")
        .bind(userId, start, end)
        .all();
    const { results: completedByDayRows } = await db
        .prepare("SELECT date(completed_at) as date, COUNT(*) as count FROM todos WHERE user_id = ? AND completed = 1 AND completed_at IS NOT NULL AND date(completed_at) BETWEEN ? AND ? GROUP BY date(completed_at)")
        .bind(userId, start, end)
        .all();
    const { results: actualByDayRows } = await db
        .prepare("SELECT date(completed_at) as date, COUNT(actual_minutes) as samples, AVG(actual_minutes) as avg, SUM(actual_minutes) as total FROM todos WHERE user_id = ? AND completed = 1 AND actual_minutes IS NOT NULL AND completed_at IS NOT NULL AND date(completed_at) BETWEEN ? AND ? GROUP BY date(completed_at)")
        .bind(userId, start, end)
        .all();
    const { results: estimatedByDayRows } = await db
        .prepare("SELECT date(completed_at) as date, COUNT(estimated_minutes) as samples, AVG(estimated_minutes) as avg, SUM(estimated_minutes) as total FROM todos WHERE user_id = ? AND completed = 1 AND estimated_minutes IS NOT NULL AND completed_at IS NOT NULL AND date(completed_at) BETWEEN ? AND ? GROUP BY date(completed_at)")
        .bind(userId, start, end)
        .all();
    const createdByDay = new Map();
    for (const row of createdByDayRows || []) {
        createdByDay.set(row.date, Number(row.count) || 0);
    }
    const completedByDay = new Map();
    for (const row of completedByDayRows || []) {
        completedByDay.set(row.date, Number(row.count) || 0);
    }
    const actualByDay = new Map();
    for (const row of actualByDayRows || []) {
        actualByDay.set(row.date, {
            samples: Number(row.samples) || 0,
            avg: Number(row.avg) || 0,
            total: Number(row.total) || 0,
        });
    }
    const estimatedByDay = new Map();
    for (const row of estimatedByDayRows || []) {
        estimatedByDay.set(row.date, {
            samples: Number(row.samples) || 0,
            avg: Number(row.avg) || 0,
            total: Number(row.total) || 0,
        });
    }
    const perDay = dateList.map((date) => {
        const actual = actualByDay.get(date);
        const estimate = estimatedByDay.get(date);
        return {
            date,
            createdCount: createdByDay.get(date) || 0,
            completedCount: completedByDay.get(date) || 0,
            totalActualMinutes: actual?.total ? Math.round(actual.total) : 0,
            avgActualMinutes: actual?.avg ? Math.round(actual.avg) : 0,
            actualMinutesSampleCount: actual?.samples || 0,
            totalEstimatedMinutes: estimate?.total ? Math.round(estimate.total) : 0,
            avgEstimatedMinutes: estimate?.avg ? Math.round(estimate.avg) : 0,
            estimatedMinutesSampleCount: estimate?.samples || 0,
        };
    });
    return {
        range: {
            start,
            end,
            days: dateList.length,
        },
        totals: {
            createdCount: Number(createdTotalRow?.count) || 0,
            completedCount: Number(completedTotalRow?.count) || 0,
            totalActualMinutes: Math.round(Number(actualTotalsRow?.total) || 0),
            avgActualMinutes: Math.round(Number(actualTotalsRow?.avg) || 0),
            actualMinutesSampleCount: Number(actualTotalsRow?.samples) || 0,
            totalEstimatedMinutes: Math.round(Number(estimatedTotalsRow?.total) || 0),
            avgEstimatedMinutes: Math.round(Number(estimatedTotalsRow?.avg) || 0),
            estimatedMinutesSampleCount: Number(estimatedTotalsRow?.samples) || 0,
        },
        perDay,
    };
}
export async function processRepeatTasks(db, userId) {
    const now = new Date();
    const { results } = await db
        .prepare(`
      SELECT * FROM todos 
      WHERE user_id = ? AND repeat_type IS NOT NULL AND completed = 1
    `)
        .bind(userId)
        .all();
    for (const todo of results || []) {
        if (!todo.completed_at)
            continue;
        const completedAt = new Date(todo.completed_at);
        let shouldRepeat = false;
        if (todo.repeat_type === 'daily') {
            const daysSince = Math.floor((now.getTime() - completedAt.getTime()) / (24 * 60 * 60 * 1000));
            shouldRepeat = daysSince >= todo.repeat_interval;
        }
        else if (todo.repeat_type === 'weekly') {
            const weeksSince = Math.floor((now.getTime() - completedAt.getTime()) / (7 * 24 * 60 * 60 * 1000));
            shouldRepeat = weeksSince >= todo.repeat_interval;
        }
        else if (todo.repeat_type === 'monthly') {
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
