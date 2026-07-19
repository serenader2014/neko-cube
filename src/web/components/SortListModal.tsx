import { useEffect, useMemo, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type DragOverEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Modal } from "./Modal";
import { SortHandle } from "./SortHandle";

export type SortListItem = {
  id: string;
  title: string;
};

type SortListModalProps = {
  open: boolean;
  title: string;
  description?: string;
  items: SortListItem[];
  isSaving?: boolean;
  onClose: () => void;
  onSave: (items: SortListItem[]) => Promise<void> | void;
};

type SortableModalRowProps = {
  item: SortListItem;
  disabled: boolean;
  isDragTarget: boolean;
};

function SortableModalRow({ item, disabled, isDragTarget }: SortableModalRowProps) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled,
  });

  return (
    <div
      className={`sort-modal-row ${isDragging ? "is-dragging" : ""} ${isDragTarget ? "is-drag-target" : ""}`.trim()}
      key={item.id}
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      <SortHandle
        buttonProps={{ ...attributes, ...listeners }}
        disabled={disabled}
        handleRef={setActivatorNodeRef}
        title={`拖动调整 ${item.title} 的顺序`}
      />
      <strong>{item.title}</strong>
    </div>
  );
}

export function SortListModal({ open, title, description, items, isSaving = false, onClose, onSave }: SortListModalProps) {
  const [draftItems, setDraftItems] = useState<SortListItem[]>(items);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    if (open) {
      setDraftItems(items);
      setActiveId(null);
      setOverId(null);
    }
  }, [items, open]);

  const hasChanges = useMemo(
    () => draftItems.length !== items.length || draftItems.some((item, index) => item.id !== items[index]?.id),
    [draftItems, items],
  );

  function resetDragState() {
    setActiveId(null);
    setOverId(null);
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
    setOverId(String(event.active.id));
  }

  function handleDragOver(event: DragOverEvent) {
    setOverId(event.over ? String(event.over.id) : null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const nextOverId = event.over ? String(event.over.id) : null;
    if (!nextOverId || event.active.id === event.over?.id) {
      resetDragState();
      return;
    }

    setDraftItems((current) => {
      const activeIndex = current.findIndex((item) => item.id === String(event.active.id));
      const overIndex = current.findIndex((item) => item.id === nextOverId);
      return arrayMove(current, activeIndex, overIndex);
    });
    resetDragState();
  }

  return (
    <Modal description={description} onClose={onClose} open={open} title={title}>
      <div className="stack">
        <div className="sort-modal-help">
          <span className="chip sort-modal-count">{draftItems.length} 项</span>
          <p className="muted">拖动左侧把手排序。键盘也可用：空格开始，方向键移动，再按空格落位。</p>
        </div>
        <DndContext
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDragStart={handleDragStart}
          onDragCancel={resetDragState}
          sensors={sensors}
        >
          <SortableContext items={draftItems.map((item) => item.id)} strategy={verticalListSortingStrategy}>
            <div className="sort-modal-list">
              {draftItems.map((item) => (
                <SortableModalRow disabled={isSaving} isDragTarget={overId === item.id && activeId !== item.id} item={item} key={item.id} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
        <div className="modal-actions">
          <button className="button-secondary" onClick={onClose} type="button">
            取消
          </button>
          <button className="button" disabled={isSaving || !hasChanges} onClick={() => void onSave(draftItems)} type="button">
            {isSaving ? "保存中..." : "保存顺序"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
