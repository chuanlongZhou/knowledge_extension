import { EditorView, basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdown(source) {
  return DOMPurify.sanitize(marked.parse(source || ''), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'iframe', 'form'],
    FORBID_ATTR: ['style'],
  });
}

export function createMarkdownEditor(parent, value, onChange, onPaste) {
  let syncing = false;
  const view = new EditorView({
    doc: value,
    parent,
    extensions: [
      basicSetup,
      markdown(),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !syncing) onChange(update.state.doc.toString());
      }),
      EditorView.domEventHandlers({ paste: onPaste }),
    ],
  });
  return {
    get selection() {
      return view.state.selection.main;
    },
    setValue(next) {
      if (view.state.doc.toString() === next) return;
      syncing = true;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
      syncing = false;
    },
    focus() {
      view.focus();
    },
    destroy() {
      view.destroy();
    },
  };
}
