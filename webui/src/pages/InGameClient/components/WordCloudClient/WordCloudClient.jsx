import {useRef, useState} from 'react';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {faPaperPlane} from '@fortawesome/free-solid-svg-icons';
import {WORD_CLOUD_MAX_LENGTH} from '@/common/constants/QuestionTypes.js';
import '../TextInputClient/styles.sass';
import './styles.sass';

export const WordCloudClient = ({contributions, onSubmit, onFinish}) => {
    const [text, setText] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const pending = useRef(false);
    const input = useRef(null);
    const trimmedText = text.trim();

    const submit = async (finish = false) => {
        if (pending.current || (!finish && !trimmedText)) return;
        pending.current = true;
        setIsSubmitting(true);
        try {
            const accepted = finish
                ? await onFinish(trimmedText ? [...contributions, trimmedText] : contributions)
                : await onSubmit(trimmedText);
            if (accepted !== false) setText('');
        } finally {
            pending.current = false;
            setIsSubmitting(false);
            input.current?.focus();
        }
    };

    return (
        <div className="word-cloud-client">
            <p className="word-cloud-entry-hint">
                {onFinish
                    ? 'Sammle mehrere Begriffe und sende sie zusammen ab.'
                    : 'Du kannst mehrere Begriffe senden, bis die Sammlung beendet wird.'}
            </p>
            <div className="text-input-client">
                <div className="text-input-container">
                    <textarea
                        ref={input}
                        value={text}
                        onChange={event => setText(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                                event.preventDefault();
                                submit();
                            }
                        }}
                        maxLength={WORD_CLOUD_MAX_LENGTH}
                        placeholder="Ein Begriff oder eine kurze Wortgruppe..."
                        className="text-answer-input"
                        aria-label="Begriff eingeben"
                        readOnly={isSubmitting}
                    />
                    <div className="character-count">{text.length}/{WORD_CLOUD_MAX_LENGTH}</div>
                </div>
                <button type="button" className="submit-text-answer submit-shown"
                        disabled={!trimmedText || isSubmitting} onClick={() => submit()}>
                    <FontAwesomeIcon icon={faPaperPlane} aria-hidden="true"/>
                    {onFinish ? 'Begriff hinzufügen' : 'Begriff senden'}
                </button>
            </div>
            <div className="word-cloud-contributions" aria-live="polite" aria-atomic="true">
                <p>{onFinish ? 'Gesammelte' : 'Gesendete'} Beiträge: {contributions.length}</p>
                {contributions.length > 0 && (
                    <ul>{contributions.map((term, index) => <li key={index}>{term}</li>)}</ul>
                )}
            </div>
            {onFinish && (
                <button type="button" className="practice-next-button"
                        disabled={isSubmitting || (contributions.length === 0 && !trimmedText)}
                        onClick={() => submit(true)}>
                    Beiträge absenden
                </button>
            )}
        </div>
    );
};
