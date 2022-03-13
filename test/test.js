'use strict';
const request = require('supertest');
const app = require('../app');
const passportStub = require('passport-stub');
const User = require('../models/user');
const Schedule = require('../models/schedule');
const Candidate = require('../models/candidate');
//出欠データモデルの読み込み
const Availability = require('../models/availability');
//Node.jsのassertモジュールの読み込み
const assert = require('assert');

describe('/login', () => {
  beforeAll(() => {
    passportStub.install(app);
    passportStub.login({ username: 'testuser' });
  });

  afterAll(() => {
    passportStub.logout();
    passportStub.uninstall(app);
  });

  test('ログインのためのリンクが含まれる', () => {
    return request(app)
      .get('/login')
      .expect('Content-Type', 'text/html; charset=utf-8')
      .expect(/<a href="\/auth\/github"/)
      .expect(200);
  });

  test('ログイン時はユーザー名が表示される', () => {
    return request(app)
      .get('/login')
      .expect(/testuser/)
      .expect(200);
  });
});

describe('/logout', () => {
  test('/ にリダイレクトされる', () => {
    return request(app)
      .get('/logout')
      .expect('Location', '/')
      .expect(302);
  });
});

describe('/schedules', () => {
  beforeAll(() => {
    passportStub.install(app);
    passportStub.login({ id: 0, username: 'testuser' });
  });

  afterAll(() => {
    passportStub.logout();
    passportStub.uninstall(app);
  });

  test('予定が作成でき、表示される', done => {
    User.upsert({ userId: 0, username: 'testuser' }).then(() => {
      request(app)
        .post('/schedules')
        .send({
          scheduleName: 'テスト予定1',
          memo: 'テストメモ1\r\nテストメモ2',
          candidates: 'テスト候補1\r\nテスト候補2\r\nテスト候補3'
        })
        .expect('Location', /schedules/)
        .expect(302)
        .end((err, res) => {
          const createdSchedulePath = res.headers.location;
          request(app)
            .get(createdSchedulePath)
            .expect(/テスト予定1/)
            .expect(/テストメモ1/)
            .expect(/テストメモ2/)
            .expect(/テスト候補1/)
            .expect(/テスト候補2/)
            .expect(/テスト候補3/)
            .expect(200)
            /* 以下のテストを削除
            .end((err, res) => {
              if (err) return done(err);
              // テストで作成したデータを削除
              const scheduleId = createdSchedulePath.split('/schedules/')[1];
              Candidate.findAll({
                where: { scheduleId: scheduleId }
              }).then(candidates => {
                const promises = candidates.map(c => {
                  return c.destroy();
                });
                Promise.all(promises).then(() => {
                  Schedule.findByPk(scheduleId).then(s => {
                    s.destroy().then(() => {
                      if (err) return done(err);
                      done();
                    });
                  });
                });
              });
            });
            */
            //deleteScheduleAggregate という関数を実装し、予定とそこに紐づく出欠・候補日程を削除するためのメソッドを切り出し、ここのテスト「予定が作成でき表示される」と次のテスト「出欠が更新できる」の両方でテストの最後に実行できるように実装
            .end((err, res) => { deleteScheduleAggregate(createdSchedulePath.split('/schedules/')[1], done, err); });
        });
    });
  });
});
//出欠がAJAXで更新するかどうかのテスト
describe('/schedules/:scheduleId/users/:userId/candidates/:candidateId', () => {
  //test前の設定
  beforeAll(() => {
    passportStub.install(app);
    passportStub.login({ id: 0, username: 'testuser' });
  });
  //testが終わった後の設定
  afterAll(() => {
    passportStub.logout();
    passportStub.uninstall(app);
  });
  //test内容
  test('出欠が更新できる', (done) => {
    //仮のユーザを設定
    User.upsert({ userId: 0, username: 'testuser' }).then(() => {
      request(app)
        //POSTで/schedulesにアクセスし、予定を入れる
        .post('/schedules')
        .send({ scheduleName: 'テスト出欠更新予定1', memo: 'テスト出欠更新メモ1', candidates: 'テスト出欠更新候補1' })
        //それが終了したら、レスポンスヘッダのlocationからスケジュールIdを抽出
        .end((err, res) => {
          const createdSchedulePath = res.headers.location;
          const scheduleId = createdSchedulePath.split('/schedules/')[1];
          //候補日程データモデルからそのスケジュールIdに一致するデータを取り出し
          Candidate.findOne({
            where: { scheduleId: scheduleId }
            //取り出したデータのIDで、その予定のwebサイトのパスへとアクセスし、
          }).then((candidate) => {
            const userId = 0;
            request(app)
              .post(`/schedules/${scheduleId}/users/${userId}/candidates/${candidate.candidateId}`)
              //出欠をデフォルトの0から出席の2に変更し、以下の結果が返ればOK
              .send({ availability: 2 })
              .expect('{"status":"OK","availability":2}')
              //結果が返ったら
              .end((err, res) => {
                //出欠データモデルからそのスケジュールIdに一致するデータを全て取り出し
                Availability.findAll({
                  where: { scheduleId: scheduleId }
                }).then((availavilities) => {
                  //assertモジュールを利用して実際の値と期待値(出欠の配列の長さが1かつその中身が2)が同じか検証
                  assert.strictEqual(availavilities.length, 1);
                  assert.strictEqual(availavilities[0].availability, 2);
                  //今回作成した予定とその関連データを削除
                  deleteScheduleAggregate(scheduleId, done, err);
                });
              })

          });
        });
    });
  });
});
//テストで作成した予定と関連するデータを削除する関数
function deleteScheduleAggregate(scheduleId, done, err) {
  //scheduleIdを元に全ての出欠データを取得
  Availability.findAll({
    where: { scheduleId: scheduleId }
  }).then((availavilities) => {
    //取得したら中身を全部消すことを定義
    const promises = availavilities.map((a) => { return a.destroy(); });
    //順番に削除し終わったら
    Promise.all(promises).then(() => {
      //候補日程をscheduleIdで全部取得し、
      Candidate.findAll({
        where: { scheduleId: scheduleId }
      }).then((candidates) => {
        //取得したら中身を全部消すことを定義
        const promises = candidates.map((c) => { return c.destroy(); });
        //順番に削除し終わったら
        Promise.all(promises).then(() => {
          //主キー検索で予定を取得し、削除
          Schedule.findByPk(scheduleId).then((s) => {
            s.destroy().then(() => {
              if (err) return done(err);
              done();
            });
          });
        });
      });
    });
  });
}