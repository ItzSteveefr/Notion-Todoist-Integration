import dotenv = require('dotenv');
import { Task, TodoistApi } from '@doist/todoist-api-typescript';
import { Client } from '@notionhq/client';
import {
  PageObjectResponse,
  QueryDatabaseResponse,
} from '@notionhq/client/build/src/api-endpoints';

dotenv.config();

const todoistKey = String(process.env.TODOISTKEY);
const notionKey = String(process.env.NOTIONKEY);
const databaseId = String(process.env.DATABASEID);

const todoistApi: TodoistApi = new TodoistApi(todoistKey);
const notionApi: Client = new Client({ auth: notionKey });

/* ---------------- PROPERTY GETTERS ---------------- */

function getNotionTitleProperty(page: PageObjectResponse): string {
  const prop = page.properties.Task as any;
  return prop?.title?.[0]?.plain_text ?? '';
}

function getNotionDescriptionProperty(page: PageObjectResponse): string {
  const prop = page.properties.Description as any;
  return prop?.rich_text?.[0]?.plain_text ?? '';
}

function getNotionDueProperty(page: PageObjectResponse): string {
  const prop = page.properties.Due as any;
  return prop?.date?.start ?? '';
}

function getNotionStatusProperty(page: PageObjectResponse): boolean {
  const prop = page.properties.Status as any;
  return prop?.checkbox ?? false;
}

function getNotionTodoistIDProperty(page: PageObjectResponse): string {
  const prop = page.properties.TodoistID as any;
  return prop?.number ? String(prop.number) : '';
}

function getNotionTodoistURLProperty(page: PageObjectResponse): string {
  const prop = page.properties.URL as any;
  return prop?.url ?? '';
}

/* ---------------- SEARCH ---------------- */

async function IDSearchNotion(
  todoistID: number
): Promise<PageObjectResponse | null> {
  const result: QueryDatabaseResponse = await notionApi.databases.query({
    database_id: databaseId,
    filter: {
      property: 'TodoistID',
      number: { equals: todoistID },
    },
  });

  return result.results[0] as PageObjectResponse || null;
}

async function notionActivePages(): Promise<PageObjectResponse[]> {
  const result = await notionApi.databases.query({
    database_id: databaseId,
    filter: {
      property: 'Status',
      checkbox: { equals: false },
    },
  });

  return result.results as PageObjectResponse[];
}

/* ---------------- CREATE / UPDATE ---------------- */

async function newNotionPage(task: Task): Promise<PageObjectResponse> {
  const page = await notionApi.pages.create({
    parent: { type: 'database_id', database_id: databaseId },
    properties: {
      Task: {
        title: [{ text: { content: task.content } }],
      },
      TodoistID: { number: Number(task.id) },
      Status: { checkbox: task.isCompleted },
      URL: { url: task.url },
      Description: {
        rich_text: [
          { type: 'text', text: { content: task.description ?? '' } },
        ],
      },
      'Sync status': {
        select: { name: 'Updated' },
      },
      Due: task.due
        ? { date: { start: task.due.date } }
        : undefined,
    },
  });

  return page as PageObjectResponse;
}

async function updateNotionPage(
  pageID: string,
  task: Task
): Promise<PageObjectResponse> {
  const page = await notionApi.pages.update({
    page_id: pageID,
    properties: {
      Task: {
        title: [{ text: { content: task.content } }],
      },
      TodoistID: { number: Number(task.id) },
      Status: { checkbox: task.isCompleted },
      URL: { url: task.url },
      Description: {
        rich_text: [
          { type: 'text', text: { content: task.description ?? '' } },
        ],
      },
      'Sync status': {
        select: { name: 'Updated' },
      },
      Due: task.due
        ? { date: { start: task.due.date } }
        : null,
    },
  });

  return page as PageObjectResponse;
}

async function newTodoistTask(
  page: PageObjectResponse
): Promise<Task> {
  return await todoistApi.addTask({
    content: getNotionTitleProperty(page),
    description: getNotionDescriptionProperty(page),
    dueDate: getNotionDueProperty(page),
  });
}

async function updateTodoistTask(
  taskID: string,
  page: PageObjectResponse
): Promise<Task> {
  return await todoistApi.updateTask(taskID, {
    content: getNotionTitleProperty(page),
    description: getNotionDescriptionProperty(page),
    dueDate: getNotionDueProperty(page),
  });
}

/* ---------------- BASIC AUTO LOOP ---------------- */

async function sync() {
  const todoistTasks = await todoistApi.getTasks();

  for (const task of todoistTasks) {
    const notionPage = await IDSearchNotion(Number(task.id));

    if (!notionPage) {
      await newNotionPage(task);
    } else {
      await updateNotionPage(notionPage.id, task);
    }
  }

  const notionPages = await notionActivePages();

  for (const page of notionPages) {
    if (!getNotionTodoistIDProperty(page)) {
      const task = await newTodoistTask(page);
      await updateNotionPage(page.id, task);
    }
  }
}

setInterval(sync, 10000);
sync();
