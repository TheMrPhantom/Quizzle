import {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {faExpand, faCompress, faMinus, faPlus, faArrowsToCircle} from '@fortawesome/free-solid-svg-icons';
import {WordCloudWords, WordCloudSummary} from '../WordCloud/WordCloud.jsx';
import './styles.sass';

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
const clampScale = value => Math.max(MIN_SCALE, Math.min(MAX_SCALE, value));
const center = points => ({x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2});
const distance = points => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);

export const WordCloudPanel = ({title, words = [], totalResponses = 0, actionLabel, onAction}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isPanning, setIsPanning] = useState(false);
    const [view, setView] = useState({x: 0, y: 0, scale: 1});
    const currentView = useRef(view);
    const viewport = useRef(null);
    const world = useRef(null);
    const pointers = useRef(new Map());
    const autoFit = useRef(true);
    const helpId = useId();

    const updateView = next => {
        currentView.current = next;
        setView(next);
    };

    const fitAll = () => {
        if (!viewport.current || !world.current) return;
        const {clientWidth: width, clientHeight: height} = viewport.current;
        const {offsetWidth: worldWidth, offsetHeight: worldHeight} = world.current;
        const scale = clampScale(Math.min(1.5, (width - 48) / worldWidth, (height - 48) / Math.max(1, worldHeight)));
        updateView({x: (width - worldWidth * scale) / 2, y: (height - worldHeight * scale) / 2, scale});
        autoFit.current = true;
    };

    // Keep the initial overview fitted as contributions arrive. Once someone
    // pans or zooms, new submissions must leave their chosen view in place.
    useLayoutEffect(() => {
        const observer = new ResizeObserver(() => { if (autoFit.current) fitAll(); });
        observer.observe(viewport.current);
        observer.observe(world.current);
        fitAll();
        return () => observer.disconnect();
    }, []);

    const zoomAt = (factor, point) => {
        const previous = currentView.current;
        const scale = clampScale(previous.scale * factor);
        const anchor = point || {x: viewport.current.clientWidth / 2, y: viewport.current.clientHeight / 2};
        autoFit.current = false;
        updateView({
            x: anchor.x - (anchor.x - previous.x) * scale / previous.scale,
            y: anchor.y - (anchor.y - previous.y) * scale / previous.scale,
            scale
        });
    };

    useEffect(() => {
        const element = viewport.current;
        const onWheel = event => {
            event.preventDefault();
            const rect = element.getBoundingClientRect();
            const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
            zoomAt(Math.exp(-delta * 0.0015), {x: event.clientX - rect.left, y: event.clientY - rect.top});
        };
        element.addEventListener('wheel', onWheel, {passive: false});
        return () => element.removeEventListener('wheel', onWheel);
    }, []);

    const pointerPosition = event => {
        const rect = viewport.current.getBoundingClientRect();
        return {x: event.clientX - rect.left, y: event.clientY - rect.top};
    };

    const onPointerDown = event => {
        if (event.button !== 0) return;
        event.preventDefault();
        viewport.current.focus({preventScroll: true});
        event.currentTarget.setPointerCapture(event.pointerId);
        pointers.current.set(event.pointerId, pointerPosition(event));
        autoFit.current = false;
        setIsPanning(true);
    };

    const onPointerMove = event => {
        if (!pointers.current.has(event.pointerId)) return;
        const before = [...pointers.current.values()].slice(0, 2);
        pointers.current.set(event.pointerId, pointerPosition(event));
        const after = [...pointers.current.values()].slice(0, 2);
        const previous = currentView.current;
        if (after.length === 1) {
            updateView({...previous, x: previous.x + after[0].x - before[0].x, y: previous.y + after[0].y - before[0].y});
        } else {
            const oldCenter = center(before);
            const newCenter = center(after);
            const scale = clampScale(previous.scale * distance(after) / Math.max(1, distance(before)));
            updateView({
                x: newCenter.x - (oldCenter.x - previous.x) * scale / previous.scale,
                y: newCenter.y - (oldCenter.y - previous.y) * scale / previous.scale,
                scale
            });
        }
    };

    const endPointer = event => {
        pointers.current.delete(event.pointerId);
        setIsPanning(pointers.current.size > 0);
    };

    const onKeyDown = event => {
        const direction = {ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1]}[event.key];
        if (direction) {
            event.preventDefault();
            autoFit.current = false;
            const step = event.shiftKey ? 120 : 40;
            const previous = currentView.current;
            updateView({...previous, x: previous.x + direction[0] * step, y: previous.y + direction[1] * step});
        } else if (['+', '=', '-', '0'].includes(event.key)) {
            event.preventDefault();
            if (event.key === '0') fitAll();
            else zoomAt(event.key === '-' ? 1 / 1.2 : 1.2);
        }
    };

    const toggleExpanded = () => {
        // Preserve the world point in the center when the viewport changes.
        const previous = currentView.current;
        const oldSize = {width: viewport.current.clientWidth, height: viewport.current.clientHeight};
        setIsExpanded(value => !value);
        requestAnimationFrame(() => {
            if (!viewport.current) return;
            if (autoFit.current) fitAll();
            else updateView({...previous,
                x: previous.x + (viewport.current.clientWidth - oldSize.width) / 2,
                y: previous.y + (viewport.current.clientHeight - oldSize.height) / 2});
        });
    };

    return createPortal(
        <section className={`word-cloud-panel${isExpanded ? ' word-cloud-panel-expanded' : ''}`}
                 aria-label="Wortwolken-Ergebnisse"
                 onKeyDown={event => { if (event.key === 'Escape' && isExpanded) toggleExpanded(); }}>
            <div className="word-cloud-panel-toolbar">
                <div className="word-cloud-panel-title" title={title}>{title || 'Wortwolke'}</div>
                <div className="word-cloud-panel-tools" role="group" aria-label="Darstellung der Wortwolke">
                    <button type="button" aria-label="Herauszoomen" title="Herauszoomen" disabled={view.scale <= MIN_SCALE} onClick={() => zoomAt(1 / 1.2)}>
                        <FontAwesomeIcon icon={faMinus} aria-hidden="true"/>
                    </button>
                    <output aria-label="Vergrößerung">{Math.round(view.scale * 100)}%</output>
                    <button type="button" aria-label="Hineinzoomen" title="Hineinzoomen" disabled={view.scale >= MAX_SCALE} onClick={() => zoomAt(1.2)}>
                        <FontAwesomeIcon icon={faPlus} aria-hidden="true"/>
                    </button>
                    <button type="button" aria-label="Alle Begriffe anzeigen" title="Alle Begriffe einpassen" onClick={fitAll}>
                        <FontAwesomeIcon icon={faArrowsToCircle} aria-hidden="true"/>
                    </button>
                    <button type="button" aria-label={isExpanded ? 'Vollbild verlassen' : 'Wortwolke im Vollbild anzeigen'}
                            title={isExpanded ? 'Vollbild verlassen' : 'Vollbild'} aria-pressed={isExpanded} onClick={toggleExpanded}>
                        <FontAwesomeIcon icon={isExpanded ? faCompress : faExpand} aria-hidden="true"/>
                    </button>
                </div>
                {onAction && <button type="button" className="word-cloud-panel-action" onClick={onAction}>{actionLabel}</button>}
            </div>
            <WordCloudSummary words={words} totalResponses={totalResponses}/>
            <div ref={viewport} className={`word-cloud-plane${isPanning ? ' is-panning' : ''}`}
                 tabIndex={0} role="region" aria-label="Wortwolke verschieben und zoomen" aria-describedby={helpId}
                 style={{backgroundPosition: `${view.x}px ${view.y}px`}}
                 onPointerDown={onPointerDown} onPointerMove={onPointerMove}
                 onPointerUp={endPointer} onPointerCancel={endPointer} onLostPointerCapture={endPointer}
                 onKeyDown={onKeyDown}
                 onDoubleClick={event => zoomAt(1.5, pointerPosition(event))}>
                <div ref={world} className="word-cloud-plane-world"
                     style={{width: Math.max(500, Math.ceil(Math.sqrt(words.length)) * 120), transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`}}>
                    {words.length > 0 ? <WordCloudWords words={words}/>
                        : <p className="word-cloud-empty">Die Wortwolke wächst mit euren Antworten.</p>}
                </div>
            </div>
            <p id={helpId} className="word-cloud-panel-help">Ziehen oder Pfeiltasten zum Verschieben · Mausrad, +/− oder zwei Finger zum Zoomen</p>
        </section>, document.body
    );
};
