import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import pako from 'pako';
import validation from '../../server/validations/quiz.js';
import {QUESTION_TYPES, DEFAULT_QUESTION_TYPE} from '../src/common/constants/QuestionTypes.js';
import {DEFAULT_QUIZ_SETTINGS} from '../src/common/constants/QuizSettings.js';
import {normalizeAnswersForType} from '../src/common/utils/QuizAnswerUtil.js';
import {QuizValidationUtil} from '../src/common/utils/QuizValidationUtil.js';

const plain = value => JSON.parse(JSON.stringify(value));
const readSource = path => readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/^export /gm, '');

const legacyQuiz = {
    __type: 'QUIZZLE2', title: 'Legacy quiz',
    settings: {...DEFAULT_QUIZ_SETTINGS, shuffleQuestions: false, shuffleAnswers: false, defaultTimer: -1},
    questions: [
        {title: 'Order the layers', type: 'sequence', answers: [
            {content: 'Application', order: 1}, {content: 'Transport', order: 2}
        ]},
        {title: 'Which layer?', type: 'multiple-choice', answers: [
            {content: 'Application', order: 1, id: 'answer-1', type: 'text', is_correct: true},
            {content: 'Transport', order: 2, id: 'answer-2', type: 'text', is_correct: false}
        ]}
    ]
};

// Supply browser services while exercising the actual export and loading code.
const createExporter = (imageCache = {}) => runInNewContext(
    `${readSource('../src/common/utils/QuizDataUtil.js')}\n({prepareQuizData, prepareQuizDataForExport})`,
    {imageCache, QUESTION_TYPES, DEFAULT_QUESTION_TYPE, normalizeAnswersForType, console}
);

const createLoader = () => {
    const states = [];
    const source = readSource('../src/common/contexts/Quiz/QuizContext.jsx');
    const provider = source.slice(0, source.search(/    return \(\r?\n\s*<QuizContext.Provider/));
    const api = runInNewContext(`${provider}
        return {loadQuizByContent, loadQuizById};
    };
    QuizProvider({});`, {
        createContext: () => ({}), useEffect: () => {}, useMemo: callback => callback(),
        useState: initial => {
            const index = states.length;
            states.push(typeof initial === 'function' ? initial() : initial);
            return [states[index], value => { states[index] = value; }];
        },
        soundManager: {getSoundEnabled: () => false, getMasterVolume: () => 100},
        pako, QuizValidationUtil, DEFAULT_QUIZ_SETTINGS, normalizeAnswersForType,
        request: async () => ({ok: true, blob: async () => new Blob([pako.deflate(JSON.stringify(legacyQuiz))])})
    });
    return {...api, states};
};

test('choice answers converted from a sequence keep their content and lose sequence metadata', () => {
    const answers = normalizeAnswersForType([
        {content: 'Application', order: 1, id: 'answer-1'},
        {content: 'Transport', order: 2, id: 'answer-2'}
    ], QUESTION_TYPES.MULTIPLE_CHOICE, {includeEditorData: true});
    assert.deepEqual(answers, [
        {content: 'Application', type: 'text', is_correct: false},
        {content: 'Transport', type: 'text', is_correct: false}
    ]);
});

test('editor image references and sequence IDs are kept only when editing their matching types', () => {
    const image = {content: '', type: 'image', is_correct: true, imageId: 'cached-image', id: 'stale', order: 1};
    assert.deepEqual(normalizeAnswersForType([image], QUESTION_TYPES.MULTIPLE_CHOICE, {includeEditorData: true}), [
        {content: '', type: 'image', is_correct: true, imageId: 'cached-image'}
    ]);
    const answers = [{content: 'First', id: 'drag-1', type: 'text', is_correct: true}, {content: 'Second', id: 'drag-2'}];
    assert.deepEqual(normalizeAnswersForType(answers, QUESTION_TYPES.SEQUENCE, {includeEditorData: true}), [
        {content: 'First', order: 1, id: 'drag-1'}, {content: 'Second', order: 2, id: 'drag-2'}
    ]);
    const question = {title: 'Sequence', type: 'sequence', answers: normalizeAnswersForType(answers, QUESTION_TYPES.SEQUENCE)};
    assert.equal(validation.questionValidation.validate(question).error, undefined);
});

test('normalization removes editor fields from every graded answer format without changing source data', () => {
    const questions = [
        legacyQuiz.questions[1],
        {title: 'True?', type: 'true-false', answers: [
            {content: 'Wahr', type: 'text', is_correct: true}, {content: 'Falsch', type: 'text', is_correct: false}
        ]},
        {title: 'Name a layer', type: 'text', answers: [{content: 'Application'}]},
        legacyQuiz.questions[0],
        {title: 'Estimate', type: 'slider', answers: [{min: 0, max: 10, correctValue: 3, step: 1, answerMargin: 'low'}]}
    ];
    for (const question of questions) {
        const dirty = {...question, answers: question.answers.map(answer => ({...answer, id: 'editor', imageId: 'cache'}))};
        const snapshot = plain(dirty);
        const clean = {...dirty, answers: normalizeAnswersForType(dirty.answers, dirty.type)};
        assert.equal(validation.questionValidation.validate(clean).error, undefined, question.type);
        assert.deepEqual(dirty, snapshot, 'normalization must not mutate the editor state');
    }
});

test('exported and uploaded legacy quizzes satisfy the server schema and preserve correct answers', async () => {
    assert.match(validation.questionValidation.validate(legacyQuiz.questions[1]).error.message, /order/);
    const snapshot = plain(legacyQuiz);
    const exporter = createExporter();
    const exported = plain(await exporter.prepareQuizDataForExport(legacyQuiz.questions, legacyQuiz.title));
    const uploaded = plain(await exporter.prepareQuizData(legacyQuiz.questions, legacyQuiz.title, true));
    assert.equal(validation.quizUpload.validate(uploaded).error, undefined);
    assert.equal(validation.quizUpload.validate({title: exported.title, questions: exported.questions}).error, undefined);
    assert.deepEqual(exported.questions[0], legacyQuiz.questions[0]);
    assert.equal(exported.questions[1].answers[0].is_correct, true);
    assert.deepEqual(exported.questions[1].answers.map(answer => answer.content), ['Application', 'Transport']);
    assert.deepEqual(legacyQuiz, snapshot);
});

test('export embeds cached answer images without leaking image IDs or sequence fields', async () => {
    const imageData = 'data:image/png;base64,aGVsbG8=';
    const exporter = createExporter({getImage: async id => {
        assert.equal(id, 'cached-image');
        return imageData;
    }});
    const question = {title: 'Choose the image', type: 'multiple-choice', answers: [
        {type: 'image', content: '', imageId: 'cached-image', is_correct: true, id: 'stale', order: 1},
        {type: 'text', content: ' Other ', is_correct: false}
    ]};
    const uploaded = plain(await exporter.prepareQuizData([question], 'Images', true));
    assert.equal(validation.quizUpload.validate(uploaded).error, undefined);
    assert.deepEqual(uploaded.questions[0].answers, [
        {type: 'image', content: imageData, is_correct: true},
        {type: 'text', content: 'Other', is_correct: false}
    ]);
    assert.equal(question.answers[0].imageId, 'cached-image');
});

for (const source of ['file', 'id']) {
    test(`loading an existing quiz by ${source} produces valid live questions`, async () => {
        const loader = createLoader();
        const loaded = source === 'file'
            ? loader.loadQuizByContent(pako.deflate(JSON.stringify(legacyQuiz)))
            : await loader.loadQuizById('legacy');
        assert.equal(loaded, true);
        const quiz = plain(loader.states[0]);
        assert.equal(validation.quizUpload.validate(quiz).error, undefined);
        assert.equal(quiz.questions[1].answers[0].is_correct, true);
        assert.deepEqual(quiz.questions[0].answers, legacyQuiz.questions[0].answers);
        assert.deepEqual(quiz.settings, legacyQuiz.settings);
        assert.equal(quiz.questions[1].timer, -1);
    });
}
