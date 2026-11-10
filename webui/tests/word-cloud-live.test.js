import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {mock, test} from 'node:test';
import {Server} from 'socket.io';
import {io} from 'socket.io-client';

// Keep the application's background session-cleanup interval inside the test
// clock; connection and question timers continue to use real time.
mock.timers.enable({apis: ['setInterval']});
const {default: registerSocket} = await import('../../server/socket.js');
mock.timers.reset();

const request = (socket, event, data = {}) => socket.timeout(2000).emitWithAck(event, data);
const createGame = async t => {
    const http = createServer();
    const server = new Server(http, {path: '/api/ws'});
    server.on('connection', socket => registerSocket(server, socket));
    http.listen(0, '127.0.0.1');
    await once(http, 'listening');
    const clients = [];
    const connect = async () => {
        const socket = io(`http://127.0.0.1:${http.address().port}`, {
            path: '/api/ws', transports: ['websocket'], autoConnect: false, reconnection: false
        });
        clients.push(socket);
        socket.connect();
        await once(socket, 'connect');
        return socket;
    };
    t.after(async () => {
        clients.forEach(socket => socket.disconnect());
        await new Promise(resolve => server.close(resolve));
    });
    const host = await connect();
    const code = await request(host, 'CREATE_ROOM', {settings: {scoringMode: 'flat'}});
    const students = [];
    const sessionIds = [];
    for (const name of ['Alice', 'Bob']) {
        const student = await connect();
        const joined = await request(student, 'JOIN_ROOM', {code, name, character: 'wizard'});
        assert.equal(joined.success, true);
        sessionIds.push(joined.sessionId);
        students.push(student);
    }
    return {host, students, sessionIds, connect};
};

const showQuestion = async (game, question) => {
    const ready = once(game.students[0], 'ANSWERS_READY');
    assert.equal((await request(game.host, 'SHOW_QUESTION', question)).success, true);
    await ready;
};

test('students can send multiple word-cloud contributions until the host closes the collection', async t => {
    const game = await createGame(t);
    await showQuestion(game, {title: 'Capital?', type: 'text', answers: [{content: 'Berlin'}]});
    for (const student of game.students) await request(student, 'SUBMIT_ANSWER', {answers: 'Berlin'});
    const payloadPromise = once(game.students[0], 'QUESTION_RECEIVED');
    await showQuestion(game, {title: 'Your ideas?', type: 'word-cloud', answers: [], pointMultiplier: 'double'});
    const [payload] = await payloadPromise;
    assert.equal(payload.type, 'word-cloud');
    assert.equal(payload.maxLength, 40);

    for (const answer of ['', ' ', [], 12, 'a'.repeat(41)]) {
        assert.equal((await request(game.students[0], 'SUBMIT_ANSWER', {answers: answer})).success, false);
    }
    const liveUpdate = once(game.host, 'WORD_CLOUD_UPDATED');
    assert.equal((await request(game.students[0], 'SUBMIT_ANSWER', {answers: ' Climate '})).success, true);
    const [live] = await liveUpdate;
    assert.equal(live.totalResponses, 1);
    assert.equal(live.words[0].text, 'Climate');
    const progress = [];
    game.host.on('ANSWER_PROGRESS', update => progress.push(update.answeredCount));
    const second = await request(game.students[0], 'SUBMIT_ANSWER', {answers: 'Oceans'});
    assert.equal(second.success, true);
    assert.deepEqual(second.contributions, ['Climate', 'Oceans']);

    const restored = await request(game.students[0], 'RECONNECT_WITH_SESSION', {sessionId: game.sessionIds[0]});
    assert.equal(restored.gameState.currentQuestion.type, 'word-cloud');
    assert.equal(restored.gameState.hasAnswered, true);
    assert.deepEqual(restored.gameState.submittedAnswer, ['Climate', 'Oceans']);
    assert.equal(restored.gameState.questionCompleted, false);
    assert.equal(restored.gameState.playerPoints, 100);
    assert.equal(restored.gameState.streak, 1);

    await request(game.students[1], 'SUBMIT_ANSWER', {answers: 'climtae'});
    const stillOpen = await request(game.students[0], 'RECONNECT_WITH_SESSION', {sessionId: game.sessionIds[0]});
    assert.equal(stillOpen.gameState.questionCompleted, false, 'every student contributing must not close the collection');
    assert.equal((await request(game.students[0], 'SUBMIT_ANSWER', {answers: 'climate'})).success, true);

    const finalResult = once(game.students[0], 'ANSWER_RECEIVED');
    const pointsResult = once(game.students[0], 'POINTS_RECEIVED');
    await request(game.host, 'SKIP_QUESTION');
    const [cloud] = await finalResult;
    assert.equal(cloud.type, 'word-cloud');
    assert.equal(cloud.totalResponses, 4);
    assert.equal(cloud.words.length, 3);
    assert.equal(cloud.words[0].count, 2);
    assert.equal(cloud.words[0].group, cloud.words[1].group);
    assert.deepEqual(progress, [1, 2, 2], 'progress counts students rather than contributions');
    assert.equal((await request(game.students[0], 'SUBMIT_ANSWER', {answers: 'Too late'})).success, false);
    const [points] = await pointsResult;
    assert.equal(points.points, 100);
    assert.equal(points.pointsEarned, 0);
    assert.equal(points.streak, 1);
    const completed = await request(game.students[0], 'RECONNECT_WITH_SESSION', {sessionId: game.sessionIds[0]});
    assert.equal(completed.gameState.questionCompleted, true);
    assert.deepEqual(completed.gameState.answerData, cloud);
    assert.equal(completed.gameState.pointsEarned, 0);
    const ended = await request(game.host, 'END_GAME');
    assert.equal(ended.analytics.studentAnalytics[0].accuracy, 100);
    assert.equal(ended.analytics.questionAnalytics[1].ungraded, true);
    assert.equal(ended.analytics.questionAnalytics[1].totalResponses, 4);
    assert.deepEqual(ended.analytics.questionAnalytics[1].words, cloud.words);
});

test('a student can reconnect and keep contributing after everyone else disconnects', async t => {
    const game = await createGame(t);
    await showQuestion(game, {title: 'Your ideas?', type: 'word-cloud', answers: []});
    await request(game.students[0], 'SUBMIT_ANSWER', {answers: 'Climate'});
    game.students[1].disconnect();
    game.students[0].disconnect();

    const returning = await game.connect();
    const restored = await request(returning, 'RECONNECT_WITH_SESSION', {sessionId: game.sessionIds[0]});
    assert.equal(restored.gameState.questionCompleted, false);
    assert.deepEqual(restored.gameState.submittedAnswer, ['Climate']);
    const second = await request(returning, 'SUBMIT_ANSWER', {answers: 'Oceans'});
    assert.equal(second.success, true);
    assert.deepEqual(second.contributions, ['Climate', 'Oceans']);
    const third = await request(returning, 'SUBMIT_ANSWER', {answers: 'Forests'});
    assert.equal(third.success, true);

    const result = await request(game.host, 'SKIP_QUESTION');
    assert.equal(result.answerData.totalResponses, 3);
    assert.deepEqual(result.answers[returning.id], ['Climate', 'Oceans', 'Forests']);
    assert.equal(Object.keys(result.answers).length, 1);
});

test('the host can finish a word cloud without any submissions', async t => {
    const game = await createGame(t);
    await request(game.host, 'SHOW_QUESTION', {title: 'Any ideas?', type: 'word-cloud', answers: []});
    const result = await request(game.host, 'SKIP_QUESTION');
    assert.equal(result.answerData.type, 'word-cloud');
    assert.equal(result.answerData.totalResponses, 0);
    assert.deepEqual(result.answerData.words, []);
});
