import { generateBriefNarrative } from "../../../adapters/ai-provider/src/index.js";
import type { DatabaseClient } from "../db.js";
import { ApiError } from "../errors.js";
import { assertBriefResult } from "../validate.js";

type TaskRow = {
  id: string;
  title: string;
  status: string;
  due_at: Date | null;
  depends_on: string[];
};

function isDueSoon(due: Date | null, now: Date): boolean {
  if (!due) return false;
  const horizon = now.getTime() + 7 * 24 * 60 * 60 * 1000;
  return due.getTime() <= horizon;
}

export async function runDailyBrief(
  client: DatabaseClient,
  projectId: string,
): Promise<Record<string, unknown>> {
  const project = await client.query<{ id: string }>(
    `SELECT id FROM control.projects WHERE id = $1 AND status = 'active'`,
    [projectId],
  );
  if (project.rowCount === 0) {
    throw new ApiError(400, "project_not_found", "project not found");
  }

  const tasks = await client.query<TaskRow>(
    `SELECT id, title, status, due_at, depends_on
       FROM control.tasks
      WHERE project_id = $1
      ORDER BY created_at`,
    [projectId],
  );

  const now = new Date();
  const open = tasks.rows.filter((task) => task.status !== "done" && task.status !== "cancelled");
  const blocked = open.filter(
    (task) => task.status === "blocked" || task.depends_on.length > 0,
  );
  const dueSoon = open.filter((task) => isDueSoon(task.due_at, now));
  const missingDates = open.filter((task) => task.due_at === null);

  const missingInformation: string[] = [];
  if (missingDates.length > 0) {
    missingInformation.push("one or more open tasks have no due date");
  }
  for (const task of blocked) {
    missingInformation.push(`task ${task.id} is blocked or has unfinished dependencies`);
  }

  const priorities = [
    ...dueSoon.map((task) => ({
      taskId: task.id,
      reason: "due within 7 days",
    })),
    ...blocked
      .filter((task) => !dueSoon.some((due) => due.id === task.id))
      .map((task) => ({
        taskId: task.id,
        reason: "blocked or waiting on a dependency",
      })),
  ];

  const referencedTaskIds = [
    ...new Set([
      ...blocked.map((task) => task.id),
      ...dueSoon.map((task) => task.id),
      ...missingDates.map((task) => task.id),
      ...priorities.map((item) => item.taskId),
    ]),
  ];

  const knownIds = new Set(tasks.rows.map((task) => task.id));
  for (const id of referencedTaskIds) {
    if (!knownIds.has(id)) {
      throw new Error(`brief referenced unknown task ${id}`);
    }
  }

  const ai = await generateBriefNarrative();
  const payload = {
    schemaVersion: "1.0",
    projectId,
    generatedAt: now.toISOString(),
    facts: {
      openCount: open.length,
      blocked: blocked.map((task) => task.id),
      dueSoon: dueSoon.map((task) => task.id),
      missingDates: missingDates.map((task) => task.id),
      referencedTaskIds,
    },
    priorities,
    missingInformation,
    aiGeneration: {
      status: "skipped",
      reason: ai.reason,
    },
    delivery: "inbox",
  };
  assertBriefResult(payload);
  return payload;
}
