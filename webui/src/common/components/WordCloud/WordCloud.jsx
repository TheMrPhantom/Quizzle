import './styles.sass';

const COLORS = ['#6547ee', '#1463b3', '#146a50', '#a23d68', '#8b5911'];

const getGroupColor = (key) => {
    let hash = 0;
    for (const character of key) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
    return COLORS[hash % COLORS.length];
};

export const WordCloudWords = ({words = []}) => {
    const maxCount = Math.max(1, ...words.map(word => word.count));
    const groups = new Map();
    for (const word of words) {
        const key = word.group || word.text.toLowerCase();
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(word);
    }

    return (
        <ul className="word-cloud-words">
            {[...groups.entries()].map(([key, entries]) => (
                <li key={key} className="word-cloud-group" aria-label={entries.length > 1 ? 'Ähnliche Begriffe' : undefined}>
                    {entries.map(word => {
                        const weight = maxCount > 1 ? Math.log(word.count) / Math.log(maxCount) : 0;
                        return (
                            <span key={word.text} className="word-cloud-word"
                                  style={{backgroundColor: getGroupColor(key), fontSize: `${1 + weight * 1.2}rem`}}
                                  aria-label={`${word.text}: ${word.count} ${word.count === 1 ? 'Antwort' : 'Antworten'}`}>
                                <span className="word-cloud-label">{word.text}</span>
                                <small className="word-cloud-count" aria-hidden="true">{word.count}</small>
                            </span>
                        );
                    })}
                </li>
            ))}
        </ul>
    );
};

export const WordCloudSummary = ({words = [], totalResponses = 0}) => (
    <p className="word-cloud-summary" aria-live="polite">
        {totalResponses} {totalResponses === 1 ? 'Antwort' : 'Antworten'} · {words.length} {words.length === 1 ? 'Begriff' : 'Begriffe'}
    </p>
);

export const WordCloud = ({words = [], totalResponses = 0}) => (
    <section className="word-cloud" aria-label="Wortwolke">
        <WordCloudSummary words={words} totalResponses={totalResponses}/>
        {words.length === 0
            ? <p className="word-cloud-empty">Die Wortwolke wächst mit euren Antworten.</p>
            : <WordCloudWords words={words}/>}
        {words.length > 0 && <p className="word-cloud-hint">Ähnliche Schreibweisen stehen nebeneinander.</p>}
    </section>
);
