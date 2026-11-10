import {QUESTION_TYPES} from '../constants/QuestionTypes.js';

export const normalizeAnswersForType = (answers, questionType, {includeEditorData = false} = {}) => {
    return answers.map((answer, index) => {
        let normalized;
        switch (questionType) {
            case QUESTION_TYPES.MULTIPLE_CHOICE:
            case QUESTION_TYPES.TRUE_FALSE:
                normalized = {
                    type: answer.type || QUESTION_TYPES.TEXT,
                    content: answer.content,
                    is_correct: answer.is_correct || false
                };
                if (includeEditorData && answer.imageId) normalized.imageId = answer.imageId;
                break;
            case QUESTION_TYPES.SEQUENCE:
                normalized = {content: answer.content, order: answer.order ?? index + 1};
                if (includeEditorData && answer.id) normalized.id = answer.id;
                break;
            case QUESTION_TYPES.TEXT:
                normalized = {content: answer.content};
                break;
            case QUESTION_TYPES.SLIDER:
                normalized = {
                    correctValue: answer.correctValue,
                    min: answer.min,
                    max: answer.max,
                    step: answer.step,
                    answerMargin: answer.answerMargin
                };
                break;
            default:
                return {...answer};
        }
        return normalized;
    });
};
