"use strict";
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ log: ["query"] });

const testUser = {
  userId: 0,
  username: "testuser",
};

function mockIronSession() {
  const ironSession = require("iron-session");
  jest.spyOn(ironSession, "getIronSession").mockReturnValue({
    user: { login: testUser.username, id: testUser.userId },
    save: jest.fn(),
    destroy: jest.fn(),
  });
}

// テストで作成したデータを削除
async function deleteScheduleAggregate(scheduleId) {
  await prisma.availability.deleteMany({ where: { scheduleId } });
  await prisma.candidate.deleteMany({ where: { scheduleId } });
  await prisma.schedule.delete({ where: { scheduleId } });
}

// フォームからリクエストを送信する
async function sendFormRequest(app, path, body) {
  return app.request(path, {
    method: "POST",
    body: new URLSearchParams(body),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });
}

// JSON を含んだリクエストを送信する
async function sendJsonRequest(app, path, body) {
  return app.request(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
  });
}

describe("/login", () => {
  beforeAll(() => {
    mockIronSession();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  test("ログインのためのリンクが含まれる", async () => {
    const app = require("./app");
    const res = await app.request("/login");
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=UTF-8");
    expect(await res.text()).toMatch(/<a href="\/auth\/github"/);
    expect(res.status).toBe(200);
  });

  test("ログイン時はユーザ名が表示される", async () => {
    const app = require("./app");
    const res = await app.request("/login");
    expect(await res.text()).toMatch(/testuser/);
    expect(res.status).toBe(200);
  });
});

describe("/logout", () => {
  test("/ にリダイレクトされる", async () => {
    const app = require("./app");
    const res = await app.request("/logout");
    expect(res.headers.get("Location")).toBe("/");
    expect(res.status).toBe(302);
  });
});

describe("/schedules", () => {
  let scheduleId = "";
  beforeAll(() => {
    mockIronSession();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await deleteScheduleAggregate(scheduleId);
  });

  test("予定が作成でき、表示される", async () => {
    await prisma.user.upsert({
      where: { userId: testUser.userId },
      create: testUser,
      update: testUser,
    });

    const app = require("./app");

    const postRes = await sendFormRequest(app, "/schedules", {
      scheduleName: "テスト予定1",
      memo: "テストメモ1\r\nテストメモ2",
      candidates: "テスト候補1\r\nテスト候補2\r\nテスト候補3",
    });

    const createdSchedulePath = postRes.headers.get("Location");
    expect(createdSchedulePath).toMatch(/schedules/);
    expect(postRes.status).toBe(302);

    scheduleId = createdSchedulePath.split("/schedules/")[1];

    const res = await app.request(createdSchedulePath);
    const body = await res.text();
    expect(body).toMatch(/テスト予定1/);
    expect(body).toMatch(/テストメモ1/);
    expect(body).toMatch(/テストメモ2/);
    expect(body).toMatch(/テスト候補1/);
    expect(body).toMatch(/テスト候補2/);
    expect(body).toMatch(/テスト候補3/);
    expect(res.status).toBe(200);
  });
});

describe("/schedules/:scheduleId/users/:userId/candidates/:candidateId", () => {
  let scheduleId = "";
  beforeAll(() => {
    mockIronSession();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await deleteScheduleAggregate(scheduleId);
  });

  test("出欠が更新できる", async () => {
    await prisma.user.upsert({
      where: { userId: testUser.userId },
      create: testUser,
      update: testUser,
    });

    const app = require("./app");

    const postRes = await sendFormRequest(app, "/schedules", {
      scheduleName: "テスト出欠更新予定1",
      memo: "テスト出欠更新メモ1",
      candidates: "テスト出欠更新候補1",
    });

    const createdSchedulePath = postRes.headers.get("Location");
    scheduleId = createdSchedulePath.split("/schedules/")[1];

    const candidate = await prisma.candidate.findFirst({
      where: { scheduleId },
    });

    const res = await sendJsonRequest(
      app,
      `/schedules/${scheduleId}/users/${testUser.userId}/candidates/${candidate.candidateId}`,
      {
        availability: 2,
      }
    );

    expect(await res.json()).toEqual({ status: "OK", availability: 2 });

    const availabilities = await prisma.availability.findMany({
      where: { scheduleId },
    });
    expect(availabilities.length).toBe(1);
    expect(availabilities[0].availability).toBe(2);
  });
});
