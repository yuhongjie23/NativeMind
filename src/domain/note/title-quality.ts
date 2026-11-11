/** Presentation check only; never guesses a topic from a URL or deletes a note. */
export function needsReadableTitle(title: string): boolean {
  const value = title.trim();
  return !value || /https?:\/\/|www\./i.test(value)
    || /^(?:[a-z0-9-]+\.)+(?:com|org|net|edu|gov|cn|io|ai|dev|app|info|me|co|uk)(?:[/:?#]\S*)?$/i.test(value)
    || /^(?:untitled|无标题|未命名)(?:[\s_\d-]*)$/i.test(value);
}
