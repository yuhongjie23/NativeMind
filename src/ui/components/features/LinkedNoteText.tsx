import { Fragment, useMemo, type RefObject } from 'react';
import { parseWikiLinks } from '@domain/note/wiki-link';
import { partitionLinkedText } from './linked-note-text';
import { useT } from '../../i18n';

export function LinkedNoteText({ content, selection, marker, onOpen }: {
  content: string;
  selection?: { start: number; end: number };
  marker: RefObject<HTMLElement | null>;
  onOpen?: (title: string) => void;
}) {
  const t = useT();
  const enabled = Boolean(onOpen);
  const links = useMemo(() => enabled ? parseWikiLinks(content) : [], [content, enabled]);
  const parts = useMemo(() => partitionLinkedText(content, links, selection), [content, links, selection]);
  const groups = useMemo(() => {
    const result: Array<{ link: typeof parts[number]['link']; parts: typeof parts }> = [];
    for (const part of parts) {
      const last = result[result.length - 1];
      if (last && last.link === part.link) last.parts.push(part);
      else result.push({ link: part.link, parts: [part] });
    }
    return result;
  }, [parts]);
  const firstHighlight = parts.find(part => part.highlighted)?.start;
  return <>{groups.map(group => {
    const text = group.parts.map(part => <Fragment key={part.start}>{part.highlighted ? <mark ref={part.start === firstHighlight ? marker : undefined}
      style={{ background: '#f4c95d', color: '#171717', font: 'inherit' }}>{part.text}</mark> : part.text}</Fragment>);
    return <Fragment key={group.parts[0].start}>{group.link ? <button type="button"
      aria-label={t('打开笔记：{0}', group.link.label)} title={group.link.title}
      onClick={() => onOpen?.(group.link!.title)}
      style={{ display: 'inline', padding: 0, border: 0, background: 'transparent', font: 'inherit', color: 'inherit',
        textDecoration: 'underline', cursor: 'pointer', textAlign: 'inherit', whiteSpace: 'inherit', overflowWrap: 'anywhere' }}>{text}</button> : text}</Fragment>;
  })}</>;
}
