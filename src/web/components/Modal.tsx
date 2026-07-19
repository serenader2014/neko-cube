import { Children, cloneElement, isValidElement, useEffect, useId, useRef, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";

type ModalProps = {
  open: boolean;
  title: string;
  description?: string;
  size?: "regular" | "wide";
  onClose: () => void;
  children: ReactNode;
};

const MODAL_LOCK_COUNT_ATTR = "data-modal-lock-count";
const MODAL_PREVIOUS_OVERFLOW_ATTR = "data-modal-previous-overflow";
const MODAL_ACTIONS_CLASS = "modal-actions";
const MODAL_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

type ModalContentElement = ReactElement<{ children?: ReactNode; className?: string }>;

function lockDocumentScroll() {
  const currentCount = Number(document.body.getAttribute(MODAL_LOCK_COUNT_ATTR) ?? "0");

  if (currentCount === 0) {
    document.body.setAttribute(MODAL_PREVIOUS_OVERFLOW_ATTR, document.body.style.overflow);
    document.body.style.overflow = "hidden";
  }

  document.body.setAttribute(MODAL_LOCK_COUNT_ATTR, String(currentCount + 1));
}

function unlockDocumentScroll() {
  const currentCount = Number(document.body.getAttribute(MODAL_LOCK_COUNT_ATTR) ?? "0");

  if (currentCount <= 1) {
    const previousOverflow = document.body.getAttribute(MODAL_PREVIOUS_OVERFLOW_ATTR) ?? "";
    if (previousOverflow) {
      document.body.style.overflow = previousOverflow;
    } else {
      document.body.style.removeProperty("overflow");
    }

    document.body.style.removeProperty("pointer-events");
    document.body.removeAttribute(MODAL_LOCK_COUNT_ATTR);
    document.body.removeAttribute(MODAL_PREVIOUS_OVERFLOW_ATTR);
    return;
  }

  document.body.setAttribute(MODAL_LOCK_COUNT_ATTR, String(currentCount - 1));
}

function getModalEyebrow(title: string) {
  const normalizedTitle = title.trim();

  if (normalizedTitle.startsWith("新增")) {
    return "新增";
  }

  if (normalizedTitle.startsWith("编辑")) {
    return "编辑";
  }

  if (normalizedTitle.startsWith("排序")) {
    return "排序";
  }

  if (normalizedTitle.startsWith("批量")) {
    return "批量";
  }

  if (normalizedTitle.includes("导入")) {
    return "导入";
  }

  return "操作";
}

function getFocusableElements(container: HTMLElement | null) {
  if (!container) {
    return [];
  }

  return Array.from(container.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.hasAttribute("disabled") || element.getAttribute("aria-hidden") === "true") {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

function hasClassName(node: ReactNode, className: string) {
  if (!isValidElement<{ className?: unknown }>(node)) {
    return false;
  }

  return typeof node.props.className === "string" && node.props.className.split(/\s+/).includes(className);
}

function splitFooter(nodes: ReactNode) {
  const items = Children.toArray(nodes);
  const lastItem = items[items.length - 1];

  if (!hasClassName(lastItem, MODAL_ACTIONS_CLASS)) {
    return { body: nodes, footer: null };
  }

  return {
    body: items.slice(0, -1),
    footer: lastItem,
  };
}

function renderModalContent(children: ReactNode) {
  const items = Children.toArray(children);

  if (items.length === 1 && isValidElement(items[0]) && typeof items[0].type === "string" && items[0].type === "form") {
    const form = items[0] as ModalContentElement;
    const { body, footer } = splitFooter(form.props.children);
    const originalClassName = form.props.className;

    return cloneElement(
      form,
      {
        className: ["modal-form", originalClassName].filter(Boolean).join(" "),
      },
      <>
        <div className={["modal-body", originalClassName].filter(Boolean).join(" ")}>{body}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </>,
    );
  }

  const { body, footer } = splitFooter(children);
  return (
    <>
      <div className="modal-body">{body}</div>
      {footer ? <div className="modal-footer">{footer}</div> : null}
    </>
  );
}

export function Modal({ open, title, description, size = "regular", onClose, children }: ModalProps) {
  const lockAcquiredRef = useRef(false);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  // Callers pass inline onClose functions; keep the focus/lock effect keyed on
  // `open` only, or every parent re-render re-runs it and yanks focus (and
  // scroll position) back to the top of the modal.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();
  const descriptionId = useId();
  const modalEyebrow = getModalEyebrow(title);

  useEffect(() => {
    if (typeof document === "undefined" || open) {
      return;
    }

    if (document.querySelector(".modal-backdrop")) {
      return;
    }

    unlockDocumentScroll();
  }, [open]);

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      return undefined;
    }

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusModalContent = window.setTimeout(() => {
      const body = modalRef.current?.querySelector<HTMLElement>(".modal-body") ?? null;
      const focusableInBody = getFocusableElements(body);
      const focusableInModal = getFocusableElements(modalRef.current);
      const preferredFocusTarget = modalRef.current?.querySelector<HTMLElement>("[data-autofocus]");
      const nextFocusTarget = preferredFocusTarget ?? focusableInBody[0] ?? focusableInModal[0] ?? modalRef.current;

      nextFocusTarget?.focus();
    }, 0);

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = getFocusableElements(modalRef.current);
      if (!focusableElements.length) {
        event.preventDefault();
        modalRef.current?.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement?.focus();
        return;
      }

      if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement?.focus();
      }
    };

    lockDocumentScroll();
    lockAcquiredRef.current = true;
    window.addEventListener("keydown", handleKeydown);

    return () => {
      window.clearTimeout(focusModalContent);

      if (lockAcquiredRef.current) {
        unlockDocumentScroll();
        lockAcquiredRef.current = false;
      }

      window.removeEventListener("keydown", handleKeydown);

      if (previousFocusRef.current && document.contains(previousFocusRef.current)) {
        previousFocusRef.current.focus();
      }
    };
  }, [open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`modal-shell modal-shell-${size}`}
        onClick={(event) => event.stopPropagation()}
        ref={modalRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">{modalEyebrow}</p>
            <h3 id={titleId}>{title}</h3>
            {description ? <p className="modal-description" id={descriptionId}>{description}</p> : null}
          </div>
          <button aria-label="关闭弹窗" className="icon-button" onClick={onClose} type="button">
            ×
          </button>
        </div>
        {renderModalContent(children)}
      </div>
    </div>,
    document.body,
  );
}
