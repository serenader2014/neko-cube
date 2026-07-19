import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { ConfigFragment } from "@shared/types";
import { Modal } from "./Modal";
import { StatusSwitch } from "./StatusSwitch";

type ConfigFragmentEditorProps = {
  draft: ConfigFragment;
  setDraft: Dispatch<SetStateAction<ConfigFragment>>;
};

type ConfigFragmentCardProps = {
  fragment: ConfigFragment;
  title: string;
  description?: string;
  editorHint?: string;
  preview: ReactNode;
  onSave: (value: ConfigFragment) => Promise<unknown> | unknown;
  isSaving?: boolean;
  isTogglePending?: boolean;
  saveLabel?: string;
  renderEditor?: (props: ConfigFragmentEditorProps) => ReactNode;
  onToggleEnabled?: (nextEnabled: boolean) => Promise<unknown> | unknown;
  open?: boolean;
  onOpenChange?: (nextOpen: boolean) => void;
  onOpenEditor?: () => void;
  editLabel?: string;
};

export function ConfigFragmentCard({
  fragment,
  title,
  description,
  editorHint,
  preview,
  onSave,
  isSaving = false,
  isTogglePending = false,
  saveLabel = "保存片段",
  renderEditor,
  onToggleEnabled,
  open,
  onOpenChange,
  onOpenEditor,
  editLabel = "编辑",
}: ConfigFragmentCardProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [draft, setDraft] = useState(fragment);
  const isOpen = open ?? internalOpen;

  useEffect(() => {
    setDraft(fragment);
  }, [fragment]);

  function closeEditor() {
    if (onOpenChange) {
      onOpenChange(false);
    } else {
      setInternalOpen(false);
    }
    setDraft(fragment);
  }

  function openEditor() {
    setDraft(fragment);
    onOpenEditor?.();

    if (onOpenChange) {
      onOpenChange(true);
    } else {
      setInternalOpen(true);
    }
  }

  return (
    <>
      <article className="fragment-card">
        <div className="section-header">
          <div>
            <h4>{title}</h4>
            {description ? <p className="muted">{description}</p> : null}
          </div>
          <div className="inline-actions">
            {onToggleEnabled ? (
              <StatusSwitch
                checked={fragment.enabled}
                disabled={isTogglePending}
                onChange={onToggleEnabled}
                title={`切换 ${title} 的启用状态`}
              />
            ) : null}
            <button
              className="button-secondary"
              onClick={openEditor}
              type="button"
            >
              {editLabel}
            </button>
          </div>
        </div>
        <div className="fragment-preview">{preview}</div>
      </article>

      <Modal description={description} onClose={closeEditor} open={isOpen} title={`编辑 ${title}`} size="wide">
        <form
          className="stack"
          onSubmit={async (event) => {
            event.preventDefault();
            await onSave(draft);
            if (onOpenChange) {
              onOpenChange(false);
            } else {
              setInternalOpen(false);
            }
          }}
        >
          {editorHint ? <p className="muted">{editorHint}</p> : null}
          {renderEditor ? (
            renderEditor({ draft, setDraft })
          ) : (
            <div className="field">
              <label>原始 YAML</label>
              <textarea
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    yamlText: event.target.value,
                  }))
                }
                value={draft.yamlText}
              />
            </div>
          )}
          <div className="modal-actions">
            <button className="button-secondary" onClick={closeEditor} type="button">
              取消
            </button>
            <button className="button" disabled={isSaving} type="submit">
              {saveLabel}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
