import { type ButtonHTMLAttributes, type ReactNode, type RefCallback } from "react";
import { KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type SortableFragmentHandleProps = {
  buttonProps: ButtonHTMLAttributes<HTMLButtonElement>;
  handleRef: RefCallback<HTMLButtonElement>;
  isDragging: boolean;
};

type SortableFragmentRowProps = {
  id: string;
  isActive: boolean;
  isDragTarget: boolean;
  children: (props: SortableFragmentHandleProps) => ReactNode;
};

export function useSortableInteractionSensors() {
  return useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
}

export function SortableFragmentRow({ id, isActive, isDragTarget, children }: SortableFragmentRowProps) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  return (
    <article
      className={`fragment-editor-row ${isActive ? "is-active" : ""} ${isDragging ? "is-dragging" : ""} ${
        isDragTarget ? "is-drag-target" : ""
      }`.trim()}
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      {children({
        buttonProps: { ...attributes, ...listeners },
        handleRef: setActivatorNodeRef,
        isDragging,
      })}
    </article>
  );
}
