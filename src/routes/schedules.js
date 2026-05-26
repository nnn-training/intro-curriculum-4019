const { Hono } = require('hono');
const { html } = require('hono/html');
const layout = require('../layout');
const ensureAuthenticated = require('../middlewares/ensure-authenticated');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ log: ['query'] });

const app = new Hono();

app.use(ensureAuthenticated());

app.get('/new', (c) => {
  return c.html(
    layout(
      c,
      '予定の作成',
      html`
        <form method="post" action="/schedules">
          <div>
            <h5>予定名</h5>
            <input type="text" name="scheduleName" />
          </div>
          <div>
            <h5>メモ</h5>
            <textarea name="memo"></textarea>
          </div>
          <div>
            <h5>候補日程 (改行して複数入力してください)</h5>
            <textarea name="candidates"></textarea>
          </div>
          <button type="submit">予定をつくる</button>
        </form>
      `,
    ),
  );
});

app.post('/', async (c) => {
  const { user } = c.get('session') ?? {};
  const body = await c.req.parseBody();

  // 予定を登録
  const schedule = await prisma.schedule.create({
    data: {
      scheduleId: randomUUID(),
      scheduleName: body.scheduleName.slice(0, 255) || '（名称未設定）',
      memo: body.memo,
      createdBy: user.id,
      updatedAt: new Date(),
    },
  });

  // 候補日程を登録
  const candidateNames = body.candidates
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  const candidates = candidateNames.map((candidateName) => ({
    candidateName: candidateName.slice(0, 255),
    scheduleId: schedule.scheduleId,
  }));
  await prisma.candidate.createMany({
    data: candidates,
  });

  // 作成した予定のページにリダイレクト
  return c.redirect('/schedules/' + schedule.scheduleId);
});

app.get('/:scheduleId', async (c) => {
  const { user } = c.get('session') ?? {};
  const schedule = await prisma.schedule.findUnique({
    where: { scheduleId: c.req.param('scheduleId') },
    include: {
      user: {
        select: {
          userId: true,
          username: true,
        },
      },
    },
  });

  if (!schedule) {
    return c.notFound();
  }

  const candidates = await prisma.candidate.findMany({
    where: { scheduleId: schedule.scheduleId },
    orderBy: { candidateId: 'asc' },
  });

  // データベースからその予定の全ての出欠を取得する
  const availabilities = await prisma.availability.findMany({
    where: { scheduleId: schedule.scheduleId },
    orderBy: { candidateId: 'asc' },
    include: {
      user: {
        select: {
          userId: true,
          username: true,
        },
      },
    },
  });

  // 各候補日程に対する各ユーザの出欠を入れ子の Map にして格納するための Map を作る。
  // key: candidateId, value: Map (key: userId, value: availability)
  const availabilityMapMap = new Map(candidates.map((c) => [c.candidateId, new Map()]));

  // 閲覧ユーザと、出欠を登録したユーザ情報を格納するための Map を作る。
  const userMap = new Map(); // key: userId, value: { userId, username }
  const viewerUserId = user.id;
  userMap.set(viewerUserId, { userId: viewerUserId, username: user.login });

  availabilities.forEach((a) => {
    availabilityMapMap.get(a.candidateId)?.set(a.user.userId, a.availability);
    userMap.set(a.user.userId, a.user);
  });

  // 閲覧ユーザと、出欠を登録したユーザを合わせた全ユーザの配列を作る
  const users = Array.from(userMap.values());

  return c.html(
    layout(
      c,
      `予定: ${schedule.scheduleName}`,
      html`
        <h4>${schedule.scheduleName}</h4>
        <p style="white-space: pre;">${schedule.memo}</p>
        <p>作成者: ${schedule.user.username}</p>
        <h3>出欠表</h3>
        <table>
          <tr>
            <th>予定</th>
            ${users.map((user) => html`<th>${user.username}</th>`)}
          </tr>
          ${candidates.map(
            (candidate) => html`
              <tr>
                <th>${candidate.candidateName}</th>
                ${users.map((user) => {
                  // 出欠が未登録の場合は「欠席」と表示する。
                  const availability =
                    availabilityMapMap.get(candidate.candidateId)?.get(user.userId) ?? 0;
                  const availabilityLabels = ["欠", "？", "出"];
                  const label = availabilityLabels[availability];
                  return html`
                    <td>
                      ${user.userId === viewerUserId
                        ? html`<button>${label}</button>`
                        : html`<p>${label}</p>`}
                    </td>
                  `;
                })}
              </tr>
            `,
          )}
        </table>
      `,
    ),
  );
});

module.exports = app;
